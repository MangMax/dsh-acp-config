// Assemble the `StatusPayload` the settings page renders: the ACP composition
// merged with the live plugin list of the profile serving the page, the preset
// candidates, the current sandbox/preset values and the drift report.
import type {
  AcpProfileInfo,
  AgentModeChoice,
  LocalizedText,
  LockReason,
  PluginMode,
  PluginRowView,
  PresetOption,
  SandboxApproval,
  SandboxChoice,
  SandboxMode,
  StatusPayload,
  WebPermission,
} from '../shared/contract.js'
import type { Composition, CompositionRow } from './dump.js'
import type {
  DumpOutcome,
  PackageMeta,
  PresetCompositionInventory,
  WebPluginInfo,
  WebStatePort,
} from './ports.js'
import type { PersistedState } from './state.js'
import { readProfileBundles } from './paths.js'
import type { ProfilePaths as Paths } from './paths.js'
import type { FsPort } from './ports.js'

/** Host rows ACP's own bundle layout owns; the page must never rewrite them. */
export const INFRA_IDS: readonly string[] = [
  'hmr',
  'session-title-llm',
  'plugin-manager',
  'tool-plugin-manager',
  'config-editor',
  'settings',
  'remote-access',
  'typert',
  'typert-loader',
  'typert-gateway',
]

const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS: readonly SandboxApproval[] = ['ask', 'never']

/** Normalize `string | {en, …}` display metadata into `LocalizedText`. */
export function toLocalized(
  value: string | Record<string, string> | undefined,
): LocalizedText | undefined {
  if (typeof value === 'string') return value === '' ? undefined : { en: value }
  if (value === undefined || value === null) return undefined
  const en = typeof value.en === 'string' ? value.en : undefined
  if (en !== undefined && en !== '') return { ...value, en }
  const first = Object.values(value).find((entry) => typeof entry === 'string' && entry !== '')
  return first === undefined ? undefined : { en: first }
}

/** Read one known literal out of a `!!js` expression (only when unambiguous). */
function singleLiteral(expression: string, allowed: readonly string[]): string | null {
  const literals = new Set<string>()
  for (const match of expression.matchAll(/'([^']*)'/g)) {
    const literal = match[1] ?? ''
    if (allowed.includes(literal)) literals.add(literal)
  }
  return literals.size === 1 ? ([...literals][0] ?? null) : null
}

/** Resolve a scalar that may be a literal or a `!!js` expression. */
export function resolveScalar(
  raw: string | undefined,
  allowed: readonly string[],
): { value: string | null; dynamic: boolean } {
  if (raw === undefined || raw === '') return { value: null, dynamic: false }
  if (!raw.startsWith('!!js')) return { value: raw, dynamic: false }
  return { value: singleLiteral(raw, allowed), dynamic: true }
}

export interface RowModel {
  rows: PluginRowView[]
  byId: Map<string, PluginRowView>
  /** Composition rows keyed by loader entry id (absent when the dump failed). */
  acpRows: Map<string, CompositionRow>
}

/** Extra inputs the row model uses for display only (never for writing). */
export interface RowModelOptions {
  /**
   * Package-locale metadata, keyed by module name. Consulted **only** for a
   * field the page's own plugin list did not provide (preset rows usually have
   * no live entry at all, so `pluginManager` has no meta for them).
   */
  packageMeta?: ReadonlyMap<string, PackageMeta>
  /** Owning preset id per row id; `compositionInventory()` first, dump second. */
  presetByRowId?: ReadonlyMap<string, string>
}

/** The `presetName` payload: the preset id, which the page localizes. */
function presetNameOf(
  id: string,
  options: RowModelOptions,
  fallback?: readonly string[],
): LocalizedText | undefined {
  const owner = options.presetByRowId?.get(id) ?? fallback?.[0]
  if (owner === undefined || owner === '') return undefined
  return { en: owner, zh: owner }
}

/**
 * Merge one row's display metadata: the live plugin list wins field by field,
 * the package locale fills whatever it left out.
 */
function displayOf(
  info: WebPluginInfo | undefined,
  moduleName: string,
  options: RowModelOptions,
): { title?: LocalizedText; description?: LocalizedText } {
  const liveTitle = toLocalized(info?.title)
  const liveDescription = toLocalized(info?.description)
  const fromPackage = moduleName === '' ? undefined : options.packageMeta?.get(moduleName)
  const title = liveTitle ?? fromPackage?.title
  const description = liveDescription ?? fromPackage?.description
  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  }
}

/** The details table's run-state cell, when the live entry reports a phase. */
function fiberOf(info: WebPluginInfo | undefined): { webFiber?: string } {
  const phase = info?.fiberPhase
  return typeof phase === 'string' && phase !== '' ? { webFiber: phase } : {}
}

/** Merge ACP rows with the live Web rows exactly as DESIGN section 5 describes. */
export function buildRowModel(
  composition: Composition | null,
  webPlugins: readonly WebPluginInfo[],
  state: PersistedState,
  options: RowModelOptions = {},
): RowModel {
  const acpRows = composition?.rowById ?? new Map<string, CompositionRow>()
  const presetIds = composition?.presetIds ?? new Set<string>()
  const infra = new Set(INFRA_IDS)
  const usedWeb = new Set<WebPluginInfo>()

  const webByPatchId = new Map<string, WebPluginInfo>()
  const webByModule = new Map<string, WebPluginInfo[]>()
  for (const info of webPlugins) {
    if (info.patchId !== undefined && info.patchId !== '') webByPatchId.set(info.patchId, info)
    const list = webByModule.get(info.moduleName)
    if (list === undefined) webByModule.set(info.moduleName, [info])
    else list.push(info)
  }

  const webInfoFor = (row: { id: string; moduleName: string }): WebPluginInfo | undefined => {
    const byPatchId = webByPatchId.get(row.id)
    if (byPatchId !== undefined) return byPatchId
    return webByModule.get(row.moduleName)?.[0]
  }

  const rows: PluginRowView[] = []
  const byId = new Map<string, PluginRowView>()

  const webState = (info: WebPluginInfo | undefined): PluginRowView['web'] =>
    info === undefined ? 'absent' : info.enabled ? 'on' : 'off'

  for (const acpRow of acpRows.values()) {
    const webInfo = webInfoFor(acpRow)
    if (webInfo !== undefined) usedWeb.add(webInfo)
    const web = webState(webInfo)
    const stored = state.plugins[acpRow.id]
    const mode: PluginMode = stored?.mode ?? 'inherit'
    const drift =
      mode === 'inherit' &&
      web !== 'absent' &&
      typeof stored?.web === 'boolean' &&
      stored.web !== (web === 'on')

    let locked: LockReason | undefined
    if (presetIds.has(acpRow.id)) locked = 'preset-managed'
    else if (infra.has(acpRow.id)) locked = 'infra'
    else if (web === 'absent') locked = 'acp-only'

    const group: PluginRowView['group'] = presetIds.has(acpRow.id) ? 'session' : 'global'
    const presetName = group === 'session' ? presetNameOf(acpRow.id, options) : undefined
    const display = displayOf(webInfo, acpRow.moduleName, options)

    const view: PluginRowView = {
      id: acpRow.id,
      group,
      moduleName: acpRow.moduleName,
      web,
      acp: acpRow.disabled === 'true' ? 'off' : acpRow.disabled === 'dynamic' ? 'dynamic' : 'on',
      mode,
      drift,
      ...(locked === undefined ? {} : { locked }),
      ...(presetName === undefined ? {} : { presetName }),
      ...fiberOf(webInfo),
      ...display,
    }
    rows.push(view)
    byId.set(view.id, view)
  }

  // Rows only the ACP presets declare: they compose per session inside the ACP
  // profile, so this profile's live plugin list has no entry for them. The
  // official page lists them in its "会话插件" group; so does this page, read-only.
  for (const declared of composition?.presetRows ?? []) {
    if (byId.has(declared.id)) continue
    const moduleName = declared.moduleName === '' ? declared.id : declared.moduleName
    const webInfo = webInfoFor({ id: declared.id, moduleName })
    if (webInfo !== undefined) usedWeb.add(webInfo)
    const stored = state.plugins[declared.id]
    const presetName = presetNameOf(declared.id, options, declared.declaredBy)
    const display = displayOf(webInfo, moduleName, options)
    const view: PluginRowView = {
      id: declared.id,
      group: 'session',
      moduleName,
      web: webState(webInfo),
      acp:
        declared.disabled === 'true' ? 'off' : declared.disabled === 'dynamic' ? 'dynamic' : 'on',
      mode: stored?.mode ?? 'inherit',
      locked: 'preset-managed',
      drift: false,
      ...(presetName === undefined ? {} : { presetName }),
      ...fiberOf(webInfo),
      ...display,
    }
    rows.push(view)
    byId.set(view.id, view)
  }

  // Rows only the Web profile knows: shown for reference, never switchable here.
  const webOnly = webPlugins
    .filter((info) => !usedWeb.has(info))
    .map((info) => {
      const id = info.patchId !== undefined && info.patchId !== '' ? info.patchId : info.moduleName
      const display = displayOf(info, info.moduleName, options)
      return {
        info,
        view: {
          id,
          group: 'global',
          moduleName: info.moduleName,
          web: webState(info),
          acp: 'absent',
          mode: (state.plugins[id]?.mode ?? 'inherit') as PluginMode,
          locked: (info.patchId === undefined ? 'unaddressable' : 'not-in-acp') as LockReason,
          drift: false,
          ...fiberOf(info),
          ...display,
        } satisfies PluginRowView,
      }
    })
    .sort((left, right) => left.view.moduleName.localeCompare(right.view.moduleName))
  for (const item of webOnly) {
    if (byId.has(item.view.id)) continue
    rows.push(item.view)
    byId.set(item.view.id, item.view)
  }

  return { rows, byId, acpRows }
}

/**
 * Map every session row id to the first preset that declares it.
 *
 * `compositionInventory()` is the live answer (it knows which preset a row came
 * from at runtime); the ACP dump's own preset declarations are the fallback for
 * rows the live roster does not list.
 */
export function presetOwners(
  inventory: readonly PresetCompositionInventory[],
  composition: Composition | null,
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const preset of inventory) {
    if (typeof preset.id !== 'string' || preset.id === '') continue
    for (const row of preset.rows ?? []) {
      const entryId = row.entryId
      if (typeof entryId === 'string' && entryId !== '' && !owners.has(entryId)) {
        owners.set(entryId, preset.id)
      }
    }
  }
  for (const declared of composition?.presetRows ?? []) {
    if (owners.has(declared.id)) continue
    const first = declared.declaredBy[0]
    if (first !== undefined && first !== '') owners.set(declared.id, first)
  }
  return owners
}

/** Read `agentPresets.compositionInventory()`; `[]` when unavailable. */
async function loadPresetInventory(
  web: WebStatePort | undefined,
): Promise<PresetCompositionInventory[]> {
  if (web?.compositionInventory === undefined) return []
  try {
    const inventory = await web.compositionInventory()
    return Array.isArray(inventory) ? inventory : []
  } catch {
    return []
  }
}

/**
 * Read package-locale metadata for the rows the live plugin list left blank.
 *
 * Only modules that are missing at least one field are read, one read per
 * module, and a failure is simply "still unknown" — the page then shows the id.
 */
async function loadPackageMeta(
  rows: readonly PluginRowView[],
  readPackageMeta: ((moduleName: string) => Promise<PackageMeta | null>) | undefined,
): Promise<Map<string, PackageMeta> | undefined> {
  if (readPackageMeta === undefined) return undefined
  const missing = new Set<string>()
  for (const row of rows) {
    if (row.title !== undefined && row.description !== undefined) continue
    if (row.moduleName === '') continue
    missing.add(row.moduleName)
  }
  if (missing.size === 0) return undefined
  const results = await Promise.all(
    [...missing].map(async (moduleName) => {
      try {
        return [moduleName, await readPackageMeta(moduleName)] as const
      } catch {
        return [moduleName, null] as const
      }
    }),
  )
  const found = new Map<string, PackageMeta>()
  for (const [moduleName, meta] of results) {
    if (meta !== null && meta !== undefined) found.set(moduleName, meta)
  }
  return found.size === 0 ? undefined : found
}

export interface StatusInput {
  deps: {
    fs: FsPort
    web: WebStatePort | undefined
    /** Package-locale metadata fallback; absent in a plain Node run. */
    readPackageMeta?: (moduleName: string) => Promise<PackageMeta | null>
  }
  paths: Paths
  profileName: string
  composition: Composition | null
  outcome: DumpOutcome
  webPlugins: readonly WebPluginInfo[]
  /** Live default preset of the page's own profile (`null` when unreadable). */
  webAgentPreset: string | null
  /** Permission preset selected in the page's own profile (`null` when unreadable). */
  webPermission: WebPermission | null
  /** Permission presets the page's own profile offers (empty when unreadable). */
  webPermissions: readonly WebPermission[]
  state: PersistedState
  stateWarnings: readonly string[]
}

/** Read `preset-*` candidates and enrich them with the live profile's titles. */
export async function loadPresets(
  composition: Composition | null,
  web: StatusInput['deps']['web'],
): Promise<{ presets: PresetOption[]; warnings: string[] }> {
  const warnings: string[] = []
  const candidates = composition?.presets ?? []
  if (candidates.length === 0) return { presets: [], warnings }
  let meta: Array<{ id: string; name?: string; description?: string }> = []
  if (web?.listPresets !== undefined) {
    try {
      meta = await web.listPresets()
    } catch (error) {
      warnings.push(
        `preset metadata unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  const presets = candidates.map((candidate) => {
    const match = meta.find((entry) => entry.id === candidate.id)
    const title = toLocalized(match?.name)
    const description = toLocalized(match?.description)
    return {
      id: candidate.id,
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
      ...(candidate.rowCount === undefined ? {} : { rowCount: candidate.rowCount }),
    } satisfies PresetOption
  })
  return { presets, warnings }
}

/** Describe the ACP profile itself (existence, paths, declared bundles). */
export function buildAcpInfo(fs: FsPort, paths: Paths, profileName: string): AcpProfileInfo {
  return {
    name: profileName,
    dir: paths.dir,
    exists: fs.existsDir(paths.dir),
    patchPath: paths.patchPath,
    bundles: readProfileBundles(fs, paths.dir),
  }
}

/** Build the full status payload. Never throws for a degraded dump. */
export async function buildStatus(input: StatusInput): Promise<StatusPayload> {
  const warnings: string[] = [...input.stateWarnings]
  const degraded = !input.outcome.ok
  if (degraded) {
    const message = input.outcome.ok ? '' : input.outcome.message
    warnings.push(`ACP composition unavailable (${message}); plugin states are read-only guesses`)
  }
  if (input.deps.web === undefined) {
    warnings.push(
      'live plugin state of this profile is unavailable (engine runs without a Cord context)',
    )
  }
  const acp = buildAcpInfo(input.deps.fs, input.paths, input.profileName)
  // Session rows: which preset declares each one. The live roster answers first
  // (it knows what is actually mounted), the ACP dump's preset declarations fill
  // in rows the roster does not list.
  const inventory = await loadPresetInventory(input.deps.web)
  const presetByRowId = presetOwners(inventory, input.composition)
  const firstPass = buildRowModel(input.composition, input.webPlugins, input.state, {
    presetByRowId,
  })
  const packageMeta = await loadPackageMeta(firstPass.rows, input.deps.readPackageMeta)
  const model =
    packageMeta === undefined
      ? firstPass
      : buildRowModel(input.composition, input.webPlugins, input.state, {
          presetByRowId,
          packageMeta,
        })
  const { presets, warnings: presetWarnings } = await loadPresets(input.composition, input.deps.web)
  warnings.push(...presetWarnings)

  const registryRow = input.composition?.rowById.get('agent-preset-registry')
  const registryDefault = resolveScalar(registryRow?.config.default, [])
  const selectedDefault = registryRow?.config.selectedDefault
  const agentAvailable = registryRow !== undefined && presets.length > 0
  if (
    registryRow !== undefined &&
    selectedDefault !== undefined &&
    selectedDefault !== 'null' &&
    selectedDefault !== ''
  ) {
    warnings.push(
      `ACP composes a non-empty agent-preset-registry.selectedDefault (${selectedDefault}); saving here overwrites it with null so the chosen default applies`,
    )
  }
  const agentReason =
    registryRow === undefined
      ? 'ACP composition has no agent-preset-registry row (dsh-acp-agentmode is not installed in this profile)'
      : presets.length === 0
        ? 'ACP composition declares no preset rows'
        : undefined

  const sandboxRow = input.composition?.rowById.get('sandbox-policy')
  const approvalRow = input.composition?.rowById.get('approval')
  const mode = resolveScalar(sandboxRow?.config.mode, SANDBOX_MODES)
  const approval = resolveScalar(approvalRow?.config.policy, APPROVALS)
  if (mode.dynamic) {
    warnings.push(
      mode.value === null
        ? 'sandbox-policy.mode is a !!js expression; the current mode cannot be resolved statically'
        : `sandbox-policy.mode is a !!js expression; showing its fallback literal (${mode.value})`,
    )
  }
  if (approval.dynamic && approval.value === null) {
    warnings.push(
      'approval.policy is a !!js expression; the current policy cannot be resolved statically',
    )
  }
  const sandboxAvailable = sandboxRow !== undefined
  const sandboxReason =
    sandboxRow === undefined ? 'ACP composition has no sandbox-policy row' : undefined

  const fallbackMode = input.state.sandboxMode
  const fallbackAgent = input.state.agentMode
  const drift = model.rows.filter((row) => row.drift).map((row) => row.id)

  const agentChoice: AgentModeChoice = input.state.agentModeChoice ?? { mode: 'acp-default' }
  const sandboxChoice: SandboxChoice = input.state.sandboxChoice ?? { mode: 'acp-default' }
  // Drift compares the snapshot taken when `inherit` was resolved with what the
  // Web profile serves now. Both sides must be readable: a missing web service
  // is "unknown", not "changed".
  const agentDrift =
    agentChoice.mode === 'inherit' &&
    input.webAgentPreset !== null &&
    typeof input.state.agentModeWeb === 'string' &&
    input.state.agentModeWeb !== input.webAgentPreset
  // The sandbox snapshot stores the **preset name**, not the mode: `auto` and
  // `danger-full-access` share a mode but differ in approval, so only the preset
  // name can tell them apart.
  const sandboxDrift =
    sandboxChoice.mode === 'inherit' &&
    input.webPermission !== null &&
    typeof input.state.sandboxWeb === 'string' &&
    input.state.sandboxWeb !== input.webPermission.preset

  return {
    ok: true,
    acp,
    rows: model.rows,
    presets,
    agentMode: {
      value: degraded ? fallbackAgent : (registryDefault.value ?? fallbackAgent),
      choice: agentChoice,
      web: input.webAgentPreset,
      drift: agentDrift,
      available: degraded ? false : agentAvailable,
      ...(degraded
        ? { reason: 'ACP composition unavailable' }
        : agentReason === undefined
          ? {}
          : { reason: agentReason }),
    },
    sandbox: {
      mode: degraded ? fallbackMode : ((mode.value as SandboxMode | null) ?? fallbackMode),
      approval: degraded ? null : ((approval.value as SandboxApproval | null) ?? null),
      choice: sandboxChoice,
      web: input.webPermission,
      webPresets: [...input.webPermissions],
      drift: sandboxDrift,
      available: degraded ? false : sandboxAvailable,
      ...(degraded
        ? { reason: 'ACP composition unavailable' }
        : sandboxReason === undefined
          ? {}
          : { reason: sandboxReason }),
    },
    apply: { lastSavedAt: input.state.savedAt, drift },
    warnings,
  }
}
