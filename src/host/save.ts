// Save: resolve the page's choices into the smallest possible patch, write the
// managed block, persist state, then re-compose the ACP profile and report what
// the composition actually says now.
import type {
  AgentModeChoice,
  PluginMode,
  SandboxChoice,
  SavePayload,
  SaveRequest,
  SandboxApproval,
  SandboxMode,
  Verification,
  WebPermission,
} from '../shared/contract.js'
import { AcpConfigError, ERROR_CODES, failure, failureOf } from './errors.js'
import {
  changedIds,
  parseManagedBlock,
  serializeManagedBlock,
  writeManagedBlock,
} from './patch-block.js'
import type { ManagedEntry } from './patch-block.js'
import { assertInsideProfile, resolveProfilePaths } from './paths.js'
import type { ProfilePaths } from './paths.js'
import type { EngineDeps } from './ports.js'
import { readState, writeState } from './state.js'
import type { PersistedPlugin, PersistedState } from './state.js'
import { buildRowModel, INFRA_IDS, resolveScalar } from './status.js'
import { parseComposition, requireComposition, readComposition } from './dump.js'
import type { Composition } from './dump.js'

const PLUGIN_MODES: readonly PluginMode[] = ['inherit', 'on', 'off']
const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS: readonly SandboxApproval[] = ['ask', 'never']

/**
 * Approval policy the shipped permission presets pair with each sandbox mode.
 *
 * Only used for an **explicitly pinned** sandbox mode (`{mode:'sandbox'}`), which
 * carries no preset of its own. An inherited permission must use the approval the
 * *selected preset* resolves to: `auto` is `danger-full-access` + `ask`, so
 * reverse-lookup through this table would wrongly write `never`.
 */
export function approvalFor(mode: SandboxMode): SandboxApproval {
  return mode === 'danger-full-access' ? 'never' : 'ask'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function usage(message: string): AcpConfigError {
  return new AcpConfigError(ERROR_CODES.usage, message)
}

/**
 * Validate one `AgentModeChoice`.
 *
 * The pre-three-state form (a bare preset id / `null`) is rejected deliberately:
 * guessing what an old caller meant would write a different ACP configuration
 * than it asked for.
 */
export function normalizeAgentChoice(raw: unknown): AgentModeChoice {
  if (!isRecord(raw)) {
    throw usage(`agentMode must be an object like {"mode":"inherit"}; got ${JSON.stringify(raw)}`)
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'preset') {
    if (typeof raw.id !== 'string' || raw.id === '')
      throw usage('agentMode with mode "preset" needs a non-empty id')
    return { mode: 'preset', id: raw.id }
  }
  throw usage(`unknown agentMode mode: ${JSON.stringify(mode)}`)
}

/** Validate one `SandboxChoice` (same rules as `normalizeAgentChoice`). */
export function normalizeSandboxChoice(raw: unknown): SandboxChoice {
  if (!isRecord(raw)) {
    throw usage(`sandboxMode must be an object like {"mode":"inherit"}; got ${JSON.stringify(raw)}`)
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'sandbox') {
    if (
      typeof raw.sandbox !== 'string' ||
      !(SANDBOX_MODES as readonly string[]).includes(raw.sandbox)
    ) {
      throw usage(`unknown sandbox mode: ${JSON.stringify(raw.sandbox)}`)
    }
    return { mode: 'sandbox', sandbox: raw.sandbox as SandboxMode }
  }
  throw usage(`unknown sandboxMode mode: ${JSON.stringify(mode)}`)
}

/** Validate the browser-supplied request; unknown shapes are usage errors. */
export function normalizeRequest(raw: unknown): SaveRequest {
  if (!isRecord(raw)) throw new AcpConfigError(ERROR_CODES.usage, 'save request must be an object')
  const request: SaveRequest = {}
  if (raw.plugins !== undefined) {
    if (!isRecord(raw.plugins))
      throw new AcpConfigError(ERROR_CODES.usage, 'plugins must be an object')
    const plugins: Record<string, PluginMode> = {}
    for (const [id, mode] of Object.entries(raw.plugins)) {
      if (typeof mode !== 'string' || !(PLUGIN_MODES as readonly string[]).includes(mode)) {
        throw new AcpConfigError(
          ERROR_CODES.usage,
          `unknown plugin mode for ${id}: ${JSON.stringify(mode)}`,
        )
      }
      plugins[id] = mode as PluginMode
    }
    request.plugins = plugins
  }
  // `undefined` (absent) keeps the saved choice; a present but invalid shape is
  // a usage error rather than a silent fallback.
  if (raw.agentMode !== undefined) request.agentMode = normalizeAgentChoice(raw.agentMode)
  if (raw.sandboxMode !== undefined) request.sandboxMode = normalizeSandboxChoice(raw.sandboxMode)
  return request
}

/** Existing managed entries indexed by id (used to preserve untouched sections). */
function existingEntries(fs: EngineDeps['fs'], paths: ProfilePaths): ManagedEntry[] {
  if (!fs.existsFile(paths.patchPath)) return []
  return parseManagedBlock(fs.readFile(paths.patchPath))
}

function findEntry(entries: readonly ManagedEntry[], id: string): ManagedEntry | undefined {
  return entries.find((entry) => entry.id === id)
}

/**
 * Resolve plugin modes into patch entries.
 *
 * The block is always rebuilt from the full desired state (requested modes
 * merged over the stored ones), so a second identical save is byte-identical
 * and a row the request does not mention keeps its override.
 *
 * `inherit` is deliberately conservative: it is only written when the inherited
 * value differs from the row's *base* state — the value observed while this
 * page was not overriding the row. Without that remembered base, a clear would
 * read our own override as "what ACP already composes" and keep writing it.
 */
function resolvePluginEntries(
  request: SaveRequest,
  composition: Composition,
  webPlugins: readonly { moduleName: string; enabled: boolean; patchId?: string }[],
  state: PersistedState,
  before: readonly ManagedEntry[],
  warnings: string[],
): {
  entries: ManagedEntry[]
  nextPlugins: Record<string, PersistedPlugin>
  nextBase: Record<string, boolean>
} {
  const model = buildRowModel(composition, webPlugins, state)
  const requested: Record<string, PluginMode> = {}
  for (const [id, mode] of Object.entries(request.plugins ?? {})) requested[id] = mode
  const managedIds = new Set(before.map((entry) => entry.id))
  const entries: ManagedEntry[] = []
  const nextBase: Record<string, boolean> = { ...state.base }
  const nextPlugins: Record<string, PersistedPlugin> = {}

  /** Base `disabled` for a row: `undefined` when a `!!js` expression decides it. */
  const baseDisabled = (id: string): boolean | undefined => {
    const observed = composition.rowById.get(id)?.disabled
    if (observed === 'dynamic') return undefined
    if (managedIds.has(id)) {
      const remembered = state.base?.[id]
      if (remembered !== undefined) return remembered
      // Overridden before the base was ever recorded: trust the composition.
      return observed === undefined ? undefined : observed === 'true'
    }
    return observed === undefined ? undefined : observed === 'true'
  }

  for (const id of Object.keys(requested)) {
    const row = model.byId.get(id)
    if (row === undefined) {
      warnings.push(
        `unknown row ${id}: not present in this profile's ACP composition or live plugin list`,
      )
      continue
    }
    if (row.locked !== undefined) {
      warnings.push(`row ${id} is read-only (${row.locked}); nothing was written for it`)
    }
  }

  for (const row of model.rows) {
    const previous = state.plugins[row.id]
    const mode: PluginMode = requested[row.id] ?? previous?.mode ?? 'inherit'
    const base = baseDisabled(row.id)
    const shouldWrite = requested[row.id] !== undefined || previous !== undefined

    if (row.locked !== undefined) {
      // Locked rows are never written; keep whatever the state recorded.
      if (previous !== undefined) nextPlugins[row.id] = { ...previous }
      if (base !== undefined) nextBase[row.id] = base
      continue
    }

    nextPlugins[row.id] = {
      mode,
      ...(row.web === 'absent' ? {} : { web: row.web === 'on' }),
    }
    if (base !== undefined) nextBase[row.id] = base
    if (!shouldWrite) continue

    if (mode === 'inherit') {
      if (row.web === 'absent') continue
      if (row.acp === 'dynamic') continue
      if (base === undefined) continue
      const target = row.web === 'off'
      if (target === base) continue
      entries.push({ id: row.id, disabled: target ? 'true' : 'false' })
      continue
    }
    // Explicit intent is always written, even when it matches the composition.
    entries.push({ id: row.id, disabled: mode === 'off' ? 'true' : 'false' })
  }

  // Remember the base of rows still covered by a block entry we are keeping.
  for (const id of managedIds) {
    if (nextBase[id] !== undefined) continue
    const remembered = state.base?.[id]
    if (remembered !== undefined) nextBase[id] = remembered
  }

  return { entries, nextPlugins, nextBase }
}

/** Entry shape the preset registry needs (see DESIGN section 4). */
function agentEntry(id: string): ManagedEntry {
  return {
    id: 'agent-preset-registry',
    // `selectedDefault: null` clears a remembered user default so `default` wins.
    config: { default: id, selectedDefault: 'null' },
  }
}

/**
 * Patch entries for one sandbox mode plus its approval policy.
 *
 * `approval` is supplied by the caller rather than derived from `mode`: an
 * inherited permission takes the approval its preset resolved to, while an
 * explicit pin falls back to the shipped pairing table.
 */
function sandboxEntriesFor(
  mode: SandboxMode,
  approval: SandboxApproval,
  composition: Composition,
  warnings: string[],
): ManagedEntry[] {
  const entries: ManagedEntry[] = [
    // A patch `config` replaces the whole object, so `workspaceRoot` must ride along.
    { id: 'sandbox-policy', config: { mode, workspaceRoot: '!!js process.cwd()' } },
  ]
  if (composition.rowById.has('approval')) {
    entries.push({ id: 'approval', config: { policy: approval } })
  } else {
    warnings.push(
      'approval row is absent from this ACP composition; only sandbox-policy.mode was written',
    )
  }
  return entries
}

/**
 * ACP value of the agent preset before this page overrides it.
 * `null` means "cannot be known": a managed entry hides the base in the
 * composition and the state never recorded one (e.g. a legacy save).
 */
function baseAgentPreset(
  composition: Composition,
  state: PersistedState,
  before: readonly ManagedEntry[],
): string | null {
  const managed = before.some((entry) => entry.id === 'agent-preset-registry')
  if (managed) return state.agentModeBase ?? null
  const raw = composition.rowById.get('agent-preset-registry')?.config.default
  return resolveScalar(raw, []).value
}

/** ACP sandbox mode before this page overrides it (`null` when unknown). */
function baseSandboxMode(
  composition: Composition,
  state: PersistedState,
  before: readonly ManagedEntry[],
): SandboxMode | null {
  const managed = before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval')
  if (managed) return state.sandboxBase ?? null
  const raw = composition.rowById.get('sandbox-policy')?.config.mode
  const resolved = resolveScalar(raw, SANDBOX_MODES)
  const value = resolved.value
  // A `!!js` expression with several possible literals is unknown, not equal.
  return value === null || !(SANDBOX_MODES as readonly string[]).includes(value)
    ? null
    : (value as SandboxMode)
}

/**
 * ACP approval policy before this page overrides it (`null` when unknown).
 *
 * Tracked alongside the base mode because the section has two knobs: an inherited
 * `auto` permission resolves to `danger-full-access` + `ask`, which has the same
 * mode as the shipped `danger-full-access` preset (`never`). Comparing modes only
 * would skip a patch that is actually needed.
 */
function baseSandboxApproval(
  composition: Composition,
  state: PersistedState,
  before: readonly ManagedEntry[],
): SandboxApproval | null {
  const managed = before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval')
  if (managed) return state.sandboxApprovalBase ?? null
  const raw = composition.rowById.get('approval')?.config.policy
  const resolved = resolveScalar(raw, APPROVALS)
  const value = resolved.value
  return value === null || !(APPROVALS as readonly string[]).includes(value)
    ? null
    : (value as SandboxApproval)
}

interface AgentResolution {
  entry: ManagedEntry | null
  /** Resolved value; `null` when no override is written. */
  value: string | null
  choice: AgentModeChoice
  /** Pre-override ACP value, remembered for the minimal-write rule. */
  base: string | null
  /** Web-side snapshot to persist for `drift` (only for `inherit`). */
  web: string | null
}

/**
 * Resolve the agent-preset section for one save.
 *
 * `inherit` is a **save-time snapshot** of the Web profile's default preset and
 * an explicit value pins one preset; both are skipped when the resolution equals
 * the pre-override ACP base, exactly like plugin rows. A `!!js` base is unknown,
 * so the inherited value is written instead of being assumed equal.
 */
function resolveAgentChoice(
  request: SaveRequest,
  composition: Composition,
  state: PersistedState,
  before: readonly ManagedEntry[],
  webPreset: string | null,
  warnings: string[],
): AgentResolution {
  const base = baseAgentPreset(composition, state, before)
  const choice: AgentModeChoice = request.agentMode ??
    state.agentModeChoice ?? { mode: 'acp-default' }
  const registry = composition.rowById.get('agent-preset-registry')

  if (choice.mode === 'acp-default') {
    if (before.some((entry) => entry.id === 'agent-preset-registry')) {
      warnings.push(
        'the previous agent preset override was removed: this page now follows the ACP default',
      )
    }
    return { entry: null, value: null, choice, base, web: null }
  }

  if (choice.mode === 'preset') {
    if (registry === undefined) {
      warnings.push(
        'agentMode was not written: this ACP composition has no agent-preset-registry row',
      )
      return { entry: null, value: null, choice, base, web: null }
    }
    if (!composition.presets.some((preset) => preset.id === choice.id)) {
      warnings.push(
        `agentMode ${choice.id} is not a preset this ACP composition declares; not written`,
      )
      return { entry: null, value: null, choice, base, web: null }
    }
    return { entry: agentEntry(choice.id), value: choice.id, choice, base, web: null }
  }

  // inherit: resolve the Web profile's current default preset at save time.
  if (webPreset === null) {
    if (request.agentMode !== undefined) {
      // An explicit `inherit` that cannot be resolved must fail, never silently
      // fall back to the ACP default.
      throw usage(
        "agentMode inherit cannot be resolved: cannot read the current profile's agent preset (agentPresets.resolve() is unavailable)",
      )
    }
    // A *stored* inherit whose Web value is unreadable right now: keep the
    // override this page wrote last time instead of failing an unrelated save.
    const previous = findEntry(before, 'agent-preset-registry')
    warnings.push(
      "the saved agentMode inherit could not be re-resolved (cannot read the current profile's agent preset); kept the previous override",
    )
    return {
      entry: previous ?? null,
      value: previous?.config?.default ?? state.agentMode,
      choice,
      base,
      web: state.agentModeWeb ?? null,
    }
  }
  if (registry === undefined) {
    warnings.push(
      'agentMode was not written: this ACP composition has no agent-preset-registry row',
    )
    return { entry: null, value: null, choice, base, web: webPreset }
  }
  if (!composition.presets.some((preset) => preset.id === webPreset)) {
    warnings.push(
      `inherit resolved to preset ${webPreset}, which this ACP composition does not declare; not written`,
    )
    return { entry: null, value: null, choice, base, web: webPreset }
  }
  if (base !== null && webPreset === base) {
    // Already what ACP composes on its own: keeping the patch minimal means
    // writing nothing for this section (same rule as plugin rows).
    return { entry: null, value: webPreset, choice, base, web: webPreset }
  }
  return { entry: agentEntry(webPreset), value: webPreset, choice, base, web: webPreset }
}

interface SandboxResolution {
  entries: ManagedEntry[]
  /** Resolved sandbox mode written (or already effective); `null` = no override. */
  value: SandboxMode | null
  /** Resolved approval policy written alongside the mode; `null` = no override. */
  approval: SandboxApproval | null
  choice: SandboxChoice
  /** Pre-override ACP mode, remembered for the minimal-write rule. */
  base: SandboxMode | null
  /** Pre-override ACP approval policy, same purpose. */
  baseApproval: SandboxApproval | null
  /** Web-side permission preset name to persist for `drift` (only for `inherit`). */
  web: string | null
}

/**
 * Resolve the sandbox section for one save.
 *
 * `inherit` snapshots the Web profile's **selected permission preset** and writes
 * both knobs from what that preset resolves to (`{ sandbox, approval }`).
 * `acp-default` removes the section entirely; `{mode:'sandbox'}` pins one mode
 * and pairs its approval from the shipped table (a pinned mode has no preset).
 *
 * The approval is never reverse-derived from the inherited mode: `auto` resolves
 * to `danger-full-access` + `ask`, so a lookup table would wrongly write `never`.
 */
function resolveSandboxChoice(
  request: SaveRequest,
  composition: Composition,
  state: PersistedState,
  before: readonly ManagedEntry[],
  webPermission: WebPermission | null,
  warnings: string[],
): SandboxResolution {
  const base = baseSandboxMode(composition, state, before)
  const baseApproval = baseSandboxApproval(composition, state, before)
  const choice: SandboxChoice = request.sandboxMode ??
    state.sandboxChoice ?? { mode: 'acp-default' }
  const policy = composition.rowById.get('sandbox-policy')
  const noOverride = (web: string | null): SandboxResolution => ({
    entries: [],
    value: null,
    approval: null,
    choice,
    base,
    baseApproval,
    web,
  })

  if (choice.mode === 'acp-default') {
    if (before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval')) {
      warnings.push(
        'the previous sandbox/approval override was removed: this page now follows the ACP default',
      )
    }
    return noOverride(null)
  }

  if (choice.mode === 'sandbox') {
    if (policy === undefined) {
      warnings.push('sandboxMode was not written: this ACP composition has no sandbox-policy row')
      return noOverride(null)
    }
    const approval = approvalFor(choice.sandbox)
    return {
      entries: sandboxEntriesFor(choice.sandbox, approval, composition, warnings),
      value: choice.sandbox,
      approval,
      choice,
      base,
      baseApproval,
      // An explicit pin is not an inheritance, so no Web snapshot is recorded.
      web: null,
    }
  }

  // inherit: resolve the Web profile's selected permission preset at save time.
  if (webPermission === null) {
    if (request.sandboxMode !== undefined) {
      // An explicit `inherit` that cannot be resolved must fail, never silently
      // fall back to the ACP default.
      throw usage(
        "sandboxMode inherit cannot be resolved: cannot read the current profile's permission preset (permissionPresets.catalog()/resolve() is unavailable)",
      )
    }
    const previous = [findEntry(before, 'sandbox-policy'), findEntry(before, 'approval')].filter(
      (entry): entry is ManagedEntry => entry !== undefined,
    )
    warnings.push(
      "the saved sandboxMode inherit could not be re-resolved (cannot read the current profile's permission preset); kept the previous override",
    )
    return {
      entries: previous,
      value: state.sandboxMode,
      approval: null,
      choice,
      base,
      baseApproval,
      web: state.sandboxWeb ?? null,
    }
  }
  if (policy === undefined) {
    warnings.push('sandboxMode was not written: this ACP composition has no sandbox-policy row')
    return noOverride(webPermission.preset)
  }
  // The patch is redundant only when both knobs already match the remembered
  // base. A same-mode/different-approval preset (`auto` vs the danger preset)
  // still needs its own patch. An unknown base approval (`!!js`) is not a
  // mismatch: keeping ACP's own dynamic expression is the point of minimal writes.
  const redundant =
    base !== null &&
    webPermission.sandbox === base &&
    (baseApproval === null || webPermission.approval === baseApproval)
  if (redundant) {
    // Already what ACP composes on its own: no sandbox/approval patch needed.
    return {
      entries: [],
      value: webPermission.sandbox,
      approval: webPermission.approval,
      choice,
      base,
      baseApproval,
      web: webPermission.preset,
    }
  }
  return {
    entries: sandboxEntriesFor(
      webPermission.sandbox,
      webPermission.approval,
      composition,
      warnings,
    ),
    value: webPermission.sandbox,
    approval: webPermission.approval,
    choice,
    base,
    baseApproval,
    web: webPermission.preset,
  }
}

/** Re-read the composition and report the effective values after the write. */
async function verify(
  deps: EngineDeps,
  timeoutMs: number,
  entryIds: readonly string[],
  writtenAgent: string | null,
  writtenSandbox: SandboxMode | null,
  warnings: string[],
): Promise<Verification> {
  const outcome = await deps.runDump({ profile: deps.profileName, timeoutMs })
  if (!outcome.ok) {
    warnings.push(`post-save verification skipped: ${outcome.message}`)
    return { source: 'unavailable', warnings: [] }
  }
  let composition: Composition
  try {
    composition = parseComposition(outcome.text)
  } catch (error) {
    warnings.push(
      `post-save verification failed to parse the dump: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { source: 'unavailable', warnings: [] }
  }
  const rows: Record<string, 'on' | 'off' | 'dynamic'> = {}
  const verifyWarnings: string[] = []
  for (const id of entryIds) {
    const row = composition.rowById.get(id)
    if (row === undefined) {
      verifyWarnings.push(`row ${id} is absent from the recomposed ACP profile`)
      continue
    }
    const state = row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
    rows[id] = state
  }
  const registry = composition.rowById.get('agent-preset-registry')
  const sandbox = composition.rowById.get('sandbox-policy')
  const agentResolved = resolveScalar(registry?.config.default, [])
  const sandboxResolved = resolveScalar(sandbox?.config.mode, SANDBOX_MODES)
  const agentValue = agentResolved.value
  const sandboxValue = sandboxResolved.value as SandboxMode | null
  if (writtenAgent !== null && agentValue !== null && agentValue !== writtenAgent) {
    verifyWarnings.push(`agentMode recomposed as ${agentValue}, expected ${writtenAgent}`)
  }
  if (writtenSandbox !== null && sandboxValue !== null && sandboxValue !== writtenSandbox) {
    verifyWarnings.push(`sandbox mode recomposed as ${sandboxValue}, expected ${writtenSandbox}`)
  }
  if (sandboxResolved.dynamic && sandboxValue !== null) {
    verifyWarnings.push(
      `sandbox-policy.mode is a !!js expression; reporting its fallback literal (${sandboxValue})`,
    )
  }
  warnings.push(...verifyWarnings)
  return {
    source: 'live',
    rows,
    agentMode: agentValue,
    sandbox: sandboxValue,
    warnings: verifyWarnings,
  }
}

export interface SaveContext {
  deps: EngineDeps
  paths: ProfilePaths
  timeoutMs: number
  webPlugins: readonly { moduleName: string; enabled: boolean; patchId?: string }[]
  /** Live default preset of the page's own profile (`null` when unreadable). */
  webAgentPreset: string | null
  /** Selected permission preset of the page's own profile (`null` when unreadable). */
  webPermission: WebPermission | null
}

/** Execute one save; business failures come back as `Failure`, never as throws. */
export async function saveSelection(
  context: SaveContext,
  rawRequest: unknown,
): Promise<SavePayload | import('../shared/contract.js').Failure> {
  try {
    const request = normalizeRequest(rawRequest)
    const { deps, paths } = context
    if (!deps.fs.existsDir(paths.dir)) {
      throw new AcpConfigError(
        ERROR_CODES.profile,
        `ACP profile directory does not exist: ${paths.dir}`,
      )
    }
    assertInsideProfile(deps.fs, paths.dir, paths.patchPath)
    assertInsideProfile(deps.fs, paths.dir, paths.statePath)

    const { composition } = await readComposition(deps, context.timeoutMs)
    requireComposition({ ok: true, source: 'live', text: '', command: '' }, composition)
    const parsed = composition as Composition
    const { state } = readState(deps.fs, paths)
    const warnings: string[] = []

    const before = existingEntries(deps.fs, paths)
    const pluginResult = resolvePluginEntries(
      request,
      parsed,
      context.webPlugins,
      state,
      before,
      warnings,
    )
    const agentResult = resolveAgentChoice(
      request,
      parsed,
      state,
      before,
      context.webAgentPreset,
      warnings,
    )
    const sandboxResult = resolveSandboxChoice(
      request,
      parsed,
      state,
      before,
      context.webPermission,
      warnings,
    )

    const entries: ManagedEntry[] = [
      ...(agentResult.entry === null ? [] : [agentResult.entry]),
      ...sandboxResult.entries,
      ...pluginResult.entries,
    ]
    const block = serializeManagedBlock(entries)
    const write = writeManagedBlock(deps.fs, paths, block)
    const after = parseManagedBlock(write.text)
    const changed = changedIds(before, after)
    if (
      (request.plugins !== undefined ||
        request.agentMode !== undefined ||
        request.sandboxMode !== undefined) &&
      changed.length === 0
    ) {
      // Nothing needed to change: the request was already the effective composition.
      warnings.push('no patch change was required; the ACP composition already matched the request')
    }

    const savedAt = deps.now()
    const nextState: PersistedState = {
      version: 1,
      savedAt,
      profile: paths.name,
      plugins: pluginResult.nextPlugins,
      agentMode: agentResult.value,
      sandboxMode: sandboxResult.value,
      agentModeChoice: agentResult.choice,
      sandboxChoice: sandboxResult.choice,
      // Web snapshots exist only for `inherit`; a non-inherit save clears them.
      ...(agentResult.web === null ? {} : { agentModeWeb: agentResult.web }),
      ...(sandboxResult.web === null ? {} : { sandboxWeb: sandboxResult.web }),
      // Keep the remembered pre-override base while it is still unknown.
      ...(agentResult.base !== null
        ? { agentModeBase: agentResult.base }
        : state.agentModeBase === undefined
          ? {}
          : { agentModeBase: state.agentModeBase }),
      ...(sandboxResult.base !== null
        ? { sandboxBase: sandboxResult.base }
        : state.sandboxBase === undefined
          ? {}
          : { sandboxBase: state.sandboxBase }),
      ...(sandboxResult.baseApproval !== null
        ? { sandboxApprovalBase: sandboxResult.baseApproval }
        : state.sandboxApprovalBase === undefined
          ? {}
          : { sandboxApprovalBase: state.sandboxApprovalBase }),
      base: pluginResult.nextBase,
    }
    writeState(deps.fs, paths, nextState)

    const verification = write.changed
      ? await verify(
          deps,
          context.timeoutMs,
          pluginResult.entries.map((entry) => entry.id),
          agentResult.value,
          sandboxResult.value,
          warnings,
        )
      : {
          source: 'live' as const,
          rows: pluginResult.entries.reduce<Record<string, 'on' | 'off' | 'dynamic'>>(
            (acc, entry) => {
              const row = parsed.rowById.get(entry.id)
              if (row !== undefined) {
                acc[entry.id] =
                  row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
              }
              return acc
            },
            {},
          ),
          agentMode: agentResult.value,
          sandbox: sandboxResult.value,
          warnings: [],
        }

    return { ok: true, savedAt, changed, verification, warnings }
  } catch (error) {
    return failureOf(error)
  }
}

/** Convenience wrapper used by the engine: resolve paths, then save. */
export async function saveWithDeps(
  deps: EngineDeps,
  rawRequest: unknown,
  timeoutMs: number,
): Promise<SavePayload | import('../shared/contract.js').Failure> {
  try {
    const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
    let webPlugins: readonly { moduleName: string; enabled: boolean; patchId?: string }[] = []
    let webAgentPreset: string | null = null
    let webPermission: WebPermission | null = null
    if (deps.web !== undefined) {
      // Each read degrades to `null` on its own; only `inherit` needs them, and an
      // unreadable value then fails the save with an explicit message instead of
      // silently falling back to the ACP default.
      try {
        webPlugins = await deps.web.listPlugins()
      } catch (error) {
        // Losing the live list only downgrades `inherit`; explicit modes still write.
        webPlugins = []
        void error
      }
      try {
        webAgentPreset = await deps.web.readAgentPreset()
      } catch {
        webAgentPreset = null
      }
      try {
        webPermission = await deps.web.readWebPermission()
      } catch {
        webPermission = null
      }
    }
    return await saveSelection(
      { deps, paths, timeoutMs, webPlugins, webAgentPreset, webPermission },
      rawRequest,
    )
  } catch (error) {
    return failureOf(error)
  }
}

export { failure, INFRA_IDS }
