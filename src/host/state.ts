// Persisted state: `<acpProfileDir>/.dsh-acp-config.json`.
//
// It remembers the mode chosen for each row plus the Web-side snapshot used to
// resolve `inherit`, which is what makes `drift` detectable after the Web
// profile changes. A missing or corrupt file degrades to empty state with a
// warning; it never fails the page.
import type {
  AgentModeChoice,
  PluginMode,
  SandboxApproval,
  SandboxChoice,
  SandboxMode,
} from '../shared/contract.js'
import { AcpConfigError, ERROR_CODES } from './errors.js'
import { assertInsideProfile } from './paths.js'
import type { FsPort } from './ports.js'
import type { ProfilePaths } from './paths.js'

export interface PersistedPlugin {
  mode: PluginMode
  /** Web-side enablement captured when `inherit` was last resolved. */
  web?: boolean
}

export interface PersistedState {
  version: 1
  savedAt: string | null
  profile: string
  plugins: Record<string, PersistedPlugin>
  /**
   * Resolved value actually written for the ACP profile (`null` = no override).
   * Kept from the pre-three-state schema: it is the validation fallback and what
   * `dsh --profile acp --dump-config` should agree with.
   */
  agentMode: string | null
  sandboxMode: SandboxMode | null
  /** What the page asked for when it last saved; missing in legacy files = ACP default. */
  agentModeChoice?: AgentModeChoice
  sandboxChoice?: SandboxChoice
  /**
   * Web-side snapshot captured when an `inherit` choice was resolved. Comparing
   * it with the live Web value is what makes `drift` detectable.
   */
  agentModeWeb?: string
  /**
   * Web-side **permission preset name** snapshotted when `inherit` was resolved
   * (e.g. `danger-full-access`, or `auto`). Not a sandbox mode: `auto` and
   * `danger-full-access` resolve to the same mode but a different approval
   * policy, so only the preset name can distinguish them.
   */
  sandboxWeb?: string
  /**
   * ACP value observed before this page started overriding the agent preset /
   * sandbox mode. Needed for the same minimal-write rule as plugin rows: once an
   * override is written the composition only reports the override, so the real
   * base has to be remembered to know whether `inherit` still needs a patch.
   */
  agentModeBase?: string
  sandboxBase?: SandboxMode
  /**
   * ACP approval policy observed before this page overrode the sandbox section.
   * Remembered next to `sandboxBase` because one inherited permission may keep
   * the base mode while changing the approval (`auto` is danger-full-access +
   * ask, the shipped danger-full-access preset is never).
   */
  sandboxApprovalBase?: SandboxApproval
  /**
   * Base `disabled` value observed for a row while it was NOT covered by the
   * managed block. Needed because after an override is written the composition
   * only reports the override, so the real base must be remembered to decide
   * whether an `inherit` resolution still needs a patch at all.
   */
  base?: Record<string, boolean>
}

const PLUGIN_MODES: readonly PluginMode[] = ['inherit', 'on', 'off']
const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS: readonly SandboxApproval[] = ['ask', 'never']

export function emptyState(profile: string): PersistedState {
  // `agentModeChoice` / `sandboxChoice` stay absent here: an absent choice means
  // "no choice was ever recorded" (a pre-three-state file, or a profile this page
  // never saved). Status and save both treat it as `{ mode: 'acp-default' }`.
  return {
    version: 1,
    savedAt: null,
    profile,
    plugins: {},
    agentMode: null,
    sandboxMode: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read a persisted agent-preset choice; `undefined` when missing or unusable. */
function readAgentChoice(raw: unknown, warnings: string[]): AgentModeChoice | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    warnings.push('state file has a non-object agentModeChoice; using the ACP default')
    return undefined
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'preset') {
    if (typeof raw.id === 'string' && raw.id !== '') return { mode: 'preset', id: raw.id }
    warnings.push('state file has a preset agentModeChoice without an id; using the ACP default')
    return undefined
  }
  warnings.push(
    `state file has unknown agentModeChoice mode ${JSON.stringify(mode)}; using the ACP default`,
  )
  return undefined
}

/** Read a persisted sandbox choice; `undefined` when missing or unusable. */
function readSandboxChoice(raw: unknown, warnings: string[]): SandboxChoice | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    warnings.push('state file has a non-object sandboxChoice; using the ACP default')
    return undefined
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'sandbox') {
    if (
      typeof raw.sandbox === 'string' &&
      (SANDBOX_MODES as readonly string[]).includes(raw.sandbox)
    )
      return { mode: 'sandbox', sandbox: raw.sandbox as SandboxMode }
    warnings.push('state file has a sandboxChoice with an unknown mode; using the ACP default')
    return undefined
  }
  warnings.push(
    `state file has unknown sandboxChoice mode ${JSON.stringify(mode)}; using the ACP default`,
  )
  return undefined
}

function readSandboxMode(raw: unknown, label: string, warnings: string[]): SandboxMode | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && (SANDBOX_MODES as readonly string[]).includes(raw)) {
    return raw as SandboxMode
  }
  warnings.push(`state file has unknown ${label} ${JSON.stringify(raw)}; ignoring it`)
  return undefined
}

/**
 * Read the persisted Web-side permission **preset name**.
 *
 * Preset names are open-ended (`auto`, `custom`, and whatever the deployment
 * configures), so any non-empty string is accepted. Files written before the
 * preset-name semantics stored a sandbox mode there; those values are valid
 * preset names too (`read-only` / `workspace-write` / `danger-full-access`),
 * which is exactly why the old shape stays readable.
 */
function readPermissionPreset(raw: unknown, label: string, warnings: string[]): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && raw !== '') return raw
  warnings.push(`state file has an unusable ${label} ${JSON.stringify(raw)}; ignoring it`)
  return undefined
}

/** Read a persisted approval policy; `undefined` when missing or unusable. */
function readApproval(
  raw: unknown,
  label: string,
  warnings: string[],
): SandboxApproval | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'string' && (APPROVALS as readonly string[]).includes(raw)) {
    return raw as SandboxApproval
  }
  warnings.push(`state file has unknown ${label} ${JSON.stringify(raw)}; ignoring it`)
  return undefined
}

/** Read state; missing file → empty state silently, corrupt file → empty + warning. */
export function readState(
  fs: FsPort,
  paths: ProfilePaths,
): { state: PersistedState; warnings: string[] } {
  const warnings: string[] = []
  if (!fs.existsFile(paths.statePath)) return { state: emptyState(paths.name), warnings }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFile(paths.statePath))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`state file is not valid JSON (${message}); starting from empty state`)
    return { state: emptyState(paths.name), warnings }
  }
  if (!isRecord(parsed)) {
    warnings.push('state file is not a JSON object; starting from empty state')
    return { state: emptyState(paths.name), warnings }
  }

  const state = emptyState(paths.name)
  if (parsed.version !== 1) {
    warnings.push(
      `state file has unsupported version ${JSON.stringify(parsed.version)}; starting from empty state`,
    )
    return { state, warnings }
  }
  if (typeof parsed.savedAt === 'string') state.savedAt = parsed.savedAt
  if (typeof parsed.profile === 'string') state.profile = parsed.profile
  if (typeof parsed.agentMode === 'string' && parsed.agentMode !== '')
    state.agentMode = parsed.agentMode
  const sandbox = parsed.sandboxMode
  if (typeof sandbox === 'string' && (SANDBOX_MODES as readonly string[]).includes(sandbox)) {
    state.sandboxMode = sandbox as SandboxMode
  } else if (sandbox !== null && sandbox !== undefined) {
    warnings.push(`state file has unknown sandboxMode ${JSON.stringify(sandbox)}; ignoring it`)
  }

  // Three-state choices (absent in pre-three-state files: keep the ACP default).
  const agentChoice = readAgentChoice(parsed.agentModeChoice, warnings)
  if (agentChoice !== undefined) state.agentModeChoice = agentChoice
  const sandboxChoice = readSandboxChoice(parsed.sandboxChoice, warnings)
  if (sandboxChoice !== undefined) state.sandboxChoice = sandboxChoice
  if (typeof parsed.agentModeWeb === 'string' && parsed.agentModeWeb !== '')
    state.agentModeWeb = parsed.agentModeWeb
  const sandboxWeb = readPermissionPreset(parsed.sandboxWeb, 'sandboxWeb', warnings)
  if (sandboxWeb !== undefined) state.sandboxWeb = sandboxWeb
  if (typeof parsed.agentModeBase === 'string' && parsed.agentModeBase !== '')
    state.agentModeBase = parsed.agentModeBase
  const sandboxBase = readSandboxMode(parsed.sandboxBase, 'sandboxBase', warnings)
  if (sandboxBase !== undefined) state.sandboxBase = sandboxBase
  const approvalBase = readApproval(parsed.sandboxApprovalBase, 'sandboxApprovalBase', warnings)
  if (approvalBase !== undefined) state.sandboxApprovalBase = approvalBase

  if (isRecord(parsed.base)) {
    const base: Record<string, boolean> = {}
    for (const [id, value] of Object.entries(parsed.base)) {
      if (typeof value === 'boolean') base[id] = value
    }
    state.base = base
  }

  if (isRecord(parsed.plugins)) {
    for (const [id, value] of Object.entries(parsed.plugins)) {
      if (!isRecord(value)) continue
      const mode = value.mode
      if (typeof mode !== 'string' || !(PLUGIN_MODES as readonly string[]).includes(mode)) {
        warnings.push(`state file has unknown mode for ${id}; treating as inherit`)
        state.plugins[id] = {
          mode: 'inherit',
          ...(typeof value.web === 'boolean' ? { web: value.web } : {}),
        }
        continue
      }
      state.plugins[id] = {
        mode: mode as PluginMode,
        ...(typeof value.web === 'boolean' ? { web: value.web } : {}),
      }
    }
  } else if (parsed.plugins !== undefined) {
    warnings.push('state file has a non-object plugins field; ignoring it')
  }
  return { state, warnings }
}

/** Write state atomically, refusing any path that escapes the profile. */
export function writeState(fs: FsPort, paths: ProfilePaths, state: PersistedState): void {
  assertInsideProfile(fs, paths.dir, paths.statePath)
  const body = JSON.stringify(state, null, 2) + '\n'
  const temp = paths.statePath + '.tmp'
  try {
    fs.writeFile(temp, body)
    fs.rename(temp, paths.statePath)
  } catch (error) {
    try {
      fs.unlink(temp)
    } catch {
      /* nothing to clean up */
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new AcpConfigError(ERROR_CODES.write, `failed to write state file: ${message}`)
  }
}
