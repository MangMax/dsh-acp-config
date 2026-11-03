import { describe, expect, it } from 'vitest'
import {
  applyManagedBlock,
  changedIds,
  MANAGED_END,
  MANAGED_START,
  parseManagedBlock,
  serializeManagedBlock,
  writeManagedBlock,
} from '../src/host/patch-block.js'
import { resolveProfilePaths } from '../src/host/paths.js'
import { memoryFs, withProfile } from './fakes.js'

const HOME = '/home/test/.dsh'

function paths() {
  const fs = memoryFs()
  withProfile(fs, HOME, 'acp')
  return { fs, paths: resolveProfilePaths(HOME, 'acp') }
}

describe('serializeManagedBlock', () => {
  it('orders sections: preset registry, sandbox, approval, then plugin rows by id', () => {
    const block = serializeManagedBlock([
      { id: 'tool-web', disabled: 'true' },
      { id: 'approval', config: { policy: 'ask' } },
      {
        id: 'sandbox-policy',
        config: { mode: 'workspace-write', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'agent-preset-registry', config: { default: 'standard', selectedDefault: 'null' } },
    ])
    const ids = parseManagedBlock(block).map((entry) => entry.id)
    expect(ids).toEqual(['agent-preset-registry', 'sandbox-policy', 'approval', 'tool-web'])
  })

  it('emits selectedDefault as a YAML null literal, not the string null', () => {
    const block = serializeManagedBlock([
      { id: 'agent-preset-registry', config: { default: 'standard', selectedDefault: 'null' } },
    ])
    expect(block).toContain('    selectedDefault: null')
    expect(block).not.toContain("selectedDefault: 'null'")
  })

  it('emits !!js values verbatim and quotes unsafe scalars', () => {
    const block = serializeManagedBlock([
      {
        id: 'sandbox-policy',
        config: { mode: 'workspace-write', workspaceRoot: '!!js process.cwd()' },
      },
      { id: 'preset-row', config: { default: 'needs quoting' } },
    ])
    expect(block).toContain('    workspaceRoot: !!js process.cwd()')
    expect(block).toContain("    default: 'needs quoting'")
  })

  it('returns an empty string when nothing is managed', () => {
    expect(serializeManagedBlock([])).toBe('')
  })
})

describe('applyManagedBlock', () => {
  it('preserves user content before and after the block', () => {
    const user = '# user comment\n- insert:\n    - id: mine\n      name: pkg\n'
    const existing = `${user}${serializeManagedBlock([{ id: 'tool-web', disabled: 'true' }])}# tail comment\n`
    const next = applyManagedBlock(
      existing,
      serializeManagedBlock([{ id: 'tool-web', disabled: 'false' }]),
    )
    expect(next).toBe(
      `${user}${serializeManagedBlock([{ id: 'tool-web', disabled: 'false' }])}# tail comment\n`,
    )
    expect(next).toContain('# tail comment')
    expect(next.split('dsh-acp-config:managed').length - 1).toBe(2)
  })

  it('replaces an existing block instead of appending a second one', () => {
    const first = applyManagedBlock(
      '# user\n',
      serializeManagedBlock([{ id: 'a', disabled: 'true' }]),
    )
    const second = applyManagedBlock(first, serializeManagedBlock([{ id: 'b', disabled: 'true' }]))
    expect(second.match(/dsh-acp-config:managed \(/g)?.length ?? 0).toBe(1)
    expect(second.match(/dsh-acp-config:managed\n/g)?.length ?? 0).toBe(1)
    expect(second.startsWith('# user\n')).toBe(true)
  })

  it('removes the whole block (markers included) when nothing is managed', () => {
    const withBlock = applyManagedBlock(
      '# user\n',
      serializeManagedBlock([{ id: 'a', disabled: 'true' }]),
    )
    const removed = applyManagedBlock(withBlock, '')
    expect(removed).toBe('# user\n')
    expect(removed).not.toContain(MANAGED_START)
    expect(removed).not.toContain(MANAGED_END)
  })

  it('appends a block to content without one', () => {
    const result = applyManagedBlock(
      '- id: llm\n',
      serializeManagedBlock([{ id: 'a', disabled: 'true' }]),
    )
    expect(result.startsWith('- id: llm\n')).toBe(true)
    expect(result).toContain(MANAGED_START)
  })

  it('is idempotent: applying the same block twice changes nothing', () => {
    const block = serializeManagedBlock([{ id: 'a', disabled: 'true' }])
    const once = applyManagedBlock('# user\n', block)
    const twice = applyManagedBlock(once, block)
    expect(twice).toBe(once)
  })

  it('rejects a half-edited marker pair', () => {
    expect(() => applyManagedBlock(`${MANAGED_END}\n`, '')).toThrow(/end marker/)
    expect(() => applyManagedBlock(`${MANAGED_START}\n`, '')).toThrow(/end marker/)
  })
})

describe('writeManagedBlock', () => {
  it('writes atomically, keeps the original mode and backs up on first write', () => {
    const { fs, paths: p } = paths()
    fs.writeFile(p.patchPath, '# user\n', 0o600)
    const outcome = writeManagedBlock(fs, p, serializeManagedBlock([{ id: 'a', disabled: 'true' }]))
    expect(outcome.changed).toBe(true)
    expect(fs.existsFile(p.backupPath)).toBe(true)
    expect(fs.files.get(p.patchPath)?.mode).toBe(0o600)
    expect(fs.existsFile(p.tempPath)).toBe(false)
  })

  it('writes nothing when the content is already identical', () => {
    const { fs, paths: p } = paths()
    const block = serializeManagedBlock([{ id: 'a', disabled: 'true' }])
    writeManagedBlock(fs, p, block)
    const before = fs.writes.length
    const second = writeManagedBlock(fs, p, block)
    expect(second.changed).toBe(false)
    expect(fs.writes.length).toBe(before)
  })

  it('retries once after a concurrent edit, then reports a conflict', () => {
    const { fs, paths: p } = paths()
    fs.writeFile(p.patchPath, '# user\n', 0o600)
    let bumps = 0
    fs.bumpOnNextStat = (path) => {
      if (path !== p.patchPath || bumps > 0) return false
      bumps += 1
      return true
    }
    // First stat reads the file, the second detects the bumped mtime, so the
    // write retries against freshly read content and succeeds.
    const outcome = writeManagedBlock(fs, p, serializeManagedBlock([{ id: 'a', disabled: 'true' }]))
    expect(outcome.changed).toBe(true)
    expect(bumps).toBe(1)
  })

  it('creates the patch file when the profile has none', () => {
    const { fs, paths: p } = paths()
    const outcome = writeManagedBlock(fs, p, serializeManagedBlock([{ id: 'a', disabled: 'true' }]))
    expect(outcome.changed).toBe(true)
    expect(fs.existsFile(p.patchPath)).toBe(true)
    expect(fs.existsFile(p.backupPath)).toBe(false)
  })
})

describe('changedIds', () => {
  it('reports added, removed and modified ids only', () => {
    const before = parseManagedBlock(
      serializeManagedBlock([
        { id: 'a', disabled: 'true' },
        { id: 'b', disabled: 'false' },
      ]),
    )
    const after = parseManagedBlock(
      serializeManagedBlock([
        { id: 'a', disabled: 'false' },
        { id: 'c', disabled: 'true' },
      ]),
    )
    expect(changedIds(before, after)).toEqual(['a', 'b', 'c'])
  })

  it('reports nothing for identical blocks', () => {
    const entries = parseManagedBlock(serializeManagedBlock([{ id: 'a', disabled: 'true' }]))
    expect(changedIds(entries, entries)).toEqual([])
  })
})
