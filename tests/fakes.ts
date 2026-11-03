// Test doubles: an in-memory `FsPort` and dump outcomes, so every engine test
// runs without touching a real `~/.dsh` profile.
import { dirname, join } from 'node:path'
import { parseManagedBlock } from '../src/host/patch-block.js'
import type {
  DumpOutcome,
  EngineDeps,
  FsPort,
  PackageMeta,
  PresetCompositionInventory,
  WebPluginInfo,
} from '../src/host/ports.js'
import type { EngineDeps as Deps } from '../src/host/ports.js'
import type { SandboxApproval, SandboxMode, WebPermission } from '../src/shared/contract.js'

interface MemoryFile {
  content: string
  mode: number
  mtimeMs: number
}

export interface MemoryFs extends FsPort {
  files: Map<string, MemoryFile>
  dirs: Set<string>
  writes: string[]
  /** Simulate an external edit between read and write (conflict detection test). */
  bumpOnNextStat?: (path: string) => boolean
}

/** Build an in-memory file system rooted at `/`. */
export function memoryFs(initial: Record<string, string> = {}): MemoryFs {
  const files = new Map<string, MemoryFile>()
  const dirs = new Set<string>(['/'])
  const writes: string[] = []
  let clock = 1_000

  const ensureDir = (path: string) => {
    let current = dirname(path)
    while (current !== '/' && current !== '.') {
      dirs.add(current)
      current = dirname(current)
    }
  }

  const api: MemoryFs = {
    files,
    dirs,
    writes,
    existsFile: (path) => files.has(path),
    existsDir: (path) => dirs.has(path),
    readFile: (path) => {
      const file = files.get(path)
      if (file === undefined) throw new Error(`ENOENT: ${path}`)
      return file.content
    },
    writeFile: (path, data, mode) => {
      ensureDir(path)
      clock += 1
      const previous = files.get(path)
      files.set(path, { content: data, mode: mode ?? previous?.mode ?? 0o644, mtimeMs: clock })
      writes.push(path)
    },
    rename: (from, to) => {
      const file = files.get(from)
      if (file === undefined) throw new Error(`ENOENT: ${from}`)
      files.delete(from)
      ensureDir(to)
      clock += 1
      files.set(to, { ...file, mtimeMs: clock })
      writes.push(`${from}->${to}`)
    },
    copyFile: (from, to) => {
      const file = files.get(from)
      if (file === undefined) throw new Error(`ENOENT: ${from}`)
      files.set(to, { ...file })
      writes.push(`${from}~>${to}`)
    },
    unlink: (path) => {
      files.delete(path)
    },
    chmod: (path, mode) => {
      const file = files.get(path)
      if (file === undefined) throw new Error(`ENOENT: ${path}`)
      file.mode = mode
    },
    mkdir: (path) => {
      ensureDir(join(path, 'x'))
      dirs.add(path)
    },
    realpath: (path) => {
      if (files.has(path) || dirs.has(path)) return path
      throw new Error(`ENOENT: ${path}`)
    },
    stat: (path) => {
      if (api.bumpOnNextStat?.(path) === true) {
        api.bumpOnNextStat = undefined
        const file = files.get(path)
        if (file !== undefined) file.mtimeMs += 10
      }
      const file = files.get(path)
      if (file === undefined) return null
      return { mtimeMs: file.mtimeMs, size: file.content.length, mode: file.mode }
    },
  }

  for (const [path, content] of Object.entries(initial)) {
    ensureDir(path)
    clock += 1
    files.set(path, { content, mode: 0o600, mtimeMs: clock })
  }
  return api
}

/** Register the profile directory (and `profiles/`) as existing. */
export function withProfile(fs: MemoryFs, homeDir: string, profile: string): void {
  fs.dirs.add(homeDir)
  fs.dirs.add(join(homeDir, 'profiles'))
  fs.dirs.add(join(homeDir, 'profiles', profile))
}

/** A minimal composed dump: two switchable rows, one preset-managed, one infra. */
export const SAMPLE_DUMP = `# == @deepseek-ai/dsh-base
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: true
- id: tool-web
  name: '@deepseek-ai/dsh-tool-web'
- id: tool-bash
  name: '@deepseek-ai/dsh-tool-bash'
  disabled: true
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js process.cwd()
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: !!js >-
      (process.env.DSH_PERMISSION_MODE ?? 'workspace-write') ===
      'danger-full-access' ? 'never' : 'ask'
- id: agent-preset-registry
  name: '@deepseek-ai/dsh-agent-preset-registry'
  config:
    default: standard
- id: preset-standard
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: standard
    order: 1
    plugins:
      - id: tool-bash
        name: '@deepseek-ai/dsh-tool-bash'
        disabled: !!js process.platform === 'win32'
      - id: tool-fs
        name: '@deepseek-ai/dsh-tool-fs'
- id: preset-minimal
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: minimal
    order: 3
    plugins:
      - id: persona
        name: '@deepseek-ai/dsh-persona'
- id: preset-cordis
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    id: cordis
    order: 2
    plugins:
      - id: planning
        name: cordis:group
        group: true
        config:
          - id: plan-mode
            name: '@deepseek-ai/dsh-plan-mode'
`

/** A dump outcome carrying `text`. */
export function liveDump(text: string = SAMPLE_DUMP): DumpOutcome {
  return { ok: true, source: 'live', text, command: 'dsh --profile acp --dump-config' }
}

/** A degraded dump outcome. */
export function failedDump(message = 'dsh not found'): DumpOutcome {
  return { ok: false, source: 'fallback', code: 'unavailable', message }
}

/** The shipped preset table: name → resolved sandbox + approval. */
export const SHIPPED_PRESETS: Record<string, { sandbox: SandboxMode; approval: SandboxApproval }> =
  {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    // Shares a sandbox mode with the danger preset but asks for approval: this is
    // why the approval must come from the preset, never from a mode lookup table.
    auto: { sandbox: 'danger-full-access', approval: 'ask' },
  }

/** Build a `WebPermission` from a preset name (throws for an unknown name). */
export function permissionOf(preset: string): WebPermission {
  const spec = SHIPPED_PRESETS[preset]
  if (spec === undefined) throw new Error(`unknown preset in fixture: ${preset}`)
  return { preset, sandbox: spec.sandbox, approval: spec.approval }
}

export interface FakeDepsOptions {
  homeDir?: string
  profileName?: string
  fs?: MemoryFs
  dump?: DumpOutcome | (() => DumpOutcome)
  web?: WebPluginInfo[]
  presets?: Array<{ id: string; name?: string; description?: string }>
  /** Rows each preset declares, as `agentPresets.compositionInventory()` reports them. */
  inventory?: PresetCompositionInventory[]
  /** Package-locale metadata keyed by module name (the injected fallback). */
  packageMeta?: Record<string, PackageMeta | null>
  /** Live default preset the fake Web profile publishes (`null` = unreadable). */
  webPreset?: string | null
  /**
   * Permission preset the fake Web profile has selected (`null` = unreadable).
   * A bare `SandboxMode` is accepted for readability and resolved through the
   * shipped table (its preset name equals the mode).
   */
  webPermission?: string | WebPermission | null
  /** Permission presets the fake Web profile offers (absent = shipped table). */
  webPermissions?: WebPermission[]
  now?: () => string
}

/** Assemble `EngineDeps` from in-memory fakes. */
export function fakeDeps(options: FakeDepsOptions = {}): EngineDeps & { fs: MemoryFs } {
  const homeDir = options.homeDir ?? '/home/test/.dsh'
  const profileName = options.profileName ?? 'acp'
  const fs = options.fs ?? memoryFs()
  const dump = options.dump ?? liveDump()
  const deps: EngineDeps & { fs: MemoryFs } = {
    homeDir,
    profileName,
    fs,
    runDump: async () => (typeof dump === 'function' ? dump() : dump),
    now: options.now ?? (() => '2026-11-03T08:00:00.000Z'),
  }
  const packageMeta = options.packageMeta
  if (packageMeta !== undefined) {
    deps.readPackageMeta = async (moduleName) => packageMeta[moduleName] ?? null
  }
  if (options.web !== undefined) {
    const webPreset = options.webPreset ?? null
    const rawPermission = options.webPermission ?? null
    const webPermission =
      typeof rawPermission === 'string' ? permissionOf(rawPermission) : rawPermission
    const webPermissions = options.webPermissions ?? []
    deps.web = {
      listPlugins: async () => options.web ?? [],
      ...(options.inventory === undefined
        ? {}
        : { compositionInventory: async () => options.inventory ?? [] }),
      ...(options.presets === undefined ? {} : { listPresets: async () => options.presets ?? [] }),
      readAgentPreset: async () => webPreset,
      readWebPermission: async () => webPermission,
      listWebPermissions: async () => webPermissions,
    }
  }
  return deps
}

/**
 * A dump that reflects the managed block, the way the real ACP profile composes
 * its patch layer on top of the bundle layers: override rows are appended after
 * the base composition, and the reader keeps the last row per id.
 */
export function composingDump(
  fs: FsPort,
  paths: { patchPath: string },
  base: string = SAMPLE_DUMP,
): DumpOutcome {
  const text = fs.existsFile(paths.patchPath) ? fs.readFile(paths.patchPath) : ''
  const entries = parseManagedBlock(text)
  if (entries.length === 0) return liveDump(base)
  const overrides: string[] = []
  for (const entry of entries) {
    overrides.push(`- id: ${entry.id}`)
    if (entry.disabled !== undefined) overrides.push(`  disabled: ${entry.disabled}`)
    const config = entry.config ?? {}
    const keys = Object.keys(config)
    if (keys.length > 0) {
      overrides.push('  config:')
      for (const key of keys) overrides.push(`    ${key}: ${config[key]}`)
    }
  }
  const joined = base.endsWith('\n') ? base : `${base}\n`
  return liveDump(`${joined}${overrides.join('\n')}\n`)
}

export type { Deps }
