/** Sandbox modes DSH's permission presets understand. */
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
/** Approval policy paired with a sandbox mode by the shipped presets. */
type SandboxApproval = 'ask' | 'never'
/** How one plugin row should be decided for the ACP profile. */
type PluginMode = 'inherit' | 'on' | 'off'
/** Why a row cannot be switched from this page. */
type LockReason = 'preset-managed' | 'infra' | 'not-in-acp' | 'acp-only' | 'unaddressable'
interface LocalizedText {
  en: string
  [locale: string]: string
}
interface PluginRowView {
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
interface PresetOption {
  id: string
  title?: LocalizedText
  description?: LocalizedText
  /** How many plugin rows the preset declares, when the ACP dump exposes it. */
  rowCount?: number
}
interface AcpProfileInfo {
  name: string
  dir: string
  exists: boolean
  patchPath: string
  /** Bundle packages the ACP profile declares, in composition order. */
  bundles: string[]
}
/** How the ACP profile should decide its agent preset. */
type AgentModeChoice =
  /** Follow the web profile's current default preset, resolved at save time. */
  | {
      mode: 'inherit'
    }
  /** No override: keep whatever the ACP profile composes on its own. */
  | {
      mode: 'acp-default'
    }
  /** Pin one preset id from the ACP composition. */
  | {
      mode: 'preset'
      id: string
    }
/** One permission preset as the web profile currently resolves it. */
interface WebPermission {
  /** Preset key shown in the web UI, e.g. `danger-full-access` or `auto`. */
  preset: string
  sandbox: SandboxMode
  approval: SandboxApproval
}
/** How the ACP profile should decide its sandbox permission. */
type SandboxChoice =
  /** Follow the web profile's selected permission preset, resolved at save time. */
  | {
      mode: 'inherit'
    }
  /** No override: keep whatever the ACP profile composes on its own. */
  | {
      mode: 'acp-default'
    }
  /** Pin one sandbox mode; the paired approval policy follows the preset table. */
  | {
      mode: 'sandbox'
      sandbox: SandboxMode
    }
interface StatusPayload {
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
interface SaveRequest {
  /** Explicit mode per row id. Rows absent here keep the saved mode. */
  plugins?: Record<string, PluginMode>
  /** `undefined` keeps this page's saved choice. */
  agentMode?: AgentModeChoice
  /** `undefined` keeps this page's saved choice. */
  sandboxMode?: SandboxChoice
}
interface Verification {
  source: 'live' | 'unavailable'
  rows?: Record<string, 'on' | 'off' | 'dynamic'>
  agentMode?: string | null
  sandbox?: SandboxMode | null
  warnings: string[]
}
interface SavePayload {
  ok: true
  savedAt: string
  changed: string[]
  /** Post-write re-composition of the ACP profile, when the dump is available. */
  verification: Verification
  warnings: string[]
}
interface Failure {
  ok: false
  error: {
    code: string
    message: string
  }
}
interface ValidatePayload {
  ok: true
  verification: Verification
  /** Where the effective values came from: the managed block, or the ACP defaults. */
  agentMode: string | null
  sandbox: SandboxMode | null
  warnings: string[]
}
/** Outcome of one `dsh --profile <name> --dump-config` run. */
type DumpOutcome =
  | {
      ok: true
      source: 'live'
      text: string
      /** Human-readable command actually used, for diagnostics. */
      command: string
    }
  | {
      ok: false
      source: 'fallback'
      /** `unavailable` (no candidate could start), `timeout`, `exit`, `spawn`. */
      code: 'unavailable' | 'timeout' | 'exit' | 'spawn'
      message: string
      command?: string
    }
/** Minimal synchronous file-system surface the engine needs. */
interface FsPort {
  existsFile(path: string): boolean
  existsDir(path: string): boolean
  /** UTF-8 read; throws when the file is unreadable. */
  readFile(path: string): string
  /** UTF-8 write. Creates or truncates `path` (parent must exist). */
  writeFile(path: string, data: string, mode?: number): void
  rename(from: string, to: string): void
  copyFile(from: string, to: string): void
  unlink(path: string): void
  chmod(path: string, mode: number): void
  mkdir(path: string): void
  /** Resolved absolute path; throws when `path` does not exist. */
  realpath(path: string): string
  /** `mtimeMs` + `size` + POSIX mode, or null when the file is missing. */
  stat(path: string): {
    mtimeMs: number
    size: number
    mode: number
  } | null
}
/** Display metadata the live profile publishes for one plugin. */
interface WebPluginInfo {
  moduleName: string
  enabled: boolean
  /** Loader entry id; absent when the profile cannot persist a patch for it. */
  patchId?: string
  title?: string | Record<string, string>
  description?: string | Record<string, string>
  /**
   * Loader root-fiber phase of the entry in the page's own profile
   * (`pending` / `loading` / `active` / `failed` / `unloading`), when live.
   * The page maps `active` to its "运行中" cell.
   */
  fiberPhase?: string
}
/**
 * Display metadata read straight out of a package's `locale/*.json` `meta`
 * block. This is the fallback for rows whose plugin never reached the page's
 * own loader (an agent preset's rows live in the ACP composition, not in this
 * profile's live list).
 */
interface PackageMeta {
  title?: LocalizedText
  description?: LocalizedText
}
/** One plugin row an agent preset declares, as `compositionInventory()` reports it. */
interface PresetCompositionRow {
  /** Composition row id; `null` when the row declares none. */
  entryId?: string | null
  moduleName?: string
  enabled?: boolean | 'conditional'
  condition?: string
  /** Root-fiber state number when the preset composition is mounted. */
  fiberState?: number | null
}
/** One agent preset's identity and flattened composition. */
interface PresetCompositionInventory {
  id: string
  name?: string
  description?: string
  isDefault?: boolean
  broken?: string
  rows?: readonly PresetCompositionRow[]
}
/** Live state of the profile serving this page (the Web GUI profile). */
interface WebStatePort {
  listPlugins(): Promise<WebPluginInfo[]>
  /** Preset display metadata; optional, the page falls back to preset ids. */
  listPresets?(): Promise<
    Array<{
      id: string
      name?: string
      description?: string
    }>
  >
  /**
   * Every agent preset's declared plugin rows (`agentPresets.compositionInventory()`).
   * Optional: absent means session rows fall back to the ACP dump's own preset
   * declarations for their `presetName`.
   */
  compositionInventory?(): Promise<PresetCompositionInventory[]>
  /**
   * Default agent preset of the profile serving this page (`agentPresets.resolve()`).
   * `null` means the value cannot be read here; `inherit` must then fail loudly
   * instead of silently falling back to the ACP default.
   */
  readAgentPreset(): Promise<string | null>
  /**
   * The permission preset the profile serving this page has selected
   * (`permissionPresets.catalog().defaultPreset`, resolved through
   * `permissionPresets.resolve()`).
   *
   * Deliberately **not** `sandboxPolicy.defaultMode`: that is the deployment
   * default (`DSH_PERMISSION_MODE ?? 'workspace-write'`), which says nothing
   * about what the user picked in the Web UI. Reading it made the page show
   * "workspace write" while the user had selected "full access".
   *
   * `null` means the value cannot be read here (see `readAgentPreset`).
   */
  readWebPermission(): Promise<WebPermission | null>
  /**
   * Every permission preset the profile serving this page offers, resolved to
   * `{ sandbox, approval }`. Optional: absent means the page falls back to its
   * static preset table.
   */
  listWebPermissions?(): Promise<WebPermission[]>
}
/** Everything the engine needs; no Cordis context appears here. */
interface EngineDeps {
  /** `$DSH_HOME`, already resolved (default `~/.dsh`). */
  homeDir: string
  /** ACP profile name, validated by `paths.ts` before any path is built. */
  profileName: string
  fs: FsPort
  runDump(args: { profile: string; timeoutMs: number }): Promise<DumpOutcome>
  /** ISO timestamp supplier (injectable clock). */
  now(): string
  /** Live plugin state of the page's own profile; absent in a plain Node run. */
  web?: WebStatePort
  /**
   * Read a package's localized `meta` from `<dshRoot>/node_modules/<module>/locale`.
   * Absent in a plain Node run (no `dshRoot` on the command line), where only the
   * live profile's metadata is available.
   *
   * A plain function value (`this: void`): the engine passes it around as data.
   */
  readPackageMeta?(this: void, moduleName: string): Promise<PackageMeta | null>
}
/**
 * The npm package a module specifier belongs to, or `null` when the specifier is
 * not one a locale lookup may turn into a path.
 *
 * Accepts `name`, `@scope/name` and their subpaths (`@scope/name/tools`), which
 * are how several Loader rows name their module. Every segment is validated, so
 * `..`, a backslash, a drive letter, a colon (`cordis:group`), a NUL byte or an
 * absolute path is rejected before any path is built.
 */
export declare function packageRootOf(moduleName: string): string | null
/** True when `moduleName` is a specifier the package-locale fallback may read. */
export declare function isPackageModuleName(moduleName: string): boolean
/**
 * Build the real `readPackageMeta`: read `<dshRoot>/node_modules/<package>/locale/
 * {zh,en}.json` and pair their `meta.title` / `meta.description`.
 *
 * Used only when `pluginManager.listPlugins()` has no metadata for a row — an
 * agent preset's plugins are composed inside the ACP profile, so their packages
 * never reach this profile's live loader entries.
 *
 * A subpath specifier (`@scope/pkg/tools`) resolves to its package root, which is
 * where the locale files live. Electron's patched `fs` reads inside `app.asar`; a
 * plain Node run passes `dshRoot: null` (see `defaultDeps`), so the fallback is
 * simply absent there. Reads are cached per module for the lifetime of the
 * returned function, and every failure resolves to `null`.
 */
export declare function createReadPackageMeta(options: {
  dshRoot: string | null
  fs?: FsPort
}): (moduleName: string) => Promise<PackageMeta | null>
/**
 * Real dependencies for production and for plain-Node smoke scripts:
 * `createEngine(defaultDeps())` works outside Electron (the execPath candidate
 * is only offered when its `lib/bin.js` actually exists).
 *
 * The package-locale metadata fallback is wired only when the desktop host
 * passed a DSH installation root (an absolute `<…>/dsh` argument); a plain Node
 * run therefore never reads `app.asar` or an installed `node_modules`.
 */
export declare function defaultDeps(overrides?: Partial<EngineDeps>): EngineDeps
interface ProfilePaths {
  homeDir: string
  name: string
  /** `<home>/profiles/<name>` (not necessarily existing). */
  dir: string
  patchPath: string
  statePath: string
  backupPath: string
  tempPath: string
}
interface EngineOptions {
  /** `dsh --dump-config` timeout; defaults to 30 s. */
  dumpTimeoutMs?: number
}
/** The three operations behind `POST /api/dsh-acp-config`. */
interface AcpEngine {
  status(): Promise<StatusPayload>
  save(request: SaveRequest): Promise<SavePayload | Failure>
  validate(): Promise<ValidatePayload | Failure>
  /** Resolved paths, for diagnostics and smoke scripts. */
  paths(): ProfilePaths
}
/**
 * Build an engine from injectable dependencies.
 *
 * Nothing here touches a Cordis context: the Host route supplies the live
 * plugin list, tests and smoke scripts supply fakes or nothing at all.
 */
export declare function createEngine(deps: EngineDeps, options?: EngineOptions): AcpEngine
export declare const name = 'dsh-acp-config'
export declare const inject: string[]
/**
 * Live plugin state of the profile that serves this page.
 *
 * Services are resolved lazily on every call: plugin activation order does not
 * guarantee `pluginManager`/`agentPresets`/`permissionPresets` exist when this
 * row activates, so a one-shot `ctx.get(...)` at apply time would degrade the
 * page permanently.
 */
export declare function createWebPort(ctx: any): WebStatePort
/** Dispatch one decoded RPC payload onto the engine. */
export declare function dispatch(engine: AcpEngine, method: string, args: unknown): Promise<unknown>
/** Build the Fetch handler; exported so tests can drive it without Cordis. */
export declare function createFetchHandler(
  engine: AcpEngine,
): (request: Request) => Promise<Response>
export declare function apply(ctx: any): void
export type {
  AcpEngine,
  DumpOutcome,
  EngineDeps,
  EngineOptions,
  FsPort,
  PackageMeta,
  PresetCompositionInventory,
  PresetCompositionRow,
  WebPluginInfo,
  WebStatePort,
}
//# sourceMappingURL=index.d.mts.map
