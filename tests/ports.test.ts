import { describe, expect, it } from 'vitest'
import {
  createReadPackageMeta,
  detectDshRoot,
  isPackageModuleName,
  packageRootOf,
} from '../src/host/ports.js'
import type { PackageMeta } from '../src/host/ports.js'
import { memoryFs } from './fakes.js'

/** A fake installation root; nothing here reads the real `~/.dsh` or `app.asar`. */
const ROOT = '/opt/fake-dsh'

function localePath(moduleName: string, locale: string): string {
  return `${ROOT}/node_modules/${moduleName}/locale/${locale}.json`
}

function zh(title: string | undefined, description?: string): string {
  return JSON.stringify({
    meta: {
      ...(title === undefined ? {} : { title }),
      ...(description === undefined ? {} : { description }),
    },
  })
}

function readMetaFor(
  files: Record<string, string>,
  dshRoot: string | null = ROOT,
): (moduleName: string) => Promise<PackageMeta | null> {
  return createReadPackageMeta({ dshRoot, fs: memoryFs(files) })
}

describe('isPackageModuleName / packageRootOf', () => {
  it('accepts package specifiers, including subpaths, and rejects anything path-like', () => {
    expect(isPackageModuleName('dsh-acp-config')).toBe(true)
    expect(isPackageModuleName('@deepseek-ai/dsh-persona')).toBe(true)
    expect(isPackageModuleName('@scope/pkg.js')).toBe(true)
    // Loader rows name subpaths too; the locale lookup resolves the package root.
    expect(isPackageModuleName('@scope/pkg/tools')).toBe(true)
    expect(isPackageModuleName('pkg/sub/entry')).toBe(true)
    for (const unsafe of [
      '',
      '..',
      '@scope',
      '@/pkg',
      '../../etc/passwd',
      '@scope/../pkg',
      'pkg/../locale',
      'pkg\\locale',
      'cordis:group',
      '/abs/path',
      'pkg\0',
    ]) {
      expect(isPackageModuleName(unsafe), unsafe).toBe(false)
    }
  })

  it('resolves the package a specifier belongs to', () => {
    expect(packageRootOf('dsh-acp-config')).toBe('dsh-acp-config')
    expect(packageRootOf('dsh-acp-config/lib/entry')).toBe('dsh-acp-config')
    expect(packageRootOf('@deepseek-ai/dsh-persona')).toBe('@deepseek-ai/dsh-persona')
    expect(packageRootOf('@deepseek-ai/dsh-plugin-market/tools')).toBe(
      '@deepseek-ai/dsh-plugin-market',
    )
    for (const unsafe of ['..', '@scope/../../x', 'cordis:group', 'pkg\\x']) {
      expect(packageRootOf(unsafe), unsafe).toBeNull()
    }
  })
})

describe('createReadPackageMeta', () => {
  it('pairs the zh and en locale metadata into LocalizedText', async () => {
    const read = readMetaFor({
      [localePath('@deepseek-ai/dsh-persona', 'zh')]: zh(
        '智能体角色设定',
        '为当前智能体提供组合中定义的角色与行为说明。',
      ),
      [localePath('@deepseek-ai/dsh-persona', 'en')]: zh('persona', 'Persona description'),
    })
    expect(await read('@deepseek-ai/dsh-persona')).toEqual({
      title: { en: 'persona', zh: '智能体角色设定' },
      description: {
        en: 'Persona description',
        zh: '为当前智能体提供组合中定义的角色与行为说明。',
      },
    })
  })

  it('falls back across languages when one locale omits a field', async () => {
    // The shipped persona en.json carries a title only.
    const read = readMetaFor({
      [localePath('@deepseek-ai/dsh-persona', 'zh')]: zh('智能体角色设定', '解释'),
      [localePath('@deepseek-ai/dsh-persona', 'en')]: zh('persona'),
    })
    expect(await read('@deepseek-ai/dsh-persona')).toEqual({
      title: { en: 'persona', zh: '智能体角色设定' },
      description: { en: '解释', zh: '解释' },
    })
  })

  it('resolves a subpath specifier to its package locale', async () => {
    const read = readMetaFor({
      [localePath('@deepseek-ai/dsh-plugin-manager', 'zh')]: zh('插件管理服务'),
    })
    expect(await read('@deepseek-ai/dsh-plugin-manager/tools')).toEqual({
      title: { en: '插件管理服务', zh: '插件管理服务' },
    })
  })

  it('returns null for a package without locale metadata', async () => {
    const read = readMetaFor({})
    expect(await read('@deepseek-ai/dsh-missing')).toBeNull()
    expect(await read('dsh-themes')).toBeNull()
  })

  it('returns null for unreadable JSON, a bad meta shape, or a non-package specifier', async () => {
    const read = readMetaFor({
      [localePath('broken', 'zh')]: '{not json',
      [localePath('no-meta', 'zh')]: JSON.stringify({ title: 'flat' }),
      [localePath('empty-meta', 'zh')]: JSON.stringify({ meta: { title: '   ' } }),
      [localePath('@scope/pkg', 'en')]: JSON.stringify({ meta: { title: 'scoped' } }),
    })
    expect(await read('broken')).toBeNull()
    expect(await read('no-meta')).toBeNull()
    expect(await read('empty-meta')).toBeNull()
    // `cordis:group` is a Loader group specifier, not an installable package.
    expect(await read('cordis:group')).toBeNull()
    // A safe specifier still resolves: the guard must not block valid names.
    expect(await read('@scope/pkg')).toEqual({ title: { en: 'scoped', zh: 'scoped' } })
  })

  it('never escapes node_modules through the module name', async () => {
    const fs = memoryFs({
      '/opt/fake-dsh/node_modules/@deepseek-ai/dsh-persona/locale/zh.json': zh('不应该被读到'),
      '/opt/secret/locale/zh.json': zh('越权'),
    })
    const read = createReadPackageMeta({ dshRoot: ROOT, fs })
    for (const unsafe of ['../secret', '@deepseek-ai/../../secret', '/opt/secret', '..%2fsecret']) {
      expect(await read(unsafe), unsafe).toBeNull()
    }
  })

  it('is disabled when no DSH installation root was detected', async () => {
    const read = readMetaFor(
      { [localePath('@deepseek-ai/dsh-persona', 'zh')]: zh('智能体角色设定') },
      null,
    )
    expect(await read('@deepseek-ai/dsh-persona')).toBeNull()
  })

  it('caches reads per module', async () => {
    const base = memoryFs({
      [localePath('@deepseek-ai/dsh-persona', 'zh')]: zh('智能体角色设定'),
      [localePath('@deepseek-ai/dsh-other', 'zh')]: zh('另一个插件'),
    })
    const reads: string[] = []
    const fs = {
      ...base,
      readFile: (path: string) => {
        reads.push(path)
        return base.readFile(path)
      },
    }
    const read = createReadPackageMeta({ dshRoot: ROOT, fs })
    const first = await read('@deepseek-ai/dsh-persona')
    const second = await read('@deepseek-ai/dsh-persona')
    expect(first).toEqual(second)
    expect(reads).toHaveLength(1)
    // A different module is read on demand.
    await read('@deepseek-ai/dsh-other')
    expect(reads).toHaveLength(2)
  })
})

describe('detectDshRoot', () => {
  it('finds an absolute `<…>/dsh` argument, including a trailing slash', () => {
    expect(detectDshRoot(['node', '/Applications/DSH.app/Resources/app.asar/dsh'], 'darwin')).toBe(
      '/Applications/DSH.app/Resources/app.asar/dsh',
    )
    expect(detectDshRoot(['node', '/opt/dsh/'], 'darwin')).toBe('/opt/dsh')
  })

  it('returns null for plain Node argv and relative paths', () => {
    expect(detectDshRoot(['node', './smoke.mjs'], 'darwin')).toBeNull()
    expect(detectDshRoot(['node', '/tmp/dsh/acp/dsh-acp-config'], 'darwin')).toBeNull()
    expect(detectDshRoot(['node'], 'darwin')).toBeNull()
  })
})
