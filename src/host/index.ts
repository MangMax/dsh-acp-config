// Cordis entry: one exact Fetch route (`POST /api/dsh-acp-config`) that the
// settings page calls through `connection.rpc.call('/api', 'dsh-acp-config', …)`.
//
// Wire shape (verified against dsh-themes and dsh-client-connection's
// `parseConnectionResponse`): HTTP 200 with
//   { type: 'server-response', rpcId, result: { ok: true, value: <payload> } }
// or `result: { ok: false, error: { code, message, details: {} } }` for a
// business failure. Only a malformed envelope gets HTTP 400.
import { AcpConfigError, ERROR_CODES, failure, failureOf } from './errors.js'
import { createEngine, defaultDeps } from './engine.js'
import type { AcpEngine } from './engine.js'
import type {
  EngineDeps,
  PresetCompositionInventory,
  WebPluginInfo,
  WebStatePort,
} from './ports.js'
import { ROUTE_PATH, SANDBOX_MODES, type ClientRequestEnvelope } from '../shared/contract.js'
import type { SandboxApproval, SandboxMode, WebPermission } from '../shared/contract.js'

export const name = 'dsh-acp-config'
export const inject = ['connection']

/** Re-export the context-free engine so `dist/index.mjs` is smoke-testable. */
export { createEngine, defaultDeps } from './engine.js'
export { createReadPackageMeta, isPackageModuleName, packageRootOf } from './ports.js'
export type { AcpEngine, EngineOptions } from './engine.js'
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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

const rpcError = (code: string, message: string) => ({ code, message, details: {} })

function rpcResponse(rpcId: string, result: unknown): Response {
  return jsonResponse(200, { type: 'server-response', rpcId, result })
}

const APPROVALS: readonly string[] = ['ask', 'never']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Lazily resolve `permissionPresets`, the service that owns the Web UI's
 * permission presets (and therefore the user's actual selection).
 *
 * `sandboxPolicy` is deliberately not consulted: its `defaultMode` is the
 * deployment default (`DSH_PERMISSION_MODE ?? 'workspace-write'`), so reading it
 * reported "workspace-write" while the user had selected full access.
 */
function permissionService(ctx: any): any {
  if (typeof ctx?.get !== 'function') return undefined
  let service: any
  try {
    service = ctx.get('permissionPresets')
  } catch {
    // A throwing `get` (mid-teardown context) is "unavailable", not an error.
    return undefined
  }
  if (service === undefined || service === null) return undefined
  if (typeof service.catalog !== 'function' || typeof service.resolve !== 'function') {
    return undefined
  }
  return service
}

/** Normalize one `resolve()` result into a `WebPermission`; `null` when unusable. */
function normalizePermission(preset: string, resolved: unknown): WebPermission | null {
  if (!isRecord(resolved)) return null
  const sandbox = resolved.sandbox
  const approval = resolved.approval
  if (typeof sandbox !== 'string' || !(SANDBOX_MODES as readonly string[]).includes(sandbox)) {
    return null
  }
  if (typeof approval !== 'string' || !APPROVALS.includes(approval)) return null
  return { preset, sandbox: sandbox as SandboxMode, approval: approval as SandboxApproval }
}

/** Resolve one preset name; never throws, `null` on any missing/invalid value. */
async function resolvePermission(service: any, preset: unknown): Promise<WebPermission | null> {
  if (typeof preset !== 'string' || preset === '') return null
  let resolved: unknown
  try {
    resolved = await service.resolve(preset)
  } catch {
    return null
  }
  return normalizePermission(preset, resolved)
}

/** Read preset names out of `catalog().options` / `catalog().defaultOptions`. */
function presetNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names: string[] = []
  for (const item of raw) {
    const value = typeof item === 'string' ? item : isRecord(item) ? item.value : undefined
    if (typeof value === 'string' && value !== '' && !names.includes(value)) names.push(value)
  }
  return names
}

/**
 * Normalize a display value (`"text"` or `{ en, zh, … }`) into the wire's
 * `LocalizedText`-compatible record; `undefined` when it carries no text.
 */
function localizedField(value: unknown): string | Record<string, string> | undefined {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, text] of Object.entries(value)) {
    if (typeof text === 'string' && text !== '') out[key] = text
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * Normalize one `pluginManager.listPlugins()` entry.
 *
 * The live inventory nests display text under `meta` (`PluginLocalizedMeta`:
 * `{ title?: LocalizedText, description?: LocalizedText }`) and reports the
 * root-fiber phase alongside. Flattening both here keeps the engine free of
 * that shape and gives every row its `webFiber` for the details table.
 */
function toWebPluginInfo(raw: unknown): WebPluginInfo | null {
  if (!isRecord(raw)) return null
  const moduleName = typeof raw.moduleName === 'string' ? raw.moduleName : ''
  if (moduleName === '') return null
  const meta = isRecord(raw.meta) ? raw.meta : undefined
  const title = localizedField(meta?.title) ?? localizedField(raw.title)
  const description = localizedField(meta?.description) ?? localizedField(raw.description)
  const patchId = typeof raw.patchId === 'string' && raw.patchId !== '' ? raw.patchId : undefined
  const fiberPhase =
    typeof raw.fiberPhase === 'string' && raw.fiberPhase !== '' ? raw.fiberPhase : undefined
  return {
    moduleName,
    enabled: raw.enabled === true,
    ...(patchId === undefined ? {} : { patchId }),
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(fiberPhase === undefined ? {} : { fiberPhase }),
  }
}

/** Normalize one `agentPresets.compositionInventory()` entry. */
function toPresetInventory(raw: unknown): PresetCompositionInventory | null {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (id === '') return null
  const rows: NonNullable<PresetCompositionInventory['rows']>[number][] = []
  if (Array.isArray(raw.rows)) {
    for (const item of raw.rows) {
      if (!isRecord(item)) continue
      rows.push({
        ...(typeof item.entryId === 'string' && item.entryId !== ''
          ? { entryId: item.entryId }
          : {}),
        ...(typeof item.moduleName === 'string' ? { moduleName: item.moduleName } : {}),
        ...(typeof item.enabled === 'boolean' || item.enabled === 'conditional'
          ? { enabled: item.enabled }
          : {}),
        ...(typeof item.condition === 'string' ? { condition: item.condition } : {}),
        ...(typeof item.fiberState === 'number' ? { fiberState: item.fiberState } : {}),
      })
    }
  }
  return {
    id,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(raw.isDefault === true ? { isDefault: true } : {}),
    ...(typeof raw.broken === 'string' ? { broken: raw.broken } : {}),
    rows,
  }
}

/**
 * Live plugin state of the profile that serves this page.
 *
 * Services are resolved lazily on every call: plugin activation order does not
 * guarantee `pluginManager`/`agentPresets`/`permissionPresets` exist when this
 * row activates, so a one-shot `ctx.get(...)` at apply time would degrade the
 * page permanently.
 */
export function createWebPort(ctx: any): WebStatePort {
  return {
    async listPlugins() {
      const manager = typeof ctx?.get === 'function' ? ctx.get('pluginManager') : undefined
      if (manager === undefined || manager === null || typeof manager.listPlugins !== 'function')
        return []
      const plugins = await manager.listPlugins()
      if (!Array.isArray(plugins)) return []
      const infos: WebPluginInfo[] = []
      for (const plugin of plugins) {
        const info = toWebPluginInfo(plugin)
        if (info !== null) infos.push(info)
      }
      return infos
    },
    async compositionInventory() {
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : undefined
      if (presets === undefined || presets === null) return []
      if (typeof presets.compositionInventory !== 'function') return []
      let inventory: unknown
      try {
        inventory = await presets.compositionInventory()
      } catch {
        return []
      }
      if (!Array.isArray(inventory)) return []
      const entries: PresetCompositionInventory[] = []
      for (const preset of inventory) {
        const normalized = toPresetInventory(preset)
        if (normalized !== null) entries.push(normalized)
      }
      return entries
    },
    async listPresets() {
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : undefined
      if (presets === undefined || presets === null || typeof presets.list !== 'function') return []
      const list = await presets.list()
      return Array.isArray(list) ? list : []
    },
    async readAgentPreset() {
      // `agentPresets.resolve()` is the current default preset object (`{ id, order }`).
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : undefined
      if (presets === undefined || presets === null || typeof presets.resolve !== 'function') {
        return null
      }
      const resolved = await presets.resolve()
      const id = (resolved as { id?: unknown } | null | undefined)?.id
      return typeof id === 'string' && id !== '' ? id : null
    },
    async readWebPermission() {
      const service = permissionService(ctx)
      if (service === undefined) return null
      let catalog: unknown
      try {
        catalog = await service.catalog()
      } catch {
        return null
      }
      if (!isRecord(catalog)) return null
      return await resolvePermission(service, catalog.defaultPreset)
    },
    async listWebPermissions() {
      const service = permissionService(ctx)
      if (service === undefined) return []
      let catalog: unknown
      try {
        catalog = await service.catalog()
      } catch {
        return []
      }
      if (!isRecord(catalog)) return []
      const names = presetNames(catalog.options)
      for (const name of presetNames(catalog.defaultOptions)) {
        if (!names.includes(name)) names.push(name)
      }
      const defaultPreset = catalog.defaultPreset
      if (
        typeof defaultPreset === 'string' &&
        defaultPreset !== '' &&
        !names.includes(defaultPreset)
      ) {
        names.push(defaultPreset)
      }
      const permissions: WebPermission[] = []
      for (const preset of names) {
        const permission = await resolvePermission(service, preset)
        if (permission !== null) permissions.push(permission)
      }
      return permissions
    },
  }
}

/** Dispatch one decoded RPC payload onto the engine. */
export async function dispatch(engine: AcpEngine, method: string, args: unknown): Promise<unknown> {
  try {
    switch (method) {
      case 'status':
        return await engine.status()
      case 'save':
        return await engine.save((args ?? {}) as never)
      case 'validate':
        return await engine.validate()
      default:
        return failure(ERROR_CODES.usage, `unknown method: ${JSON.stringify(method)}`)
    }
  } catch (error) {
    // `status`/`validate` throw only for unrecoverable setup problems (an
    // invalid profile name, a missing directory); they must still answer 200.
    return failureOf(error)
  }
}

/** Build the Fetch handler; exported so tests can drive it without Cordis. */
export function createFetchHandler(engine: AcpEngine): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    let message: unknown = null
    try {
      message = await request.json()
    } catch {
      return jsonResponse(400, rpcError('bad-request', 'invalid JSON body'))
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message)) {
      return jsonResponse(400, rpcError('bad-request', 'RPC envelope must be an object'))
    }
    const envelope = message as Partial<ClientRequestEnvelope>
    if (envelope.type !== 'client-request') {
      return jsonResponse(400, rpcError('bad-request', 'expected a client-request envelope'))
    }
    const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : null
    if (rpcId === null)
      return jsonResponse(400, rpcError('bad-request', 'RPC envelope is missing rpcId'))
    const payload = envelope.payload
    const method =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { method?: unknown }).method === 'string'
        ? (payload as { method: string }).method
        : ''
    const args =
      typeof payload === 'object' && payload !== null
        ? (payload as { args?: unknown }).args
        : undefined
    try {
      const result = await dispatch(engine, method, args)
      if (
        result !== null &&
        typeof result === 'object' &&
        (result as { ok?: unknown }).ok === false
      ) {
        const error = (result as { error?: { code?: string; message?: string } }).error
        return rpcResponse(rpcId, {
          ok: false,
          error: rpcError(error?.code ?? ERROR_CODES.internal, error?.message ?? 'save failed'),
        })
      }
      return rpcResponse(rpcId, { ok: true, value: result })
    } catch (error) {
      const mapped = failureOf(error)
      return rpcResponse(rpcId, {
        ok: false,
        error: rpcError(mapped.error.code, mapped.error.message),
      })
    }
  }
}

export function apply(ctx: any) {
  let deps: EngineDeps
  try {
    deps = defaultDeps()
  } catch (error) {
    throw new AcpConfigError(ERROR_CODES.internal, `failed to build dependencies: ${String(error)}`)
  }
  deps.web = createWebPort(ctx)
  const engine = createEngine(deps)

  ctx.effect(() => {
    if (typeof ctx.connection?.fetch?.register !== 'function') {
      throw new AcpConfigError(
        ERROR_CODES.internal,
        'dsh-acp-config needs connection.fetch (DSH >= 0.1.5-rc.1 HostConnectionFetch)',
      )
    }
    const dispose = ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createFetchHandler(engine),
    })
    return () => {
      void dispose()
    }
  }, 'dsh-acp-config: POST /api/dsh-acp-config')
}
