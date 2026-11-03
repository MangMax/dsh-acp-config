import { describe, expect, it } from 'vitest'
import { createEngine, defaultDeps } from '../src/host/engine.js'
import { createFetchHandler, createWebPort, dispatch, inject, name } from '../src/host/index.js'
import { fakeDeps, memoryFs, withProfile } from './fakes.js'

const HOME = '/home/test/.dsh'

function handler() {
  const fs = memoryFs()
  withProfile(fs, HOME, 'acp')
  const deps = fakeDeps({
    fs,
    homeDir: HOME,
    web: [{ moduleName: '@deepseek-ai/dsh-tool-web', enabled: true, patchId: 'tool-web' }],
  })
  return createFetchHandler(createEngine(deps))
}

function envelope(method: string, args?: unknown): Request {
  return new Request('http://127.0.0.1/api/dsh-acp-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', payload: { method, args } }),
  })
}

describe('route envelope', () => {
  it('declares the plugin name and connection injection', () => {
    expect(name).toBe('dsh-acp-config')
    expect(inject).toEqual(['connection'])
  })

  it('wraps a successful status in the connection result envelope', async () => {
    const response = await handler()(envelope('status'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ type: 'server-response', rpcId: 'rpc-1', result: { ok: true } })
    expect(body.result.value.ok).toBe(true)
    expect(Array.isArray(body.result.value.rows)).toBe(true)
  })

  it('returns a business failure inside result with HTTP 200', async () => {
    const response = await handler()(envelope('save', { plugins: { 'tool-web': 'nope' } }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result.ok).toBe(false)
    expect(body.result.error).toMatchObject({ code: 'E_USAGE' })
    expect(typeof body.result.error.details).toBe('object')
  })

  it('answers an unknown method with a usage failure', async () => {
    const body = await (await handler()(envelope('nope'))).json()
    expect(body.result.ok).toBe(false)
    expect(body.result.error.code).toBe('E_USAGE')
  })

  it('rejects a malformed envelope with HTTP 400', async () => {
    const cases = [
      new Request('http://127.0.0.1/api/dsh-acp-config', { method: 'POST', body: '{' }),
      new Request('http://127.0.0.1/api/dsh-acp-config', {
        method: 'POST',
        body: JSON.stringify({ type: 'server-response', rpcId: 'x' }),
      }),
      new Request('http://127.0.0.1/api/dsh-acp-config', {
        method: 'POST',
        body: JSON.stringify({ type: 'client-request', payload: { method: 'status' } }),
      }),
    ]
    for (const request of cases) {
      const response = await handler()(request)
      expect(response.status).toBe(400)
      expect((await response.json()).code).toBe('bad-request')
    }
  })

  it('runs save through the same handler', async () => {
    const body = await (
      await handler()(envelope('save', { sandboxMode: { mode: 'sandbox', sandbox: 'read-only' } }))
    ).json()
    expect(body.result.ok).toBe(true)
    expect(body.result.value.savedAt).toBe('2026-11-03T08:00:00.000Z')
  })

  it('maps a thrown engine error onto a result failure', async () => {
    const fs = memoryFs()
    const deps = fakeDeps({ fs, homeDir: HOME, profileName: '../escape' })
    const engine = createEngine(deps)
    const result = (await dispatch(engine, 'status', undefined)) as {
      ok: false
      error: { code: string }
    }
    // `status` throws for an invalid profile; dispatch surfaces it as a failure.
    expect(result.ok).toBe(false)
    expect(result.error.code).toBe('E_PROFILE')
  })
})

describe('createWebPort', () => {
  it('resolves services lazily so late activation is picked up', async () => {
    const services = new Map<string, unknown>()
    const ctx = { get: (service: string) => services.get(service) }
    const port = createWebPort(ctx)
    // Nothing activated yet: empty/null values, not a permanent degradation.
    expect(await port.listPlugins()).toEqual([])
    expect(await port.listPresets?.()).toEqual([])
    expect(await port.readAgentPreset()).toBeNull()
    expect(await port.readWebPermission()).toBeNull()
    expect(await port.listWebPermissions?.()).toEqual([])

    services.set('pluginManager', {
      listPlugins: async () => [{ moduleName: 'pkg', enabled: true, patchId: 'row' }],
    })
    services.set('agentPresets', {
      list: async () => [{ id: 'standard', name: 'Standard' }],
      resolve: async () => ({ id: 'ptc', order: 2 }),
    })
    services.set('permissionPresets', {
      catalog: async () => ({
        options: [
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'danger-full-access', name: 'Full access' },
          { value: 'auto', name: 'Auto' },
        ],
        defaultOptions: [
          { value: 'workspace-write', name: 'Workspace write' },
          { value: 'danger-full-access', name: 'Full access' },
        ],
        defaultPreset: 'danger-full-access',
      }),
      resolve: async (preset: string) =>
        preset === 'auto'
          ? { sandbox: 'danger-full-access', approval: 'ask' }
          : preset === 'danger-full-access'
            ? { sandbox: 'danger-full-access', approval: 'never' }
            : { sandbox: 'workspace-write', approval: 'ask' },
    })
    expect(await port.listPlugins()).toEqual([{ moduleName: 'pkg', enabled: true, patchId: 'row' }])
    expect(await port.listPresets?.()).toEqual([{ id: 'standard', name: 'Standard' }])
    expect(await port.readAgentPreset()).toBe('ptc')
    expect(await port.readWebPermission()).toEqual({
      preset: 'danger-full-access',
      sandbox: 'danger-full-access',
      approval: 'never',
    })
    expect(await port.listWebPermissions?.()).toEqual([
      { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
      { preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
      { preset: 'auto', sandbox: 'danger-full-access', approval: 'ask' },
    ])
  })

  it('reads the selected permission preset, not the deployment default', async () => {
    // The regression this task fixes: `sandboxPolicy.defaultMode` is the
    // deployment default and said "workspace-write" while the user's Web UI
    // selection was full access. The port must report the preset.
    const port = createWebPort({
      get: (service: string) => {
        if (service === 'sandboxPolicy') return { defaultMode: 'workspace-write' }
        return {
          catalog: async () => ({ options: [], defaultOptions: [], defaultPreset: 'auto' }),
          resolve: async () => ({ sandbox: 'danger-full-access', approval: 'ask' }),
        }
      },
    })
    expect(await port.readWebPermission()).toEqual({
      preset: 'auto',
      sandbox: 'danger-full-access',
      approval: 'ask',
    })
  })

  it('survives a context without get() and a failing service', async () => {
    const port = createWebPort({})
    expect(await port.listPlugins()).toEqual([])
    expect(await port.listPresets?.()).toEqual([])
    expect(await port.readAgentPreset()).toBeNull()
    expect(await port.readWebPermission()).toBeNull()
    expect(await port.listWebPermissions?.()).toEqual([])

    const broken = createWebPort({
      get: (service: string) =>
        service === 'agentPresets'
          ? { resolve: async () => ({}) }
          : service === 'permissionPresets'
            ? { catalog: async () => ({ defaultPreset: 'nope' }), resolve: async () => ({}) }
            : { defaultMode: 'not-a-mode' },
    })
    expect(await broken.readAgentPreset()).toBeNull()
    expect(await broken.readWebPermission()).toBeNull()
    expect(await broken.listWebPermissions?.()).toEqual([])
  })

  it('returns null when permissionPresets is incomplete or throws', async () => {
    const noCatalog = createWebPort({
      get: (service: string) =>
        service === 'permissionPresets' ? { resolve: async () => ({}) } : undefined,
    })
    expect(await noCatalog.readWebPermission()).toBeNull()
    expect(await noCatalog.listWebPermissions?.()).toEqual([])

    const throwing = createWebPort({
      get: (service: string) =>
        service === 'permissionPresets'
          ? {
              catalog: async () => {
                throw new Error('boom')
              },
              resolve: async () => {
                throw new Error('boom')
              },
            }
          : undefined,
    })
    expect(await throwing.readWebPermission()).toBeNull()
    expect(await throwing.listWebPermissions?.()).toEqual([])

    const nullDefault = createWebPort({
      get: (service: string) =>
        service === 'permissionPresets'
          ? {
              catalog: async () => ({ options: [], defaultOptions: [], defaultPreset: null }),
              resolve: async () => ({ sandbox: 'workspace-write', approval: 'ask' }),
            }
          : undefined,
    })
    expect(await nullDefault.readWebPermission()).toBeNull()

    const invalidSpec = createWebPort({
      get: (service: string) =>
        service === 'permissionPresets'
          ? {
              catalog: async () => ({ defaultPreset: 'weird' }),
              resolve: async () => ({ sandbox: 'read-write', approval: 'maybe' }),
            }
          : undefined,
    })
    expect(await invalidSpec.readWebPermission()).toBeNull()
    expect(await invalidSpec.listWebPermissions?.()).toEqual([])
  })
})

describe('defaultDeps', () => {
  it('builds real dependencies outside Electron', () => {
    const deps = defaultDeps()
    expect(deps.profileName).toBe('acp')
    expect(deps.homeDir).toMatch(/\.dsh$/)
    expect(typeof deps.runDump).toBe('function')
    expect(deps.now()).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(deps.web).toBeUndefined()
  })

  it('accepts overrides used by smoke scripts', () => {
    const deps = defaultDeps({ homeDir: '/tmp/home', profileName: 'acp' })
    expect(deps.homeDir).toBe('/tmp/home')
  })
})

describe('createWebPort: live inventory shape', () => {
  it('flattens meta.title/description and passes fiberPhase through', async () => {
    const port = createWebPort({
      get: (service: string) =>
        service === 'pluginManager'
          ? {
              listPlugins: async () => [
                {
                  entryId: 'persona',
                  moduleName: '@deepseek-ai/dsh-persona',
                  enabled: true,
                  fiberPhase: 'active',
                  patchId: 'persona',
                  meta: {
                    title: { en: 'persona', zh: '智能体角色设定' },
                    description: { en: 'Persona', zh: '角色说明' },
                  },
                },
                // A flat top-level title (older host shape) is still honored.
                { moduleName: 'legacy-plugin', enabled: false, title: 'Legacy' },
                // Entries without a module name are ignored rather than crashing the page.
                { enabled: true },
              ],
            }
          : undefined,
    })
    expect(await port.listPlugins()).toEqual([
      {
        moduleName: '@deepseek-ai/dsh-persona',
        enabled: true,
        patchId: 'persona',
        title: { en: 'persona', zh: '智能体角色设定' },
        description: { en: 'Persona', zh: '角色说明' },
        fiberPhase: 'active',
      },
      { moduleName: 'legacy-plugin', enabled: false, title: 'Legacy' },
    ])
  })

  it('normalizes compositionInventory() rows', async () => {
    const port = createWebPort({
      get: (service: string) =>
        service === 'agentPresets'
          ? {
              compositionInventory: async () => [
                {
                  id: 'ptc',
                  name: 'PTC',
                  isDefault: true,
                  rows: [
                    { entryId: 'persona', moduleName: '@deepseek-ai/dsh-persona', enabled: true },
                    {
                      entryId: null,
                      moduleName: '@deepseek-ai/dsh-tool-fs',
                      enabled: 'conditional',
                    },
                    'not-a-row',
                  ],
                },
                { id: '', rows: [] },
              ],
            }
          : undefined,
    })
    expect(await port.compositionInventory?.()).toEqual([
      {
        id: 'ptc',
        name: 'PTC',
        isDefault: true,
        rows: [
          { entryId: 'persona', moduleName: '@deepseek-ai/dsh-persona', enabled: true },
          { moduleName: '@deepseek-ai/dsh-tool-fs', enabled: 'conditional' },
        ],
      },
    ])
  })

  it('degrades to empty lists when the inventory services are broken', async () => {
    const throwing = createWebPort({
      get: (service: string) =>
        service === 'pluginManager'
          ? {
              listPlugins: async () => {
                throw new Error('boom')
              },
            }
          : {
              compositionInventory: async () => {
                throw new Error('boom')
              },
            },
    })
    // A throwing listPlugins is the engine's problem (it catches per call), but
    // the port itself must not invent rows; inventory failures degrade to [].
    await expect(throwing.listPlugins()).rejects.toThrow('boom')
    expect(await throwing.compositionInventory?.()).toEqual([])
    expect(await createWebPort({}).compositionInventory?.()).toEqual([])
  })
})

describe('defaultDeps: package-locale fallback wiring', () => {
  it('is absent in a plain Node run (no `<…>/dsh` argv)', () => {
    expect(defaultDeps().readPackageMeta).toBeUndefined()
  })

  it('honors an injected reader', async () => {
    const readPackageMeta = async () => ({ title: { en: 'x', zh: 'X' } })
    expect(defaultDeps({ readPackageMeta }).readPackageMeta).toBe(readPackageMeta)
  })
})
