import { describe, expect, it } from 'vitest'
import {
  assertInsideProfile,
  assertProfileName,
  readProfileBundles,
  resolveProfilePaths,
} from '../src/host/paths.js'
import { memoryFs, withProfile } from './fakes.js'

const HOME = '/home/test/.dsh'

describe('resolveProfilePaths', () => {
  it('builds profile, patch and state paths under $DSH_HOME/profiles', () => {
    const paths = resolveProfilePaths(HOME, 'acp')
    expect(paths.dir).toBe(`${HOME}/profiles/acp`)
    expect(paths.patchPath).toBe(`${HOME}/profiles/acp/cordis.patch.yml`)
    expect(paths.statePath).toBe(`${HOME}/profiles/acp/.dsh-acp-config.json`)
    expect(paths.backupPath).toBe(`${HOME}/profiles/acp/cordis.patch.yml.dsh-acp-config.bak`)
    expect(paths.tempPath).toBe(`${HOME}/profiles/acp/cordis.patch.yml.dsh-acp-config.tmp`)
  })

  it('accepts dotted and dashed profile names', () => {
    expect(assertProfileName('acp')).toBe('acp')
    expect(assertProfileName('my.profile-2')).toBe('my.profile-2')
  })

  it('rejects traversal, separators, leading dots and empty names', () => {
    for (const name of [
      '..',
      '.',
      '../acp',
      'a/b',
      'a\\b',
      '',
      ' acp',
      '-acp',
      '.hidden',
      'acp\n',
    ]) {
      expect(() => assertProfileName(name)).toThrow(/invalid profile name/)
    }
  })

  it('refuses names longer than 64 characters', () => {
    expect(() => assertProfileName('a'.repeat(65))).toThrow(/invalid profile name/)
  })
})

describe('assertInsideProfile', () => {
  it('accepts the profile patch and state paths', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    expect(() => assertInsideProfile(fs, paths.dir, paths.patchPath)).not.toThrow()
    expect(() => assertInsideProfile(fs, paths.dir, paths.statePath)).not.toThrow()
  })

  it('rejects a target outside the profile directory', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    expect(() =>
      assertInsideProfile(fs, paths.dir, `${HOME}/profiles/desktop/cordis.patch.yml`),
    ).toThrow(/escapes the profile/)
    expect(() => assertInsideProfile(fs, paths.dir, '/etc/passwd')).toThrow(/escapes the profile/)
  })

  it('rejects a target that escapes through an existing symlinked ancestor', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    const original = (path: string) => fs.realpath(path)
    fs.realpath = (path: string) => {
      if (path === paths.dir) return path
      if (path === `${HOME}/profiles/acp/nested`) return '/etc'
      return original(path)
    }
    expect(() => assertInsideProfile(fs, paths.dir, `${HOME}/profiles/acp/nested/x.yml`)).toThrow(
      /escapes the profile/,
    )
  })

  it('throws E_PROFILE when the profile directory is missing', () => {
    const fs = memoryFs()
    const paths = resolveProfilePaths(HOME, 'acp')
    expect(() => assertInsideProfile(fs, paths.dir, paths.patchPath)).toThrow(/not readable/)
  })
})

describe('readProfileBundles', () => {
  it('reads dsh.profile.bundles in declaration order', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    fs.writeFile(
      `${paths.dir}/package.json`,
      JSON.stringify({
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-acp-agentmode'] } },
      }),
    )
    expect(readProfileBundles(fs, paths.dir)).toEqual([
      '@deepseek-ai/dsh-base',
      'dsh-acp-agentmode',
    ])
  })

  it('returns [] for a missing, malformed or bundle-less manifest', () => {
    const fs = memoryFs()
    withProfile(fs, HOME, 'acp')
    const paths = resolveProfilePaths(HOME, 'acp')
    expect(readProfileBundles(fs, paths.dir)).toEqual([])
    fs.writeFile(`${paths.dir}/package.json`, '{not json')
    expect(readProfileBundles(fs, paths.dir)).toEqual([])
    fs.writeFile(`${paths.dir}/package.json`, JSON.stringify({ dsh: { profile: {} } }))
    expect(readProfileBundles(fs, paths.dir)).toEqual([])
  })
})
