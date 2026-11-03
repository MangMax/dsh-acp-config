// Context-free engine: the same three operations the HTTP route exposes, usable
// from a plain Node script (Lead's smoke test imports `dist/index.mjs`).
import type {
  Failure,
  SavePayload,
  SaveRequest,
  StatusPayload,
  ValidatePayload,
  Verification,
  WebPermission,
} from '../shared/contract.js'
import { ERROR_CODES, failureOf } from './errors.js'
import { parseComposition, readComposition } from './dump.js'
import { parseManagedBlock } from './patch-block.js'
import { resolveProfilePaths } from './paths.js'
import type { ProfilePaths } from './paths.js'
import type { EngineDeps, WebPluginInfo } from './ports.js'
import { readState } from './state.js'
import { buildStatus } from './status.js'
import { saveWithDeps } from './save.js'
import { DEFAULT_DUMP_TIMEOUT_MS } from './ports.js'

export {
  defaultDeps,
  nodeFs,
  createRunDump,
  createReadPackageMeta,
  isPackageModuleName,
  packageRootOf,
  resolveHomeDir,
  detectDshRoot,
  DEFAULT_DUMP_TIMEOUT_MS,
} from './ports.js'
export type {
  DumpOutcome,
  EngineDeps,
  FsPort,
  PackageMeta,
  PresetCompositionInventory,
  PresetCompositionRow,
  WebPluginInfo,
  WebStatePort,
} from './ports.js'
export { parseComposition, readComposition } from './dump.js'
export type { Composition, CompositionRow, PresetCandidate, PresetDeclaredRow } from './dump.js'
export { parseManagedBlock, serializeManagedBlock } from './patch-block.js'
export { resolveProfilePaths } from './paths.js'
export { readState } from './state.js'

export interface EngineOptions {
  /** `dsh --dump-config` timeout; defaults to 30 s. */
  dumpTimeoutMs?: number
}

/** The three operations behind `POST /api/dsh-acp-config`. */
export interface AcpEngine {
  status(): Promise<StatusPayload>
  save(request: SaveRequest): Promise<SavePayload | Failure>
  validate(): Promise<ValidatePayload | Failure>
  /** Resolved paths, for diagnostics and smoke scripts. */
  paths(): ProfilePaths
}

async function loadWebPlugins(deps: EngineDeps): Promise<WebPluginInfo[]> {
  if (deps.web === undefined) return []
  try {
    return await deps.web.listPlugins()
  } catch {
    // A missing live list only degrades `inherit` rows; the page still opens.
    return []
  }
}

/** Read the live agent preset; `null` means "cannot be read here". */
async function loadWebAgentPreset(deps: EngineDeps): Promise<string | null> {
  if (deps.web === undefined) return null
  try {
    return await deps.web.readAgentPreset()
  } catch {
    return null
  }
}

/** Read the selected permission preset; `null` means "cannot be read here". */
async function loadWebPermission(deps: EngineDeps): Promise<WebPermission | null> {
  if (deps.web === undefined) return null
  try {
    return await deps.web.readWebPermission()
  } catch {
    return null
  }
}

/** Read the selectable permission presets; `[]` when the port cannot answer. */
async function loadWebPermissions(deps: EngineDeps): Promise<WebPermission[]> {
  if (deps.web === undefined || deps.web.listWebPermissions === undefined) return []
  try {
    const list = await deps.web.listWebPermissions()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * Build an engine from injectable dependencies.
 *
 * Nothing here touches a Cordis context: the Host route supplies the live
 * plugin list, tests and smoke scripts supply fakes or nothing at all.
 */
export function createEngine(deps: EngineDeps, options: EngineOptions = {}): AcpEngine {
  const timeoutMs = options.dumpTimeoutMs ?? DEFAULT_DUMP_TIMEOUT_MS

  return {
    paths: () => resolveProfilePaths(deps.homeDir, deps.profileName),

    async status(): Promise<StatusPayload> {
      const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
      const [
        { outcome, composition },
        webPlugins,
        webAgentPreset,
        webPermission,
        webPermissions,
        stateResult,
      ] = await Promise.all([
        readComposition(deps, timeoutMs),
        loadWebPlugins(deps),
        loadWebAgentPreset(deps),
        loadWebPermission(deps),
        loadWebPermissions(deps),
        Promise.resolve(readState(deps.fs, paths)),
      ])
      return await buildStatus({
        deps: {
          fs: deps.fs,
          web: deps.web,
          ...(deps.readPackageMeta === undefined ? {} : { readPackageMeta: deps.readPackageMeta }),
        },
        paths,
        profileName: deps.profileName,
        composition,
        outcome,
        webPlugins,
        webAgentPreset,
        webPermission,
        webPermissions,
        state: stateResult.state,
        stateWarnings: stateResult.warnings,
      })
    },

    save: (request: SaveRequest) => saveWithDeps(deps, request, timeoutMs),

    async validate(): Promise<ValidatePayload | Failure> {
      try {
        const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
        const { outcome, composition } = await readComposition(deps, timeoutMs)
        const stateResult = readState(deps.fs, paths)
        const warnings: string[] = [...stateResult.warnings]
        const verification: Verification = { source: 'unavailable', warnings: [] }
        let agentMode: string | null = stateResult.state.agentMode
        let sandbox = stateResult.state.sandboxMode

        if (composition !== null && outcome.ok) {
          const managedIds = deps.fs.existsFile(paths.patchPath)
            ? parseManagedBlock(deps.fs.readFile(paths.patchPath)).map((entry) => entry.id)
            : []
          const rows: Record<string, 'on' | 'off' | 'dynamic'> = {}
          for (const id of managedIds) {
            const row = composition.rowById.get(id)
            if (row === undefined) {
              warnings.push(`managed row ${id} is absent from the ACP composition`)
              continue
            }
            rows[id] =
              row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
          }
          const registry = composition.rowById.get('agent-preset-registry')
          const policy = composition.rowById.get('sandbox-policy')
          const composedAgent = registry?.config.default ?? null
          const composedSandbox = policy?.config.mode ?? null
          if (composedSandbox !== null && composedSandbox.startsWith('!!js')) {
            warnings.push(
              'sandbox-policy.mode is a !!js expression; effective mode is decided at ACP startup',
            )
          } else if (composedSandbox !== null) {
            sandbox = composedSandbox as typeof sandbox
          }
          if (composedAgent !== null) agentMode = composedAgent
          verification.source = 'live'
          verification.rows = rows
          verification.agentMode = composedAgent
          verification.sandbox = sandbox
          const selected = registry?.config.selectedDefault
          if (selected !== undefined && selected !== 'null' && selected !== '') {
            warnings.push(
              `ACP composes a non-empty agent-preset-registry.selectedDefault (${selected}); saving here overwrites it with null`,
            )
          }
        } else {
          warnings.push(
            `ACP composition unavailable (${outcome.ok ? 'parse failed' : outcome.message}); validation is degraded`,
          )
        }
        verification.warnings = warnings.filter((entry) => entry !== '').slice(-4)
        return { ok: true, verification, agentMode, sandbox, warnings }
      } catch (error) {
        const failure = failureOf(error)
        return failure
      }
    },
  }
}

/** Re-exported so a smoke script can assert the stable code set without importing internals. */
export { ERROR_CODES }
export { parseComposition as parseCompositionForSmoke }
