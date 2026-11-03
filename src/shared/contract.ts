// Wire contract shared by the Host half (route handler) and the Client half
// (settings page). Plain data only: both sides are bundled separately, so this
// file must stay dependency-free and side-effect-free.

/** Sandbox modes DSH's permission presets understand. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** Approval policy paired with a sandbox mode by the shipped presets. */
export type SandboxApproval = 'ask' | 'never'

/** How one plugin row should be decided for the ACP profile. */
export type PluginMode = 'inherit' | 'on' | 'off'

/** Why a row cannot be switched from this page. */
export type LockReason =
  | 'preset-managed' // an agent preset declares this row; ACP mounts it per session
  | 'infra' // host infrastructure rows ACP's own bundle layout owns
  | 'not-in-acp' // installed/used by this profile but absent from ACP composition
  | 'acp-only' // present in ACP with no counterpart in this profile
  | 'unaddressable' // the profile cannot persist a patch for this row

export interface LocalizedText {
  en: string
  [locale: string]: string
}

export interface PluginRowView {
  /** Loader entry id in the ACP composition (`patchId`). */
  id: string
  /**
   * Which group the official Plugins page would put this row in:
   * `session` rows are declared by an agent preset and mounted per session,
   * `global` rows compose at process level.
   */
  group: 'session' | 'global'
  /** For `session` rows: the preset(s) that declare this row, when known. */
  presetName?: LocalizedText
  /** Plugin package name, used to match a row across profiles. */
  moduleName: string
  title?: LocalizedText
  description?: LocalizedText
  /** Live state of the same plugin in the profile serving this page. */
  web: 'on' | 'off' | 'absent'
  /** State composed by the ACP profile before this page's overrides. */
  acp: 'on' | 'off' | 'dynamic' | 'absent'
  /** Live fiber phase of the same row in the page's own profile, for the details table. */
  webFiber?: string
  mode: PluginMode
  locked?: LockReason
  /** The web state changed since the last save that resolved `inherit`. */
  drift: boolean
}

export interface PresetOption {
  id: string
  title?: LocalizedText
  description?: LocalizedText
  /** How many plugin rows the preset declares, when the ACP dump exposes it. */
  rowCount?: number
}

export interface AcpProfileInfo {
  name: string
  dir: string
  exists: boolean
  patchPath: string
  /** Bundle packages the ACP profile declares, in composition order. */
  bundles: string[]
}

export interface StatusRequest {}

/** How the ACP profile should decide its agent preset. */
export type AgentModeChoice =
  /** Follow the web profile's current default preset, resolved at save time. */
  | { mode: 'inherit' }
  /** No override: keep whatever the ACP profile composes on its own. */
  | { mode: 'acp-default' }
  /** Pin one preset id from the ACP composition. */
  | { mode: 'preset'; id: string }

/** One permission preset as the web profile currently resolves it. */
export interface WebPermission {
  /** Preset key shown in the web UI, e.g. `danger-full-access` or `auto`. */
  preset: string
  sandbox: SandboxMode
  approval: SandboxApproval
}

/** How the ACP profile should decide its sandbox permission. */
export type SandboxChoice =
  /** Follow the web profile's selected permission preset, resolved at save time. */
  | { mode: 'inherit' }
  /** No override: keep whatever the ACP profile composes on its own. */
  | { mode: 'acp-default' }
  /** Pin one sandbox mode; the paired approval policy follows the preset table. */
  | { mode: 'sandbox'; sandbox: SandboxMode }

export interface StatusPayload {
  ok: true
  acp: AcpProfileInfo
  rows: PluginRowView[]
  presets: PresetOption[]
  agentMode: {
    /** The effective preset ACP composes today (managed block, else its own default). */
    value: string | null
    /** What this page asks for. */
    choice: AgentModeChoice
    /** The web profile's current default preset, when it can be read. */
    web: string | null
    /** The web value changed since this page last resolved an `inherit` choice. */
    drift: boolean
    /** True when the ACP composition exposes a preset registry row at all. */
    available: boolean
    reason?: string
  }
  sandbox: {
    /** The effective mode ACP composes today. */
    mode: SandboxMode | null
    approval: SandboxApproval | null
    /** What this page asks for. */
    choice: SandboxChoice
    /**
     * The web profile's selected permission preset (sandbox + paired approval),
     * not the deployment default. `null` when it cannot be read.
     */
    web: WebPermission | null
    /** Permission presets the web profile offers, for the pin options. */
    webPresets: WebPermission[]
    drift: boolean
    available: boolean
    reason?: string
  }
  apply: {
    /** Wall-clock time of the last successful write from this page. */
    lastSavedAt: string | null
    /** Row ids whose inherited resolution no longer matches the saved snapshot. */
    drift: string[]
  }
  /** Non-fatal conditions worth showing in the page (degraded dump, unknown rows). */
  warnings: string[]
}

export interface SaveRequest {
  /** Explicit mode per row id. Rows absent here keep the saved mode. */
  plugins?: Record<string, PluginMode>
  /** `undefined` keeps this page's saved choice. */
  agentMode?: AgentModeChoice
  /** `undefined` keeps this page's saved choice. */
  sandboxMode?: SandboxChoice
}

export interface Verification {
  source: 'live' | 'unavailable'
  rows?: Record<string, 'on' | 'off' | 'dynamic'>
  agentMode?: string | null
  sandbox?: SandboxMode | null
  warnings: string[]
}

export interface SavePayload {
  ok: true
  savedAt: string
  changed: string[]
  /** Post-write re-composition of the ACP profile, when the dump is available. */
  verification: Verification
  warnings: string[]
}

export interface Failure {
  ok: false
  error: {
    code: string
    message: string
  }
}

/**
 * What `ctx.connection.rpc.call(...)` resolves to: the connection layer requires
 * the route's `result` to be a `{ ok, value }` / `{ ok:false, error }` envelope.
 * The payload types above are the `value` side.
 */
export type RpcResult<T> = { ok: true; value: T } | Failure

export interface ValidateRequest {}

export interface ValidatePayload {
  ok: true
  verification: Verification
  /** Where the effective values came from: the managed block, or the ACP defaults. */
  agentMode: string | null
  sandbox: SandboxMode | null
  warnings: string[]
}

/** Methods accepted by `POST /api/dsh-acp-config`. */
export type WireMethod = 'status' | 'save' | 'validate'

/** Envelope the Client's `connection.rpc.call` sends; mirrored from dsh-themes. */
export interface ClientRequestEnvelope {
  type: 'client-request'
  rpcId: string
  payload: {
    method: string
    args?: unknown
  }
}

export interface ServerResponseEnvelope {
  type: 'server-response'
  rpcId: string
  result: unknown
}

export const ROUTE_PATH = '/api/dsh-acp-config'
export const ROUTE_KEY = 'dsh-acp-config'
export const RPC_PREFIX = '/api'

export const SANDBOX_MODES: readonly SandboxMode[] = [
  'read-only',
  'workspace-write',
  'danger-full-access',
]
