import { describe, expect, it } from 'vitest'
import { createEngine } from '../src/host/engine.js'
import { INFRA_IDS } from '../src/host/status.js'
import { serializeManagedBlock } from '../src/host/patch-block.js'
import { resolveProfilePaths } from '../src/host/paths.js'
import {
  composingDump,
  fakeDeps,
  failedDump,
  liveDump,
  memoryFs,
  SAMPLE_DUMP,
  withProfile,
} from './fakes.js'

const HOME = '/home/test/.dsh'

function engineWith(options: Parameters<typeof fakeDeps>[0] = {}) {
  const fs = options.fs ?? memoryFs()
  withProfile(fs as ReturnType<typeof memoryFs>, HOME, 'acp')
  const deps = fakeDeps({ ...options, fs, homeDir: HOME })
  return { engine: createEngine(deps), deps, fs }
}

const WEB = [
  { moduleName: '@deepseek-ai/dsh-tool-web', enabled: true, patchId: 'tool-web' },
  { moduleName: '@deepseek-ai/dsh-tool-bash', enabled: false, patchId: 'tool-bash' },
  { moduleName: '@deepseek-ai/dsh-hmr', enabled: true, patchId: 'hmr' },
  { moduleName: 'dsh-themes', enabled: true, patchId: 'themes' },
]

describe('status', () => {
  it('merges ACP rows with live Web rows', async () => {
    const { engine } = engineWith({ web: WEB })
    const status = await engine.status()
    const rows = new Map(status.rows.map((row) => [row.id, row]))
    expect(rows.get('tool-web')).toMatchObject({
      web: 'on',
      acp: 'on',
      mode: 'inherit',
      drift: false,
    })
    expect(rows.get('hmr')).toMatchObject({ web: 'on', acp: 'off', locked: 'infra' })
    expect(rows.get('tool-bash')).toMatchObject({
      web: 'off',
      acp: 'off',
      locked: 'preset-managed',
    })
    expect(rows.get('themes')).toMatchObject({ web: 'on', acp: 'absent', locked: 'not-in-acp' })
  })

  it('reports preset candidates, ordered, enriched with live titles', async () => {
    const { engine } = engineWith({
      web: WEB,
      presets: [{ id: 'standard', name: 'Standard', description: 'default preset' }],
    })
    const status = await engine.status()
    expect(status.presets.map((preset) => preset.id)).toEqual(['standard', 'cordis', 'minimal'])
    expect(status.presets[0]?.title).toEqual({ en: 'Standard' })
    expect(status.agentMode).toMatchObject({ value: 'standard', available: true })
  })

  it('resolves the sandbox fallback literal and warns that it is dynamic', async () => {
    const { engine } = engineWith({ web: WEB })
    const status = await engine.status()
    expect(status.sandbox).toMatchObject({ mode: 'workspace-write', available: true })
    expect(status.warnings.join(' ')).toMatch(/fallback literal/)
    expect(status.warnings.join(' ')).toMatch(/approval\.policy is a !!js expression/)
  })

  it('describes the ACP profile, its patch path and declared bundles', async () => {
    const { engine, fs } = engineWith({ web: WEB })
    fs.writeFile(
      `${HOME}/profiles/acp/package.json`,
      JSON.stringify({
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-acp-agentmode'] } },
      }),
    )
    const status = await engine.status()
    expect(status.acp).toMatchObject({
      name: 'acp',
      dir: `${HOME}/profiles/acp`,
      exists: true,
      patchPath: `${HOME}/profiles/acp/cordis.patch.yml`,
      bundles: ['@deepseek-ai/dsh-base', 'dsh-acp-agentmode'],
    })
  })

  it('degrades instead of throwing when the dump fails', async () => {
    const { engine } = engineWith({ web: WEB, dump: failedDump() })
    const status = await engine.status()
    expect(status.ok).toBe(true)
    expect(status.rows.every((row) => row.locked !== undefined)).toBe(true)
    expect(status.agentMode.available).toBe(false)
    expect(status.sandbox.available).toBe(false)
    expect(status.warnings.join(' ')).toMatch(/ACP composition unavailable/)
  })

  it('still opens when the state file is corrupt', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(paths.statePath, '{broken')
    const { engine } = engineWith({ fs, web: WEB })
    const status = await engine.status()
    expect(status.ok).toBe(true)
    expect(status.warnings.join(' ')).toMatch(/not valid JSON/)
  })

  it('reports drift when the Web side changed after an inherit save', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(
      paths.statePath,
      JSON.stringify({ version: 1, plugins: { 'tool-web': { mode: 'inherit', web: false } } }),
    )
    const { engine } = engineWith({ fs, web: WEB })
    const status = await engine.status()
    expect(status.apply.drift).toEqual(['tool-web'])
    const row = status.rows.find((entry) => entry.id === 'tool-web')
    expect(row?.drift).toBe(true)
  })

  it('locks every infra row', async () => {
    const { engine } = engineWith({ web: WEB })
    const status = await engine.status()
    for (const id of INFRA_IDS) {
      const row = status.rows.find((entry) => entry.id === id)
      if (row !== undefined) expect(row.locked).toBe('infra')
    }
  })
})

describe('validate', () => {
  it('reports live composition values and managed rows', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(
      paths.patchPath,
      `# user\n${serializeManagedBlock([{ id: 'tool-web', disabled: 'true' }])}`,
    )
    const { engine } = engineWith({ fs, web: WEB, dump: () => composingDump(fs, paths) })
    const result = await engine.validate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.verification.source).toBe('live')
    expect(result.agentMode).toBe('standard')
    expect(result.verification.rows).toEqual({ 'tool-web': 'off' })
  })

  it('degrades to unavailable when the dump cannot be read', async () => {
    const { engine } = engineWith({ web: WEB, dump: failedDump() })
    const result = await engine.validate()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.verification.source).toBe('unavailable')
    expect(result.warnings.join(' ')).toMatch(/validation is degraded/)
  })
})

describe('dump plumbing', () => {
  it('passes the validated profile name to runDump', async () => {
    const calls: string[] = []
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME })
    deps.runDump = async ({ profile }) => {
      calls.push(profile)
      return liveDump()
    }
    await createEngine(deps).status()
    expect(calls).toEqual(['acp'])
  })

  it('rejects an unsafe profile name before running anything', () => {
    const fs = memoryFs()
    const deps = fakeDeps({ fs, homeDir: HOME, profileName: '../escape' })
    expect(() => createEngine(deps).paths()).toThrow(/invalid profile name/)
  })

  it('keeps the sample dump as the fixture the parser was written against', () => {
    expect(SAMPLE_DUMP).toContain('- id: agent-preset-registry')
  })
})

describe('status: three-state agent mode and sandbox', () => {
  const STATE_PATH = resolveProfilePaths(HOME, 'acp').statePath

  it('reports the saved choice, the live Web value and drift', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        agentModeChoice: { mode: 'inherit' },
        agentModeWeb: 'standard',
        sandboxChoice: { mode: 'sandbox', sandbox: 'read-only' },
      }),
    )
    const { engine } = engineWith({
      fs,
      web: WEB,
      webPreset: 'cordis',
      webPermission: 'workspace-write',
    })
    const status = await engine.status()
    expect(status.agentMode.choice).toEqual({ mode: 'inherit' })
    expect(status.agentMode.web).toBe('cordis')
    // The Web default changed from the snapshot taken at save time.
    expect(status.agentMode.drift).toBe(true)
    expect(status.sandbox.choice).toEqual({ mode: 'sandbox', sandbox: 'read-only' })
    expect(status.sandbox.web).toEqual({
      preset: 'workspace-write',
      sandbox: 'workspace-write',
      approval: 'ask',
    })
    // An explicit choice never drifts.
    expect(status.sandbox.drift).toBe(false)
    expect(status.apply.drift).toEqual([])
  })

  it('reports sandbox drift when the Web permission preset changed', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        sandboxChoice: { mode: 'inherit' },
        sandboxWeb: 'read-only',
      }),
    )
    const { engine } = engineWith({ fs, web: WEB, webPermission: 'danger-full-access' })
    const status = await engine.status()
    expect(status.sandbox.choice).toEqual({ mode: 'inherit' })
    expect(status.sandbox.web).toEqual({
      preset: 'danger-full-access',
      sandbox: 'danger-full-access',
      approval: 'never',
    })
    expect(status.sandbox.drift).toBe(true)
    expect(status.agentMode.drift).toBe(false)
  })

  it('does not report drift when only the approval differs from a legacy snapshot', async () => {
    // The snapshot is a preset name. `auto` resolves to danger-full-access + ask;
    // the legacy snapshot said `danger-full-access` (never), so the preset names
    // differ and the page must ask for a re-save.
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        sandboxChoice: { mode: 'inherit' },
        sandboxWeb: 'danger-full-access',
      }),
    )
    const { engine } = engineWith({ fs, web: WEB, webPermission: 'auto' })
    const status = await engine.status()
    expect(status.sandbox.web).toMatchObject({ preset: 'auto', sandbox: 'danger-full-access' })
    expect(status.sandbox.drift).toBe(true)
  })

  it('does not report drift for an inherit whose Web value is unreadable', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        agentModeChoice: { mode: 'inherit' },
        agentModeWeb: 'standard',
      }),
    )
    const { engine } = engineWith({ fs, web: WEB, webPreset: null, webPermission: null })
    const status = await engine.status()
    expect(status.agentMode.web).toBeNull()
    expect(status.agentMode.drift).toBe(false)
    expect(status.sandbox.web).toBeNull()
    expect(status.sandbox.drift).toBe(false)
    expect(status.sandbox.webPresets).toEqual([])
  })

  it('reads a legacy state file as acp-default and without drift', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        agentMode: 'standard',
        sandboxMode: 'workspace-write',
      }),
    )
    const { engine } = engineWith({
      fs,
      web: WEB,
      webPreset: 'standard',
      webPermission: 'workspace-write',
    })
    const status = await engine.status()
    expect(status.agentMode.choice).toEqual({ mode: 'acp-default' })
    expect(status.agentMode.drift).toBe(false)
    expect(status.sandbox.choice).toEqual({ mode: 'acp-default' })
    expect(status.sandbox.drift).toBe(false)
  })

  it('reads a legacy mode-shaped sandboxWeb as its own preset name', async () => {
    // Pre-fix files stored the sandbox mode in `sandboxWeb`; the preset names the
    // shipped table ships are identical, so the snapshot still matches.
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(
      STATE_PATH,
      JSON.stringify({
        version: 1,
        plugins: {},
        sandboxChoice: { mode: 'inherit' },
        sandboxWeb: 'workspace-write',
      }),
    )
    const { engine } = engineWith({ fs, web: WEB, webPermission: 'workspace-write' })
    const status = await engine.status()
    expect(status.sandbox.drift).toBe(false)
  })

  it('reports a freshly saved inherit choice with no drift', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPreset: 'cordis',
      webPermission: 'danger-full-access',
      dump: () => composingDump(fs, paths),
    })
    const engine = createEngine(deps)
    const saved = await engine.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    expect(saved.ok).toBe(true)
    const status = await engine.status()
    expect(status.agentMode.choice).toEqual({ mode: 'inherit' })
    expect(status.agentMode.web).toBe('cordis')
    expect(status.agentMode.value).toBe('cordis')
    expect(status.agentMode.drift).toBe(false)
    expect(status.sandbox.choice).toEqual({ mode: 'inherit' })
    expect(status.sandbox.web).toEqual({
      preset: 'danger-full-access',
      sandbox: 'danger-full-access',
      approval: 'never',
    })
    expect(status.sandbox.mode).toBe('danger-full-access')
    expect(status.sandbox.drift).toBe(false)
  })
})

describe('status: the Web permission comes from the preset, not the deployment default', () => {
  const STATE_PATH = resolveProfilePaths(HOME, 'acp').statePath

  it('reports the selected preset even when the deployment default disagrees', async () => {
    // THE regression: the user selected "full access" in the Web UI while the
    // deployment default (DSH_PERMISSION_MODE) stayed `workspace-write`. Reading
    // `sandboxPolicy.defaultMode` reported "workspace write" instead of full
    // access. The ACP composition below still composes `workspace-write`, so the
    // two values genuinely disagree.
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const { engine } = engineWith({
      fs,
      web: WEB,
      webPermission: {
        preset: 'danger-full-access',
        sandbox: 'danger-full-access',
        approval: 'never',
      },
    })
    const status = await engine.status()
    expect(status.sandbox.mode).toBe('workspace-write') // ACP composition
    expect(status.sandbox.web).toEqual({
      preset: 'danger-full-access',
      sandbox: 'danger-full-access',
      approval: 'never',
    })
    expect(status.sandbox.available).toBe(true)
  })

  it('lists the Web permission presets resolved from the catalog', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const { engine } = engineWith({
      fs,
      web: WEB,
      webPermission: 'auto',
      webPermissions: [
        { preset: 'workspace-write', sandbox: 'workspace-write', approval: 'ask' },
        { preset: 'danger-full-access', sandbox: 'danger-full-access', approval: 'never' },
        { preset: 'auto', sandbox: 'danger-full-access', approval: 'ask' },
      ],
    })
    const status = await engine.status()
    expect(status.sandbox.webPresets.map((entry) => entry.preset)).toEqual([
      'workspace-write',
      'danger-full-access',
      'auto',
    ])
    // `auto` shares a mode with the danger preset but keeps `ask`.
    expect(status.sandbox.webPresets[2]).toEqual({
      preset: 'auto',
      sandbox: 'danger-full-access',
      approval: 'ask',
    })
  })

  it('keeps the Web permission readable while the ACP composition is degraded', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    fs.writeFile(STATE_PATH, JSON.stringify({ version: 1, plugins: {} }))
    const { engine } = engineWith({
      fs,
      web: WEB,
      webPermission: 'danger-full-access',
      dump: failedDump(),
    })
    const status = await engine.status()
    expect(status.sandbox.available).toBe(false)
    expect(status.sandbox.web).toEqual({
      preset: 'danger-full-access',
      sandbox: 'danger-full-access',
      approval: 'never',
    })
  })
})

describe('status: official plugin-page metadata (group / preset / fiber / meta fallback)', () => {
  /** Live rows shaped like `pluginManager.listPlugins()`: meta nested, fiber live. */
  const WEB_META = [
    {
      moduleName: '@deepseek-ai/dsh-tool-web',
      enabled: true,
      patchId: 'tool-web',
      title: { en: 'Web tool', zh: '网页工具' },
      description: { en: 'Fetches pages', zh: '抓取网页' },
      fiberPhase: 'active',
    },
    {
      moduleName: '@deepseek-ai/dsh-tool-bash',
      enabled: false,
      patchId: 'tool-bash',
      fiberPhase: 'failed',
    },
    // A preset row the page's own profile does list, but without a patchId.
    { moduleName: '@deepseek-ai/dsh-persona', enabled: true, fiberPhase: 'active' },
    { moduleName: 'dsh-themes', enabled: true, patchId: 'themes' },
  ]

  const PACKAGE_META = {
    '@deepseek-ai/dsh-persona': {
      title: { en: 'persona', zh: '智能体角色设定' },
      description: { en: 'Persona', zh: '为当前智能体提供组合中定义的角色与行为说明。' },
    },
  }

  it('groups rows by whether an agent preset declares them', async () => {
    const { engine } = engineWith({ web: WEB })
    const rows = new Map((await engine.status()).rows.map((row) => [row.id, row]))
    expect(rows.get('tool-web')?.group).toBe('global')
    expect(rows.get('hmr')?.group).toBe('global')
    expect(rows.get('themes')?.group).toBe('global')
    // `tool-bash` is both a top-level row and declared by `standard`.
    expect(rows.get('tool-bash')?.group).toBe('session')
    // persona/time-context live only inside a preset: still a session row.
    expect(rows.get('persona')).toMatchObject({
      group: 'session',
      moduleName: '@deepseek-ai/dsh-persona',
      locked: 'preset-managed',
      web: 'absent',
    })
    expect(rows.get('plan-mode')?.group).toBe('session')
  })

  it('names the owning preset from the ACP dump, then prefers compositionInventory()', async () => {
    const { engine } = engineWith({ web: WEB })
    const fromDump = new Map((await engine.status()).rows.map((row) => [row.id, row]))
    expect(fromDump.get('persona')?.presetName).toEqual({ en: 'minimal', zh: 'minimal' })
    expect(fromDump.get('tool-bash')?.presetName).toEqual({ en: 'standard', zh: 'standard' })
    // Global rows carry no owner.
    expect(fromDump.get('tool-web')?.presetName).toBeUndefined()

    const inventory = [
      {
        id: 'ptc',
        isDefault: true,
        rows: [{ entryId: 'persona' }, { entryId: 'tool-bash' }, { entryId: 'tool-fs' }],
      },
      // A second declaring preset never wins: the first one owns the row.
      { id: 'standard', rows: [{ entryId: 'tool-bash' }] },
    ]
    const { engine: withInventory } = engineWith({ web: WEB, inventory })
    const owned = new Map((await withInventory.status()).rows.map((row) => [row.id, row]))
    expect(owned.get('persona')?.presetName).toEqual({ en: 'ptc', zh: 'ptc' })
    expect(owned.get('tool-bash')?.presetName).toEqual({ en: 'ptc', zh: 'ptc' })
    expect(owned.get('tool-fs')?.presetName).toEqual({ en: 'ptc', zh: 'ptc' })
    // A session row the live roster does not list keeps the dump's owner.
    expect(owned.get('plan-mode')?.presetName).toEqual({ en: 'cordis', zh: 'cordis' })
  })

  it('passes the live fiber phase through to webFiber', async () => {
    const { engine } = engineWith({ web: WEB_META })
    const rows = new Map((await engine.status()).rows.map((row) => [row.id, row]))
    expect(rows.get('tool-web')?.webFiber).toBe('active')
    expect(rows.get('tool-bash')?.webFiber).toBe('failed')
    // A synthesized session row picks up the live entry matched by module name.
    expect(rows.get('persona')).toMatchObject({ web: 'on', webFiber: 'active' })
    // No entry, no phase: the page renders its "—" cell.
    expect(rows.get('hmr')?.webFiber).toBeUndefined()
  })

  it('falls back to the package locale only where the live list has no meta', async () => {
    const { engine } = engineWith({ web: WEB_META, packageMeta: PACKAGE_META })
    const rows = new Map((await engine.status()).rows.map((row) => [row.id, row]))
    expect(rows.get('persona')?.title).toEqual({ en: 'persona', zh: '智能体角色设定' })
    expect(rows.get('persona')?.description?.zh).toBe(
      '为当前智能体提供组合中定义的角色与行为说明。',
    )
    // Live metadata wins over the package fallback.
    expect(rows.get('tool-web')?.title).toEqual({ en: 'Web tool', zh: '网页工具' })
  })

  it('still opens when no metadata is available anywhere', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, packageMeta: {} })
    deps.readPackageMeta = async () => {
      throw new Error('locale read failed')
    }
    const status = await createEngine(deps).status()
    expect(status.ok).toBe(true)
    const persona = status.rows.find((row) => row.id === 'persona')
    expect(persona?.title).toBeUndefined()
    expect(persona?.description).toBeUndefined()
    // The page falls back to the row id; nothing throws.
    expect(persona?.group).toBe('session')
  })

  it('reports each preset row count from the ACP dump', async () => {
    const { engine } = engineWith({
      web: WEB,
      presets: [{ id: 'standard', name: 'Standard' }],
    })
    const presets = new Map((await engine.status()).presets.map((preset) => [preset.id, preset]))
    expect(presets.get('standard')?.rowCount).toBe(2)
    expect(presets.get('cordis')?.rowCount).toBe(1)
    expect(presets.get('minimal')?.rowCount).toBe(1)
  })

  it('does not duplicate a preset row the live list also reports', async () => {
    const { engine } = engineWith({ web: WEB_META })
    const persona = (await engine.status()).rows.filter(
      (row) => row.moduleName === '@deepseek-ai/dsh-persona',
    )
    expect(persona).toHaveLength(1)
    expect(persona[0]?.id).toBe('persona')
  })

  it('degrades to global-only rows when the ACP dump is unavailable', async () => {
    const { engine } = engineWith({ web: WEB, dump: failedDump() })
    const status = await engine.status()
    expect(status.rows.every((row) => row.group === 'global')).toBe(true)
    expect(status.rows.some((row) => row.id === 'persona')).toBe(false)
    expect(status.rows.some((row) => row.presetName !== undefined)).toBe(false)
  })
})
