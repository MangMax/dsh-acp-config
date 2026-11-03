// `dsh --profile <name> --dump-config` plus the narrow YAML reader for its
// output. The dump is a flat list of composed loader rows, so a full YAML
// parser (and its runtime dependency) is unnecessary: only row ids, module
// names, `disabled` state and scalar `config` keys are read here.
import { AcpConfigError, ERROR_CODES } from './errors.js'
import type { DumpOutcome, EngineDeps } from './ports.js'

/** Three-state enablement a composed row can express. */
export type DisabledState = 'true' | 'false' | 'dynamic'

/** One top-level composed row. */
export interface CompositionRow {
  /** Loader entry id (`patchId` for this profile). */
  id: string
  /** Module specifier the row imports. */
  moduleName: string
  /** `disabled: true|false`, or `dynamic` for a `!!js` expression. */
  disabled: DisabledState
  /** Scalar entries directly under the row's `config:`. */
  config: Record<string, string>
}

/** One agent preset the ACP composition declares (`preset-*` row). */
export interface PresetCandidate {
  id: string
  order: number
  /**
   * How many items the preset's `config.plugins` list declares at its own
   * nesting level (group rows count once; their children are separate deeper
   * items). Absent when the preset declares no readable `plugins:` list.
   */
  rowCount?: number
}

/** One plugin row an agent preset declares in the ACP composition. */
export interface PresetDeclaredRow {
  /** Composition row id the preset declares. */
  id: string
  /** Module specifier the declared row names (`''` when the dump omits it). */
  moduleName: string
  /** `disabled: true|false`, or `dynamic` for a `!!js` expression. */
  disabled: DisabledState
  /** Preset ids that declare this row, in dump order (the first one owns it). */
  declaredBy: string[]
}

/** Result of reading the composed ACP configuration. */
export interface Composition {
  rows: CompositionRow[]
  rowById: Map<string, CompositionRow>
  /** Row ids an agent preset declares, so switching them here would double-register. */
  presetIds: Set<string>
  /** Preset candidates ordered by `config.order`, then id. */
  presets: PresetCandidate[]
  /**
   * Plugin rows the presets declare, flattened in declaration order (group
   * children included). These are the rows the official page shows in its
   * "会话插件" group even when the page's own profile never loads them.
   */
  presetRows: PresetDeclaredRow[]
  /** `presetRows` indexed by row id. */
  presetRowById: Map<string, PresetDeclaredRow>
}

const ROW_START = /^- id:(.*)$/
const ROW_FIELD = /^  ([A-Za-z0-9_$-]+):(.*)$/
const CONFIG_SCALAR = /^    ([A-Za-z0-9_$@/.-]+):(.*)$/
const NESTED_ROW_ID = /^\s{6,}- id:(.*)$/
const NESTED_FIELD = /^(\s+)([A-Za-z0-9_$-]+):(.*)$/

/** Strip an inline `# comment`, then YAML quotes, then surrounding whitespace. */
export function scalar(raw: string): string {
  let value = raw
  let inSingle = false
  let inDouble = false
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "'" && !inDouble) inSingle = !inSingle
    else if (char === '"' && !inSingle) inDouble = !inDouble
    else if (
      char === '#' &&
      !inSingle &&
      !inDouble &&
      (index === 0 || /\s/.test(value[index - 1] ?? ''))
    ) {
      value = value.slice(0, index)
      break
    }
  }
  value = value.trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'")
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
  return value
}

/** Read a row's `disabled:` scalar into the three-state model. */
export function parseDisabled(raw: string): DisabledState {
  const value = raw.trim()
  if (value.startsWith('!!js')) return 'dynamic'
  if (value === 'true') return 'true'
  if (value === 'false') return 'false'
  // Unknown literal: treat as dynamic so the writer never assumes enablement.
  return 'dynamic'
}

/** A `config.plugins` item while the parser is reading its fields. */
interface PendingDeclared {
  row: PresetDeclaredRow
  indent: number
  /** `group: true` rows are structural; their children are the plugins. */
  group: boolean
}

/**
 * Parse the composed dump into rows, preset candidates and preset-managed ids.
 *
 * Tolerates comment banners (`# == …`), `!!js` expressions (including folded
 * ones), quoted scalars and blank lines; anything it cannot classify is skipped
 * rather than fatal, so a format drift degrades the page instead of breaking it.
 */
export function parseComposition(text: string): Composition {
  const rows: CompositionRow[] = []
  const presetIds = new Set<string>()
  const presetBlocks: Array<{ rowId: string; rowCount: number; declared: PresetDeclaredRow[] }> = []
  let current: CompositionRow | null = null
  let inConfig = false
  let inPresetPlugins = false
  let isPresetRow = false
  // Nested `plugins:` list state: the indent of its first item and the item
  // currently receiving `name:`/`disabled:`/`group:`.
  let nestedIndent: number | null = null
  let currentBlock: { rowId: string; declared: PendingDeclared[] } | null = null
  let currentNested: PendingDeclared | null = null

  const closeRow = () => {
    if (current !== null) rows.push(current)
    if (currentBlock !== null) {
      const items = currentBlock.declared
      presetBlocks.push({
        rowId: currentBlock.rowId,
        // Count plugins, not structural group wrappers: a group's children are
        // the rows the page actually lists.
        rowCount: items.filter((item) => !item.group).length,
        declared: items.filter((item) => !item.group).map((item) => item.row),
      })
    }
    current = null
    currentBlock = null
    currentNested = null
    inConfig = false
    inPresetPlugins = false
    isPresetRow = false
    nestedIndent = null
  }

  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue

    const start = ROW_START.exec(line)
    if (start !== null) {
      closeRow()
      const id = scalar(start[1] ?? '')
      if (id === '') continue
      current = { id, moduleName: '', disabled: 'false', config: {} }
      isPresetRow = id.startsWith('preset-')
      if (isPresetRow) currentBlock = { rowId: id, declared: [] }
      continue
    }

    // A different top-level list item ends the current row.
    if (line.startsWith('-') && !line.startsWith('- ')) {
      closeRow()
      continue
    }
    if (line.startsWith('- ') && !line.startsWith('- id:')) {
      // `- id:` with a folded/odd spelling still belongs to the row list.
      closeRow()
      continue
    }
    if (!line.startsWith(' ')) {
      closeRow()
      continue
    }
    if (current === null) continue

    const field = ROW_FIELD.exec(line)
    if (field !== null) {
      const key = field[1] ?? ''
      const rest = field[2] ?? ''
      const value = scalar(rest)
      inConfig = false
      inPresetPlugins = false
      currentNested = null
      if (key === 'name' && value !== '') current.moduleName = value
      else if (key === 'disabled' && value !== '') current.disabled = parseDisabled(value)
      else if (key === 'config' && value === '') inConfig = true
      continue
    }

    if (!inConfig) continue

    if (isPresetRow && inPresetPlugins) {
      const nested = NESTED_ROW_ID.exec(line)
      if (nested !== null) {
        const indent = line.length - line.trimStart().length
        if (nestedIndent === null) nestedIndent = indent
        const id = scalar(nested[1] ?? '')
        if (id === '') {
          currentNested = null
          continue
        }
        presetIds.add(id)
        const pending: PendingDeclared = {
          row: { id, moduleName: '', disabled: 'false', declaredBy: [] },
          indent,
          group: false,
        }
        // Group children (a deeper item) are plugin rows too: the official page
        // lists them, and `compositionInventory()` flattens them the same way.
        if (currentBlock !== null && indent >= (nestedIndent ?? indent)) {
          currentBlock.declared.push(pending)
        }
        currentNested = pending
        continue
      }

      // `name:` / `disabled:` / `group:` of the nested item itself.
      if (currentNested !== null) {
        const nestedField = NESTED_FIELD.exec(line)
        if (nestedField !== null) {
          const indent = (nestedField[1] ?? '').length
          if (indent === currentNested.indent + 2) {
            const key = nestedField[2] ?? ''
            const value = scalar(nestedField[3] ?? '')
            if (key === 'name' && value !== '') currentNested.row.moduleName = value
            else if (key === 'disabled' && value !== '') {
              currentNested.row.disabled = parseDisabled(value)
            } else if (key === 'group') {
              currentNested.group = value === 'true'
            }
            continue
          }
        }
      }
    }

    const config = CONFIG_SCALAR.exec(line)
    if (config !== null) {
      const key = config[1] ?? ''
      const rest = config[2] ?? ''
      const value = scalar(rest)
      if (value === '') {
        // `plugins:` opens the preset-managed subtree; any other empty value is
        // a nested structure this reader intentionally ignores.
        inPresetPlugins = isPresetRow && key === 'plugins'
      } else {
        current.config[key] = value
        inPresetPlugins = false
      }
    }
  }
  closeRow()

  const blockByRowId = new Map<string, { rowCount: number; declared: PresetDeclaredRow[] }>()
  for (const block of presetBlocks) blockByRowId.set(block.rowId, block)

  const presets: PresetCandidate[] = []
  for (const row of rows) {
    if (!row.id.startsWith('preset-')) continue
    const declared = row.config.id ?? row.id.slice('preset-'.length)
    if (declared === '') continue
    const parsedOrder = Number(row.config.order)
    const block = blockByRowId.get(row.id)
    const rowCount = block === undefined ? 0 : block.rowCount
    presets.push({
      id: declared,
      order: Number.isFinite(parsedOrder) ? parsedOrder : Number.MAX_SAFE_INTEGER,
      rowCount,
    })
  }
  presets.sort((left, right) =>
    left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order,
  )

  const rowById = new Map<string, CompositionRow>()
  for (const row of rows) rowById.set(row.id, row)

  // Flatten every preset's declared rows, keeping declaration order and
  // remembering every preset that declares the same row id.
  const presetRows: PresetDeclaredRow[] = []
  const presetRowById = new Map<string, PresetDeclaredRow>()
  for (const row of rows) {
    if (!row.id.startsWith('preset-')) continue
    const presetId = row.config.id ?? row.id.slice('preset-'.length)
    const block = blockByRowId.get(row.id)
    if (presetId === '' || block === undefined) continue
    for (const declared of block.declared) {
      const existing = presetRowById.get(declared.id)
      if (existing !== undefined) {
        if (!existing.declaredBy.includes(presetId)) existing.declaredBy.push(presetId)
        if (existing.moduleName === '' && declared.moduleName !== '') {
          existing.moduleName = declared.moduleName
        }
        continue
      }
      const copy: PresetDeclaredRow = {
        id: declared.id,
        moduleName: declared.moduleName,
        disabled: declared.disabled,
        declaredBy: [presetId],
      }
      presetRowById.set(copy.id, copy)
      presetRows.push(copy)
    }
  }

  return { rows, rowById, presetIds, presets, presetRows, presetRowById }
}

/** Run the dump for the engine's profile and parse it, or degrade with a reason. */
export async function readComposition(
  deps: EngineDeps,
  timeoutMs: number,
): Promise<{ outcome: DumpOutcome; composition: Composition | null }> {
  const outcome = await deps.runDump({ profile: deps.profileName, timeoutMs })
  if (!outcome.ok) return { outcome, composition: null }
  try {
    return { outcome, composition: parseComposition(outcome.text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      outcome: {
        ok: false,
        source: 'fallback',
        code: 'spawn',
        message: `dump parse failed: ${message}`,
      },
      composition: null,
    }
  }
}

/** Throw when the dump could not be read; used by save, which must not write blind. */
export function requireComposition(
  outcome: DumpOutcome,
  composition: Composition | null,
): Composition {
  if (composition !== null && outcome.ok) return composition
  const message = outcome.ok ? 'dump parse failed' : outcome.message
  throw new AcpConfigError(ERROR_CODES.dump, `ACP composition unavailable: ${message}`)
}
