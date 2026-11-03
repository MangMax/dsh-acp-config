// Injectable dependencies for the ACP configuration engine.
//
// Everything the engine touches outside its own logic (file system, clock, the
// `dsh --dump-config` child process, the live plugin list of the profile that
// serves the page) arrives through this one shape. Unit tests inject fakes;
// `defaultDeps()` wires the real Node/Electron implementations.
import { spawn } from 'node:child_process'
import * as fsSync from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import type { LocalizedText, WebPermission } from '../shared/contract.js'

/** Outcome of one `dsh --profile <name> --dump-config` run. */
export type DumpOutcome =
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
export interface FsPort {
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
  stat(path: string): { mtimeMs: number; size: number; mode: number } | null
}

/** Display metadata the live profile publishes for one plugin. */
export interface WebPluginInfo {
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
export interface PackageMeta {
  title?: LocalizedText
  description?: LocalizedText
}

/** One plugin row an agent preset declares, as `compositionInventory()` reports it. */
export interface PresetCompositionRow {
  /** Composition row id; `null` when the row declares none. */
  entryId?: string | null
  moduleName?: string
  enabled?: boolean | 'conditional'
  condition?: string
  /** Root-fiber state number when the preset composition is mounted. */
  fiberState?: number | null
}

/** One agent preset's identity and flattened composition. */
export interface PresetCompositionInventory {
  id: string
  name?: string
  description?: string
  isDefault?: boolean
  broken?: string
  rows?: readonly PresetCompositionRow[]
}

/** Live state of the profile serving this page (the Web GUI profile). */
export interface WebStatePort {
  listPlugins(): Promise<WebPluginInfo[]>
  /** Preset display metadata; optional, the page falls back to preset ids. */
  listPresets?(): Promise<Array<{ id: string; name?: string; description?: string }>>
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
export interface EngineDeps {
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

export const DEFAULT_DUMP_TIMEOUT_MS = 30_000

/** Real `node:fs` adapter. */
export const nodeFs: FsPort = {
  existsFile: (path) => {
    try {
      return fsSync.statSync(path).isFile()
    } catch {
      return false
    }
  },
  existsDir: (path) => {
    try {
      return fsSync.statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  readFile: (path) => fsSync.readFileSync(path, 'utf8'),
  writeFile: (path, data, mode) => {
    fsSync.writeFileSync(path, data, mode === undefined ? 'utf8' : { encoding: 'utf8', mode })
  },
  rename: (from, to) => fsSync.renameSync(from, to),
  copyFile: (from, to) => fsSync.copyFileSync(from, to),
  unlink: (path) => fsSync.rmSync(path, { force: true }),
  chmod: (path, mode) => fsSync.chmodSync(path, mode),
  mkdir: (path) => fsSync.mkdirSync(path, { recursive: true }),
  realpath: (path) => fsSync.realpathSync(path),
  stat: (path) => {
    try {
      const s = fsSync.statSync(path)
      return { mtimeMs: s.mtimeMs, size: s.size, mode: s.mode }
    } catch {
      return null
    }
  },
}

/** Strip trailing slashes so `endsWith('/dsh')` also accepts `…/dsh/`. */
function normalizeRoot(candidate: string): string {
  return candidate.length > 1 ? candidate.replace(/[/\\]+$/, '') : candidate
}

/**
 * Locate the DSH installation root from `process.argv` (the desktop host passes
 * `<…>/app.asar/dsh` as an argument). Returns null when the argument is absent,
 * e.g. in a plain Node script.
 */
export function detectDshRoot(
  argv: readonly string[],
  platform: string = process.platform,
): string | null {
  const isWin = platform === 'win32'
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue
    if (!isAbsolute(arg)) continue
    const candidate = normalizeRoot(arg)
    const tail = isWin ? /[/\\]dsh$/i : /\/dsh$/
    if (tail.test(candidate)) return candidate
  }
  return null
}

/**
 * One path segment of a module specifier: plain, lowercase/uppercase package-name
 * characters. `.` and `..` fail this test, so no specifier can climb a directory.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * The npm package a module specifier belongs to, or `null` when the specifier is
 * not one a locale lookup may turn into a path.
 *
 * Accepts `name`, `@scope/name` and their subpaths (`@scope/name/tools`), which
 * are how several Loader rows name their module. Every segment is validated, so
 * `..`, a backslash, a drive letter, a colon (`cordis:group`), a NUL byte or an
 * absolute path is rejected before any path is built.
 */
export function packageRootOf(moduleName: string): string | null {
  if (typeof moduleName !== 'string' || moduleName === '' || moduleName.length > 214) return null
  if (moduleName.includes('\\') || moduleName.includes('\0') || moduleName.includes(':')) {
    return null
  }
  if (moduleName.startsWith('/')) return null
  const segments = moduleName.split('/')
  if (segments.some((segment) => segment === '')) return null
  const scoped = moduleName.startsWith('@')
  if (scoped && segments.length < 2) return null
  for (const [index, segment] of segments.entries()) {
    if (index === 0 && scoped) {
      if (!SAFE_SEGMENT.test(segment.slice(1))) return null
      continue
    }
    if (!SAFE_SEGMENT.test(segment)) return null
  }
  return (scoped ? segments.slice(0, 2) : segments.slice(0, 1)).join('/')
}

/** True when `moduleName` is a specifier the package-locale fallback may read. */
export function isPackageModuleName(moduleName: string): boolean {
  return packageRootOf(moduleName) !== null
}

/** One locale file's `meta` block, flattened to plain strings. */
interface LocaleMeta {
  title?: string
  description?: string
}

/** Read one string out of a locale value (`"text"` or `{ en, zh, … }`). */
function localeTextOf(value: unknown, locale: string): string | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  // The locale file is already language-specific; a nested shape is tolerated by
  // preferring this locale, then the two languages this package ships.
  for (const key of [locale, 'en', 'zh']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  return undefined
}

/** Read `locale/<name>.json`'s `meta` block; any problem is "no metadata". */
function readLocaleMeta(fs: FsPort, localePath: string, locale: string): LocaleMeta {
  try {
    if (!fs.existsFile(localePath)) return {}
    const parsed: unknown = JSON.parse(fs.readFile(localePath))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const meta = (parsed as Record<string, unknown>).meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return {}
    const record = meta as Record<string, unknown>
    const title = localeTextOf(record.title, locale)
    const description = localeTextOf(record.description, locale)
    return {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    }
  } catch {
    return {}
  }
}

/** Pair the zh/en strings into the wire's `LocalizedText`; `undefined` when empty. */
function localizedPair(zh: string | undefined, en: string | undefined): LocalizedText | undefined {
  if (zh === undefined && en === undefined) return undefined
  const fallback = zh ?? en ?? ''
  return { en: en ?? fallback, zh: zh ?? fallback }
}

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
export function createReadPackageMeta(options: {
  dshRoot: string | null
  fs?: FsPort
}): (moduleName: string) => Promise<PackageMeta | null> {
  const fs = options.fs ?? nodeFs
  const root = options.dshRoot
  const nodeModules = root === null || root === '' ? null : join(root, 'node_modules')
  const cache = new Map<string, Promise<PackageMeta | null>>()

  const read = async (moduleName: string): Promise<PackageMeta | null> => {
    if (nodeModules === null) return null
    try {
      const packageRoot = packageRootOf(moduleName)
      if (packageRoot === null) return null
      const packageDir = resolve(nodeModules, ...packageRoot.split('/'))
      // Defense in depth: the segments are validated, but a path that resolves
      // outside `node_modules` must never be read.
      if (!packageDir.startsWith(`${resolve(nodeModules)}${sep}`)) return null
      const localeDir = join(packageDir, 'locale')
      const zh = readLocaleMeta(fs, join(localeDir, 'zh.json'), 'zh')
      const en = readLocaleMeta(fs, join(localeDir, 'en.json'), 'en')
      const title = localizedPair(zh.title, en.title)
      const description = localizedPair(zh.description, en.description)
      if (title === undefined && description === undefined) return null
      return {
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
      }
    } catch {
      return null
    }
  }

  return (moduleName) => {
    if (typeof moduleName !== 'string' || moduleName === '') return Promise.resolve(null)
    const cached = cache.get(moduleName)
    if (cached !== undefined) return cached
    const pending = read(moduleName)
    cache.set(moduleName, pending)
    return pending
  }
}

/** One spawn candidate: the command plus extra environment for that command. */
interface SpawnCandidate {
  command: string
  args: string[]
  env?: Record<string, string>
}

function dumpCandidates(
  fs: FsPort,
  env: NodeJS.ProcessEnv,
  dshRoot: string | null,
  execPath: string,
  profile: string,
): SpawnCandidate[] {
  const tail = ['--profile', profile, '--dump-config']
  const candidates: SpawnCandidate[] = []
  const override = env.DSH_ACP_CONFIG_CLI
  if (typeof override === 'string' && override.trim() !== '') {
    candidates.push({ command: override.trim(), args: tail })
  }
  candidates.push({ command: 'dsh', args: tail })
  if (dshRoot !== null) {
    const bin = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsFile(bin)) {
      candidates.push({
        command: execPath,
        args: [bin, ...tail],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      })
    }
  }
  return candidates
}

/**
 * Spawn one dump run asynchronously (never `spawnSync`: the host is Electron's
 * main process and a blocking 1–2 s dump freezes the whole GUI).
 *
 * A timeout kills the child and settles as `timeout`; a missing binary settles
 * as `unavailable` so the caller can fall through to the next candidate.
 */
async function spawnDump(
  candidate: SpawnCandidate,
  timeoutMs: number,
): Promise<DumpOutcome & { missingBinary?: boolean }> {
  const command = [candidate.command, ...candidate.args].join(' ')
  return await new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let killTimer: ReturnType<typeof setTimeout> | undefined
    let stdout = ''
    let stderr = ''
    const finish = (outcome: DumpOutcome & { missingBinary?: boolean }) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (killTimer !== undefined) clearTimeout(killTimer)
      resolve(outcome)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(candidate.command, candidate.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: candidate.env === undefined ? process.env : { ...process.env, ...candidate.env },
        windowsHide: true,
      })
    } catch (error) {
      finish({ ok: false, source: 'fallback', code: 'spawn', message: String(error), command })
      return
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < 32 * 1024 * 1024) stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < 1024 * 1024) stderr += chunk
    })

    child.on('error', (error: NodeJS.ErrnoException) => {
      const missing = error.code === 'ENOENT'
      finish({
        ok: false,
        source: 'fallback',
        code: missing ? 'unavailable' : 'spawn',
        message: missing ? `${candidate.command} not found` : error.message,
        command,
        ...(missing ? { missingBinary: true } : {}),
      })
    })

    child.on('close', (code, signal) => {
      if (settled) return
      if (code === 0) {
        finish({ ok: true, source: 'live', text: stdout, command })
        return
      }
      const detail = stderr.trim() !== '' ? stderr.trim().split('\n').slice(-3).join(' ') : ''
      finish({
        ok: false,
        source: 'fallback',
        code: 'exit',
        message: `exit ${code ?? signal ?? 'unknown'}${detail === '' ? '' : `: ${detail}`}`,
        command,
      })
    })

    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already gone */
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }, 2_000)
      killTimer.unref?.()
      finish({
        ok: false,
        source: 'fallback',
        code: 'timeout',
        message: `dump timed out after ${timeoutMs}ms`,
        command,
      })
    }, timeoutMs)
    timer.unref?.()
  })
}

/**
 * Build the real `runDump` implementation: try each candidate in order, skip
 * binaries that do not exist, and surface the last meaningful failure.
 */
export function createRunDump(
  options: {
    env?: NodeJS.ProcessEnv
    fs?: FsPort
    dshRoot?: string | null
    execPath?: string
    timeoutMs?: number
  } = {},
): (args: { profile: string; timeoutMs: number }) => Promise<DumpOutcome> {
  const env = options.env ?? process.env
  const fs = options.fs ?? nodeFs
  const execPath = options.execPath ?? process.execPath
  const timeoutMs = options.timeoutMs ?? DEFAULT_DUMP_TIMEOUT_MS
  return async (args) => {
    const root = options.dshRoot === undefined ? detectDshRoot(process.argv) : options.dshRoot
    const candidates = dumpCandidates(fs, env, root, execPath, args.profile)
    let last: DumpOutcome = {
      ok: false,
      source: 'fallback',
      code: 'unavailable',
      message: 'no dsh executable available',
    }
    for (const candidate of candidates) {
      const outcome = await spawnDump(candidate, args.timeoutMs ?? timeoutMs)
      if (outcome.ok) return outcome
      last = outcome
      // Only a missing binary justifies trying the next candidate; a real
      // failure (bad profile, crash) is the answer the caller must see.
      if (outcome.missingBinary !== true) return outcome
    }
    return last
  }
}

/** `$DSH_HOME` (default `~/.dsh`) for the running process. */
export function resolveHomeDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(home, '.dsh')
}

/**
 * Real dependencies for production and for plain-Node smoke scripts:
 * `createEngine(defaultDeps())` works outside Electron (the execPath candidate
 * is only offered when its `lib/bin.js` actually exists).
 *
 * The package-locale metadata fallback is wired only when the desktop host
 * passed a DSH installation root (an absolute `<…>/dsh` argument); a plain Node
 * run therefore never reads `app.asar` or an installed `node_modules`.
 */
export function defaultDeps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  const fs = overrides.fs ?? nodeFs
  const dshRoot = overrides.readPackageMeta === undefined ? detectDshRoot(process.argv) : null
  const readPackageMeta =
    overrides.readPackageMeta ??
    (dshRoot === null ? undefined : createReadPackageMeta({ dshRoot, fs }))
  return {
    homeDir: overrides.homeDir ?? resolveHomeDir(),
    profileName: overrides.profileName ?? 'acp',
    fs,
    runDump: overrides.runDump ?? createRunDump({ fs }),
    now: overrides.now ?? (() => new Date().toISOString()),
    ...(overrides.web === undefined ? {} : { web: overrides.web }),
    ...(readPackageMeta === undefined ? {} : { readPackageMeta }),
  }
}
