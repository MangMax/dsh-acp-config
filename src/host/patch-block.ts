// The managed block: the only place this plugin writes inside the ACP profile's
// patch layer. Everything outside the marker pair is preserved byte for byte,
// writes are atomic (tmp + rename) with a one-time backup, and a concurrent
// external edit is detected through mtime + size and retried exactly once.
import { AcpConfigError, ERROR_CODES } from './errors.js'
import type { FsPort } from './ports.js'
import type { ProfilePaths } from './paths.js'

export const MANAGED_START = '# >>> dsh-acp-config:managed'
export const MANAGED_END = '# <<< dsh-acp-config:managed'

const START_LINE = /^# >>> dsh-acp-config:managed[^\r\n]*/m
const END_LINE = /^# <<< dsh-acp-config:managed[^\r\n]*/m
const ENTRY_ID = /^- id:(.*)$/
const ENTRY_DISABLED = /^  disabled:(.*)$/
const ENTRY_CONFIG = /^    ([A-Za-z0-9_$@/.-]+):(.*)$/

/** One row this page owns inside the managed block. */
export interface ManagedEntry {
  id: string
  /** `disabled` override for a plugin row; absent for config-only rows. */
  disabled?: 'true' | 'false'
  /** Scalar config entries; a value starting with `!!js ` is emitted verbatim. */
  config?: Record<string, string>
}

/** Fixed section order: preset registry, sandbox policy, approval, then plugin rows. */
const SECTION_ORDER: readonly string[] = ['agent-preset-registry', 'sandbox-policy', 'approval']

/** Config keys per known row, so a preserved entry re-serializes deterministically. */
const CONFIG_KEY_ORDER: Record<string, readonly string[]> = {
  'agent-preset-registry': ['default', 'selectedDefault'],
  'sandbox-policy': ['mode', 'workspaceRoot'],
  approval: ['policy'],
}

function trimQuotes(raw: string): string {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

/** Quote a YAML scalar only when the plain form would change its meaning. */
function quoteScalar(value: string): string {
  if (value.startsWith('!!js ')) return value
  // YAML literals: `selectedDefault: null` must stay null, never the string 'null'.
  if (value === 'null' || value === 'true' || value === 'false') return value
  const plain = /^[A-Za-z0-9_$@/.][A-Za-z0-9_$@/.:-]*$/
  const reserved = /^(true|false|null|yes|no|on|off|~)$/i
  if (plain.test(value) && !reserved.test(value)) return value
  return `'${value.replace(/'/g, "''")}'`
}

function configKeyOrder(id: string, keys: string[]): string[] {
  const known = CONFIG_KEY_ORDER[id] ?? []
  const ordered = known.filter((key) => keys.includes(key))
  const rest = keys.filter((key) => !known.includes(key)).sort()
  return [...ordered, ...rest]
}

/**
 * Serialize the managed block.
 *
 * Returns `''` when no entry remains: the caller then removes the block entirely
 * (markers included) instead of leaving an empty, meaningless section.
 */
export function serializeManagedBlock(entries: readonly ManagedEntry[]): string {
  const active = entries.filter((entry) => entry.id !== '')
  if (active.length === 0) return ''
  const ranked = active
    .map((entry) => {
      const section = SECTION_ORDER.indexOf(entry.id)
      return { entry, section: section === -1 ? SECTION_ORDER.length : section }
    })
    .sort((left, right) =>
      left.section === right.section
        ? left.entry.id.localeCompare(right.entry.id)
        : left.section - right.section,
    )
    .map((item) => item.entry)

  const lines: string[] = [
    `${MANAGED_START} (generated; edits inside this block are overwritten on save)`,
  ]
  for (const entry of ranked) {
    lines.push(`- id: ${quoteScalar(entry.id)}`)
    if (entry.disabled !== undefined) lines.push(`  disabled: ${entry.disabled}`)
    const config = entry.config ?? {}
    const keys = configKeyOrder(entry.id, Object.keys(config))
    if (keys.length > 0) {
      lines.push('  config:')
      for (const key of keys) lines.push(`    ${key}: ${quoteScalar(config[key] ?? '')}`)
    }
  }
  lines.push(MANAGED_END)
  return lines.join('\n') + '\n'
}

/** Locate the managed region; `null` when the file carries no markers. */
function findBlock(text: string): { start: number; end: number; inner: string } | null {
  const startMatch = START_LINE.exec(text)
  if (startMatch === null) {
    // A stray end marker without a start marker means the block was hand-edited;
    // writing around it would corrupt the file, so fail loudly instead.
    if (END_LINE.test(text)) {
      throw new AcpConfigError(ERROR_CODES.write, 'managed end marker without a start marker')
    }
    return null
  }
  const start = startMatch.index
  const afterStart = start + startMatch[0].length
  const rest = text.slice(afterStart)
  const endMatch = END_LINE.exec(rest)
  if (endMatch === null) {
    throw new AcpConfigError(ERROR_CODES.write, 'managed start marker without an end marker')
  }
  const endStart = afterStart + endMatch.index
  let end = endStart + endMatch[0].length
  if (text[end] === '\r' && text[end + 1] === '\n') end += 2
  else if (text[end] === '\n') end += 1
  return { start, end, inner: text.slice(afterStart, endStart) }
}

/** Parse the entries currently inside the managed block (empty when absent). */
export function parseManagedBlock(text: string): ManagedEntry[] {
  const block = findBlock(text)
  if (block === null) return []
  const entries: ManagedEntry[] = []
  let current: ManagedEntry | null = null
  let inConfig = false
  for (const line of block.inner.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue
    const id = ENTRY_ID.exec(line)
    if (id !== null) {
      current = { id: trimQuotes(id[1] ?? '') }
      if (current.id !== '') entries.push(current)
      else current = null
      inConfig = false
      continue
    }
    if (current === null) continue
    const disabled = ENTRY_DISABLED.exec(line)
    if (disabled !== null) {
      const value = trimQuotes(disabled[1] ?? '')
      if (value === 'true' || value === 'false') current.disabled = value
      inConfig = false
      continue
    }
    if (/^  config:[^\r\n]*$/.test(line)) {
      inConfig = true
      continue
    }
    if (!inConfig) continue
    const config = ENTRY_CONFIG.exec(line)
    if (config !== null) {
      const key = config[1] ?? ''
      if (key !== '') {
        current.config = current.config ?? {}
        current.config[key] = trimQuotes(config[2] ?? '')
      }
    }
  }
  return entries
}

/** Replace, insert or remove the managed block; every other byte stays as-is. */
export function applyManagedBlock(text: string, block: string): string {
  const existing = findBlock(text)
  if (existing === null) {
    if (block === '') return text
    if (text === '') return block
    return text.endsWith('\n') ? text + block : `${text}\n${block}`
  }
  return text.slice(0, existing.start) + block + text.slice(existing.end)
}

export interface WriteOutcome {
  /** True when the file content actually changed (idempotent saves write nothing). */
  changed: boolean
  /** Content written, or the current content when nothing needed writing. */
  text: string
}

/**
 * Read → transform → write, with conflict detection and one retry.
 *
 * The transformation is re-applied to freshly read content on retry, so a
 * concurrent edit by the user is merged rather than clobbered.
 */
export function writeManagedBlock(fs: FsPort, paths: ProfilePaths, block: string): WriteOutcome {
  let attempt = 0
  for (;;) {
    attempt += 1
    const exists = fs.existsFile(paths.patchPath)
    const before = fs.stat(paths.patchPath)
    const current = exists ? fs.readFile(paths.patchPath) : ''
    const next = applyManagedBlock(current, block)
    if (next === current) return { changed: false, text: current }

    const after = fs.stat(paths.patchPath)
    if (
      exists &&
      before !== null &&
      after !== null &&
      (after.mtimeMs !== before.mtimeMs || after.size !== before.size)
    ) {
      if (attempt >= 2) {
        throw new AcpConfigError(
          ERROR_CODES.conflict,
          'cordis.patch.yml changed while saving; retry',
        )
      }
      continue
    }

    writeAtomic(fs, paths, next, before === null ? undefined : before.mode & 0o777)
    return { changed: true, text: next }
  }
}

function writeAtomic(
  fs: FsPort,
  paths: ProfilePaths,
  text: string,
  mode: number | undefined,
): void {
  if (mode !== undefined && !fs.existsFile(paths.backupPath) && fs.existsFile(paths.patchPath)) {
    try {
      fs.copyFile(paths.patchPath, paths.backupPath)
    } catch {
      // A missing backup must not block the save; the atomic write still protects content.
    }
  }
  try {
    fs.writeFile(paths.tempPath, text, mode)
    if (mode !== undefined) fs.chmod(paths.tempPath, mode)
    fs.rename(paths.tempPath, paths.patchPath)
  } catch (error) {
    try {
      fs.unlink(paths.tempPath)
    } catch {
      /* nothing to clean up */
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new AcpConfigError(ERROR_CODES.write, `failed to write cordis.patch.yml: ${message}`)
  }
}

/** Compute which entry ids differ between the old and the new block. */
export function changedIds(
  before: readonly ManagedEntry[],
  after: readonly ManagedEntry[],
): string[] {
  const index = (entries: readonly ManagedEntry[]) => {
    const map = new Map<string, string>()
    for (const entry of entries) {
      const config = entry.config ?? {}
      const serializedConfig = Object.keys(config)
        .sort()
        .map((key) => `${key}=${config[key]}`)
        .join(';')
      map.set(entry.id, `${entry.disabled ?? ''}|${serializedConfig}`)
    }
    return map
  }
  const left = index(before)
  const right = index(after)
  const ids = new Set<string>([...left.keys(), ...right.keys()])
  const changed: string[] = []
  for (const id of ids) {
    if (left.get(id) !== right.get(id)) changed.push(id)
  }
  return changed.sort()
}
