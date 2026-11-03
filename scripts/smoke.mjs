#!/usr/bin/env node
// End-to-end smoke test for the Host engine against a throwaway ACP profile.
//
// It imports the BUILT host bundle (`dist/index.mjs`), creates a temporary
// `$DSH_HOME` with an `acp-smoke` profile composed exactly like the real ACP
// profile (base + acp-app + dsh-acp-agentmode), and drives status → save →
// validate → dump → idempotent save → clear. Nothing under the real `~/.dsh`
// is read or written.
//
//   pnpm build && node scripts/smoke.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEngine, createReadPackageMeta, createWebPort, defaultDeps } from '../dist/index.mjs'

const REPO = new URL('..', import.meta.url).pathname
const AGENTMODE_DIR = '/Users/mang/AI/Deepseek/dsh-acp-agentmode'
const PROFILE = 'acp-smoke'

const failures = []
function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok   ${name}`)
    return
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-acp-config-smoke-'))
  const dir = join(home, 'profiles', PROFILE)
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  symlinkSync(AGENTMODE_DIR, join(dir, 'node_modules', 'dsh-acp-agentmode'), 'dir')
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: `dsh-profile-${PROFILE}`,
        private: true,
        dsh: {
          profile: {
            bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app', 'dsh-acp-agentmode'],
            patchReload: 'startup',
          },
        },
        dependencies: { 'dsh-acp-agentmode': `link:${AGENTMODE_DIR}` },
      },
      null,
      2,
    ) + '\n',
  )
  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  // A user-owned patch with content that must survive every save.
  writeFileSync(
    join(dir, 'cordis.patch.yml'),
    [
      '# user-owned patch content',
      '- id: agent-default-model',
      '  config:',
      '    provider: smoke-provider',
      '    model: smoke-model',
      '',
    ].join('\n'),
  )
  // A stand-in for the desktop host's DSH installation root. The Host falls back
  // to package `locale/*.json` for rows the page's own profile never loads (an
  // agent preset's plugins); Electron reads the same path inside app.asar.
  // Nothing here touches the real installation or the real `~/.dsh`.
  const dshRoot = join(home, 'fake-dsh-root')
  const personaLocale = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-persona', 'locale')
  mkdirSync(personaLocale, { recursive: true })
  writeFileSync(
    join(personaLocale, 'zh.json'),
    JSON.stringify({
      meta: {
        title: '智能体角色设定',
        description: '为当前智能体提供组合中定义的角色与行为说明。',
      },
    }),
  )
  writeFileSync(join(personaLocale, 'en.json'), JSON.stringify({ meta: { title: 'persona' } }))
  return { home, dshRoot }
}

function dumpComposition(home) {
  const result = spawnSync('dsh', ['--profile', PROFILE, '--dump-config'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, DSH_HOME: home },
  })
  if (result.status !== 0) {
    throw new Error(`dsh --dump-config failed (${result.status}): ${result.stderr}`)
  }
  return result.stdout
}

function runDumpWithHome(home) {
  return async ({ profile }) => {
    const result = spawnSync('dsh', ['--profile', profile, '--dump-config'], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, DSH_HOME: home },
    })
    if (result.error) {
      return { ok: false, source: 'fallback', code: 'spawn', message: String(result.error) }
    }
    if (result.status !== 0) {
      return {
        ok: false,
        source: 'fallback',
        code: 'exit',
        message: `exit ${result.status}: ${(result.stderr || '').trim().slice(0, 300)}`,
      }
    }
    return { ok: true, source: 'live', text: result.stdout, command: 'dsh' }
  }
}

/** Minimal reader for the values this feature owns in a composed dump. */
function composedValues(text) {
  const rows = new Map()
  let current = null
  let inConfig = false
  for (const line of text.split('\n')) {
    const top = /^- id:\s*(\S+)\s*$/.exec(line)
    if (top) {
      current = { id: top[1], disabled: undefined, config: {} }
      rows.set(current.id, current)
      inConfig = false
      continue
    }
    if (current === null) continue
    const field = /^ {2}(name|disabled):\s*(.*)$/.exec(line)
    if (field) {
      if (field[1] === 'disabled') current.disabled = field[2].trim()
      continue
    }
    if (/^ {2}config:\s*$/.test(line)) {
      inConfig = true
      continue
    }
    if (inConfig) {
      const kv = /^ {4}([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
      if (kv) current.config[kv[1]] = kv[2].trim()
    }
  }
  return rows
}

async function main() {
  console.log('dsh-acp-config smoke: throwaway ACP profile\n')
  let { home, dshRoot } = makeHome()
  const patchPath = join(home, 'profiles', PROFILE, 'cordis.patch.yml')
  const statePath = join(home, 'profiles', PROFILE, '.dsh-acp-config.json')

  // The live Web profile this page belongs to: its default preset and the
  // permission preset the user selected are what an `inherit` snapshots at save
  // time. The permission preset — not the deployment default — is the source.
  const webState = { preset: 'cordis', permission: 'workspace-write' }

  // The preset table the fake Web profile resolves against. `auto` deliberately
  // shares `danger-full-access` as its sandbox but keeps approval `ask`, which is
  // exactly the case a mode-based lookup would get wrong.
  const PRESETS = {
    'read-only': { sandbox: 'read-only', approval: 'ask' },
    'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
    'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    auto: { sandbox: 'danger-full-access', approval: 'ask' },
  }
  const permissionOf = (preset) => ({ preset, ...PRESETS[preset] })

  const web = {
    listPlugins: async () => [
      { patchId: 'llm-retry', moduleName: '@deepseek-ai/dsh-llm-retry', enabled: true },
      {
        patchId: 'tool-web',
        moduleName: '@deepseek-ai/dsh-tool-web',
        enabled: false,
        fiberPhase: 'active',
      },
      { patchId: 'hmr', moduleName: '@deepseek-ai/dsh-hmr', enabled: false },
    ],
    // What the live agent-preset roster declares, per preset (first preset wins).
    compositionInventory: async () => [
      { id: 'ptc', isDefault: true, rows: [{ entryId: 'persona' }, { entryId: 'tool-fs' }] },
    ],
    listPresets: async () => [
      { id: 'standard', name: 'Standard' },
      { id: 'cordis', name: 'Cordis' },
    ],
    readAgentPreset: async () => webState.preset,
    readWebPermission: async () => permissionOf(webState.permission),
    listWebPermissions: async () => Object.keys(PRESETS).map(permissionOf),
  }

  const engine = createEngine(
    defaultDeps({
      homeDir: home,
      profileName: PROFILE,
      web,
      runDump: runDumpWithHome(home),
      // The real Host wires this from `detectDshRoot(process.argv)`; a plain Node
      // run has no such argument, so the smoke injects a fake installation root.
      readPackageMeta: createReadPackageMeta({ dshRoot }),
    }),
  )

  console.log('1. status')
  const status = await engine.status()
  check('status ok', status.ok === true)
  check('profile dir resolved', status.acp.dir === join(home, 'profiles', PROFILE))
  check('acp profile exists', status.acp.exists === true)
  check(
    'agent preset registry available',
    status.agentMode.available === true,
    JSON.stringify(status.agentMode),
  )
  check('four presets composed', status.presets.length === 4, `got ${status.presets.length}`)
  check('sandbox available', status.sandbox.available === true)
  check(
    'sandbox web permission reported',
    status.sandbox.web?.preset === 'workspace-write' &&
      status.sandbox.web?.sandbox === 'workspace-write' &&
      status.sandbox.web?.approval === 'ask',
    JSON.stringify(status.sandbox.web),
  )
  check(
    'sandbox web presets listed',
    status.sandbox.webPresets.length === 4 &&
      status.sandbox.webPresets.some((entry) => entry.preset === 'auto'),
    JSON.stringify(status.sandbox.webPresets),
  )
  const llmRetry = status.rows.find((row) => row.id === 'llm-retry')
  check('switchable row present', llmRetry !== undefined && llmRetry.locked === undefined)
  check(
    'preset-managed rows locked',
    status.rows.some((row) => row.locked === 'preset-managed'),
  )
  check(
    'infra rows locked',
    status.rows.some((row) => row.locked === 'infra'),
  )

  console.log('\n1c. official plugin-page metadata')
  {
    const rows = new Map(status.rows.map((row) => [row.id, row]))
    check(
      'every row carries a group',
      status.rows.every((row) => row.group === 'session' || row.group === 'global'),
      JSON.stringify(
        status.rows.filter((row) => row.group !== 'session' && row.group !== 'global'),
      ),
    )
    const persona = rows.get('persona')
    check(
      'preset-declared row appears as a session row',
      persona !== undefined && persona.group === 'session' && persona.locked === 'preset-managed',
      JSON.stringify(persona),
    )
    check(
      'package locale fallback supplies the zh title',
      persona?.title?.zh === '智能体角色设定',
      JSON.stringify(persona?.title),
    )
    check(
      'package locale fallback supplies the description',
      persona?.description?.zh === '为当前智能体提供组合中定义的角色与行为说明。',
      JSON.stringify(persona?.description),
    )
    check(
      'compositionInventory names the owning preset',
      persona?.presetName?.en === 'ptc',
      JSON.stringify(persona?.presetName),
    )
    const planMode = rows.get('plan-mode')
    check(
      'a group child is a session plugin row',
      planMode?.group === 'session' && planMode?.moduleName === '@deepseek-ai/dsh-plan-mode',
      JSON.stringify(planMode),
    )
    check(
      'structural cordis:group rows never become plugin cards',
      status.rows.every((row) => row.moduleName !== 'cordis:group'),
      JSON.stringify(
        status.rows.filter((row) => row.moduleName === 'cordis:group').map((row) => row.id),
      ),
    )
    check(
      'both groups are populated',
      status.rows.some((row) => row.group === 'session') &&
        status.rows.some((row) => row.group === 'global'),
      JSON.stringify({
        session: status.rows.filter((row) => row.group === 'session').length,
        global: status.rows.filter((row) => row.group === 'global').length,
      }),
    )
    check('a global row stays global', rows.get('llm-retry')?.group === 'global')
    check(
      'webFiber passes the live fiber phase through',
      rows.get('tool-web')?.webFiber === 'active',
      JSON.stringify(rows.get('tool-web')?.webFiber),
    )
    const standard = status.presets.find((preset) => preset.id === 'standard')
    check(
      'preset rowCount comes from the ACP dump',
      typeof standard?.rowCount === 'number' && standard.rowCount > 10,
      JSON.stringify(status.presets),
    )
    check('plain Node has no package-locale fallback', defaultDeps().readPackageMeta === undefined)
  }

  console.log('\n1b. Web port: the selected permission preset beats the deployment default')
  {
    // The user picked full access in the Web UI while the deployment default
    // (DSH_PERMISSION_MODE) stayed workspace-write. Reading
    // `sandboxPolicy.defaultMode` reported "workspace write" — the bug this fix
    // removes. The port must report the preset, resolved through resolve().
    const ctx = {
      get: (service) => {
        if (service === 'sandboxPolicy') return { defaultMode: 'workspace-write' }
        if (service === 'permissionPresets') {
          return {
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
            resolve: async (preset) =>
              PRESETS[preset] ?? { sandbox: 'workspace-write', approval: 'ask' },
          }
        }
        return undefined
      },
    }
    const port = createWebPort(ctx)
    const permission = await port.readWebPermission()
    check(
      'web permission is the selected preset, not the deployment default',
      permission?.preset === 'danger-full-access' &&
        permission?.sandbox === 'danger-full-access' &&
        permission?.approval === 'never',
      JSON.stringify(permission),
    )
    check(
      'deployment default genuinely disagrees',
      ctx.get('sandboxPolicy').defaultMode !== permission?.sandbox,
    )
    const listed = await port.listWebPermissions()
    check(
      'web presets resolved from the catalog',
      listed.length === 3 && listed.some((entry) => entry.preset === 'auto'),
      JSON.stringify(listed),
    )
    check(
      'auto keeps ask despite the danger sandbox',
      listed.find((entry) => entry.preset === 'auto')?.approval === 'ask',
    )
    const blind = createWebPort({})
    check('blind context yields null, never a guess', (await blind.readWebPermission()) === null)
    check('blind context yields no presets', (await blind.listWebPermissions()).length === 0)
  }

  console.log('\n2. save: llm-retry off, agent mode cordis, sandbox danger-full-access')
  const saved = await engine.save({
    plugins: { 'llm-retry': 'off' },
    agentMode: { mode: 'preset', id: 'cordis' },
    sandboxMode: { mode: 'sandbox', sandbox: 'danger-full-access' },
  })
  check('save ok', saved.ok === true, JSON.stringify(saved))
  if (saved.ok) {
    check('verification live', saved.verification.source === 'live')
    check('verification agent mode', saved.verification.agentMode === 'cordis')
    check('verification sandbox', saved.verification.sandbox === 'danger-full-access')
  }
  const text1 = readFileSync(patchPath, 'utf8')
  check('managed markers written', text1.includes('# >>> dsh-acp-config:managed'))
  check('user content preserved', text1.includes('provider: smoke-provider'))
  check('selectedDefault is a YAML null', /selectedDefault: null\s*$/m.test(text1))
  check(
    'sandbox workspaceRoot expression written',
    text1.includes('workspaceRoot: !!js process.cwd()'),
  )
  check('agent preset row written', /default: cordis/.test(text1))
  check('policy follows danger-full-access', /policy: never/.test(text1))
  check('plugin row override written', /- id: llm-retry\n  disabled: true/.test(text1))
  check('state file written', readFileSync(statePath, 'utf8').includes('"agentMode": "cordis"'))

  console.log('\n3. save again is byte-idempotent')
  const second = await engine.save({
    plugins: { 'llm-retry': 'off' },
    agentMode: { mode: 'preset', id: 'cordis' },
    sandboxMode: { mode: 'sandbox', sandbox: 'danger-full-access' },
  })
  check('second save ok', second.ok === true)
  if (second.ok)
    check('second save changed nothing', second.changed.length === 0, second.changed.join(','))
  check('patch text unchanged', readFileSync(patchPath, 'utf8') === text1)

  console.log('\n4. validate + composed ACP dump')
  const validated = await engine.validate()
  check('validate ok', validated.ok === true)
  if (validated.ok) {
    check('validate agent mode', validated.agentMode === 'cordis')
    check('validate sandbox', validated.sandbox === 'danger-full-access')
    check('validate rows', validated.verification.rows?.['llm-retry'] === 'off')
  }
  const rows = composedValues(dumpComposition(home))
  check(
    'composed preset default',
    rows.get('agent-preset-registry')?.config.default === 'cordis',
    JSON.stringify(rows.get('agent-preset-registry')?.config),
  )
  check('composed sandbox mode', rows.get('sandbox-policy')?.config.mode === 'danger-full-access')
  check('composed approval policy', rows.get('approval')?.config.policy === 'never')
  check('composed plugin row disabled', rows.get('llm-retry')?.disabled === 'true')

  console.log('\n5. clear this page’s overrides')
  const cleared = await engine.save({
    plugins: { 'llm-retry': 'inherit' },
    agentMode: { mode: 'acp-default' },
    sandboxMode: { mode: 'acp-default' },
  })
  check('clear ok', cleared.ok === true)
  const text2 = readFileSync(patchPath, 'utf8')
  check('managed block removed', !text2.includes('dsh-acp-config:managed'))
  check('user content still preserved', text2.includes('provider: smoke-provider'))
  check(
    'user patch byte-identical to seed',
    text2 ===
      [
        '# user-owned patch content',
        '- id: agent-default-model',
        '  config:',
        '    provider: smoke-provider',
        '    model: smoke-model',
        '',
      ].join('\n'),
  )
  const clearedRows = composedValues(dumpComposition(home))
  check(
    'preset default restored',
    clearedRows.get('agent-preset-registry')?.config.default !== 'cordis',
  )
  check('llm-retry enabled again', clearedRows.get('llm-retry')?.disabled !== 'true')

  console.log('\n6. three-state inherit: snapshot, minimal write, drift, hard failure')
  const statusAfterClear = await engine.status()
  const basePreset = statusAfterClear.agentMode.value
  const baseSandbox = statusAfterClear.sandbox.mode
  const inheritPreset = status.presets.map((preset) => preset.id).find((id) => id !== basePreset)
  check(
    'a second preset exists to inherit',
    inheritPreset !== undefined,
    JSON.stringify({ basePreset, presets: status.presets.map((preset) => preset.id) }),
  )
  if (inheritPreset !== undefined) {
    // Web side: another preset and a permission preset that differs from ACP's own.
    webState.preset = inheritPreset
    // `auto` resolves to danger-full-access + ask: the mode differs from ACP's
    // base and the approval is NOT the shipped danger pairing. This is the case
    // a mode-based approval lookup would silently write as `never`.
    webState.permission = 'auto'
    const inherited = await engine.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    check('inherit save ok', inherited.ok === true, JSON.stringify(inherited))
    const text3 = readFileSync(patchPath, 'utf8')
    check('inherited preset written', new RegExp(`default: ${inheritPreset}`).test(text3))
    check('inherited sandbox written', /mode: danger-full-access/.test(text3))
    check(
      'inherited approval comes from the preset (auto → ask)',
      /policy: ask/.test(text3),
      text3.match(/policy: .*/)?.[0] ?? 'no approval entry',
    )
    const state3 = JSON.parse(readFileSync(statePath, 'utf8'))
    check('choice persisted', state3.agentModeChoice?.mode === 'inherit')
    check('web snapshot persisted', state3.agentModeWeb === inheritPreset)
    check(
      'sandbox web snapshot is the preset name',
      state3.sandboxWeb === 'auto',
      state3.sandboxWeb,
    )
    check('pre-override preset base remembered', state3.agentModeBase === basePreset)
    check('pre-override sandbox base remembered', state3.sandboxBase === baseSandbox)

    const inheritedAgain = await engine.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    check(
      'inherit re-save is idempotent',
      inheritedAgain.ok === true && inheritedAgain.changed.length === 0,
    )
    check('inherit re-save leaves the patch untouched', readFileSync(patchPath, 'utf8') === text3)

    // Drift: the Web preset changes after the snapshot was taken.
    webState.preset = basePreset
    const drifted = await engine.status()
    check('agent mode drift reported', drifted.agentMode.drift === true)
    check('sandbox has no drift', drifted.sandbox.drift === false)
    // Changing only the permission preset must be detected: the snapshot stores
    // the preset name, so `auto` → `danger-full-access` is a real change even
    // though both resolve to the same sandbox mode.
    webState.permission = 'danger-full-access'
    const permDrift = await engine.status()
    check('sandbox permission drift reported', permDrift.sandbox.drift === true)
    check(
      'sandbox drift compares preset names',
      permDrift.sandbox.web?.preset === 'danger-full-access' &&
        JSON.parse(readFileSync(statePath, 'utf8')).sandboxWeb === 'auto',
    )
    webState.permission = 'auto'

    const synced = await engine.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    check('re-saving syncs the snapshot', synced.ok === true)
    const text4 = readFileSync(patchPath, 'utf8')
    // Inheriting the ACP base preset needs no patch entry; the sandbox section stays.
    check('redundant preset override dropped', !/default:/.test(text4))
    check('sandbox override kept', /mode: danger-full-access/.test(text4))
    const afterSync = await engine.status()
    check('drift cleared after the sync save', afterSync.agentMode.drift === false)

    // Unreadable Web values must fail loudly instead of falling back to ACP defaults.
    const blindEngine = createEngine(
      defaultDeps({
        homeDir: home,
        profileName: PROFILE,
        runDump: runDumpWithHome(home),
        web: {
          listPlugins: async () => [],
          readAgentPreset: async () => null,
          readWebPermission: async () => null,
          listWebPermissions: async () => [],
        },
      }),
    )
    const blind = await blindEngine.save({
      agentMode: { mode: 'inherit' },
      sandboxMode: { mode: 'inherit' },
    })
    check('unreadable inherit fails', blind.ok === false, JSON.stringify(blind))
    if (!blind.ok) {
      check('unreadable inherit is a usage failure', blind.error.code === 'E_USAGE')
      check(
        'unreadable inherit explains itself',
        /cannot read the current profile/.test(blind.error.message),
        blind.error.message,
      )
    }
  }

  if (process.env.KEEP_SMOKE_HOME === '1') console.log(`\nkept smoke home: ${home}`)
  else rmSync(home, { recursive: true, force: true })
  console.log(
    '\n' +
      (failures.length === 0
        ? 'PASS: all smoke checks succeeded'
        : `FAIL: ${failures.length} check(s) failed`),
  )
  if (failures.length > 0) {
    for (const failure of failures) console.log(` - ${failure}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('\nsmoke crashed:', error)
  process.exit(1)
})
