import { describe, expect, it } from 'vitest'
import { parseComposition } from '../src/host/dump.js'
import { SAMPLE_DUMP } from './fakes.js'

describe('parseComposition', () => {
  const composition = parseComposition(SAMPLE_DUMP)

  it('reads top-level rows with module names', () => {
    expect(composition.rowById.get('tool-web')).toEqual({
      id: 'tool-web',
      moduleName: '@deepseek-ai/dsh-tool-web',
      disabled: 'false',
      config: {},
    })
  })

  it('distinguishes the three disabled states', () => {
    expect(composition.rowById.get('hmr')?.disabled).toBe('true')
    expect(composition.rowById.get('tool-web')?.disabled).toBe('false')
    expect(composition.rowById.get('preset-standard')?.config.id).toBe('standard')
    // `!!js` on a top-level row is dynamic.
    const dynamic = parseComposition(
      `- id: bash-sandbox\n  disabled: !!js process.platform === 'win32'\n`,
    )
    expect(dynamic.rowById.get('bash-sandbox')?.disabled).toBe('dynamic')
  })

  it('reads scalar config and ignores nested structures', () => {
    expect(composition.rowById.get('sandbox-policy')?.config.mode).toContain('!!js')
    expect(composition.rowById.get('agent-preset-registry')?.config.default).toBe('standard')
  })

  it('collects preset-managed ids including nested group rows', () => {
    expect(composition.presetIds.has('tool-bash')).toBe(true)
    expect(composition.presetIds.has('tool-fs')).toBe(true)
    expect(composition.presetIds.has('persona')).toBe(true)
    expect(composition.presetIds.has('plan-mode')).toBe(true)
    expect(composition.presetIds.has('tool-web')).toBe(false)
  })

  it('orders preset candidates by config.order then id', () => {
    expect(composition.presets.map((preset) => preset.id)).toEqual([
      'standard',
      'cordis',
      'minimal',
    ])
  })

  it('tolerates a folded !!js disabled expression', () => {
    const folded = parseComposition(
      `- id: demo\n  disabled: !!js >-\n    process.platform === 'win32'\n`,
    )
    expect(folded.rowById.get('demo')?.disabled).toBe('dynamic')
  })

  it('tolerates comments, quotes and CRLF', () => {
    const text = [
      '# banner',
      '- id: quoted',
      `  name: '@deepseek-ai/dsh-quoted' # trailing comment`,
      '  config:',
      `    mode: "read-only"`,
      '',
    ].join('\r\n')
    const parsed = parseComposition(text)
    expect(parsed.rowById.get('quoted')?.moduleName).toBe('@deepseek-ai/dsh-quoted')
    expect(parsed.rowById.get('quoted')?.config.mode).toBe('read-only')
  })
})

describe('parseComposition: agent-preset declarations', () => {
  const composition = parseComposition(SAMPLE_DUMP)

  it('counts each preset plugins list at its own nesting level', () => {
    const byId = new Map(composition.presets.map((preset) => [preset.id, preset]))
    // standard declares tool-bash + tool-fs (the group child is not a second item).
    expect(byId.get('standard')?.rowCount).toBe(2)
    expect(byId.get('minimal')?.rowCount).toBe(1)
    // cordis' only top-level item is the `planning` group row.
    expect(byId.get('cordis')?.rowCount).toBe(1)
  })

  it('flattens declared rows with module names and their disabled state', () => {
    expect(composition.presetRowById.get('persona')).toMatchObject({
      id: 'persona',
      moduleName: '@deepseek-ai/dsh-persona',
      disabled: 'false',
      declaredBy: ['minimal'],
    })
    expect(composition.presetRowById.get('tool-bash')).toMatchObject({
      moduleName: '@deepseek-ai/dsh-tool-bash',
      disabled: 'dynamic',
      declaredBy: ['standard'],
    })
    // Structural `cordis:group` wrappers are not plugin rows; their children are.
    expect(composition.presetRowById.has('planning')).toBe(false)
    expect(composition.presetIds.has('planning')).toBe(true)
    expect(composition.presetRowById.get('plan-mode')).toMatchObject({
      moduleName: '@deepseek-ai/dsh-plan-mode',
      declaredBy: ['cordis'],
    })
  })

  it('records every preset that declares the same row id, first one first', () => {
    const parsed = parseComposition(
      [
        '- id: preset-a',
        `  name: '@deepseek-ai/dsh-agent-preset'`,
        '  config:',
        '    id: a',
        '    plugins:',
        '      - id: tool-fs',
        `        name: '@deepseek-ai/dsh-tool-fs'`,
        '- id: preset-b',
        `  name: '@deepseek-ai/dsh-agent-preset'`,
        '  config:',
        '    id: b',
        '    plugins:',
        '      - id: tool-fs',
        `        name: '@deepseek-ai/dsh-tool-fs'`,
        '      - id: persona',
        `        name: '@deepseek-ai/dsh-persona'`,
        '',
      ].join('\n'),
    )
    expect(parsed.presetRowById.get('tool-fs')?.declaredBy).toEqual(['a', 'b'])
    expect(parsed.presetRowById.get('persona')?.declaredBy).toEqual(['b'])
    expect(parsed.presets.map((preset) => preset.id)).toEqual(['a', 'b'])
    expect(parsed.presets[1]?.rowCount).toBe(2)
  })

  it('reports zero rows for a preset whose plugins list is empty', () => {
    const parsed = parseComposition(
      [
        '- id: preset-empty',
        `  name: '@deepseek-ai/dsh-agent-preset'`,
        '  config:',
        '    id: empty',
        '    plugins: []',
        '',
      ].join('\n'),
    )
    expect(parsed.presets[0]?.rowCount).toBe(0)
    expect(parsed.presetRows).toEqual([])
  })
})
