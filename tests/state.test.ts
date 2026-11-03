import { describe, expect, it } from 'vitest'
import { emptyState, readState, writeState } from '../src/host/state.js'
import { resolveProfilePaths } from '../src/host/paths.js'
import { memoryFs, withProfile } from './fakes.js'

const HOME = '/home/test/.dsh'

function setup() {
  const fs = memoryFs()
  withProfile(fs, HOME, 'acp')
  return { fs, paths: resolveProfilePaths(HOME, 'acp') }
}

describe('readState', () => {
  it('returns empty state without a warning when the file is missing', () => {
    const { fs, paths } = setup()
    const result = readState(fs, paths)
    expect(result.state).toEqual(emptyState('acp'))
    expect(result.warnings).toEqual([])
  })

  it('reads a complete state file', () => {
    const { fs, paths } = setup()
    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        savedAt: '2026-11-03T08:00:00.000Z',
        profile: 'acp',
        plugins: { 'tool-web': { mode: 'off', web: true } },
        agentMode: 'standard',
        sandboxMode: 'danger-full-access',
      }),
    )
    const result = readState(fs, paths)
    expect(result.state.savedAt).toBe('2026-11-03T08:00:00.000Z')
    expect(result.state.plugins['tool-web']).toEqual({ mode: 'off', web: true })
    expect(result.state.agentMode).toBe('standard')
    expect(result.state.sandboxMode).toBe('danger-full-access')
    expect(result.warnings).toEqual([])
  })

  it('degrades to empty state with a warning on corrupt JSON', () => {
    const { fs, paths } = setup()
    fs.writeFile(paths.statePath, '{oops')
    const result = readState(fs, paths)
    expect(result.state).toEqual(emptyState('acp'))
    expect(result.warnings[0]).toMatch(/not valid JSON/)
  })

  it('degrades on a non-object payload and on an unsupported version', () => {
    const { fs, paths } = setup()
    fs.writeFile(paths.statePath, '[1,2,3]')
    expect(readState(fs, paths).warnings[0]).toMatch(/not a JSON object/)
    fs.writeFile(paths.statePath, JSON.stringify({ version: 9, plugins: {} }))
    expect(readState(fs, paths).warnings[0]).toMatch(/unsupported version/)
    expect(readState(fs, paths).state).toEqual(emptyState('acp'))
  })

  it('keeps valid entries and warns about invalid ones', () => {
    const { fs, paths } = setup()
    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        plugins: { good: { mode: 'on', web: false }, bad: { mode: 'sideways' }, weird: 'nope' },
        sandboxMode: 'read-write',
      }),
    )
    const result = readState(fs, paths)
    expect(result.state.plugins.good).toEqual({ mode: 'on', web: false })
    expect(result.state.plugins.bad).toEqual({ mode: 'inherit' })
    expect(result.state.plugins.weird).toBeUndefined()
    expect(result.state.sandboxMode).toBeNull()
    expect(result.warnings.join(' ')).toMatch(/unknown mode for bad/)
    expect(result.warnings.join(' ')).toMatch(/unknown sandboxMode/)
  })

  it('warns when plugins is not an object', () => {
    const { fs, paths } = setup()
    fs.writeFile(paths.statePath, JSON.stringify({ version: 1, plugins: [] }))
    expect(readState(fs, paths).warnings.join(' ')).toMatch(/non-object plugins/)
  })
})

describe('writeState', () => {
  it('writes pretty JSON atomically', () => {
    const { fs, paths } = setup()
    writeState(fs, paths, {
      version: 1,
      savedAt: '2026-11-03T09:00:00.000Z',
      profile: 'acp',
      plugins: { 'tool-web': { mode: 'off', web: true } },
      agentMode: 'standard',
      sandboxMode: 'workspace-write',
    })
    expect(fs.existsFile(paths.statePath)).toBe(true)
    expect(fs.existsFile(`${paths.statePath}.tmp`)).toBe(false)
    const roundTrip = readState(fs, paths).state
    expect(roundTrip.plugins['tool-web']).toEqual({ mode: 'off', web: true })
  })

  it('refuses to write outside the profile', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const escaped = { ...paths, statePath: '/tmp/evil.json' }
    expect(() => writeState(fs, escaped, emptyState('acp'))).toThrow(/escapes the profile/)
  })
})

describe('three-state choices', () => {
  it('treats a legacy file (agentMode/sandboxMode only) as acp-default', () => {
    const { fs, paths } = setup()
    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        savedAt: '2026-11-03T08:00:00.000Z',
        profile: 'acp',
        plugins: {},
        agentMode: 'standard',
        sandboxMode: 'workspace-write',
      }),
    )
    const result = readState(fs, paths)
    expect(result.warnings).toEqual([])
    expect(result.state.agentMode).toBe('standard')
    expect(result.state.sandboxMode).toBe('workspace-write')
    // The pre-three-state file carries no choice; status/save read that as
    // `acp-default` rather than inventing an `inherit`.
    expect(result.state.agentModeChoice).toBeUndefined()
    expect(result.state.sandboxChoice).toBeUndefined()
    expect(result.state.agentModeWeb).toBeUndefined()
    expect(result.state.sandboxWeb).toBeUndefined()
  })

  it('round-trips choices, Web snapshots and remembered bases', () => {
    const { fs, paths } = setup()
    writeState(fs, paths, {
      ...emptyState('acp'),
      savedAt: '2026-11-03T09:00:00.000Z',
      agentMode: 'cordis',
      sandboxMode: 'danger-full-access',
      agentModeChoice: { mode: 'inherit' },
      sandboxChoice: { mode: 'inherit' },
      agentModeWeb: 'cordis',
      sandboxWeb: 'danger-full-access',
      agentModeBase: 'standard',
      sandboxBase: 'workspace-write',
    })
    const state = readState(fs, paths).state
    expect(state.agentModeChoice).toEqual({ mode: 'inherit' })
    expect(state.sandboxChoice).toEqual({ mode: 'inherit' })
    expect(state.agentModeWeb).toBe('cordis')
    expect(state.sandboxWeb).toBe('danger-full-access')
    expect(state.agentModeBase).toBe('standard')
    expect(state.sandboxBase).toBe('workspace-write')
  })

  it('reads concrete choices and warns about unusable ones', () => {
    const { fs, paths } = setup()
    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        plugins: {},
        agentModeChoice: { mode: 'preset', id: 'cordis' },
        sandboxChoice: { mode: 'sandbox', sandbox: 'read-only' },
      }),
    )
    let result = readState(fs, paths)
    expect(result.state.agentModeChoice).toEqual({ mode: 'preset', id: 'cordis' })
    expect(result.state.sandboxChoice).toEqual({ mode: 'sandbox', sandbox: 'read-only' })
    expect(result.warnings).toEqual([])

    fs.writeFile(
      paths.statePath,
      JSON.stringify({
        version: 1,
        plugins: {},
        agentModeChoice: 'inherit',
        sandboxChoice: { mode: 'sandbox', sandbox: 'yolo' },
        sandboxWeb: 42,
      }),
    )
    result = readState(fs, paths)
    expect(result.state.agentModeChoice).toBeUndefined()
    expect(result.state.sandboxChoice).toBeUndefined()
    expect(result.state.sandboxWeb).toBeUndefined()
    const warnings = result.warnings.join(' ')
    expect(warnings).toMatch(/non-object agentModeChoice/)
    expect(warnings).toMatch(/sandboxChoice with an unknown mode/)
    expect(warnings).toMatch(/unusable sandboxWeb/)
  })

  it('warns when a preset choice has no id', () => {
    const { fs, paths } = setup()
    fs.writeFile(
      paths.statePath,
      JSON.stringify({ version: 1, plugins: {}, agentModeChoice: { mode: 'preset' } }),
    )
    const result = readState(fs, paths)
    expect(result.state.agentModeChoice).toBeUndefined()
    expect(result.warnings.join(' ')).toMatch(/without an id/)
  })
})
