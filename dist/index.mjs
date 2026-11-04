import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import * as fsSync from 'node:fs'
import { homedir } from 'node:os'
// src/host/errors.ts
const ERROR_CODES = {
  usage: 'E_USAGE',
  profile: 'E_PROFILE',
  dump: 'E_DUMP',
  conflict: 'E_CONFLICT',
  write: 'E_WRITE',
  internal: 'E_INTERNAL',
}
/** Business failure that carries a stable code instead of a stack trace. */
var AcpConfigError = class extends Error {
  code
  constructor(code, message) {
    super(message)
    this.name = 'AcpConfigError'
    this.code = code
  }
}
/** Build the wire failure payload (HTTP 200; only malformed envelopes get 400). */
function failure(code, message) {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  }
}
/** Map any thrown value onto a stable failure; unknown errors become E_INTERNAL. */
function failureOf(error) {
  if (error instanceof AcpConfigError) return failure(error.code, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return failure(ERROR_CODES.internal, message || 'unexpected failure')
}
// src/host/dump.ts
const ROW_START = /^- id:(.*)$/
const ROW_FIELD = /^  ([A-Za-z0-9_$-]+):(.*)$/
const CONFIG_SCALAR = /^    ([A-Za-z0-9_$@/.-]+):(.*)$/
const NESTED_ROW_ID = /^\s{6,}- id:(.*)$/
const NESTED_FIELD = /^(\s+)([A-Za-z0-9_$-]+):(.*)$/
/** Strip an inline `# comment`, then YAML quotes, then surrounding whitespace. */
function scalar(raw) {
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
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'")
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
    return value.slice(1, -1).replace(/\\"/g, '"')
  return value
}
/** Read a row's `disabled:` scalar into the three-state model. */
function parseDisabled(raw) {
  const value = raw.trim()
  if (value.startsWith('!!js')) return 'dynamic'
  if (value === 'true') return 'true'
  if (value === 'false') return 'false'
  return 'dynamic'
}
/**
 * Parse the composed dump into rows, preset candidates and preset-managed ids.
 *
 * Tolerates comment banners (`# == …`), `!!js` expressions (including folded
 * ones), quoted scalars and blank lines; anything it cannot classify is skipped
 * rather than fatal, so a format drift degrades the page instead of breaking it.
 */
function parseComposition(text) {
  const rows = []
  const presetIds = /* @__PURE__ */ new Set()
  const presetBlocks = []
  let current = null
  let inConfig = false
  let inPresetPlugins = false
  let isPresetRow = false
  let nestedIndent = null
  let currentBlock = null
  let currentNested = null
  const closeRow = () => {
    if (current !== null) rows.push(current)
    if (currentBlock !== null) {
      const items = currentBlock.declared
      presetBlocks.push({
        rowId: currentBlock.rowId,
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
      current = {
        id,
        moduleName: '',
        disabled: 'false',
        config: {},
      }
      isPresetRow = id.startsWith('preset-')
      if (isPresetRow)
        currentBlock = {
          rowId: id,
          declared: [],
        }
      continue
    }
    if (line.startsWith('-') && !line.startsWith('- ')) {
      closeRow()
      continue
    }
    if (line.startsWith('- ') && !line.startsWith('- id:')) {
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
      const value = scalar(field[2] ?? '')
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
        const pending = {
          row: {
            id,
            moduleName: '',
            disabled: 'false',
            declaredBy: [],
          },
          indent,
          group: false,
        }
        if (currentBlock !== null && indent >= (nestedIndent ?? indent))
          currentBlock.declared.push(pending)
        currentNested = pending
        continue
      }
      if (currentNested !== null) {
        const nestedField = NESTED_FIELD.exec(line)
        if (nestedField !== null) {
          if ((nestedField[1] ?? '').length === currentNested.indent + 2) {
            const key = nestedField[2] ?? ''
            const value = scalar(nestedField[3] ?? '')
            if (key === 'name' && value !== '') currentNested.row.moduleName = value
            else if (key === 'disabled' && value !== '')
              currentNested.row.disabled = parseDisabled(value)
            else if (key === 'group') currentNested.group = value === 'true'
            continue
          }
        }
      }
    }
    const config = CONFIG_SCALAR.exec(line)
    if (config !== null) {
      const key = config[1] ?? ''
      const value = scalar(config[2] ?? '')
      if (value === '') inPresetPlugins = isPresetRow && key === 'plugins'
      else {
        current.config[key] = value
        inPresetPlugins = false
      }
    }
  }
  closeRow()
  const blockByRowId = /* @__PURE__ */ new Map()
  for (const block of presetBlocks) blockByRowId.set(block.rowId, block)
  const presets = []
  for (const row of rows) {
    if (!row.id.startsWith('preset-')) continue
    const declared = row.config.id ?? row.id.slice(7)
    if (declared === '') continue
    const parsedOrder = Number(row.config.order)
    const block = blockByRowId.get(row.id)
    const rowCount = block === void 0 ? 0 : block.rowCount
    presets.push({
      id: declared,
      order: Number.isFinite(parsedOrder) ? parsedOrder : Number.MAX_SAFE_INTEGER,
      rowCount,
    })
  }
  presets.sort((left, right) =>
    left.order === right.order ? left.id.localeCompare(right.id) : left.order - right.order,
  )
  const rowById = /* @__PURE__ */ new Map()
  for (const row of rows) rowById.set(row.id, row)
  const presetRows = []
  const presetRowById = /* @__PURE__ */ new Map()
  for (const row of rows) {
    if (!row.id.startsWith('preset-')) continue
    const presetId = row.config.id ?? row.id.slice(7)
    const block = blockByRowId.get(row.id)
    if (presetId === '' || block === void 0) continue
    for (const declared of block.declared) {
      const existing = presetRowById.get(declared.id)
      if (existing !== void 0) {
        if (!existing.declaredBy.includes(presetId)) existing.declaredBy.push(presetId)
        if (existing.moduleName === '' && declared.moduleName !== '')
          existing.moduleName = declared.moduleName
        continue
      }
      const copy = {
        id: declared.id,
        moduleName: declared.moduleName,
        disabled: declared.disabled,
        declaredBy: [presetId],
      }
      presetRowById.set(copy.id, copy)
      presetRows.push(copy)
    }
  }
  return {
    rows,
    rowById,
    presetIds,
    presets,
    presetRows,
    presetRowById,
  }
}
/** Run the dump for the engine's profile and parse it, or degrade with a reason. */
async function readComposition(deps, timeoutMs) {
  const outcome = await deps.runDump({
    profile: deps.profileName,
    timeoutMs,
  })
  if (!outcome.ok)
    return {
      outcome,
      composition: null,
    }
  try {
    return {
      outcome,
      composition: parseComposition(outcome.text),
    }
  } catch (error) {
    return {
      outcome: {
        ok: false,
        source: 'fallback',
        code: 'spawn',
        message: `dump parse failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      composition: null,
    }
  }
}
/** Throw when the dump could not be read; used by save, which must not write blind. */
function requireComposition(outcome, composition) {
  if (composition !== null && outcome.ok) return composition
  const message = outcome.ok ? 'dump parse failed' : outcome.message
  throw new AcpConfigError(ERROR_CODES.dump, `ACP composition unavailable: ${message}`)
}
// src/host/patch-block.ts
const MANAGED_START = '# >>> dsh-acp-config:managed'
const MANAGED_END = '# <<< dsh-acp-config:managed'
const START_LINE = /^# >>> dsh-acp-config:managed[^\r\n]*/m
const END_LINE = /^# <<< dsh-acp-config:managed[^\r\n]*/m
const ENTRY_ID = /^- id:(.*)$/
const ENTRY_DISABLED = /^  disabled:(.*)$/
const ENTRY_CONFIG = /^    ([A-Za-z0-9_$@/.-]+):(.*)$/
/** Fixed section order: preset registry, sandbox policy, approval, then plugin rows. */
const SECTION_ORDER = ['agent-preset-registry', 'sandbox-policy', 'approval']
/** Config keys per known row, so a preserved entry re-serializes deterministically. */
const CONFIG_KEY_ORDER = {
  'agent-preset-registry': ['default', 'selectedDefault'],
  'sandbox-policy': ['mode', 'workspaceRoot'],
  approval: ['policy'],
}
function trimQuotes(raw) {
  const value = raw.trim()
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'"))
    return value.slice(1, -1).replace(/''/g, "'")
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"'))
    return value.slice(1, -1).replace(/\\"/g, '"')
  return value
}
/** Quote a YAML scalar only when the plain form would change its meaning. */
function quoteScalar(value) {
  if (value.startsWith('!!js ')) return value
  if (value === 'null' || value === 'true' || value === 'false') return value
  if (
    /^[A-Za-z0-9_$@/.][A-Za-z0-9_$@/.:-]*$/.test(value) &&
    !/^(true|false|null|yes|no|on|off|~)$/i.test(value)
  )
    return value
  return `'${value.replace(/'/g, "''")}'`
}
function configKeyOrder(id, keys) {
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
function serializeManagedBlock(entries) {
  const active = entries.filter((entry) => entry.id !== '')
  if (active.length === 0) return ''
  const ranked = active
    .map((entry) => {
      const section = SECTION_ORDER.indexOf(entry.id)
      return {
        entry,
        section: section === -1 ? SECTION_ORDER.length : section,
      }
    })
    .sort((left, right) =>
      left.section === right.section
        ? left.entry.id.localeCompare(right.entry.id)
        : left.section - right.section,
    )
    .map((item) => item.entry)
  const lines = [`${MANAGED_START} (generated; edits inside this block are overwritten on save)`]
  for (const entry of ranked) {
    lines.push(`- id: ${quoteScalar(entry.id)}`)
    if (entry.disabled !== void 0) lines.push(`  disabled: ${entry.disabled}`)
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
function findBlock(text) {
  const startMatch = START_LINE.exec(text)
  if (startMatch === null) {
    if (END_LINE.test(text))
      throw new AcpConfigError(ERROR_CODES.write, 'managed end marker without a start marker')
    return null
  }
  const start = startMatch.index
  const afterStart = start + startMatch[0].length
  const rest = text.slice(afterStart)
  const endMatch = END_LINE.exec(rest)
  if (endMatch === null)
    throw new AcpConfigError(ERROR_CODES.write, 'managed start marker without an end marker')
  const endStart = afterStart + endMatch.index
  let end = endStart + endMatch[0].length
  if (text[end] === '\r' && text[end + 1] === '\n') end += 2
  else if (text[end] === '\n') end += 1
  return {
    start,
    end,
    inner: text.slice(afterStart, endStart),
  }
}
/** Parse the entries currently inside the managed block (empty when absent). */
function parseManagedBlock(text) {
  const block = findBlock(text)
  if (block === null) return []
  const entries = []
  let current = null
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
function applyManagedBlock(text, block) {
  const existing = findBlock(text)
  if (existing === null) {
    if (block === '') return text
    if (text === '') return block
    return text.endsWith('\n') ? text + block : `${text}\n${block}`
  }
  return text.slice(0, existing.start) + block + text.slice(existing.end)
}
/**
 * Read → transform → write, with conflict detection and one retry.
 *
 * The transformation is re-applied to freshly read content on retry, so a
 * concurrent edit by the user is merged rather than clobbered.
 */
function writeManagedBlock(fs, paths, block) {
  let attempt = 0
  for (;;) {
    attempt += 1
    const exists = fs.existsFile(paths.patchPath)
    const before = fs.stat(paths.patchPath)
    const current = exists ? fs.readFile(paths.patchPath) : ''
    const next = applyManagedBlock(current, block)
    if (next === current)
      return {
        changed: false,
        text: current,
      }
    const after = fs.stat(paths.patchPath)
    if (
      exists &&
      before !== null &&
      after !== null &&
      (after.mtimeMs !== before.mtimeMs || after.size !== before.size)
    ) {
      if (attempt >= 2)
        throw new AcpConfigError(
          ERROR_CODES.conflict,
          'cordis.patch.yml changed while saving; retry',
        )
      continue
    }
    writeAtomic(fs, paths, next, before === null ? void 0 : before.mode & 511)
    return {
      changed: true,
      text: next,
    }
  }
}
function writeAtomic(fs, paths, text, mode) {
  if (mode !== void 0 && !fs.existsFile(paths.backupPath) && fs.existsFile(paths.patchPath))
    try {
      fs.copyFile(paths.patchPath, paths.backupPath)
    } catch {}
  try {
    fs.writeFile(paths.tempPath, text, mode)
    if (mode !== void 0) fs.chmod(paths.tempPath, mode)
    fs.rename(paths.tempPath, paths.patchPath)
  } catch (error) {
    try {
      fs.unlink(paths.tempPath)
    } catch {}
    const message = error instanceof Error ? error.message : String(error)
    throw new AcpConfigError(ERROR_CODES.write, `failed to write cordis.patch.yml: ${message}`)
  }
}
/** Compute which entry ids differ between the old and the new block. */
function changedIds(before, after) {
  const index = (entries) => {
    const map = /* @__PURE__ */ new Map()
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
  const ids = /* @__PURE__ */ new Set([...left.keys(), ...right.keys()])
  const changed = []
  for (const id of ids) if (left.get(id) !== right.get(id)) changed.push(id)
  return changed.sort()
}
// src/host/paths.ts
/** Profile names accepted by the DSH loader (no separators, no `.`/`..`). */
const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PATCH_FILE = 'cordis.patch.yml'
const STATE_FILE = '.dsh-acp-config.json'
const BACKUP_SUFFIX = '.dsh-acp-config.bak'
const TEMP_SUFFIX = '.dsh-acp-config.tmp'
/** Throw `E_PROFILE` unless `name` is a safe single path segment. */
function assertProfileName(name) {
  if (typeof name !== 'string' || !PROFILE_NAME.test(name) || name.length > 64)
    throw new AcpConfigError(ERROR_CODES.profile, `invalid profile name: ${JSON.stringify(name)}`)
  return name
}
/** Build every path the engine touches for one profile. */
function resolveProfilePaths(homeDir, profileName) {
  const name = assertProfileName(profileName)
  const dir = join(homeDir, 'profiles', name)
  const patchPath = join(dir, PATCH_FILE)
  return {
    homeDir,
    name,
    dir,
    patchPath,
    statePath: join(dir, STATE_FILE),
    backupPath: patchPath + BACKUP_SUFFIX,
    tempPath: patchPath + TEMP_SUFFIX,
  }
}
/** True when `child` is `parent` itself or lies below it (both already absolute). */
function isInside(parent, child) {
  const base = parent.endsWith(sep) ? parent : parent + sep
  return child === parent || child.startsWith(base)
}
/**
 * Resolve `target`'s real location and require it to stay inside the profile.
 * For a file that does not exist yet the nearest existing ancestor is checked,
 * which is exactly the directory the atomic write will create the temp file in.
 */
function assertInsideProfile(fs, profileDir, target) {
  let realProfile
  try {
    realProfile = fs.realpath(profileDir)
  } catch {
    throw new AcpConfigError(
      ERROR_CODES.profile,
      `profile directory is not readable: ${profileDir}`,
    )
  }
  let realTarget
  try {
    realTarget = fs.realpath(target)
  } catch {
    let parent = dirname(target)
    for (;;)
      try {
        realTarget = join(fs.realpath(parent), target.slice(parent.length))
        break
      } catch {
        const next = dirname(parent)
        if (next === parent)
          throw new AcpConfigError(
            ERROR_CODES.profile,
            `write target escapes the profile: ${target}`,
          )
        parent = next
      }
  }
  if (!isInside(realProfile, realTarget))
    throw new AcpConfigError(ERROR_CODES.profile, `write target escapes the profile: ${target}`)
}
/** Read `dsh.profile.bundles` from the profile's own `package.json`. */
function readProfileBundles(fs, profileDir) {
  const manifest = join(profileDir, 'package.json')
  if (!fs.existsFile(manifest)) return []
  try {
    const parsed = JSON.parse(fs.readFile(manifest))
    if (typeof parsed !== 'object' || parsed === null) return []
    const dsh = parsed.dsh
    if (typeof dsh !== 'object' || dsh === null) return []
    const profile = dsh.profile
    if (typeof profile !== 'object' || profile === null) return []
    const bundles = profile.bundles
    if (!Array.isArray(bundles)) return []
    return bundles.filter((entry) => typeof entry === 'string')
  } catch {
    return []
  }
}
// src/host/state.ts
const PLUGIN_MODES$1 = ['inherit', 'on', 'off']
const SANDBOX_MODES$3 = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS$3 = ['ask', 'never']
function emptyState(profile) {
  return {
    version: 1,
    savedAt: null,
    profile,
    plugins: {},
    agentMode: null,
    sandboxMode: null,
  }
}
function isRecord$2(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/** Read a persisted agent-preset choice; `undefined` when missing or unusable. */
function readAgentChoice(raw, warnings) {
  if (raw === void 0) return void 0
  if (!isRecord$2(raw)) {
    warnings.push('state file has a non-object agentModeChoice; using the ACP default')
    return
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'preset') {
    if (typeof raw.id === 'string' && raw.id !== '')
      return {
        mode: 'preset',
        id: raw.id,
      }
    warnings.push('state file has a preset agentModeChoice without an id; using the ACP default')
    return
  }
  warnings.push(
    `state file has unknown agentModeChoice mode ${JSON.stringify(mode)}; using the ACP default`,
  )
}
/** Read a persisted sandbox choice; `undefined` when missing or unusable. */
function readSandboxChoice(raw, warnings) {
  if (raw === void 0) return void 0
  if (!isRecord$2(raw)) {
    warnings.push('state file has a non-object sandboxChoice; using the ACP default')
    return
  }
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'sandbox') {
    if (typeof raw.sandbox === 'string' && SANDBOX_MODES$3.includes(raw.sandbox))
      return {
        mode: 'sandbox',
        sandbox: raw.sandbox,
      }
    warnings.push('state file has a sandboxChoice with an unknown mode; using the ACP default')
    return
  }
  warnings.push(
    `state file has unknown sandboxChoice mode ${JSON.stringify(mode)}; using the ACP default`,
  )
}
function readSandboxMode(raw, label, warnings) {
  if (raw === void 0 || raw === null) return void 0
  if (typeof raw === 'string' && SANDBOX_MODES$3.includes(raw)) return raw
  warnings.push(`state file has unknown ${label} ${JSON.stringify(raw)}; ignoring it`)
}
/**
 * Read the persisted Web-side permission **preset name**.
 *
 * Preset names are open-ended (`auto`, `custom`, and whatever the deployment
 * configures), so any non-empty string is accepted. Files written before the
 * preset-name semantics stored a sandbox mode there; those values are valid
 * preset names too (`read-only` / `workspace-write` / `danger-full-access`),
 * which is exactly why the old shape stays readable.
 */
function readPermissionPreset(raw, label, warnings) {
  if (raw === void 0 || raw === null) return void 0
  if (typeof raw === 'string' && raw !== '') return raw
  warnings.push(`state file has an unusable ${label} ${JSON.stringify(raw)}; ignoring it`)
}
/** Read a persisted approval policy; `undefined` when missing or unusable. */
function readApproval(raw, label, warnings) {
  if (raw === void 0 || raw === null) return void 0
  if (typeof raw === 'string' && APPROVALS$3.includes(raw)) return raw
  warnings.push(`state file has unknown ${label} ${JSON.stringify(raw)}; ignoring it`)
}
/** Read state; missing file → empty state silently, corrupt file → empty + warning. */
function readState(fs, paths) {
  const warnings = []
  if (!fs.existsFile(paths.statePath))
    return {
      state: emptyState(paths.name),
      warnings,
    }
  let parsed
  try {
    parsed = JSON.parse(fs.readFile(paths.statePath))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    warnings.push(`state file is not valid JSON (${message}); starting from empty state`)
    return {
      state: emptyState(paths.name),
      warnings,
    }
  }
  if (!isRecord$2(parsed)) {
    warnings.push('state file is not a JSON object; starting from empty state')
    return {
      state: emptyState(paths.name),
      warnings,
    }
  }
  const state = emptyState(paths.name)
  if (parsed.version !== 1) {
    warnings.push(
      `state file has unsupported version ${JSON.stringify(parsed.version)}; starting from empty state`,
    )
    return {
      state,
      warnings,
    }
  }
  if (typeof parsed.savedAt === 'string') state.savedAt = parsed.savedAt
  if (typeof parsed.profile === 'string') state.profile = parsed.profile
  if (typeof parsed.agentMode === 'string' && parsed.agentMode !== '')
    state.agentMode = parsed.agentMode
  const sandbox = parsed.sandboxMode
  if (typeof sandbox === 'string' && SANDBOX_MODES$3.includes(sandbox)) state.sandboxMode = sandbox
  else if (sandbox !== null && sandbox !== void 0)
    warnings.push(`state file has unknown sandboxMode ${JSON.stringify(sandbox)}; ignoring it`)
  const agentChoice = readAgentChoice(parsed.agentModeChoice, warnings)
  if (agentChoice !== void 0) state.agentModeChoice = agentChoice
  const sandboxChoice = readSandboxChoice(parsed.sandboxChoice, warnings)
  if (sandboxChoice !== void 0) state.sandboxChoice = sandboxChoice
  if (typeof parsed.agentModeWeb === 'string' && parsed.agentModeWeb !== '')
    state.agentModeWeb = parsed.agentModeWeb
  const sandboxWeb = readPermissionPreset(parsed.sandboxWeb, 'sandboxWeb', warnings)
  if (sandboxWeb !== void 0) state.sandboxWeb = sandboxWeb
  if (typeof parsed.agentModeBase === 'string' && parsed.agentModeBase !== '')
    state.agentModeBase = parsed.agentModeBase
  const sandboxBase = readSandboxMode(parsed.sandboxBase, 'sandboxBase', warnings)
  if (sandboxBase !== void 0) state.sandboxBase = sandboxBase
  const approvalBase = readApproval(parsed.sandboxApprovalBase, 'sandboxApprovalBase', warnings)
  if (approvalBase !== void 0) state.sandboxApprovalBase = approvalBase
  if (isRecord$2(parsed.base)) {
    const base = {}
    for (const [id, value] of Object.entries(parsed.base))
      if (typeof value === 'boolean') base[id] = value
    state.base = base
  }
  if (isRecord$2(parsed.plugins))
    for (const [id, value] of Object.entries(parsed.plugins)) {
      if (!isRecord$2(value)) continue
      const mode = value.mode
      if (typeof mode !== 'string' || !PLUGIN_MODES$1.includes(mode)) {
        warnings.push(`state file has unknown mode for ${id}; treating as inherit`)
        state.plugins[id] = {
          mode: 'inherit',
          ...(typeof value.web === 'boolean' ? { web: value.web } : {}),
        }
        continue
      }
      state.plugins[id] = {
        mode,
        ...(typeof value.web === 'boolean' ? { web: value.web } : {}),
      }
    }
  else if (parsed.plugins !== void 0)
    warnings.push('state file has a non-object plugins field; ignoring it')
  return {
    state,
    warnings,
  }
}
/** Write state atomically, refusing any path that escapes the profile. */
function writeState(fs, paths, state) {
  assertInsideProfile(fs, paths.dir, paths.statePath)
  const body = JSON.stringify(state, null, 2) + '\n'
  const temp = paths.statePath + '.tmp'
  try {
    fs.writeFile(temp, body)
    fs.rename(temp, paths.statePath)
  } catch (error) {
    try {
      fs.unlink(temp)
    } catch {}
    const message = error instanceof Error ? error.message : String(error)
    throw new AcpConfigError(ERROR_CODES.write, `failed to write state file: ${message}`)
  }
}
// src/host/status.ts
/** Host rows ACP's own bundle layout owns; the page must never rewrite them. */
const INFRA_IDS = [
  'hmr',
  'session-title-llm',
  'plugin-manager',
  'tool-plugin-manager',
  'config-editor',
  'settings',
  'remote-access',
  'typert',
  'typert-loader',
  'typert-gateway',
]
const SANDBOX_MODES$2 = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS$2 = ['ask', 'never']
/** Normalize `string | {en, …}` display metadata into `LocalizedText`. */
function toLocalized(value) {
  if (typeof value === 'string') return value === '' ? void 0 : { en: value }
  if (value === void 0 || value === null) return void 0
  const en = typeof value.en === 'string' ? value.en : void 0
  if (en !== void 0 && en !== '')
    return {
      ...value,
      en,
    }
  const first = Object.values(value).find((entry) => typeof entry === 'string' && entry !== '')
  return first === void 0 ? void 0 : { en: first }
}
/** Read one known literal out of a `!!js` expression (only when unambiguous). */
function singleLiteral(expression, allowed) {
  const literals = /* @__PURE__ */ new Set()
  for (const match of expression.matchAll(/'([^']*)'/g)) {
    const literal = match[1] ?? ''
    if (allowed.includes(literal)) literals.add(literal)
  }
  return literals.size === 1 ? ([...literals][0] ?? null) : null
}
/** Resolve a scalar that may be a literal or a `!!js` expression. */
function resolveScalar(raw, allowed) {
  if (raw === void 0 || raw === '')
    return {
      value: null,
      dynamic: false,
    }
  if (!raw.startsWith('!!js'))
    return {
      value: raw,
      dynamic: false,
    }
  return {
    value: singleLiteral(raw, allowed),
    dynamic: true,
  }
}
/** The `presetName` payload: the preset id, which the page localizes. */
function presetNameOf(id, options, fallback) {
  const owner = options.presetByRowId?.get(id) ?? fallback?.[0]
  if (owner === void 0 || owner === '') return void 0
  return {
    en: owner,
    zh: owner,
  }
}
/**
 * Merge one row's display metadata: the live plugin list wins field by field,
 * the package locale fills whatever it left out.
 */
function displayOf(info, moduleName, options) {
  const liveTitle = toLocalized(info?.title)
  const liveDescription = toLocalized(info?.description)
  const fromPackage = moduleName === '' ? void 0 : options.packageMeta?.get(moduleName)
  const title = liveTitle ?? fromPackage?.title
  const description = liveDescription ?? fromPackage?.description
  return {
    ...(title === void 0 ? {} : { title }),
    ...(description === void 0 ? {} : { description }),
  }
}
/** The details table's run-state cell, when the live entry reports a phase. */
function fiberOf(info) {
  const phase = info?.fiberPhase
  return typeof phase === 'string' && phase !== '' ? { webFiber: phase } : {}
}
/** Merge ACP rows with the live Web rows exactly as DESIGN section 5 describes. */
function buildRowModel(composition, webPlugins, state, options = {}) {
  const acpRows = composition?.rowById ?? /* @__PURE__ */ new Map()
  const presetIds = composition?.presetIds ?? /* @__PURE__ */ new Set()
  const infra = new Set(INFRA_IDS)
  const usedWeb = /* @__PURE__ */ new Set()
  const webByPatchId = /* @__PURE__ */ new Map()
  const webByModule = /* @__PURE__ */ new Map()
  for (const info of webPlugins) {
    if (info.patchId !== void 0 && info.patchId !== '') webByPatchId.set(info.patchId, info)
    const list = webByModule.get(info.moduleName)
    if (list === void 0) webByModule.set(info.moduleName, [info])
    else list.push(info)
  }
  const webInfoFor = (row) => {
    const byPatchId = webByPatchId.get(row.id)
    if (byPatchId !== void 0) return byPatchId
    return webByModule.get(row.moduleName)?.[0]
  }
  const rows = []
  const byId = /* @__PURE__ */ new Map()
  const webState = (info) => (info === void 0 ? 'absent' : info.enabled ? 'on' : 'off')
  for (const acpRow of acpRows.values()) {
    const webInfo = webInfoFor(acpRow)
    if (webInfo !== void 0) usedWeb.add(webInfo)
    const web = webState(webInfo)
    const stored = state.plugins[acpRow.id]
    const mode = stored?.mode ?? 'inherit'
    const drift =
      mode === 'inherit' &&
      web !== 'absent' &&
      typeof stored?.web === 'boolean' &&
      stored.web !== (web === 'on')
    let locked
    if (presetIds.has(acpRow.id)) locked = 'preset-managed'
    else if (infra.has(acpRow.id)) locked = 'infra'
    else if (web === 'absent') locked = 'acp-only'
    const group = presetIds.has(acpRow.id) ? 'session' : 'global'
    const presetName = group === 'session' ? presetNameOf(acpRow.id, options) : void 0
    const display = displayOf(webInfo, acpRow.moduleName, options)
    const view = {
      id: acpRow.id,
      group,
      moduleName: acpRow.moduleName,
      web,
      acp: acpRow.disabled === 'true' ? 'off' : acpRow.disabled === 'dynamic' ? 'dynamic' : 'on',
      mode,
      drift,
      ...(locked === void 0 ? {} : { locked }),
      ...(presetName === void 0 ? {} : { presetName }),
      ...fiberOf(webInfo),
      ...display,
    }
    rows.push(view)
    byId.set(view.id, view)
  }
  for (const declared of composition?.presetRows ?? []) {
    if (byId.has(declared.id)) continue
    const moduleName = declared.moduleName === '' ? declared.id : declared.moduleName
    const webInfo = webInfoFor({
      id: declared.id,
      moduleName,
    })
    if (webInfo !== void 0) usedWeb.add(webInfo)
    const stored = state.plugins[declared.id]
    const presetName = presetNameOf(declared.id, options, declared.declaredBy)
    const display = displayOf(webInfo, moduleName, options)
    const view = {
      id: declared.id,
      group: 'session',
      moduleName,
      web: webState(webInfo),
      acp:
        declared.disabled === 'true' ? 'off' : declared.disabled === 'dynamic' ? 'dynamic' : 'on',
      mode: stored?.mode ?? 'inherit',
      locked: 'preset-managed',
      drift: false,
      ...(presetName === void 0 ? {} : { presetName }),
      ...fiberOf(webInfo),
      ...display,
    }
    rows.push(view)
    byId.set(view.id, view)
  }
  const webOnly = webPlugins
    .filter((info) => !usedWeb.has(info))
    .map((info) => {
      const id = info.patchId !== void 0 && info.patchId !== '' ? info.patchId : info.moduleName
      const display = displayOf(info, info.moduleName, options)
      return {
        info,
        view: {
          id,
          group: 'global',
          moduleName: info.moduleName,
          web: webState(info),
          acp: 'absent',
          mode: state.plugins[id]?.mode ?? 'inherit',
          locked: info.patchId === void 0 ? 'unaddressable' : 'not-in-acp',
          drift: false,
          ...fiberOf(info),
          ...display,
        },
      }
    })
    .sort((left, right) => left.view.moduleName.localeCompare(right.view.moduleName))
  for (const item of webOnly) {
    if (byId.has(item.view.id)) continue
    rows.push(item.view)
    byId.set(item.view.id, item.view)
  }
  return {
    rows,
    byId,
    acpRows,
  }
}
/**
 * Map every session row id to the first preset that declares it.
 *
 * `compositionInventory()` is the live answer (it knows which preset a row came
 * from at runtime); the ACP dump's own preset declarations are the fallback for
 * rows the live roster does not list.
 */
function presetOwners(inventory, composition) {
  const owners = /* @__PURE__ */ new Map()
  for (const preset of inventory) {
    if (typeof preset.id !== 'string' || preset.id === '') continue
    for (const row of preset.rows ?? []) {
      const entryId = row.entryId
      if (typeof entryId === 'string' && entryId !== '' && !owners.has(entryId))
        owners.set(entryId, preset.id)
    }
  }
  for (const declared of composition?.presetRows ?? []) {
    if (owners.has(declared.id)) continue
    const first = declared.declaredBy[0]
    if (first !== void 0 && first !== '') owners.set(declared.id, first)
  }
  return owners
}
/** Read `agentPresets.compositionInventory()`; `[]` when unavailable. */
async function loadPresetInventory(web) {
  if (web?.compositionInventory === void 0) return []
  try {
    const inventory = await web.compositionInventory()
    return Array.isArray(inventory) ? inventory : []
  } catch {
    return []
  }
}
/**
 * Read package-locale metadata for the rows the live plugin list left blank.
 *
 * Only modules that are missing at least one field are read, one read per
 * module, and a failure is simply "still unknown" — the page then shows the id.
 */
async function loadPackageMeta(rows, readPackageMeta) {
  if (readPackageMeta === void 0) return void 0
  const missing = /* @__PURE__ */ new Set()
  for (const row of rows) {
    if (row.title !== void 0 && row.description !== void 0) continue
    if (row.moduleName === '') continue
    missing.add(row.moduleName)
  }
  if (missing.size === 0) return void 0
  const results = await Promise.all(
    [...missing].map(async (moduleName) => {
      try {
        return [moduleName, await readPackageMeta(moduleName)]
      } catch {
        return [moduleName, null]
      }
    }),
  )
  const found = /* @__PURE__ */ new Map()
  for (const [moduleName, meta] of results)
    if (meta !== null && meta !== void 0) found.set(moduleName, meta)
  return found.size === 0 ? void 0 : found
}
/** Read `preset-*` candidates and enrich them with the live profile's titles. */
async function loadPresets(composition, web) {
  const warnings = []
  const candidates = composition?.presets ?? []
  if (candidates.length === 0)
    return {
      presets: [],
      warnings,
    }
  let meta = []
  if (web?.listPresets !== void 0)
    try {
      meta = await web.listPresets()
    } catch (error) {
      warnings.push(
        `preset metadata unavailable: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  return {
    presets: candidates.map((candidate) => {
      const match = meta.find((entry) => entry.id === candidate.id)
      const title = toLocalized(match?.name)
      const description = toLocalized(match?.description)
      return {
        id: candidate.id,
        ...(title === void 0 ? {} : { title }),
        ...(description === void 0 ? {} : { description }),
        ...(candidate.rowCount === void 0 ? {} : { rowCount: candidate.rowCount }),
      }
    }),
    warnings,
  }
}
/** Describe the ACP profile itself (existence, paths, declared bundles). */
function buildAcpInfo(fs, paths, profileName) {
  return {
    name: profileName,
    dir: paths.dir,
    exists: fs.existsDir(paths.dir),
    patchPath: paths.patchPath,
    bundles: readProfileBundles(fs, paths.dir),
  }
}
/** Build the full status payload. Never throws for a degraded dump. */
async function buildStatus(input) {
  const warnings = [...input.stateWarnings]
  const degraded = !input.outcome.ok
  if (degraded) {
    const message = input.outcome.ok ? '' : input.outcome.message
    warnings.push(`ACP composition unavailable (${message}); plugin states are read-only guesses`)
  }
  if (input.deps.web === void 0)
    warnings.push(
      'live plugin state of this profile is unavailable (engine runs without a Cord context)',
    )
  const acp = buildAcpInfo(input.deps.fs, input.paths, input.profileName)
  const presetByRowId = presetOwners(await loadPresetInventory(input.deps.web), input.composition)
  const firstPass = buildRowModel(input.composition, input.webPlugins, input.state, {
    presetByRowId,
  })
  const packageMeta = await loadPackageMeta(firstPass.rows, input.deps.readPackageMeta)
  const model =
    packageMeta === void 0
      ? firstPass
      : buildRowModel(input.composition, input.webPlugins, input.state, {
          presetByRowId,
          packageMeta,
        })
  const { presets, warnings: presetWarnings } = await loadPresets(input.composition, input.deps.web)
  warnings.push(...presetWarnings)
  const registryRow = input.composition?.rowById.get('agent-preset-registry')
  const registryDefault = resolveScalar(registryRow?.config.default, [])
  const selectedDefault = registryRow?.config.selectedDefault
  const agentAvailable = registryRow !== void 0 && presets.length > 0
  if (
    registryRow !== void 0 &&
    selectedDefault !== void 0 &&
    selectedDefault !== 'null' &&
    selectedDefault !== ''
  )
    warnings.push(
      `ACP composes a non-empty agent-preset-registry.selectedDefault (${selectedDefault}); saving here overwrites it with null so the chosen default applies`,
    )
  const agentReason =
    registryRow === void 0
      ? 'ACP composition has no agent-preset-registry row (dsh-acp-agentmode is not installed in this profile)'
      : presets.length === 0
        ? 'ACP composition declares no preset rows'
        : void 0
  const sandboxRow = input.composition?.rowById.get('sandbox-policy')
  const approvalRow = input.composition?.rowById.get('approval')
  const mode = resolveScalar(sandboxRow?.config.mode, SANDBOX_MODES$2)
  const approval = resolveScalar(approvalRow?.config.policy, APPROVALS$2)
  if (mode.dynamic)
    warnings.push(
      mode.value === null
        ? 'sandbox-policy.mode is a !!js expression; the current mode cannot be resolved statically'
        : `sandbox-policy.mode is a !!js expression; showing its fallback literal (${mode.value})`,
    )
  if (approval.dynamic && approval.value === null)
    warnings.push(
      'approval.policy is a !!js expression; the current policy cannot be resolved statically',
    )
  const sandboxAvailable = sandboxRow !== void 0
  const sandboxReason = sandboxRow === void 0 ? 'ACP composition has no sandbox-policy row' : void 0
  const fallbackMode = input.state.sandboxMode
  const fallbackAgent = input.state.agentMode
  const drift = model.rows.filter((row) => row.drift).map((row) => row.id)
  const agentChoice = input.state.agentModeChoice ?? { mode: 'acp-default' }
  const sandboxChoice = input.state.sandboxChoice ?? { mode: 'acp-default' }
  const agentDrift =
    agentChoice.mode === 'inherit' &&
    input.webAgentPreset !== null &&
    typeof input.state.agentModeWeb === 'string' &&
    input.state.agentModeWeb !== input.webAgentPreset
  const sandboxDrift =
    sandboxChoice.mode === 'inherit' &&
    input.webPermission !== null &&
    typeof input.state.sandboxWeb === 'string' &&
    input.state.sandboxWeb !== input.webPermission.preset
  return {
    ok: true,
    acp,
    rows: model.rows,
    presets,
    agentMode: {
      value: degraded ? fallbackAgent : (registryDefault.value ?? fallbackAgent),
      choice: agentChoice,
      web: input.webAgentPreset,
      drift: agentDrift,
      available: degraded ? false : agentAvailable,
      ...(degraded
        ? { reason: 'ACP composition unavailable' }
        : agentReason === void 0
          ? {}
          : { reason: agentReason }),
    },
    sandbox: {
      mode: degraded ? fallbackMode : (mode.value ?? fallbackMode),
      approval: degraded ? null : (approval.value ?? null),
      choice: sandboxChoice,
      web: input.webPermission,
      webPresets: [...input.webPermissions],
      drift: sandboxDrift,
      available: degraded ? false : sandboxAvailable,
      ...(degraded
        ? { reason: 'ACP composition unavailable' }
        : sandboxReason === void 0
          ? {}
          : { reason: sandboxReason }),
    },
    apply: {
      lastSavedAt: input.state.savedAt,
      drift,
    },
    warnings,
  }
}
// src/host/save.ts
const PLUGIN_MODES = ['inherit', 'on', 'off']
const SANDBOX_MODES$1 = ['read-only', 'workspace-write', 'danger-full-access']
const APPROVALS$1 = ['ask', 'never']
/**
 * Approval policy the shipped permission presets pair with each sandbox mode.
 *
 * Only used for an **explicitly pinned** sandbox mode (`{mode:'sandbox'}`), which
 * carries no preset of its own. An inherited permission must use the approval the
 * *selected preset* resolves to: `auto` is `danger-full-access` + `ask`, so
 * reverse-lookup through this table would wrongly write `never`.
 */
function approvalFor(mode) {
  return mode === 'danger-full-access' ? 'never' : 'ask'
}
function isRecord$1(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function usage(message) {
  return new AcpConfigError(ERROR_CODES.usage, message)
}
/**
 * Validate one `AgentModeChoice`.
 *
 * The pre-three-state form (a bare preset id / `null`) is rejected deliberately:
 * guessing what an old caller meant would write a different ACP configuration
 * than it asked for.
 */
function normalizeAgentChoice(raw) {
  if (!isRecord$1(raw))
    throw usage(`agentMode must be an object like {"mode":"inherit"}; got ${JSON.stringify(raw)}`)
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'preset') {
    if (typeof raw.id !== 'string' || raw.id === '')
      throw usage('agentMode with mode "preset" needs a non-empty id')
    return {
      mode: 'preset',
      id: raw.id,
    }
  }
  throw usage(`unknown agentMode mode: ${JSON.stringify(mode)}`)
}
/** Validate one `SandboxChoice` (same rules as `normalizeAgentChoice`). */
function normalizeSandboxChoice(raw) {
  if (!isRecord$1(raw))
    throw usage(`sandboxMode must be an object like {"mode":"inherit"}; got ${JSON.stringify(raw)}`)
  const mode = raw.mode
  if (mode === 'inherit' || mode === 'acp-default') return { mode }
  if (mode === 'sandbox') {
    if (typeof raw.sandbox !== 'string' || !SANDBOX_MODES$1.includes(raw.sandbox))
      throw usage(`unknown sandbox mode: ${JSON.stringify(raw.sandbox)}`)
    return {
      mode: 'sandbox',
      sandbox: raw.sandbox,
    }
  }
  throw usage(`unknown sandboxMode mode: ${JSON.stringify(mode)}`)
}
/** Validate the browser-supplied request; unknown shapes are usage errors. */
function normalizeRequest(raw) {
  if (!isRecord$1(raw))
    throw new AcpConfigError(ERROR_CODES.usage, 'save request must be an object')
  const request = {}
  if (raw.plugins !== void 0) {
    if (!isRecord$1(raw.plugins))
      throw new AcpConfigError(ERROR_CODES.usage, 'plugins must be an object')
    const plugins = {}
    for (const [id, mode] of Object.entries(raw.plugins)) {
      if (typeof mode !== 'string' || !PLUGIN_MODES.includes(mode))
        throw new AcpConfigError(
          ERROR_CODES.usage,
          `unknown plugin mode for ${id}: ${JSON.stringify(mode)}`,
        )
      plugins[id] = mode
    }
    request.plugins = plugins
  }
  if (raw.agentMode !== void 0) request.agentMode = normalizeAgentChoice(raw.agentMode)
  if (raw.sandboxMode !== void 0) request.sandboxMode = normalizeSandboxChoice(raw.sandboxMode)
  return request
}
/** Existing managed entries indexed by id (used to preserve untouched sections). */
function existingEntries(fs, paths) {
  if (!fs.existsFile(paths.patchPath)) return []
  return parseManagedBlock(fs.readFile(paths.patchPath))
}
function findEntry(entries, id) {
  return entries.find((entry) => entry.id === id)
}
/**
 * Resolve plugin modes into patch entries.
 *
 * The block is always rebuilt from the full desired state (requested modes
 * merged over the stored ones), so a second identical save is byte-identical
 * and a row the request does not mention keeps its override.
 *
 * `inherit` is deliberately conservative: it is only written when the inherited
 * value differs from the row's *base* state — the value observed while this
 * page was not overriding the row. Without that remembered base, a clear would
 * read our own override as "what ACP already composes" and keep writing it.
 */
function resolvePluginEntries(request, composition, webPlugins, state, before, warnings) {
  const model = buildRowModel(composition, webPlugins, state)
  const requested = {}
  for (const [id, mode] of Object.entries(request.plugins ?? {})) requested[id] = mode
  const managedIds = new Set(before.map((entry) => entry.id))
  const entries = []
  const nextBase = { ...state.base }
  const nextPlugins = {}
  /** Base `disabled` for a row: `undefined` when a `!!js` expression decides it. */
  const baseDisabled = (id) => {
    const observed = composition.rowById.get(id)?.disabled
    if (observed === 'dynamic') return void 0
    if (managedIds.has(id)) {
      const remembered = state.base?.[id]
      if (remembered !== void 0) return remembered
      return observed === void 0 ? void 0 : observed === 'true'
    }
    return observed === void 0 ? void 0 : observed === 'true'
  }
  for (const id of Object.keys(requested)) {
    const row = model.byId.get(id)
    if (row === void 0) {
      warnings.push(
        `unknown row ${id}: not present in this profile's ACP composition or live plugin list`,
      )
      continue
    }
    if (row.locked !== void 0)
      warnings.push(`row ${id} is read-only (${row.locked}); nothing was written for it`)
  }
  for (const row of model.rows) {
    const previous = state.plugins[row.id]
    const mode = requested[row.id] ?? previous?.mode ?? 'inherit'
    const base = baseDisabled(row.id)
    const shouldWrite = requested[row.id] !== void 0 || previous !== void 0
    if (row.locked !== void 0) {
      if (previous !== void 0) nextPlugins[row.id] = { ...previous }
      if (base !== void 0) nextBase[row.id] = base
      continue
    }
    nextPlugins[row.id] = {
      mode,
      ...(row.web === 'absent' ? {} : { web: row.web === 'on' }),
    }
    if (base !== void 0) nextBase[row.id] = base
    if (!shouldWrite) continue
    if (mode === 'inherit') {
      if (row.web === 'absent') continue
      if (row.acp === 'dynamic') continue
      if (base === void 0) continue
      const target = row.web === 'off'
      if (target === base) continue
      entries.push({
        id: row.id,
        disabled: target ? 'true' : 'false',
      })
      continue
    }
    entries.push({
      id: row.id,
      disabled: mode === 'off' ? 'true' : 'false',
    })
  }
  for (const id of managedIds) {
    if (nextBase[id] !== void 0) continue
    const remembered = state.base?.[id]
    if (remembered !== void 0) nextBase[id] = remembered
  }
  return {
    entries,
    nextPlugins,
    nextBase,
  }
}
/** Entry shape the preset registry needs (see DESIGN section 4). */
function agentEntry(id) {
  return {
    id: 'agent-preset-registry',
    config: {
      default: id,
      selectedDefault: 'null',
    },
  }
}
/**
 * Patch entries for one sandbox mode plus its approval policy.
 *
 * `approval` is supplied by the caller rather than derived from `mode`: an
 * inherited permission takes the approval its preset resolved to, while an
 * explicit pin falls back to the shipped pairing table.
 */
function sandboxEntriesFor(mode, approval, composition, warnings) {
  const entries = [
    {
      id: 'sandbox-policy',
      config: {
        mode,
        workspaceRoot: '!!js process.cwd()',
      },
    },
  ]
  if (composition.rowById.has('approval'))
    entries.push({
      id: 'approval',
      config: { policy: approval },
    })
  else
    warnings.push(
      'approval row is absent from this ACP composition; only sandbox-policy.mode was written',
    )
  return entries
}
/**
 * ACP value of the agent preset before this page overrides it.
 * `null` means "cannot be known": a managed entry hides the base in the
 * composition and the state never recorded one (e.g. a legacy save).
 */
function baseAgentPreset(composition, state, before) {
  if (before.some((entry) => entry.id === 'agent-preset-registry'))
    return state.agentModeBase ?? null
  const raw = composition.rowById.get('agent-preset-registry')?.config.default
  return resolveScalar(raw, []).value
}
/** ACP sandbox mode before this page overrides it (`null` when unknown). */
function baseSandboxMode(composition, state, before) {
  if (before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval'))
    return state.sandboxBase ?? null
  const raw = composition.rowById.get('sandbox-policy')?.config.mode
  const value = resolveScalar(raw, SANDBOX_MODES$1).value
  return value === null || !SANDBOX_MODES$1.includes(value) ? null : value
}
/**
 * ACP approval policy before this page overrides it (`null` when unknown).
 *
 * Tracked alongside the base mode because the section has two knobs: an inherited
 * `auto` permission resolves to `danger-full-access` + `ask`, which has the same
 * mode as the shipped `danger-full-access` preset (`never`). Comparing modes only
 * would skip a patch that is actually needed.
 */
function baseSandboxApproval(composition, state, before) {
  if (before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval'))
    return state.sandboxApprovalBase ?? null
  const raw = composition.rowById.get('approval')?.config.policy
  const value = resolveScalar(raw, APPROVALS$1).value
  return value === null || !APPROVALS$1.includes(value) ? null : value
}
/**
 * Resolve the agent-preset section for one save.
 *
 * `inherit` is a **save-time snapshot** of the Web profile's default preset and
 * an explicit value pins one preset; both are skipped when the resolution equals
 * the pre-override ACP base, exactly like plugin rows. A `!!js` base is unknown,
 * so the inherited value is written instead of being assumed equal.
 */
function resolveAgentChoice(request, composition, state, before, webPreset, warnings) {
  const base = baseAgentPreset(composition, state, before)
  const choice = request.agentMode ?? state.agentModeChoice ?? { mode: 'acp-default' }
  const registry = composition.rowById.get('agent-preset-registry')
  if (choice.mode === 'acp-default') {
    if (before.some((entry) => entry.id === 'agent-preset-registry'))
      warnings.push(
        'the previous agent preset override was removed: this page now follows the ACP default',
      )
    return {
      entry: null,
      value: null,
      choice,
      base,
      web: null,
    }
  }
  if (choice.mode === 'preset') {
    if (registry === void 0) {
      warnings.push(
        'agentMode was not written: this ACP composition has no agent-preset-registry row',
      )
      return {
        entry: null,
        value: null,
        choice,
        base,
        web: null,
      }
    }
    if (!composition.presets.some((preset) => preset.id === choice.id)) {
      warnings.push(
        `agentMode ${choice.id} is not a preset this ACP composition declares; not written`,
      )
      return {
        entry: null,
        value: null,
        choice,
        base,
        web: null,
      }
    }
    return {
      entry: agentEntry(choice.id),
      value: choice.id,
      choice,
      base,
      web: null,
    }
  }
  if (webPreset === null) {
    if (request.agentMode !== void 0)
      throw usage(
        "agentMode inherit cannot be resolved: cannot read the current profile's agent preset (agentPresets.resolve() is unavailable)",
      )
    const previous = findEntry(before, 'agent-preset-registry')
    warnings.push(
      "the saved agentMode inherit could not be re-resolved (cannot read the current profile's agent preset); kept the previous override",
    )
    return {
      entry: previous ?? null,
      value: previous?.config?.default ?? state.agentMode,
      choice,
      base,
      web: state.agentModeWeb ?? null,
    }
  }
  if (registry === void 0) {
    warnings.push(
      'agentMode was not written: this ACP composition has no agent-preset-registry row',
    )
    return {
      entry: null,
      value: null,
      choice,
      base,
      web: webPreset,
    }
  }
  if (!composition.presets.some((preset) => preset.id === webPreset)) {
    warnings.push(
      `inherit resolved to preset ${webPreset}, which this ACP composition does not declare; not written`,
    )
    return {
      entry: null,
      value: null,
      choice,
      base,
      web: webPreset,
    }
  }
  if (base !== null && webPreset === base)
    return {
      entry: null,
      value: webPreset,
      choice,
      base,
      web: webPreset,
    }
  return {
    entry: agentEntry(webPreset),
    value: webPreset,
    choice,
    base,
    web: webPreset,
  }
}
/**
 * Resolve the sandbox section for one save.
 *
 * `inherit` snapshots the Web profile's **selected permission preset** and writes
 * both knobs from what that preset resolves to (`{ sandbox, approval }`).
 * `acp-default` removes the section entirely; `{mode:'sandbox'}` pins one mode
 * and pairs its approval from the shipped table (a pinned mode has no preset).
 *
 * The approval is never reverse-derived from the inherited mode: `auto` resolves
 * to `danger-full-access` + `ask`, so a lookup table would wrongly write `never`.
 */
function resolveSandboxChoice(request, composition, state, before, webPermission, warnings) {
  const base = baseSandboxMode(composition, state, before)
  const baseApproval = baseSandboxApproval(composition, state, before)
  const choice = request.sandboxMode ?? state.sandboxChoice ?? { mode: 'acp-default' }
  const policy = composition.rowById.get('sandbox-policy')
  const noOverride = (web) => ({
    entries: [],
    value: null,
    approval: null,
    choice,
    base,
    baseApproval,
    web,
  })
  if (choice.mode === 'acp-default') {
    if (before.some((entry) => entry.id === 'sandbox-policy' || entry.id === 'approval'))
      warnings.push(
        'the previous sandbox/approval override was removed: this page now follows the ACP default',
      )
    return noOverride(null)
  }
  if (choice.mode === 'sandbox') {
    if (policy === void 0) {
      warnings.push('sandboxMode was not written: this ACP composition has no sandbox-policy row')
      return noOverride(null)
    }
    const approval = approvalFor(choice.sandbox)
    return {
      entries: sandboxEntriesFor(choice.sandbox, approval, composition, warnings),
      value: choice.sandbox,
      approval,
      choice,
      base,
      baseApproval,
      web: null,
    }
  }
  if (webPermission === null) {
    if (request.sandboxMode !== void 0)
      throw usage(
        "sandboxMode inherit cannot be resolved: cannot read the current profile's permission preset (permissionPresets.catalog()/resolve() is unavailable)",
      )
    const previous = [findEntry(before, 'sandbox-policy'), findEntry(before, 'approval')].filter(
      (entry) => entry !== void 0,
    )
    warnings.push(
      "the saved sandboxMode inherit could not be re-resolved (cannot read the current profile's permission preset); kept the previous override",
    )
    return {
      entries: previous,
      value: state.sandboxMode,
      approval: null,
      choice,
      base,
      baseApproval,
      web: state.sandboxWeb ?? null,
    }
  }
  if (policy === void 0) {
    warnings.push('sandboxMode was not written: this ACP composition has no sandbox-policy row')
    return noOverride(webPermission.preset)
  }
  if (
    base !== null &&
    webPermission.sandbox === base &&
    (baseApproval === null || webPermission.approval === baseApproval)
  )
    return {
      entries: [],
      value: webPermission.sandbox,
      approval: webPermission.approval,
      choice,
      base,
      baseApproval,
      web: webPermission.preset,
    }
  return {
    entries: sandboxEntriesFor(
      webPermission.sandbox,
      webPermission.approval,
      composition,
      warnings,
    ),
    value: webPermission.sandbox,
    approval: webPermission.approval,
    choice,
    base,
    baseApproval,
    web: webPermission.preset,
  }
}
/** Re-read the composition and report the effective values after the write. */
async function verify(deps, timeoutMs, entryIds, writtenAgent, writtenSandbox, warnings) {
  const outcome = await deps.runDump({
    profile: deps.profileName,
    timeoutMs,
  })
  if (!outcome.ok) {
    warnings.push(`post-save verification skipped: ${outcome.message}`)
    return {
      source: 'unavailable',
      warnings: [],
    }
  }
  let composition
  try {
    composition = parseComposition(outcome.text)
  } catch (error) {
    warnings.push(
      `post-save verification failed to parse the dump: ${error instanceof Error ? error.message : String(error)}`,
    )
    return {
      source: 'unavailable',
      warnings: [],
    }
  }
  const rows = {}
  const verifyWarnings = []
  for (const id of entryIds) {
    const row = composition.rowById.get(id)
    if (row === void 0) {
      verifyWarnings.push(`row ${id} is absent from the recomposed ACP profile`)
      continue
    }
    rows[id] = row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
  }
  const registry = composition.rowById.get('agent-preset-registry')
  const sandbox = composition.rowById.get('sandbox-policy')
  const agentResolved = resolveScalar(registry?.config.default, [])
  const sandboxResolved = resolveScalar(sandbox?.config.mode, SANDBOX_MODES$1)
  const agentValue = agentResolved.value
  const sandboxValue = sandboxResolved.value
  if (writtenAgent !== null && agentValue !== null && agentValue !== writtenAgent)
    verifyWarnings.push(`agentMode recomposed as ${agentValue}, expected ${writtenAgent}`)
  if (writtenSandbox !== null && sandboxValue !== null && sandboxValue !== writtenSandbox)
    verifyWarnings.push(`sandbox mode recomposed as ${sandboxValue}, expected ${writtenSandbox}`)
  if (sandboxResolved.dynamic && sandboxValue !== null)
    verifyWarnings.push(
      `sandbox-policy.mode is a !!js expression; reporting its fallback literal (${sandboxValue})`,
    )
  warnings.push(...verifyWarnings)
  return {
    source: 'live',
    rows,
    agentMode: agentValue,
    sandbox: sandboxValue,
    warnings: verifyWarnings,
  }
}
/** Execute one save; business failures come back as `Failure`, never as throws. */
async function saveSelection(context, rawRequest) {
  try {
    const request = normalizeRequest(rawRequest)
    const { deps, paths } = context
    if (!deps.fs.existsDir(paths.dir))
      throw new AcpConfigError(
        ERROR_CODES.profile,
        `ACP profile directory does not exist: ${paths.dir}`,
      )
    assertInsideProfile(deps.fs, paths.dir, paths.patchPath)
    assertInsideProfile(deps.fs, paths.dir, paths.statePath)
    const { composition } = await readComposition(deps, context.timeoutMs)
    requireComposition(
      {
        ok: true,
        source: 'live',
        text: '',
        command: '',
      },
      composition,
    )
    const parsed = composition
    const { state } = readState(deps.fs, paths)
    const warnings = []
    const before = existingEntries(deps.fs, paths)
    const pluginResult = resolvePluginEntries(
      request,
      parsed,
      context.webPlugins,
      state,
      before,
      warnings,
    )
    const agentResult = resolveAgentChoice(
      request,
      parsed,
      state,
      before,
      context.webAgentPreset,
      warnings,
    )
    const sandboxResult = resolveSandboxChoice(
      request,
      parsed,
      state,
      before,
      context.webPermission,
      warnings,
    )
    const block = serializeManagedBlock([
      ...(agentResult.entry === null ? [] : [agentResult.entry]),
      ...sandboxResult.entries,
      ...pluginResult.entries,
    ])
    const write = writeManagedBlock(deps.fs, paths, block)
    const changed = changedIds(before, parseManagedBlock(write.text))
    if (
      (request.plugins !== void 0 ||
        request.agentMode !== void 0 ||
        request.sandboxMode !== void 0) &&
      changed.length === 0
    )
      warnings.push('no patch change was required; the ACP composition already matched the request')
    const savedAt = deps.now()
    const nextState = {
      version: 1,
      savedAt,
      profile: paths.name,
      plugins: pluginResult.nextPlugins,
      agentMode: agentResult.value,
      sandboxMode: sandboxResult.value,
      agentModeChoice: agentResult.choice,
      sandboxChoice: sandboxResult.choice,
      ...(agentResult.web === null ? {} : { agentModeWeb: agentResult.web }),
      ...(sandboxResult.web === null ? {} : { sandboxWeb: sandboxResult.web }),
      ...(agentResult.base !== null
        ? { agentModeBase: agentResult.base }
        : state.agentModeBase === void 0
          ? {}
          : { agentModeBase: state.agentModeBase }),
      ...(sandboxResult.base !== null
        ? { sandboxBase: sandboxResult.base }
        : state.sandboxBase === void 0
          ? {}
          : { sandboxBase: state.sandboxBase }),
      ...(sandboxResult.baseApproval !== null
        ? { sandboxApprovalBase: sandboxResult.baseApproval }
        : state.sandboxApprovalBase === void 0
          ? {}
          : { sandboxApprovalBase: state.sandboxApprovalBase }),
      base: pluginResult.nextBase,
    }
    writeState(deps.fs, paths, nextState)
    return {
      ok: true,
      savedAt,
      changed,
      verification: write.changed
        ? await verify(
            deps,
            context.timeoutMs,
            pluginResult.entries.map((entry) => entry.id),
            agentResult.value,
            sandboxResult.value,
            warnings,
          )
        : {
            source: 'live',
            rows: pluginResult.entries.reduce((acc, entry) => {
              const row = parsed.rowById.get(entry.id)
              if (row !== void 0)
                acc[entry.id] =
                  row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
              return acc
            }, {}),
            agentMode: agentResult.value,
            sandbox: sandboxResult.value,
            warnings: [],
          },
      warnings,
    }
  } catch (error) {
    return failureOf(error)
  }
}
/** Convenience wrapper used by the engine: resolve paths, then save. */
async function saveWithDeps(deps, rawRequest, timeoutMs) {
  try {
    const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
    let webPlugins = []
    let webAgentPreset = null
    let webPermission = null
    if (deps.web !== void 0) {
      try {
        webPlugins = await deps.web.listPlugins()
      } catch (error) {
        webPlugins = []
      }
      try {
        webAgentPreset = await deps.web.readAgentPreset()
      } catch {
        webAgentPreset = null
      }
      try {
        webPermission = await deps.web.readWebPermission()
      } catch {
        webPermission = null
      }
    }
    return await saveSelection(
      {
        deps,
        paths,
        timeoutMs,
        webPlugins,
        webAgentPreset,
        webPermission,
      },
      rawRequest,
    )
  } catch (error) {
    return failureOf(error)
  }
}
/** Real `node:fs` adapter. */
const nodeFs = {
  existsFile: (path) => {
    try {
      return fsSync.statSync(path).isFile()
    } catch {
      return false
    }
  },
  existsDir: (path) => {
    try {
      return fsSync.statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  readFile: (path) => fsSync.readFileSync(path, 'utf8'),
  writeFile: (path, data, mode) => {
    fsSync.writeFileSync(
      path,
      data,
      mode === void 0
        ? 'utf8'
        : {
            encoding: 'utf8',
            mode,
          },
    )
  },
  rename: (from, to) => fsSync.renameSync(from, to),
  copyFile: (from, to) => fsSync.copyFileSync(from, to),
  unlink: (path) => fsSync.rmSync(path, { force: true }),
  chmod: (path, mode) => fsSync.chmodSync(path, mode),
  mkdir: (path) => fsSync.mkdirSync(path, { recursive: true }),
  realpath: (path) => fsSync.realpathSync(path),
  stat: (path) => {
    try {
      const s = fsSync.statSync(path)
      return {
        mtimeMs: s.mtimeMs,
        size: s.size,
        mode: s.mode,
      }
    } catch {
      return null
    }
  },
}
/** Strip trailing slashes so `endsWith('/dsh')` also accepts `…/dsh/`. */
function normalizeRoot(candidate) {
  return candidate.length > 1 ? candidate.replace(/[/\\]+$/, '') : candidate
}
/**
 * Locate the DSH installation root from `process.argv` (the desktop host passes
 * `<…>/app.asar/dsh` as an argument). Returns null when the argument is absent,
 * e.g. in a plain Node script.
 */
function detectDshRoot(argv, platform = process.platform) {
  const isWin = platform === 'win32'
  for (const arg of argv) {
    if (typeof arg !== 'string' || arg.startsWith('-')) continue
    if (!isAbsolute(arg)) continue
    const candidate = normalizeRoot(arg)
    if ((isWin ? /[/\\]dsh$/i : /\/dsh$/).test(candidate)) return candidate
  }
  return null
}
/**
 * One path segment of a module specifier: plain, lowercase/uppercase package-name
 * characters. `.` and `..` fail this test, so no specifier can climb a directory.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/**
 * The npm package a module specifier belongs to, or `null` when the specifier is
 * not one a locale lookup may turn into a path.
 *
 * Accepts `name`, `@scope/name` and their subpaths (`@scope/name/tools`), which
 * are how several Loader rows name their module. Every segment is validated, so
 * `..`, a backslash, a drive letter, a colon (`cordis:group`), a NUL byte or an
 * absolute path is rejected before any path is built.
 */
function packageRootOf(moduleName) {
  if (typeof moduleName !== 'string' || moduleName === '' || moduleName.length > 214) return null
  if (moduleName.includes('\\') || moduleName.includes('\0') || moduleName.includes(':'))
    return null
  if (moduleName.startsWith('/')) return null
  const segments = moduleName.split('/')
  if (segments.some((segment) => segment === '')) return null
  const scoped = moduleName.startsWith('@')
  if (scoped && segments.length < 2) return null
  for (const [index, segment] of segments.entries()) {
    if (index === 0 && scoped) {
      if (!SAFE_SEGMENT.test(segment.slice(1))) return null
      continue
    }
    if (!SAFE_SEGMENT.test(segment)) return null
  }
  return (scoped ? segments.slice(0, 2) : segments.slice(0, 1)).join('/')
}
/** True when `moduleName` is a specifier the package-locale fallback may read. */
function isPackageModuleName(moduleName) {
  return packageRootOf(moduleName) !== null
}
/** Read one string out of a locale value (`"text"` or `{ en, zh, … }`). */
function localeTextOf(value, locale) {
  if (typeof value === 'string') return value.trim() === '' ? void 0 : value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return void 0
  const record = value
  for (const key of [locale, 'en', 'zh']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
}
/** Read `locale/<name>.json`'s `meta` block; any problem is "no metadata". */
function readLocaleMeta(fs, localePath, locale) {
  try {
    if (!fs.existsFile(localePath)) return {}
    const parsed = JSON.parse(fs.readFile(localePath))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const meta = parsed.meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return {}
    const record = meta
    const title = localeTextOf(record.title, locale)
    const description = localeTextOf(record.description, locale)
    return {
      ...(title === void 0 ? {} : { title }),
      ...(description === void 0 ? {} : { description }),
    }
  } catch {
    return {}
  }
}
/** Pair the zh/en strings into the wire's `LocalizedText`; `undefined` when empty. */
function localizedPair(zh, en) {
  if (zh === void 0 && en === void 0) return void 0
  const fallback = zh ?? en ?? ''
  return {
    en: en ?? fallback,
    zh: zh ?? fallback,
  }
}
/**
 * Build the real `readPackageMeta`: read `<dshRoot>/node_modules/<package>/locale/
 * {zh,en}.json` and pair their `meta.title` / `meta.description`.
 *
 * Used only when `pluginManager.listPlugins()` has no metadata for a row — an
 * agent preset's plugins are composed inside the ACP profile, so their packages
 * never reach this profile's live loader entries.
 *
 * A subpath specifier (`@scope/pkg/tools`) resolves to its package root, which is
 * where the locale files live. Electron's patched `fs` reads inside `app.asar`; a
 * plain Node run passes `dshRoot: null` (see `defaultDeps`), so the fallback is
 * simply absent there. Reads are cached per module for the lifetime of the
 * returned function, and every failure resolves to `null`.
 */
function createReadPackageMeta(options) {
  const fs = options.fs ?? nodeFs
  const root = options.dshRoot
  const nodeModules = root === null || root === '' ? null : join(root, 'node_modules')
  const cache = /* @__PURE__ */ new Map()
  const read = async (moduleName) => {
    if (nodeModules === null) return null
    try {
      const packageRoot = packageRootOf(moduleName)
      if (packageRoot === null) return null
      const packageDir = resolve(nodeModules, ...packageRoot.split('/'))
      if (!packageDir.startsWith(`${resolve(nodeModules)}${sep}`)) return null
      const localeDir = join(packageDir, 'locale')
      const zh = readLocaleMeta(fs, join(localeDir, 'zh.json'), 'zh')
      const en = readLocaleMeta(fs, join(localeDir, 'en.json'), 'en')
      const title = localizedPair(zh.title, en.title)
      const description = localizedPair(zh.description, en.description)
      if (title === void 0 && description === void 0) return null
      return {
        ...(title === void 0 ? {} : { title }),
        ...(description === void 0 ? {} : { description }),
      }
    } catch {
      return null
    }
  }
  return (moduleName) => {
    if (typeof moduleName !== 'string' || moduleName === '') return Promise.resolve(null)
    const cached = cache.get(moduleName)
    if (cached !== void 0) return cached
    const pending = read(moduleName)
    cache.set(moduleName, pending)
    return pending
  }
}
function dumpCandidates(fs, env, dshRoot, execPath, profile) {
  const tail = ['--profile', profile, '--dump-config']
  const candidates = []
  const override = env.DSH_ACP_CONFIG_CLI
  if (typeof override === 'string' && override.trim() !== '')
    candidates.push({
      command: override.trim(),
      args: tail,
    })
  candidates.push({
    command: 'dsh',
    args: tail,
  })
  if (dshRoot !== null) {
    const bin = join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsFile(bin))
      candidates.push({
        command: execPath,
        args: [bin, ...tail],
        env: { ELECTRON_RUN_AS_NODE: '1' },
      })
  }
  return candidates
}
/**
 * Spawn one dump run asynchronously (never `spawnSync`: the host is Electron's
 * main process and a blocking 1–2 s dump freezes the whole GUI).
 *
 * A timeout kills the child and settles as `timeout`; a missing binary settles
 * as `unavailable` so the caller can fall through to the next candidate.
 */
async function spawnDump(candidate, timeoutMs) {
  const command = [candidate.command, ...candidate.args].join(' ')
  return await new Promise((resolve) => {
    let settled = false
    let timer
    let killTimer
    let stdout = ''
    let stderr = ''
    const finish = (outcome) => {
      if (settled) return
      settled = true
      if (timer !== void 0) clearTimeout(timer)
      if (killTimer !== void 0) clearTimeout(killTimer)
      resolve(outcome)
    }
    let child
    try {
      child = spawn(candidate.command, candidate.args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env:
          candidate.env === void 0
            ? process.env
            : {
                ...process.env,
                ...candidate.env,
              },
        windowsHide: true,
      })
    } catch (error) {
      finish({
        ok: false,
        source: 'fallback',
        code: 'spawn',
        message: String(error),
        command,
      })
      return
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 33554432) stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 1048576) stderr += chunk
    })
    child.on('error', (error) => {
      const missing = error.code === 'ENOENT'
      finish({
        ok: false,
        source: 'fallback',
        code: missing ? 'unavailable' : 'spawn',
        message: missing ? `${candidate.command} not found` : error.message,
        command,
        ...(missing ? { missingBinary: true } : {}),
      })
    })
    child.on('close', (code, signal) => {
      if (settled) return
      if (code === 0) {
        finish({
          ok: true,
          source: 'live',
          text: stdout,
          command,
        })
        return
      }
      const detail = stderr.trim() !== '' ? stderr.trim().split('\n').slice(-3).join(' ') : ''
      finish({
        ok: false,
        source: 'fallback',
        code: 'exit',
        message: `exit ${code ?? signal ?? 'unknown'}${detail === '' ? '' : `: ${detail}`}`,
        command,
      })
    })
    timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {}
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
      }, 2e3)
      killTimer.unref?.()
      finish({
        ok: false,
        source: 'fallback',
        code: 'timeout',
        message: `dump timed out after ${timeoutMs}ms`,
        command,
      })
    }, timeoutMs)
    timer.unref?.()
  })
}
/**
 * Build the real `runDump` implementation: try each candidate in order, skip
 * binaries that do not exist, and surface the last meaningful failure.
 */
function createRunDump(options = {}) {
  const env = options.env ?? process.env
  const fs = options.fs ?? nodeFs
  const execPath = options.execPath ?? process.execPath
  const timeoutMs = options.timeoutMs ?? 3e4
  return async (args) => {
    const root = options.dshRoot === void 0 ? detectDshRoot(process.argv) : options.dshRoot
    const candidates = dumpCandidates(fs, env, root, execPath, args.profile)
    let last = {
      ok: false,
      source: 'fallback',
      code: 'unavailable',
      message: 'no dsh executable available',
    }
    for (const candidate of candidates) {
      const outcome = await spawnDump(candidate, args.timeoutMs ?? timeoutMs)
      if (outcome.ok) return outcome
      last = outcome
      if (outcome.missingBinary !== true) return outcome
    }
    return last
  }
}
/** `$DSH_HOME` (default `~/.dsh`) for the running process. */
function resolveHomeDir(env = process.env, home = homedir()) {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(home, '.dsh')
}
/**
 * Real dependencies for production and for plain-Node smoke scripts:
 * `createEngine(defaultDeps())` works outside Electron (the execPath candidate
 * is only offered when its `lib/bin.js` actually exists).
 *
 * The package-locale metadata fallback is wired only when the desktop host
 * passed a DSH installation root (an absolute `<…>/dsh` argument); a plain Node
 * run therefore never reads `app.asar` or an installed `node_modules`.
 */
function defaultDeps(overrides = {}) {
  const fs = overrides.fs ?? nodeFs
  const dshRoot = overrides.readPackageMeta === void 0 ? detectDshRoot(process.argv) : null
  const readPackageMeta =
    overrides.readPackageMeta ??
    (dshRoot === null
      ? void 0
      : createReadPackageMeta({
          dshRoot,
          fs,
        }))
  return {
    homeDir: overrides.homeDir ?? resolveHomeDir(),
    profileName: overrides.profileName ?? 'acp',
    fs,
    runDump: overrides.runDump ?? createRunDump({ fs }),
    now: overrides.now ?? (() => /* @__PURE__ */ new Date().toISOString()),
    ...(overrides.web === void 0 ? {} : { web: overrides.web }),
    ...(readPackageMeta === void 0 ? {} : { readPackageMeta }),
  }
}
// src/host/engine.ts
async function loadWebPlugins(deps) {
  if (deps.web === void 0) return []
  try {
    return await deps.web.listPlugins()
  } catch {
    return []
  }
}
/** Read the live agent preset; `null` means "cannot be read here". */
async function loadWebAgentPreset(deps) {
  if (deps.web === void 0) return null
  try {
    return await deps.web.readAgentPreset()
  } catch {
    return null
  }
}
/** Read the selected permission preset; `null` means "cannot be read here". */
async function loadWebPermission(deps) {
  if (deps.web === void 0) return null
  try {
    return await deps.web.readWebPermission()
  } catch {
    return null
  }
}
/** Read the selectable permission presets; `[]` when the port cannot answer. */
async function loadWebPermissions(deps) {
  if (deps.web === void 0 || deps.web.listWebPermissions === void 0) return []
  try {
    const list = await deps.web.listWebPermissions()
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}
/**
 * Build an engine from injectable dependencies.
 *
 * Nothing here touches a Cordis context: the Host route supplies the live
 * plugin list, tests and smoke scripts supply fakes or nothing at all.
 */
function createEngine(deps, options = {}) {
  const timeoutMs = options.dumpTimeoutMs ?? 3e4
  return {
    paths: () => resolveProfilePaths(deps.homeDir, deps.profileName),
    async status() {
      const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
      const [
        { outcome, composition },
        webPlugins,
        webAgentPreset,
        webPermission,
        webPermissions,
        stateResult,
      ] = await Promise.all([
        readComposition(deps, timeoutMs),
        loadWebPlugins(deps),
        loadWebAgentPreset(deps),
        loadWebPermission(deps),
        loadWebPermissions(deps),
        Promise.resolve(readState(deps.fs, paths)),
      ])
      return await buildStatus({
        deps: {
          fs: deps.fs,
          web: deps.web,
          ...(deps.readPackageMeta === void 0 ? {} : { readPackageMeta: deps.readPackageMeta }),
        },
        paths,
        profileName: deps.profileName,
        composition,
        outcome,
        webPlugins,
        webAgentPreset,
        webPermission,
        webPermissions,
        state: stateResult.state,
        stateWarnings: stateResult.warnings,
      })
    },
    save: (request) => saveWithDeps(deps, request, timeoutMs),
    async validate() {
      try {
        const paths = resolveProfilePaths(deps.homeDir, deps.profileName)
        const { outcome, composition } = await readComposition(deps, timeoutMs)
        const stateResult = readState(deps.fs, paths)
        const warnings = [...stateResult.warnings]
        const verification = {
          source: 'unavailable',
          warnings: [],
        }
        let agentMode = stateResult.state.agentMode
        let sandbox = stateResult.state.sandboxMode
        if (composition !== null && outcome.ok) {
          const managedIds = deps.fs.existsFile(paths.patchPath)
            ? parseManagedBlock(deps.fs.readFile(paths.patchPath)).map((entry) => entry.id)
            : []
          const rows = {}
          for (const id of managedIds) {
            const row = composition.rowById.get(id)
            if (row === void 0) {
              warnings.push(`managed row ${id} is absent from the ACP composition`)
              continue
            }
            rows[id] =
              row.disabled === 'true' ? 'off' : row.disabled === 'dynamic' ? 'dynamic' : 'on'
          }
          const registry = composition.rowById.get('agent-preset-registry')
          const policy = composition.rowById.get('sandbox-policy')
          const composedAgent = registry?.config.default ?? null
          const composedSandbox = policy?.config.mode ?? null
          if (composedSandbox !== null && composedSandbox.startsWith('!!js'))
            warnings.push(
              'sandbox-policy.mode is a !!js expression; effective mode is decided at ACP startup',
            )
          else if (composedSandbox !== null) sandbox = composedSandbox
          if (composedAgent !== null) agentMode = composedAgent
          verification.source = 'live'
          verification.rows = rows
          verification.agentMode = composedAgent
          verification.sandbox = sandbox
          const selected = registry?.config.selectedDefault
          if (selected !== void 0 && selected !== 'null' && selected !== '')
            warnings.push(
              `ACP composes a non-empty agent-preset-registry.selectedDefault (${selected}); saving here overwrites it with null`,
            )
        } else
          warnings.push(
            `ACP composition unavailable (${outcome.ok ? 'parse failed' : outcome.message}); validation is degraded`,
          )
        verification.warnings = warnings.filter((entry) => entry !== '').slice(-4)
        return {
          ok: true,
          verification,
          agentMode,
          sandbox,
          warnings,
        }
      } catch (error) {
        return failureOf(error)
      }
    },
  }
}
// src/shared/contract.ts
const ROUTE_PATH = '/api/dsh-acp-config'
const SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access']
// src/host/index.ts
const name = 'dsh-acp-config'
const inject = ['connection']
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
const rpcError = (code, message) => ({
  code,
  message,
  details: {},
})
function rpcResponse(rpcId, result) {
  return jsonResponse(200, {
    type: 'server-response',
    rpcId,
    result,
  })
}
const APPROVALS = ['ask', 'never']
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
/**
 * Lazily resolve `permissionPresets`, the service that owns the Web UI's
 * permission presets (and therefore the user's actual selection).
 *
 * `sandboxPolicy` is deliberately not consulted: its `defaultMode` is the
 * deployment default (`DSH_PERMISSION_MODE ?? 'workspace-write'`), so reading it
 * reported "workspace-write" while the user had selected full access.
 */
function permissionService(ctx) {
  if (typeof ctx?.get !== 'function') return void 0
  let service
  try {
    service = ctx.get('permissionPresets')
  } catch {
    return
  }
  if (service === void 0 || service === null) return void 0
  if (typeof service.catalog !== 'function' || typeof service.resolve !== 'function') return
  return service
}
/** Normalize one `resolve()` result into a `WebPermission`; `null` when unusable. */
function normalizePermission(preset, resolved) {
  if (!isRecord(resolved)) return null
  const sandbox = resolved.sandbox
  const approval = resolved.approval
  if (typeof sandbox !== 'string' || !SANDBOX_MODES.includes(sandbox)) return null
  if (typeof approval !== 'string' || !APPROVALS.includes(approval)) return null
  return {
    preset,
    sandbox,
    approval,
  }
}
/** Resolve one preset name; never throws, `null` on any missing/invalid value. */
async function resolvePermission(service, preset) {
  if (typeof preset !== 'string' || preset === '') return null
  let resolved
  try {
    resolved = await service.resolve(preset)
  } catch {
    return null
  }
  return normalizePermission(preset, resolved)
}
/** Read preset names out of `catalog().options` / `catalog().defaultOptions`. */
function presetNames(raw) {
  if (!Array.isArray(raw)) return []
  const names = []
  for (const item of raw) {
    const value = typeof item === 'string' ? item : isRecord(item) ? item.value : void 0
    if (typeof value === 'string' && value !== '' && !names.includes(value)) names.push(value)
  }
  return names
}
/**
 * Normalize a display value (`"text"` or `{ en, zh, … }`) into the wire's
 * `LocalizedText`-compatible record; `undefined` when it carries no text.
 */
function localizedField(value) {
  if (typeof value === 'string') return value.trim() === '' ? void 0 : value
  if (!isRecord(value)) return void 0
  const out = {}
  for (const [key, text] of Object.entries(value))
    if (typeof text === 'string' && text !== '') out[key] = text
  return Object.keys(out).length === 0 ? void 0 : out
}
/**
 * Normalize one `pluginManager.listPlugins()` entry.
 *
 * The live inventory nests display text under `meta` (`PluginLocalizedMeta`:
 * `{ title?: LocalizedText, description?: LocalizedText }`) and reports the
 * root-fiber phase alongside. Flattening both here keeps the engine free of
 * that shape and gives every row its `webFiber` for the details table.
 */
function toWebPluginInfo(raw) {
  if (!isRecord(raw)) return null
  const moduleName = typeof raw.moduleName === 'string' ? raw.moduleName : ''
  if (moduleName === '') return null
  const meta = isRecord(raw.meta) ? raw.meta : void 0
  const title = localizedField(meta?.title) ?? localizedField(raw.title)
  const description = localizedField(meta?.description) ?? localizedField(raw.description)
  const patchId = typeof raw.patchId === 'string' && raw.patchId !== '' ? raw.patchId : void 0
  const fiberPhase =
    typeof raw.fiberPhase === 'string' && raw.fiberPhase !== '' ? raw.fiberPhase : void 0
  return {
    moduleName,
    enabled: raw.enabled === true,
    ...(patchId === void 0 ? {} : { patchId }),
    ...(title === void 0 ? {} : { title }),
    ...(description === void 0 ? {} : { description }),
    ...(fiberPhase === void 0 ? {} : { fiberPhase }),
  }
}
/** Normalize one `agentPresets.compositionInventory()` entry. */
function toPresetInventory(raw) {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' ? raw.id : ''
  if (id === '') return null
  const rows = []
  if (Array.isArray(raw.rows))
    for (const item of raw.rows) {
      if (!isRecord(item)) continue
      rows.push({
        ...(typeof item.entryId === 'string' && item.entryId !== ''
          ? { entryId: item.entryId }
          : {}),
        ...(typeof item.moduleName === 'string' ? { moduleName: item.moduleName } : {}),
        ...(typeof item.enabled === 'boolean' || item.enabled === 'conditional'
          ? { enabled: item.enabled }
          : {}),
        ...(typeof item.condition === 'string' ? { condition: item.condition } : {}),
        ...(typeof item.fiberState === 'number' ? { fiberState: item.fiberState } : {}),
      })
    }
  return {
    id,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    ...(raw.isDefault === true ? { isDefault: true } : {}),
    ...(typeof raw.broken === 'string' ? { broken: raw.broken } : {}),
    rows,
  }
}
/**
 * Live plugin state of the profile that serves this page.
 *
 * Services are resolved lazily on every call: plugin activation order does not
 * guarantee `pluginManager`/`agentPresets`/`permissionPresets` exist when this
 * row activates, so a one-shot `ctx.get(...)` at apply time would degrade the
 * page permanently.
 */
function createWebPort(ctx) {
  return {
    async listPlugins() {
      const manager = typeof ctx?.get === 'function' ? ctx.get('pluginManager') : void 0
      if (manager === void 0 || manager === null || typeof manager.listPlugins !== 'function')
        return []
      const plugins = await manager.listPlugins()
      if (!Array.isArray(plugins)) return []
      const infos = []
      for (const plugin of plugins) {
        const info = toWebPluginInfo(plugin)
        if (info !== null) infos.push(info)
      }
      return infos
    },
    async compositionInventory() {
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : void 0
      if (presets === void 0 || presets === null) return []
      if (typeof presets.compositionInventory !== 'function') return []
      let inventory
      try {
        inventory = await presets.compositionInventory()
      } catch {
        return []
      }
      if (!Array.isArray(inventory)) return []
      const entries = []
      for (const preset of inventory) {
        const normalized = toPresetInventory(preset)
        if (normalized !== null) entries.push(normalized)
      }
      return entries
    },
    async listPresets() {
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : void 0
      if (presets === void 0 || presets === null || typeof presets.list !== 'function') return []
      const list = await presets.list()
      return Array.isArray(list) ? list : []
    },
    async readAgentPreset() {
      const presets = typeof ctx?.get === 'function' ? ctx.get('agentPresets') : void 0
      if (presets === void 0 || presets === null || typeof presets.resolve !== 'function')
        return null
      const id = (await presets.resolve())?.id
      return typeof id === 'string' && id !== '' ? id : null
    },
    async readWebPermission() {
      const service = permissionService(ctx)
      if (service === void 0) return null
      let catalog
      try {
        catalog = await service.catalog()
      } catch {
        return null
      }
      if (!isRecord(catalog)) return null
      return await resolvePermission(service, catalog.defaultPreset)
    },
    async listWebPermissions() {
      const service = permissionService(ctx)
      if (service === void 0) return []
      let catalog
      try {
        catalog = await service.catalog()
      } catch {
        return []
      }
      if (!isRecord(catalog)) return []
      const names = presetNames(catalog.options)
      for (const name of presetNames(catalog.defaultOptions))
        if (!names.includes(name)) names.push(name)
      const defaultPreset = catalog.defaultPreset
      if (
        typeof defaultPreset === 'string' &&
        defaultPreset !== '' &&
        !names.includes(defaultPreset)
      )
        names.push(defaultPreset)
      const permissions = []
      for (const preset of names) {
        const permission = await resolvePermission(service, preset)
        if (permission !== null) permissions.push(permission)
      }
      return permissions
    },
  }
}
/** Dispatch one decoded RPC payload onto the engine. */
async function dispatch(engine, method, args) {
  try {
    switch (method) {
      case 'status':
        return await engine.status()
      case 'save':
        return await engine.save(args ?? {})
      case 'validate':
        return await engine.validate()
      default:
        return failure(ERROR_CODES.usage, `unknown method: ${JSON.stringify(method)}`)
    }
  } catch (error) {
    return failureOf(error)
  }
}
/** Build the Fetch handler; exported so tests can drive it without Cordis. */
function createFetchHandler(engine) {
  return async (request) => {
    let message = null
    try {
      message = await request.json()
    } catch {
      return jsonResponse(400, rpcError('bad-request', 'invalid JSON body'))
    }
    if (typeof message !== 'object' || message === null || Array.isArray(message))
      return jsonResponse(400, rpcError('bad-request', 'RPC envelope must be an object'))
    const envelope = message
    if (envelope.type !== 'client-request')
      return jsonResponse(400, rpcError('bad-request', 'expected a client-request envelope'))
    const rpcId = typeof envelope.rpcId === 'string' ? envelope.rpcId : null
    if (rpcId === null)
      return jsonResponse(400, rpcError('bad-request', 'RPC envelope is missing rpcId'))
    const payload = envelope.payload
    const method =
      typeof payload === 'object' && payload !== null && typeof payload.method === 'string'
        ? payload.method
        : ''
    const args = typeof payload === 'object' && payload !== null ? payload.args : void 0
    try {
      const result = await dispatch(engine, method, args)
      if (result !== null && typeof result === 'object' && result.ok === false) {
        const error = result.error
        return rpcResponse(rpcId, {
          ok: false,
          error: rpcError(error?.code ?? ERROR_CODES.internal, error?.message ?? 'save failed'),
        })
      }
      return rpcResponse(rpcId, {
        ok: true,
        value: result,
      })
    } catch (error) {
      const mapped = failureOf(error)
      return rpcResponse(rpcId, {
        ok: false,
        error: rpcError(mapped.error.code, mapped.error.message),
      })
    }
  }
}
function apply(ctx) {
  let deps
  try {
    deps = defaultDeps()
  } catch (error) {
    throw new AcpConfigError(ERROR_CODES.internal, `failed to build dependencies: ${String(error)}`)
  }
  deps.web = createWebPort(ctx)
  const engine = createEngine(deps)
  ctx.effect(() => {
    if (typeof ctx.connection?.fetch?.register !== 'function')
      throw new AcpConfigError(
        ERROR_CODES.internal,
        'dsh-acp-config needs connection.fetch (DSH >= 0.1.5-rc.1 HostConnectionFetch)',
      )
    const dispose = ctx.connection.fetch.register({
      path: ROUTE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createFetchHandler(engine),
    })
    return () => {
      dispose()
    }
  }, 'dsh-acp-config: POST /api/dsh-acp-config')
}
export {
  apply,
  createEngine,
  createFetchHandler,
  createReadPackageMeta,
  createWebPort,
  defaultDeps,
  dispatch,
  inject,
  isPackageModuleName,
  name,
  packageRootOf,
}

//# sourceMappingURL=index.mjs.map
