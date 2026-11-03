import { describe, expect, it } from 'vitest'
import type { SaveRequest } from '../src/shared/contract.js'
import { createEngine } from '../src/host/engine.js'
import { parseManagedBlock, serializeManagedBlock } from '../src/host/patch-block.js'
import { resolveProfilePaths } from '../src/host/paths.js'
import { readState } from '../src/host/state.js'
import { composingDump, fakeDeps, failedDump, memoryFs, withProfile } from './fakes.js'

const HOME = '/home/test/.dsh'
const WEB = [
  { moduleName: '@deepseek-ai/dsh-tool-web', enabled: true, patchId: 'tool-web' },
  { moduleName: '@deepseek-ai/dsh-tool-bash', enabled: false, patchId: 'tool-bash' },
  { moduleName: '@deepseek-ai/dsh-hmr', enabled: true, patchId: 'hmr' },
  { moduleName: 'dsh-themes', enabled: true, patchId: 'themes' },
]

/** Engine whose fake dump re-composes the patch layer after every save. */
function engine(
  fsOptions: {
    patch?: string
    web?: typeof WEB
    webPreset?: string | null
    webPermission?: 'read-only' | 'workspace-write' | 'danger-full-access' | 'auto' | null
  } = {},
) {
  const fs = memoryFs()
  withProfile(fs, HOME, 'acp')
  const paths = resolveProfilePaths(HOME, 'acp')
  if (fsOptions.patch !== undefined) fs.writeFile(paths.patchPath, fsOptions.patch)
  const deps = fakeDeps({
    fs,
    homeDir: HOME,
    web: fsOptions.web ?? WEB,
    ...(fsOptions.webPreset === undefined ? {} : { webPreset: fsOptions.webPreset }),
    ...(fsOptions.webPermission === undefined ? {} : { webPermission: fsOptions.webPermission }),
    dump: () => composingDump(fs, paths),
  })
  return { engine: createEngine(deps), fs, paths }
}

function patchEntries(
  fs: ReturnType<typeof memoryFs>,
  paths: ReturnType<typeof resolveProfilePaths>,
) {
  return parseManagedBlock(fs.existsFile(paths.patchPath) ? fs.readFile(paths.patchPath) : '')
}

describe('save: plugin rows', () => {
  it('writes an explicit off and an explicit on', async () => {
    const { engine: acp, fs, paths } = engine()
    const result = await acp.save({ plugins: { 'tool-web': 'off' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([{ id: 'tool-web', disabled: 'true' }])
    expect(result.changed).toEqual(['tool-web'])
    expect(result.verification.source).toBe('live')
    expect(result.verification.rows).toEqual({ 'tool-web': 'off' })
  })

  it('keeps the patch minimal: inherit matching the ACP state writes nothing', async () => {
    const { engine: acp, fs, paths } = engine()
    // tool-web is composed on and enabled on the Web side, so inherit is a no-op.
    const result = await acp.save({ plugins: { 'tool-web': 'inherit' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsFile(paths.patchPath)).toBe(false)
    expect(result.changed).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/no patch change was required/)
  })

  it('writes inherit only when it disagrees with the ACP state', async () => {
    const { fs, paths } = engine()
    const webOff = [
      { moduleName: '@deepseek-ai/dsh-tool-web', enabled: false, patchId: 'tool-web' },
    ]
    const deps = fakeDeps({ fs, homeDir: HOME, web: webOff, dump: () => composingDump(fs, paths) })
    const result = await createEngine(deps).save({ plugins: { 'tool-web': 'inherit' } })
    expect(result.ok).toBe(true)
    expect(patchEntries(fs, paths)).toEqual([{ id: 'tool-web', disabled: 'true' }])
  })

  it('never writes inherit for a !!js dynamic row or an absent Web row', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, dump: () => composingDump(fs, paths) })
    const result = await createEngine(deps).save({
      plugins: { 'sandbox-policy': 'inherit', themes: 'inherit' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsFile(paths.patchPath)).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/read-only/)
  })

  it('refuses preset-managed, infra and not-in-acp rows with warnings', async () => {
    const { engine: acp, fs, paths } = engine()
    const result = await acp.save({
      plugins: { 'tool-bash': 'on', hmr: 'off', themes: 'off', 'no-such-row': 'on' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const text = result.warnings.join(' ')
    expect(text).toMatch(/tool-bash is read-only \(preset-managed\)/)
    expect(text).toMatch(/hmr is read-only \(infra\)/)
    expect(text).toMatch(/themes is read-only \(not-in-acp\)/)
    expect(text).toMatch(/unknown row no-such-row/)
    expect(patchEntries(fs, paths)).toEqual([])
  })

  it('rejects an invalid mode as a usage failure', async () => {
    const { engine: acp } = engine()
    const result = await acp.save({ plugins: { 'tool-web': 'maybe' as never } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_USAGE')
  })
})

describe('save: preset and sandbox sections', () => {
  it('writes default plus selectedDefault: null for the chosen preset', async () => {
    const { engine: acp, fs, paths } = engine()
    const result = await acp.save({ agentMode: { mode: 'preset', id: 'minimal' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const entries = patchEntries(fs, paths)
    expect(entries).toEqual([
      { id: 'agent-preset-registry', config: { default: 'minimal', selectedDefault: 'null' } },
    ])
    const text = fs.readFile(paths.patchPath)
    expect(text).toContain('    selectedDefault: null')
    expect(result.verification.agentMode).toBe('minimal')
  })

  it('writes sandbox mode with workspaceRoot and the paired approval policy', async () => {
    const { engine: acp, fs, paths } = engine()
    const result = await acp.save({
      sandboxMode: { mode: 'sandbox', sandbox: 'danger-full-access' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'never' } },
    ])
  })

  it('pairs read-only with approval ask', async () => {
    const { engine: acp, fs, paths } = engine()
    await acp.save({ sandboxMode: { mode: 'sandbox', sandbox: 'read-only' } })
    expect(patchEntries(fs, paths).find((entry) => entry.id === 'approval')?.config?.policy).toBe(
      'ask',
    )
  })

  it('rejects a preset this composition does not declare', async () => {
    const { engine: acp, fs, paths } = engine()
    const result = await acp.save({ agentMode: { mode: 'preset', id: 'ghost' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.join(' ')).toMatch(/not a preset this ACP composition declares/)
    expect(patchEntries(fs, paths)).toEqual([])
  })

  it('clears the override when both choices are acp-default', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, dump: () => composingDump(fs, paths) })
    const acp = createEngine(deps)
    await acp.save({
      agentMode: { mode: 'preset', id: 'standard' },
      sandboxMode: { mode: 'sandbox', sandbox: 'workspace-write' },
    })
    expect(patchEntries(fs, paths).map((entry) => entry.id)).toContain('agent-preset-registry')

    const cleared = await acp.save({
      agentMode: { mode: 'acp-default' },
      sandboxMode: { mode: 'acp-default' },
    })
    expect(cleared.ok).toBe(true)
    expect(patchEntries(fs, paths)).toEqual([])
    expect(fs.readFile(paths.patchPath)).not.toContain('dsh-acp-config:managed (')
  })

  it('preserves the previous section when the field is omitted', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, dump: () => composingDump(fs, paths) })
    const acp = createEngine(deps)
    await acp.save({
      agentMode: { mode: 'preset', id: 'standard' },
      sandboxMode: { mode: 'sandbox', sandbox: 'workspace-write' },
    })
    const before = fs.readFile(paths.patchPath)

    const second = await acp.save({ plugins: { 'tool-web': 'off' } })
    expect(second.ok).toBe(true)
    const after = fs.readFile(paths.patchPath)
    expect(after).toContain('    default: standard')
    expect(after).toContain('    mode: workspace-write')
    expect(after).toContain('- id: tool-web')
    expect(after.length).toBeGreaterThan(before.length)
  })
})

describe('save: clearing an override restores the base composition', () => {
  it('removes the whole block and the user patch is byte-identical again', async () => {
    const user = '# my patch\n- id: llm-pi-ai\n  config:\n    streamIdleTimeoutMs: 600000\n'
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(paths.patchPath, user)
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, dump: () => composingDump(fs, paths) })
    const acp = createEngine(deps)

    // 1) Override the row off; the composition now reports `disabled: true`.
    const off = await acp.save({ plugins: { 'tool-web': 'off' } })
    expect(off.ok).toBe(true)
    expect(patchEntries(fs, paths)).toEqual([{ id: 'tool-web', disabled: 'true' }])
    expect(fs.readFile(paths.patchPath)).toContain('dsh-acp-config:managed (')

    // 2) Clear: inherit must resolve against the remembered base (on), not
    // against our own override, so no patch entry remains at all.
    const cleared = await acp.save({
      plugins: { 'tool-web': 'inherit' },
      agentMode: { mode: 'acp-default' },
      sandboxMode: { mode: 'acp-default' },
    })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    expect(patchEntries(fs, paths)).toEqual([])
    expect(fs.readFile(paths.patchPath)).toBe(user)
    expect(cleared.changed).toEqual(['tool-web'])

    // 3) A second identical clear changes nothing (block already gone).
    const again = await acp.save({
      plugins: { 'tool-web': 'inherit' },
      agentMode: { mode: 'acp-default' },
      sandboxMode: { mode: 'acp-default' },
    })
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.changed).toEqual([])
    expect(fs.readFile(paths.patchPath)).toBe(user)
  })

  it('clears back to a base that was off', async () => {
    // A switchable row whose base composition is `disabled: true`.
    const base = [
      '- id: tool-fs',
      "  name: '@deepseek-ai/dsh-tool-fs'",
      '  disabled: true',
      '- id: agent-preset-registry',
      "  name: '@deepseek-ai/dsh-agent-preset-registry'",
      '  config:',
      '    default: standard',
      '',
    ].join('\n')
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const web = [{ moduleName: '@deepseek-ai/dsh-tool-fs', enabled: false, patchId: 'tool-fs' }]
    const deps = fakeDeps({ fs, homeDir: HOME, web, dump: () => composingDump(fs, paths, base) })
    const acp = createEngine(deps)

    const on = await acp.save({ plugins: { 'tool-fs': 'on' } })
    expect(on.ok).toBe(true)
    expect(patchEntries(fs, paths)).toEqual([{ id: 'tool-fs', disabled: 'false' }])

    const cleared = await acp.save({
      plugins: { 'tool-fs': 'inherit' },
      agentMode: { mode: 'acp-default' },
      sandboxMode: { mode: 'acp-default' },
    })
    expect(cleared.ok).toBe(true)
    if (!cleared.ok) return
    // web off + base off → inherit needs no patch, so the block disappears.
    expect(patchEntries(fs, paths)).toEqual([])
    expect(cleared.changed).toEqual(['tool-fs'])
  })
})

describe('save: idempotency and state', () => {
  it('is byte-for-byte idempotent for the same input', async () => {
    const { engine: acp, fs, paths } = engine()
    const request: SaveRequest = {
      plugins: { 'tool-web': 'off' },
      agentMode: { mode: 'preset', id: 'standard' },
      sandboxMode: { mode: 'sandbox', sandbox: 'read-only' },
    }
    const first = await acp.save(request)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const text = fs.readFile(paths.patchPath)
    const second = await acp.save(request)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(fs.readFile(paths.patchPath)).toBe(text)
    expect(second.changed).toEqual([])
    expect(first.changed).toEqual([
      'agent-preset-registry',
      'approval',
      'sandbox-policy',
      'tool-web',
    ])
  })

  it('preserves user content and its bytes around the block', async () => {
    const user =
      '# my patch\n- id: llm-pi-ai\n  config:\n    providers:\n      magpie:\n        apiKeyEnv: X\n'
    const { engine: acp, fs, paths } = engine({ patch: user })
    await acp.save({ plugins: { 'tool-web': 'off' } })
    const text = fs.readFile(paths.patchPath)
    expect(text.startsWith(user)).toBe(true)
    expect(text).toContain('- id: tool-web')
    expect(fs.existsFile(paths.backupPath)).toBe(true)
  })

  it('persists mode and the Web snapshot, clearing drift on the next status', async () => {
    const { engine: acp, fs, paths } = engine()
    await acp.save({ plugins: { 'tool-web': 'inherit' } })
    const state = readState(fs, paths).state
    expect(state.savedAt).toBe('2026-11-03T08:00:00.000Z')
    expect(state.plugins['tool-web']).toEqual({ mode: 'inherit', web: true })
    // Locked rows are not recorded unless the request names them.
    expect(state.plugins['tool-bash']).toBeUndefined()

    const webFlipped = [
      { moduleName: '@deepseek-ai/dsh-tool-web', enabled: false, patchId: 'tool-web' },
      ...WEB.slice(1),
    ]
    const deps = fakeDeps({
      fs,
      homeDir: HOME,
      web: webFlipped,
      dump: () => composingDump(fs, paths),
    })
    const status = await createEngine(deps).status()
    expect(status.apply.drift).toEqual(['tool-web'])
  })

  it('keeps rows the request did not mention at their stored mode', async () => {
    const { engine: acp, fs, paths } = engine()
    await acp.save({ plugins: { 'tool-web': 'off' } })
    await acp.save({ sandboxMode: { mode: 'sandbox', sandbox: 'read-only' } })
    const state = readState(fs, paths).state
    expect(state.plugins['tool-web']?.mode).toBe('off')
  })

  it('reports E_DUMP and writes nothing when the dump is unavailable', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB, dump: failedDump() })
    const result = await createEngine(deps).save({ plugins: { 'tool-web': 'off' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_DUMP')
    expect(fs.existsFile(paths.patchPath)).toBe(false)
    expect(fs.existsFile(paths.statePath)).toBe(false)
  })

  it('reports E_PROFILE when the profile directory is missing', async () => {
    const fs = memoryFs()
    const deps = fakeDeps({ fs, homeDir: HOME, web: WEB })
    const result = await createEngine(deps).save({ plugins: {} })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_PROFILE')
  })

  it('treats every ACP row as read-only when the live Web list is unavailable', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, dump: () => composingDump(fs, paths) })
    const result = await createEngine(deps).save({ plugins: { 'tool-web': 'on' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([])
    expect(result.warnings.join(' ')).toMatch(/tool-web is read-only \(acp-only\)/)
  })
})

describe('save: three-state agent mode and sandbox', () => {
  it('inherits the Web preset at save time and keeps the sandbox minimal when equal', async () => {
    const {
      engine: acp,
      fs,
      paths,
    } = engine({
      webPreset: 'cordis',
      webPermission: 'workspace-write',
    })
    const result = await acp.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // cordis differs from the ACP base (standard) so it is written; the Web
    // sandbox already equals the ACP base, so the whole sandbox section is skipped.
    expect(patchEntries(fs, paths)).toEqual([
      { id: 'agent-preset-registry', config: { default: 'cordis', selectedDefault: 'null' } },
    ])
    expect(result.changed).toEqual(['agent-preset-registry'])
    expect(result.verification.agentMode).toBe('cordis')
    expect(result.verification.sandbox).toBe('workspace-write')

    const state = readState(fs, paths).state
    expect(state.agentMode).toBe('cordis')
    expect(state.agentModeChoice).toEqual({ mode: 'inherit' })
    expect(state.agentModeWeb).toBe('cordis')
    expect(state.agentModeBase).toBe('standard')
    expect(state.sandboxMode).toBe('workspace-write')
    expect(state.sandboxChoice).toEqual({ mode: 'inherit' })
    expect(state.sandboxWeb).toBe('workspace-write')
    expect(state.sandboxBase).toBe('workspace-write')
  })

  it('writes nothing when both inherit resolutions equal the ACP base', async () => {
    const {
      engine: acp,
      fs,
      paths,
    } = engine({
      webPreset: 'standard',
      webPermission: 'workspace-write',
    })
    const result = await acp.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fs.existsFile(paths.patchPath)).toBe(false)
    expect(result.changed).toEqual([])
    const state = readState(fs, paths).state
    expect(state.agentMode).toBe('standard')
    expect(state.sandboxMode).toBe('workspace-write')
    // The base is remembered so a later re-resolution can stay minimal.
    expect(state.agentModeBase).toBe('standard')
    expect(state.sandboxBase).toBe('workspace-write')
  })

  it('pairs the approval policy with an inherited sandbox mode', async () => {
    const { engine: acp, fs, paths } = engine({ webPermission: 'danger-full-access' })
    const result = await acp.save({
      sandboxMode: { mode: 'inherit' },
      plugins: { 'tool-web': 'off' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'never' } },
      { id: 'tool-web', disabled: 'true' },
    ])
    expect(result.verification.sandbox).toBe('danger-full-access')
  })

  it('takes the approval from the inherited preset, not from a mode lookup', async () => {
    // THE regression this task fixes: `auto` resolves to
    // { sandbox: 'danger-full-access', approval: 'ask' }. Reverse-deriving the
    // approval from the mode would write `never` (the danger preset's pairing)
    // and silently turn an ask-before-running profile into a never-ask one.
    const { engine: acp, fs, paths } = engine({ webPermission: 'auto' })
    const result = await acp.save({
      sandboxMode: { mode: 'inherit' },
      plugins: { 'tool-web': 'off' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      // ask, not never
      { id: 'approval', config: { policy: 'ask' } },
      { id: 'tool-web', disabled: 'true' },
    ])
    const state = readState(fs, paths).state
    // The snapshot is the preset name: `auto` and `danger-full-access` share a
    // mode but differ in approval, so the mode alone could not round-trip.
    expect(state.sandboxWeb).toBe('auto')
    expect(state.sandboxMode).toBe('danger-full-access')
    expect(state.sandboxBase).toBe('workspace-write')
    // The fixture's approval.policy is a multi-literal `!!js` expression, so the
    // pre-override approval is statically unknown and is not remembered.
    expect(state.sandboxApprovalBase).toBeUndefined()
  })

  it('writes an inherited preset whose mode equals the base but whose approval differs', async () => {
    // ACP already composes danger-full-access + never. Inheriting `auto`
    // (danger-full-access + ask) has the same mode but a different approval, so
    // the section is NOT redundant and the approval needs a patch.
    const base = [
      '- id: sandbox-policy',
      "  name: '@deepseek-ai/dsh-sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      '    workspaceRoot: !!js process.cwd()',
      '- id: approval',
      "  name: '@deepseek-ai/dsh-user-approval'",
      '  config:',
      '    policy: never',
      '- id: agent-preset-registry',
      "  name: '@deepseek-ai/dsh-agent-preset-registry'",
      '  config:',
      '    default: standard',
      '',
    ].join('\n')
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPermission: 'auto',
      dump: () => composingDump(fs, paths, base),
    })
    const result = await createEngine(deps).save({ sandboxMode: { mode: 'inherit' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'ask' } },
    ])
    // Both pre-override knobs are literal here, so the minimal-write rule can
    // compare the approval as well as the mode on a later save.
    const state = readState(fs, paths).state
    expect(state.sandboxBase).toBe('danger-full-access')
    expect(state.sandboxApprovalBase).toBe('never')
  })

  it('keeps a pinned sandbox mode paired through the shipped table', async () => {
    // An explicit pin carries no preset, so the shipped pairing still applies.
    const { engine: acp, fs, paths } = engine({ webPermission: 'auto' })
    await acp.save({ sandboxMode: { mode: 'sandbox', sandbox: 'danger-full-access' } })
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'never' } },
    ])
    // A pin records no Web snapshot: drift only applies to inherit.
    expect(readState(fs, paths).state.sandboxWeb).toBeUndefined()
  })

  it('fails with E_USAGE when inherit cannot read the Web agent preset', async () => {
    const { engine: acp, fs, paths } = engine({ webPreset: null, webPermission: 'workspace-write' })
    const result = await acp.save({ agentMode: { mode: 'inherit' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_USAGE')
    expect(result.error.message).toMatch(/cannot read the current profile's agent preset/)
    expect(fs.existsFile(paths.patchPath)).toBe(false)
    expect(fs.existsFile(paths.statePath)).toBe(false)
  })

  it('fails with E_USAGE when inherit cannot read the Web permission preset', async () => {
    const { engine: acp, fs, paths } = engine({ webPreset: 'standard', webPermission: null })
    const result = await acp.save({ sandboxMode: { mode: 'inherit' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_USAGE')
    expect(result.error.message).toMatch(/cannot read the current profile's permission preset/)
    expect(fs.existsFile(paths.patchPath)).toBe(false)
  })

  it('fails inherit when the engine runs without a live profile at all', async () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({ fs, homeDir: HOME, dump: () => composingDump(fs, paths) })
    const result = await createEngine(deps).save({ sandboxMode: { mode: 'inherit' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('E_USAGE')
    expect(fs.existsFile(paths.patchPath)).toBe(false)
  })

  it('drops a now-redundant override when switching back to inherit', async () => {
    const {
      engine: acp,
      fs,
      paths,
    } = engine({
      webPreset: 'standard',
      webPermission: 'workspace-write',
    })
    const pinned = await acp.save({
      agentMode: { mode: 'preset', id: 'cordis' },
      sandboxMode: { mode: 'sandbox', sandbox: 'danger-full-access' },
    })
    expect(pinned.ok).toBe(true)
    expect(patchEntries(fs, paths).map((entry) => entry.id)).toEqual([
      'agent-preset-registry',
      'sandbox-policy',
      'approval',
    ])

    // The remembered base is standard / workspace-write, so inherit resolves to
    // what ACP composes anyway: the whole block disappears again.
    const back = await acp.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(patchEntries(fs, paths)).toEqual([])
    expect(back.changed).toEqual(['agent-preset-registry', 'approval', 'sandbox-policy'])
    expect(fs.readFile(paths.patchPath)).not.toContain('dsh-acp-config:managed (')
  })

  it('keeps the saved choice when the request omits the field', async () => {
    const { engine: acp, fs, paths } = engine({ webPreset: 'cordis' })
    const first = await acp.save({ agentMode: { mode: 'inherit' } })
    expect(first.ok).toBe(true)
    expect(readState(fs, paths).state.agentModeChoice).toEqual({ mode: 'inherit' })

    const later = await acp.save({ plugins: { 'tool-web': 'off' } })
    expect(later.ok).toBe(true)
    // The inherited preset override survives a save that never mentions it.
    expect(patchEntries(fs, paths)).toEqual([
      { id: 'agent-preset-registry', config: { default: 'cordis', selectedDefault: 'null' } },
      { id: 'tool-web', disabled: 'true' },
    ])
  })

  it('keeps a stored inherit override when the Web value is unreadable on a later save', async () => {
    // First save resolves the inherit while the Web value is readable.
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const readable = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPreset: 'cordis',
      webPermission: 'danger-full-access',
      dump: () => composingDump(fs, paths),
    })
    const first = await createEngine(readable).save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    expect(first.ok).toBe(true)
    expect(patchEntries(fs, paths).map((entry) => entry.id)).toEqual([
      'agent-preset-registry',
      'sandbox-policy',
      'approval',
    ])

    // A later save (unrelated row) runs where the live profile cannot answer the
    // two value reads, while the plugin list is still available.
    const blind = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPreset: null,
      webPermission: null,
      dump: () => composingDump(fs, paths),
    })
    const later = await createEngine(blind).save({ plugins: { 'tool-web': 'off' } })
    expect(later.ok).toBe(true)
    if (!later.ok) return
    // The stored inherit keeps its last resolution instead of failing the save.
    expect(patchEntries(fs, paths)).toEqual([
      { id: 'agent-preset-registry', config: { default: 'cordis', selectedDefault: 'null' } },
      {
        id: 'sandbox-policy',
        config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'never' } },
      { id: 'tool-web', disabled: 'true' },
    ])
    expect(later.warnings.join(' ')).toMatch(/could not be re-resolved/)
    // The state still records the inherited choice and its snapshot.
    const state = readState(fs, paths).state
    expect(state.agentModeChoice).toEqual({ mode: 'inherit' })
    expect(state.agentModeWeb).toBe('cordis')
    expect(state.sandboxChoice).toEqual({ mode: 'inherit' })
    expect(state.sandboxWeb).toBe('danger-full-access')
  })

  it('migrates a legacy state file: absent choice means the ACP default', async () => {
    // Pre-three-state save: an override plus `agentMode`/`sandboxMode` values,
    // but no `agentModeChoice` / `sandboxChoice` fields.
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        savedAt: '2026-11-01T08:00:00.000Z',
        profile: 'acp',
        plugins: {},
        agentMode: 'cordis',
        sandboxMode: 'danger-full-access',
      }),
    )
    fs.writeFile(
      paths.patchPath,
      serializeManagedBlock([
        { id: 'agent-preset-registry', config: { default: 'cordis', selectedDefault: 'null' } },
        {
          id: 'sandbox-policy',
          config: { mode: 'danger-full-access', workspaceRoot: '!!js process.cwd()' },
        },
        { id: 'approval', config: { policy: 'never' } },
      ]),
    )
    const deps = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPreset: 'cordis',
      webPermission: 'danger-full-access',
      dump: () => composingDump(fs, paths),
    })
    const result = await createEngine(deps).save({ plugins: { 'tool-web': 'off' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // No recorded choice means "follow the ACP default", so the legacy override
    // is dropped — with an explicit warning so it never happens silently.
    expect(patchEntries(fs, paths)).toEqual([{ id: 'tool-web', disabled: 'true' }])
    expect(result.warnings.join(' ')).toMatch(/previous agent preset override was removed/)
    expect(result.warnings.join(' ')).toMatch(/previous sandbox\/approval override was removed/)
    const state = readState(fs, paths).state
    expect(state.agentModeChoice).toEqual({ mode: 'acp-default' })
    expect(state.sandboxChoice).toEqual({ mode: 'acp-default' })
    expect(state.agentMode).toBeNull()
    expect(state.sandboxMode).toBeNull()
  })

  it('writes an inherited sandbox when the ACP base mode is a !!js expression', async () => {
    // A `!!js` mode with several literals is unknown, not "equal": the inherited
    // value must be written instead of assumed redundant.
    const base = [
      '- id: sandbox-policy',
      "  name: '@deepseek-ai/dsh-sandbox-policy'",
      '  config:',
      "    mode: !!js process.env.X ?? 'workspace-write' === 'y' ? 'read-only' : 'danger-full-access'",
      '    workspaceRoot: !!js process.cwd()',
      '- id: approval',
      "  name: '@deepseek-ai/dsh-user-approval'",
      '  config:',
      '    policy: ask',
      '- id: agent-preset-registry',
      "  name: '@deepseek-ai/dsh-agent-preset-registry'",
      '  config:',
      '    default: standard',
      '',
    ].join('\n')
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const deps = fakeDeps({
      fs,
      homeDir: HOME,
      web: WEB,
      webPermission: 'workspace-write',
      dump: () => composingDump(fs, paths, base),
    })
    const result = await createEngine(deps).save({ sandboxMode: { mode: 'inherit' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(patchEntries(fs, paths)).toEqual([
      {
        id: 'sandbox-policy',
        config: { mode: 'workspace-write', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'approval', config: { policy: 'ask' } },
    ])
    expect(readState(fs, paths).state.sandboxBase).toBeUndefined()
  })

  it('rejects the pre-three-state wire shapes as usage errors', async () => {
    const { engine: acp } = engine()
    const requests: unknown[] = [
      { agentMode: 'standard' },
      { agentMode: null },
      { sandboxMode: 'read-only' },
      { sandboxMode: { mode: 'nope' } },
      { sandboxMode: { mode: 'sandbox', sandbox: 'read-write' } },
      { agentMode: { mode: 'preset' } },
    ]
    for (const request of requests) {
      const result = await acp.save(request as never)
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.error.code).toBe('E_USAGE')
    }
  })
})
