#!/usr/bin/env node
// Independent verifier for the ACP profile composition.
//
// Runs the same command the plugin's Host half uses and reports the values this
// feature is allowed to change, so a save can be checked without the browser:
//
//   node scripts/acp-dump-check.mjs [profile] [--json]
//
// It never writes anything.
import { spawnSync } from 'node:child_process'

const profile = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) ?? 'acp'
const asJson = process.argv.includes('--json')

const res = spawnSync('dsh', ['--profile', profile, '--dump-config'], {
  encoding: 'utf8',
  timeout: 60_000,
})
if (res.error) {
  console.error(`failed to run dsh: ${res.error.message}`)
  process.exit(1)
}
if (res.status !== 0) {
  console.error(`dsh exited ${res.status}\n${res.stderr}`)
  process.exit(1)
}

/** @typedef {{ id: string, moduleName?: string, disabled?: string, config: Record<string, string> }} Row */

/** @type {Row[]} */
const rows = []
let current = null
let inConfig = false
for (const line of res.stdout.split('\n')) {
  if (/^# ==/.test(line) || /^#/.test(line) || line.trim() === '') continue
  const top = /^- id:\s*(\S+)\s*$/.exec(line)
  if (top) {
    current = { id: top[1], config: {} }
    rows.push(current)
    inConfig = false
    continue
  }
  if (!current) continue
  const field = /^ {2}(name|disabled):\s*(.*)$/.exec(line)
  if (field) {
    if (field[1] === 'name') current.moduleName = unquote(field[2])
    else current.disabled = field[2].trim()
    continue
  }
  if (/^ {2}config:\s*$/.test(line)) {
    inConfig = true
    continue
  }
  if (inConfig) {
    const kv = /^ {4}([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line)
    if (kv) current.config[kv[1]] = kv[2].trim()
    else if (!/^ {4,}/.test(line)) inConfig = false
  }
}

function unquote(v) {
  return v.replace(/^['"]|['"]$/g, '')
}

const managedMarker = /dsh-acp-config:managed/
const patchText = await readPatch()
const managed = managedMarker.test(patchText)

const row = (id) => rows.find((r) => r.id === id)
const presetRows = rows.filter((r) => r.id.startsWith('preset-'))
const report = {
  profile,
  managedBlock: managed,
  presetRegistry: row('agent-preset-registry')
    ? { default: row('agent-preset-registry').config.default ?? null }
    : null,
  sandbox: row('sandbox-policy') ? { mode: row('sandbox-policy').config.mode ?? null } : null,
  approval: row('approval') ? { policy: row('approval').config.policy ?? null } : null,
  presets: presetRows.map((r) => r.config.id).filter(Boolean),
  disabledRows: rows.filter((r) => r.disabled === 'true').map((r) => r.id),
  totalRows: rows.length,
}

if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`profile:            ${report.profile}`)
  console.log(`rows:               ${report.totalRows}`)
  console.log(`managed block:      ${report.managedBlock ? 'present' : 'absent'}`)
  console.log(`agent-preset default: ${report.presetRegistry?.default ?? '(no registry row)'}`)
  console.log(`sandbox-policy mode:  ${report.sandbox?.mode ?? '(no row)'}`)
  console.log(`approval policy:      ${report.approval?.policy ?? '(no row)'}`)
  console.log(`presets:            ${report.presets.join(', ') || '(none)'}`)
  console.log(`disabled rows (${report.disabledRows.length}): ${report.disabledRows.join(', ')}`)
}

async function readPatch() {
  const { readFile } = await import('node:fs/promises')
  const home = process.env.DSH_HOME ?? `${process.env.HOME}/.dsh`
  try {
    return await readFile(`${home}/profiles/${profile}/cordis.patch.yml`, 'utf8')
  } catch {
    return ''
  }
}
