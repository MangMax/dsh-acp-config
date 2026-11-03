// The "ACP mode" settings section.
//
// Everything here is plain React built through `createElement` (the Client half
// is bundled as an IIFE and has no JSX transform), and every string goes through
// the dictionary in `./locale.js`. The component tree is defensive on purpose:
// the Host may be missing, the RPC may fail, and status fields may be absent —
// an uncaught error would clear the whole settings slot.
//
// The page is split into four tabs (plugins, agent mode, sandbox permission,
// status) so no single column has to carry the whole configuration. Tab state
// lives in `Page` next to the draft, status and search state, so switching tabs
// never resets unsaved edits; only the rendered panel changes. Two settings
// (agent mode, sandbox permission) are three-way choices that mirror the plugin
// rows' "inherit" semantics: inherit the Web profile's live value, leave the ACP
// default alone, or pin a concrete value. They are rendered with the same
// `dac-seg` control as the plugin rows; pinning turns the card list below into a
// radio group.
//
// Every list (plugin rows per group, agent presets, sandbox levels) uses the
// official plugins-page card: a folded face with the name, purpose, mono id and
// a status tag, plus a details drawer with the loader entry id, a `dl` table and
// (for plugin rows) the three-way control. Card geometry follows
// docs/OFFICIAL-UI-SPEC.md.
//
// Transient feedback is raised as toasts (fixed above the sticky action bar,
// capped at three, success auto-dismissed) rather than as inline notice strips:
// the page has no side-rule notice blocks left.
import type {
  AgentModeChoice,
  LockReason,
  LocalizedText,
  PluginMode,
  PluginRowView,
  PresetOption,
  SandboxApproval,
  SandboxChoice,
  SandboxMode,
  SavePayload,
  SaveRequest,
  StatusPayload,
  WebPermission,
  WireMethod,
} from '../shared/contract.js'
import { SANDBOX_MODES } from '../shared/contract.js'
import {
  hasMessage,
  langOf,
  translate,
  type Lang,
  type MessageKey,
  type Translate,
  type Vars,
} from './locale.js'
import { STYLES } from './styles.js'

/** A rendered React element. The structural facade below keeps this file free of a `react` dependency. */
export type Element = unknown

/** The subset of `react` this page uses; obtained with `require('react')` inside the factory. */
export interface ReactLike {
  createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): Element
  useState<S>(initial: S | (() => S)): [S, (next: S | ((previous: S) => S)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  useSyncExternalStore<T>(subscribe: (onChange: () => void) => () => void, getSnapshot: () => T): T
}

/** Element factory: DOM tags take loose props, components take their own props type. */
export interface CreateElement {
  (type: string, props?: Record<string, unknown> | null, ...children: unknown[]): Element
  <P>(
    type: (props: P) => Element,
    props?: (P & { key?: string }) | null,
    ...children: unknown[]
  ): Element
}

/** Client services this page reads through the injected context. */
export interface ClientContextLike {
  connection: {
    rpc: {
      call: (
        prefix: string,
        endpoint: string,
        payload: { method: string; args?: unknown },
      ) => Promise<unknown>
    }
  }
  locale: {
    getLocale: () => { active: string }
    subscribe: (onChange: () => void) => () => void
  }
}

/** Props the settings shell hands to a section. */
export interface PageProps {
  close?: () => void
}

const RPC_PREFIX = '/api'
const RPC_ENDPOINT = 'dsh-acp-config'

/** Approval policy the shipped ACP presets pair with each sandbox mode. */
const SANDBOX_APPROVAL: Record<SandboxMode, SandboxApproval> = {
  'read-only': 'ask',
  'workspace-write': 'ask',
  'danger-full-access': 'never',
}

const WEB_STATES = ['on', 'off', 'absent'] as const
const ACP_STATES = ['on', 'off', 'dynamic', 'absent'] as const
const PLUGIN_MODES = ['inherit', 'on', 'off'] as const
const LOCK_REASONS = ['preset-managed', 'infra', 'not-in-acp', 'acp-only', 'unaddressable'] as const

// ---------------------------------------------------------------------------
// Wire helpers
// ---------------------------------------------------------------------------

type Outcome<T> = { ok: true; value: T } | { ok: false; code: string; detail: string }

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isText(value: unknown): value is string {
  return typeof value === 'string'
}

function oneOf<V extends string>(value: unknown, allowed: readonly V[], fallback: V): V {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as V)
    : fallback
}

function optionalOneOf<V extends string>(value: unknown, allowed: readonly V[]): V | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as V)
    : undefined
}

function sandboxHeadOf(value: unknown): SandboxMode | null {
  return optionalOneOf(value, SANDBOX_MODES) ?? null
}

function approvalOf(value: unknown): SandboxApproval | null {
  return optionalOneOf(value, ['ask', 'never'] as const) ?? null
}

/**
 * Normalize the Web profile's permission preset.
 *
 * A Host that predates the permission-preset fix still sends the bare sandbox
 * mode in `sandbox.web`; that shape is recovered as a preset named after the
 * mode with the shipped table's approval. A preset name is NOT a sandbox mode
 * (`auto` and `danger-full-access` share a sandbox but pair different approvals),
 * so a bare string that is not a mode is resolved through `known` (the presets
 * the same reply listed) before it is given up on as unreadable.
 */
function webPermissionOf(
  value: unknown,
  known: readonly WebPermission[] = [],
): WebPermission | null {
  if (typeof value === 'string') {
    const sandbox = sandboxHeadOf(value)
    if (sandbox !== null) {
      return { preset: value, sandbox, approval: SANDBOX_APPROVAL[sandbox] }
    }
    return known.find((permission) => permission.preset === value) ?? null
  }
  if (!isRecord(value)) return null
  const preset = asText(value.preset)
  const sandbox = sandboxHeadOf(value.sandbox) ?? sandboxHeadOf(preset)
  if (sandbox === null) {
    const match = known.find((permission) => permission.preset === preset)
    if (match !== undefined) return match
    return null
  }
  return {
    preset: preset === '' ? sandbox : preset,
    sandbox,
    approval: approvalOf(value.approval) ?? SANDBOX_APPROVAL[sandbox],
  }
}

function webPermissionsOf(value: unknown): WebPermission[] {
  const out: WebPermission[] = []
  for (const raw of asArray(value)) {
    const permission = webPermissionOf(raw)
    if (permission !== null) out.push(permission)
  }
  return out
}

/**
 * A Host that predates the three-way choice still answers `status` without
 * `choice`. Degrade to "ACP default" instead of guessing at a pinned value: the
 * segment shows a real, selectable state and saving a plugin row stays possible.
 */
function agentChoiceOf(value: unknown): AgentModeChoice {
  if (isRecord(value)) {
    if (value.mode === 'inherit') return { mode: 'inherit' }
    if (value.mode === 'preset') {
      const id = asText(value.id)
      if (id !== '') return { mode: 'preset', id }
    }
  }
  return { mode: 'acp-default' }
}

function sandboxChoiceOf(value: unknown): SandboxChoice {
  if (isRecord(value)) {
    if (value.mode === 'inherit') return { mode: 'inherit' }
    if (value.mode === 'sandbox') {
      const sandbox = sandboxHeadOf(value.sandbox)
      if (sandbox !== null) return { mode: 'sandbox', sandbox }
    }
  }
  return { mode: 'acp-default' }
}

function localTextOf(value: unknown): LocalizedText | undefined {
  if (typeof value === 'string') return value === '' ? undefined : { en: value }
  if (!isRecord(value)) return undefined
  const en = asText(value.en)
  if (en === '') return undefined
  const out: LocalizedText = { en }
  for (const [key, text] of Object.entries(value)) {
    if (key !== 'en' && typeof text === 'string') out[key] = text
  }
  return out
}

function normalizeRow(value: unknown): PluginRowView | null {
  if (!isRecord(value)) return null
  const id = asText(value.id)
  if (id === '') return null
  const locked = optionalOneOf(value.locked, LOCK_REASONS)
  // The Host fills `group`; a reply from before that field existed degrades to
  // the lock-derived split (preset-managed rows are the session rows).
  const group: PluginRowView['group'] =
    value.group === 'session'
      ? 'session'
      : value.group === 'global'
        ? 'global'
        : locked === 'preset-managed'
          ? 'session'
          : 'global'
  return {
    id,
    group,
    presetName: localTextOf(value.presetName),
    moduleName: asText(value.moduleName) || id,
    title: localTextOf(value.title),
    description: localTextOf(value.description),
    web: oneOf(value.web, WEB_STATES, 'absent'),
    acp: oneOf(value.acp, ACP_STATES, 'absent'),
    webFiber: asText(value.webFiber) || undefined,
    mode: oneOf(value.mode, PLUGIN_MODES, 'inherit'),
    locked,
    drift: value.drift === true,
  }
}

function normalizePreset(value: unknown): PresetOption | null {
  if (!isRecord(value)) return null
  const id = asText(value.id)
  if (id === '') return null
  const rowCount = value.rowCount
  return {
    id,
    title: localTextOf(value.title),
    description: localTextOf(value.description),
    rowCount: typeof rowCount === 'number' && Number.isFinite(rowCount) ? rowCount : undefined,
  }
}

/** Rebuild a `StatusPayload` field by field so a partial Host reply cannot crash the page. */
function normalizeStatus(value: unknown): StatusPayload | null {
  if (!isRecord(value)) return null
  const acp = isRecord(value.acp) ? value.acp : {}
  const agentMode = isRecord(value.agentMode) ? value.agentMode : {}
  const sandbox = isRecord(value.sandbox) ? value.sandbox : {}
  const apply = isRecord(value.apply) ? value.apply : {}

  const rows: PluginRowView[] = []
  for (const raw of asArray(value.rows)) {
    const row = normalizeRow(raw)
    if (row !== null) rows.push(row)
  }
  const presets: PresetOption[] = []
  for (const raw of asArray(value.presets)) {
    const preset = normalizePreset(raw)
    if (preset !== null) presets.push(preset)
  }

  const agentReason = asText(agentMode.reason)
  const sandboxReason = asText(sandbox.reason)
  // Presets first: the Web value may name a preset that is not a sandbox mode,
  // and only the preset list can resolve that name to its real pairing.
  const webPresets = webPermissionsOf(sandbox.webPresets)
  return {
    ok: true,
    acp: {
      name: asText(acp.name) || 'acp',
      dir: asText(acp.dir),
      exists: asBool(acp.exists, true),
      patchPath: asText(acp.patchPath),
      bundles: asArray(acp.bundles).filter(isText),
    },
    rows,
    presets,
    agentMode: {
      value: asText(agentMode.value) || null,
      choice: agentChoiceOf(agentMode.choice),
      web: asText(agentMode.web) || null,
      drift: agentMode.drift === true,
      available: asBool(agentMode.available, false),
      ...(agentReason === '' ? {} : { reason: agentReason }),
    },
    sandbox: {
      mode: sandboxHeadOf(sandbox.mode),
      approval: approvalOf(sandbox.approval),
      choice: sandboxChoiceOf(sandbox.choice),
      web: webPermissionOf(sandbox.web, webPresets),
      webPresets,
      drift: sandbox.drift === true,
      available: asBool(sandbox.available, false),
      ...(sandboxReason === '' ? {} : { reason: sandboxReason }),
    },
    apply: {
      lastSavedAt: asText(apply.lastSavedAt) || null,
      drift: asArray(apply.drift).filter(isText),
    },
    warnings: asArray(value.warnings).filter(isText),
  }
}

/** What the page needs out of a `SavePayload`, without trusting its optional fields. */
interface SaveView {
  savedAt: string | null
  changed: string[]
  warnings: string[]
}

function normalizeSave(value: unknown): SaveView {
  if (!isRecord(value)) return { savedAt: null, changed: [], warnings: [] }
  return {
    savedAt: asText(value.savedAt) || null,
    changed: asArray(value.changed).filter(isText),
    warnings: asArray(value.warnings).filter(isText),
  }
}

/** What the page needs out of a `ValidatePayload`. */
interface ValidateView {
  source: 'live' | 'unavailable'
  agentMode: string | null
  sandbox: SandboxMode | null
  warnings: string[]
}

function normalizeValidate(value: unknown): ValidateView {
  const raw = isRecord(value) ? value : {}
  const verification = isRecord(raw.verification) ? raw.verification : {}
  const source = verification.source === 'live' ? 'live' : 'unavailable'
  return {
    source,
    agentMode: asText(raw.agentMode) || null,
    sandbox: sandboxHeadOf(raw.sandbox),
    warnings: asArray(raw.warnings).filter(isText),
  }
}

function describeThrown(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return ''
}

/** One RPC round-trip through `connection.rpc.call`, with both failure channels folded into one value. */
async function callHost<T>(
  ctx: ClientContextLike,
  method: WireMethod,
  args: unknown,
): Promise<Outcome<T>> {
  let raw: unknown
  try {
    raw = await ctx.connection.rpc.call(RPC_PREFIX, RPC_ENDPOINT, { method, args })
  } catch (error) {
    return { ok: false, code: 'network', detail: describeThrown(error) }
  }
  if (!isRecord(raw)) {
    return raw === undefined
      ? { ok: false, code: 'bad-response', detail: '' }
      : { ok: false, code: 'bad-response', detail: describeThrown(raw) }
  }
  // `rpc.call` resolves the ConnectionRpcResult envelope: `{ ok: true, value: <payload> }`.
  // Returning `raw` here would hand callers the envelope instead of the payload.
  if (raw.ok === true) {
    if (!isRecord(raw.value)) return { ok: false, code: 'bad-response', detail: '' }
    return { ok: true, value: raw.value as T }
  }
  const failure = raw.error
  if (isRecord(failure)) {
    return {
      ok: false,
      code: asText(failure.code) || 'generic',
      detail: asText(failure.message),
    }
  }
  if (typeof failure === 'string') return { ok: false, code: 'generic', detail: failure }
  return { ok: false, code: 'bad-response', detail: '' }
}

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------

/** Editable copy of the Host's answer: everything the user can change before saving. */
interface Draft {
  plugins: Record<string, PluginMode>
  agentMode: AgentModeChoice
  sandboxMode: SandboxChoice
}

function draftOf(status: StatusPayload): Draft {
  const plugins: Record<string, PluginMode> = {}
  for (const row of status.rows) {
    if (row.locked === undefined) plugins[row.id] = row.mode
  }
  return {
    plugins,
    agentMode: status.agentMode.choice,
    sandboxMode: status.sandbox.choice,
  }
}

/** Structural equality for the two choice unions (they carry at most one extra field). */
function sameAgentChoice(left: AgentModeChoice, right: AgentModeChoice): boolean {
  if (left.mode !== right.mode) return false
  return left.mode !== 'preset' || right.mode !== 'preset' || left.id === right.id
}

function sameSandboxChoice(left: SandboxChoice, right: SandboxChoice): boolean {
  if (left.mode !== right.mode) return false
  return left.mode !== 'sandbox' || right.mode !== 'sandbox' || left.sandbox === right.sandbox
}

function isDirty(status: StatusPayload | null, draft: Draft | null): boolean {
  if (status === null || draft === null) return false
  if (status.agentMode.available && !sameAgentChoice(draft.agentMode, status.agentMode.choice)) {
    return true
  }
  if (status.sandbox.available && !sameSandboxChoice(draft.sandboxMode, status.sandbox.choice)) {
    return true
  }
  for (const row of status.rows) {
    if (row.locked !== undefined) continue
    if ((draft.plugins[row.id] ?? row.mode) !== row.mode) return true
  }
  return false
}

/**
 * Build the save request.
 *
 * `plugins` must carry EVERY switchable row, not just the edited ones: the
 * contract documents "rows absent here keep `inherit`", so sending a delta would
 * silently reset every untouched row back to inherit. `agentMode` /
 * `sandboxMode` are different: `undefined` means "keep this page's saved
 * choice", so an untouched control must be omitted entirely — otherwise a
 * plugin-only save would also pin the ACP sandbox to whatever the page displayed.
 */
function saveRequestOf(status: StatusPayload, draft: Draft): SaveRequest {
  const plugins: Record<string, PluginMode> = {}
  for (const row of status.rows) {
    if (row.locked !== undefined) continue
    plugins[row.id] = draft.plugins[row.id] ?? row.mode
  }
  const request: SaveRequest = { plugins }
  if (status.agentMode.available && !sameAgentChoice(draft.agentMode, status.agentMode.choice)) {
    request.agentMode = draft.agentMode
  }
  if (status.sandbox.available && !sameSandboxChoice(draft.sandboxMode, status.sandbox.choice)) {
    request.sandboxMode = draft.sandboxMode
  }
  return request
}

/** The effective value a choice would resolve to, as far as the page can know it. */
function agentValueAfter(status: StatusPayload, choice: AgentModeChoice): string | null {
  if (choice.mode === 'preset') return choice.id
  if (choice.mode === 'inherit') return status.agentMode.web ?? status.agentMode.value
  return status.agentMode.value
}

function sandboxValueAfter(status: StatusPayload, choice: SandboxChoice): SandboxMode | null {
  if (choice.mode === 'sandbox') return choice.sandbox
  if (choice.mode === 'inherit') return status.sandbox.web?.sandbox ?? status.sandbox.mode
  return status.sandbox.mode
}

/**
 * Approval policy the page expects ACP to compose after this choice is saved.
 * An inherited preset carries its own approval (`auto` is full access + ask, not
 * never), so it must come from the Web preset rather than the mode's table row.
 */
function sandboxApprovalAfter(
  status: StatusPayload,
  choice: SandboxChoice,
): SandboxApproval | null {
  if (choice.mode === 'sandbox') return SANDBOX_APPROVAL[choice.sandbox]
  if (choice.mode === 'inherit') {
    return status.sandbox.web?.approval ?? status.sandbox.approval
  }
  return status.sandbox.approval
}

/** Optimistic post-save status: the Host applied exactly the draft, so the draft becomes the baseline. */
function afterSave(status: StatusPayload, draft: Draft, savedAt: string | null): StatusPayload {
  const rows = status.rows.map((row) => {
    if (row.locked !== undefined) return { ...row, drift: false }
    return { ...row, mode: draft.plugins[row.id] ?? row.mode, drift: false }
  })
  return {
    ...status,
    rows,
    agentMode: {
      ...status.agentMode,
      choice: draft.agentMode,
      value: status.agentMode.available
        ? agentValueAfter(status, draft.agentMode)
        : status.agentMode.value,
      drift: false,
    },
    sandbox: {
      ...status.sandbox,
      choice: draft.sandboxMode,
      mode: status.sandbox.available
        ? sandboxValueAfter(status, draft.sandboxMode)
        : status.sandbox.mode,
      approval: status.sandbox.available
        ? sandboxApprovalAfter(status, draft.sandboxMode)
        : status.sandbox.approval,
      drift: false,
    },
    apply: { lastSavedAt: savedAt ?? status.apply.lastSavedAt, drift: [] },
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** Localized text resolution: active language, then English, then any shipped value. */
function resolveText(text: LocalizedText | undefined, lang: Lang): string {
  if (text === undefined) return ''
  const preferred = text[lang]
  if (typeof preferred === 'string' && preferred !== '') return preferred
  if (typeof text.en === 'string' && text.en !== '') return text.en
  for (const value of Object.values(text)) {
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

function formatWhen(iso: string | null, fallback: string): string {
  if (iso === null || iso === '') return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  try {
    return date.toLocaleString()
  } catch {
    return iso
  }
}

/**
 * One inline error line: the stable wire code (quoted, so a bug report can carry
 * it), the localized meaning, then the Host's own message.
 */
function errorLine(t: Translate, code: string, detail: string): string {
  const key = `error.${code}`
  const base = hasMessage(key) ? t(key) : t('error.generic')
  const tag = code === '' ? '' : `[${code}] `
  const trimmed = detail.trim()
  const head = `${tag}${base}`
  return trimmed === '' ? head : `${head}: ${trimmed}`
}

function stateKey(state: PluginRowView['web'] | PluginRowView['acp']): MessageKey {
  return `state.${state}`
}

function lockKey(reason: LockReason): MessageKey {
  return `lock.${reason}`
}

function lockHintKey(reason: LockReason): MessageKey {
  return `lock.${reason}.hint`
}

/**
 * Localized name of a Web permission preset.
 *
 * A preset is not a sandbox mode: `auto` resolves to full access with approvals,
 * while `danger-full-access` resolves to full access without them. Known presets
 * therefore read their own vocabulary; an unknown preset keeps its raw key so a
 * future Web preset still shows something meaningful instead of a blank.
 */
function permissionNameOf(t: Translate, preset: string): string {
  const key = `permission.${preset}`
  return hasMessage(key) ? t(key) : preset
}

/**
 * Label for a sandbox level inside the inherit note, in the permission-preset
 * vocabulary, so the note reads "preset 完全权限 → sandbox 完全权限" rather than
 * mixing two names for one level.
 */
function sandboxLabelOf(t: Translate, sandbox: SandboxMode): string {
  const key = `permission.${sandbox}`
  return hasMessage(key) ? t(key) : t(`sandbox.${sandbox}.title`)
}

/**
 * The Web preset that describes one pinned sandbox level, if any.
 * A preset whose name IS the level (`danger-full-access`) wins over a preset that
 * merely resolves to it (`auto`): the former's approval is what the pin writes.
 */
function presetForSandbox(
  presets: readonly WebPermission[],
  sandbox: SandboxMode,
): WebPermission | null {
  const exact = presets.find((preset) => preset.preset === sandbox)
  if (exact !== undefined) return exact
  return presets.find((preset) => preset.sandbox === sandbox) ?? null
}

/** The three segments both choice controls share; "pin" opens the radio cards. */
type ChoiceMode = 'inherit' | 'acp-default' | 'pin'

function choiceModeOf(choice: AgentModeChoice | SandboxChoice): ChoiceMode {
  if (choice.mode === 'inherit') return 'inherit'
  if (choice.mode === 'acp-default') return 'acp-default'
  return 'pin'
}

// ---------------------------------------------------------------------------
// Page factory
// ---------------------------------------------------------------------------

/** Build the section component; `React` and `ctx` are captured once so hooks stay stable. */
export function createPage(React: ReactLike, ctx: ClientContextLike) {
  // Bound once (React.createElement must keep its receiver) and overloaded so
  // passing a component contextually types its props; a plain
  // `Record<string, unknown>` signature would silently accept anything.
  const h = ((type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) =>
    React.createElement(type, props, ...children)) as CreateElement

  const subscribeLocale = (onChange: () => void): (() => void) => {
    try {
      return ctx.locale.subscribe(onChange)
    } catch {
      return () => {}
    }
  }
  const readLocale = (): string => {
    try {
      const active = ctx.locale.getLocale().active
      return typeof active === 'string' ? active : 'en'
    } catch {
      return 'en'
    }
  }

  type Tone = 'on' | 'off' | 'absent' | 'dynamic' | 'warn' | 'accent' | 'danger'

  function Badge(props: {
    key?: string
    tone: Tone
    label: string
    value?: string
    title?: string
  }): Element {
    return h(
      'span',
      { className: `dac-badge dac-badge-${props.tone}`, title: props.title },
      h('span', { className: 'dac-dot', 'aria-hidden': 'true' }),
      props.label,
      props.value === undefined ? null : ' ',
      props.value === undefined ? null : props.value,
    )
  }

  function SectionHead(props: { title: string; desc?: string }): Element {
    return h(
      'div',
      { className: 'dac-section-head' },
      h('h3', { className: 'dac-section-title' }, props.title),
      props.desc === undefined ? null : h('p', { className: 'dac-section-desc' }, props.desc),
    )
  }

  /** One label/value pair of the summary grid (spread as two grid children). */
  function kvPair(label: string, value: string, mono = false): Element[] {
    return [
      h('div', { className: 'dac-kv-key', key: `${label}-key` }, label),
      h(
        'div',
        { className: mono ? 'dac-kv-val dac-mono' : 'dac-kv-val', key: `${label}-val` },
        value === '' ? '—' : value,
      ),
    ]
  }

  /** The plugin rows' three-way switch; the choice controls reuse it unchanged. */
  function Segmented(props: {
    t: Translate
    value: PluginMode
    ariaLabel: string
    onChange: (mode: PluginMode) => void
  }): Element {
    const options: ReadonlyArray<readonly [PluginMode, MessageKey]> = [
      ['inherit', 'plugins.inherit'],
      ['on', 'plugins.on'],
      ['off', 'plugins.off'],
    ]
    return h(
      'div',
      { className: 'dac-seg', role: 'radiogroup', 'aria-label': props.ariaLabel },
      options.map(([mode, key]) =>
        h(
          'button',
          {
            key: mode,
            type: 'button',
            role: 'radio',
            'aria-checked': props.value === mode ? 'true' : 'false',
            className: 'dac-seg-btn',
            onClick: () => props.onChange(mode),
          },
          props.t(key),
        ),
      ),
    )
  }

  /**
   * Three-way choice switch for Agent mode / sandbox: inherit the Web value,
   * keep the ACP default, or pin a concrete value (the radio cards below).
   * A disabled inherit segment keeps its reason in `title` so it is never a
   * silent omission.
   */
  function ChoiceSeg(props: {
    ariaLabel: string
    value: ChoiceMode
    inheritLabel: string
    inheritDisabled: boolean
    inheritTitle?: string
    acpDefaultLabel: string
    acpDefaultDisabled: boolean
    acpDefaultTitle?: string
    pinLabel: string
    pinDisabled: boolean
    pinTitle?: string
    onChange: (mode: ChoiceMode) => void
  }): Element {
    const buttons: ReadonlyArray<{
      mode: ChoiceMode
      label: string
      disabled: boolean
      title?: string
    }> = [
      {
        mode: 'inherit',
        label: props.inheritLabel,
        disabled: props.inheritDisabled,
        title: props.inheritTitle,
      },
      {
        mode: 'acp-default',
        label: props.acpDefaultLabel,
        disabled: props.acpDefaultDisabled,
        title: props.acpDefaultDisabled ? props.acpDefaultTitle : undefined,
      },
      {
        mode: 'pin',
        label: props.pinLabel,
        disabled: props.pinDisabled,
        title: props.pinTitle,
      },
    ]
    return h(
      'div',
      { className: 'dac-seg', role: 'radiogroup', 'aria-label': props.ariaLabel },
      buttons.map((button) =>
        h(
          'button',
          {
            key: button.mode,
            type: 'button',
            role: 'radio',
            'aria-checked': props.value === button.mode ? 'true' : 'false',
            className: 'dac-seg-btn',
            disabled: button.disabled,
            title: button.title,
            onClick: () => props.onChange(button.mode),
          },
          button.label,
        ),
      ),
    )
  }

  /** Official chevron: a 12px SVG that points down when folded, up when open. */
  function Chevron(props: { open: boolean }): Element {
    return h(
      'svg',
      {
        className: props.open ? 'dac-chevron dac-chevron-open' : 'dac-chevron',
        width: 12,
        height: 12,
        viewBox: '0 0 16 16',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('path', {
        d: 'M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    )
  }

  /**
   * The details drawer shared by every card: the loader-entry id, the official
   * `dl` table, and an optional footer (the three-way control or a lock hint).
   */
  function CardDetails(props: {
    id: string
    entry: string
    items: ReadonlyArray<readonly [string, string]>
    footer?: Element
  }): Element {
    return h(
      'div',
      { className: 'dac-card-details', id: props.id },
      h('code', { className: 'dac-entry', 'data-loader-entry': 'true' }, props.entry),
      h(
        'dl',
        { className: 'dac-card-dl' },
        props.items.map(([label, value]) =>
          h(
            'div',
            { className: 'dac-card-dl-row', key: label },
            h('dt', null, label),
            h('dd', null, value),
          ),
        ),
      ),
      props.footer === undefined ? null : props.footer,
    )
  }

  /**
   * One official-style card: folded it shows the name, description, mono id and
   * a status tag; the drawer carries the `dl` table and (for plugin rows) the
   * three-way control.
   *
   * Selectable cards (a pinned agent preset / sandbox level) put the radio
   * semantics on the main content button and keep the chevron as a separate
   * button, so choosing a value and reading its details stay different actions.
   */
  function OfficialCard(props: {
    t: Translate
    id: string
    contentId: string
    title: string
    titleAttr?: string
    desc?: string
    meta?: string
    risk?: string
    tag?: string
    /** Interactive control rendered beside the card text (never inside the button). */
    trailing?: Element
    open: boolean
    selectable: boolean
    selected: boolean
    entry: string
    items: ReadonlyArray<readonly [string, string]>
    footer?: Element
    ariaLabel: string
    onToggle: () => void
    onSelect?: () => void
    onKeyDown?: (event: { key: string; preventDefault: () => void }) => void
  }): Element {
    const body = [
      h('strong', { className: 'dac-card-title', title: props.titleAttr }, props.title),
      props.desc === undefined || props.desc === ''
        ? null
        : h('span', { className: 'dac-card-desc' }, props.desc),
      props.risk === undefined || props.risk === ''
        ? null
        : h('span', { className: 'dac-card-risk' }, props.risk),
      props.meta === undefined ? null : h('span', { className: 'dac-card-meta' }, props.meta),
    ]
    const content = props.selectable
      ? h(
          'button',
          {
            type: 'button',
            className: 'dac-card-content',
            id: props.contentId,
            role: 'radio',
            'aria-checked': props.selected ? 'true' : 'false',
            'aria-label': props.ariaLabel,
            tabIndex: props.selected ? 0 : -1,
            onClick: props.onSelect,
            onKeyDown: props.onKeyDown,
          },
          ...body,
        )
      : h(
          'button',
          {
            type: 'button',
            className: 'dac-card-content',
            id: props.contentId,
            'aria-expanded': props.open ? 'true' : 'false',
            'aria-controls': props.id,
            'aria-label': props.ariaLabel,
            onClick: props.onToggle,
            onKeyDown: props.onKeyDown,
          },
          ...body,
        )
    const aside = h(
      'div',
      { className: 'dac-card-aside' },
      props.tag === undefined ? null : h('span', { className: 'dac-tag' }, props.tag),
      props.trailing === undefined ? null : props.trailing,
      h(
        'button',
        {
          type: 'button',
          className: 'dac-card-toggle',
          'aria-expanded': props.open ? 'true' : 'false',
          'aria-controls': props.id,
          'aria-label': props.open ? props.t('card.collapse') : props.t('card.expand'),
          onClick: props.onToggle,
        },
        h(Chevron, { open: props.open }),
      ),
    )
    return h(
      'li',
      {
        className: [
          'dac-card',
          props.selectable ? 'dac-card-select' : '',
          props.selected ? 'dac-card-on' : '',
        ]
          .filter((part) => part !== '')
          .join(' '),
      },
      h('div', { className: 'dac-card-head' }, content, aside),
      props.open
        ? h(CardDetails, {
            id: props.id,
            entry: props.entry,
            items: props.items,
            footer: props.footer,
          })
        : null,
    )
  }

  /** The three-way mode of one plugin row, as a localized label. */
  function pluginModeLabel(t: Translate, mode: PluginMode): string {
    if (mode === 'on') return t('plugins.on')
    if (mode === 'off') return t('plugins.off')
    return t('plugins.inherit')
  }

  /** The tag a folded plugin card shows: lock state, this page's override, or the Web fallback. */
  function pluginTagOf(t: Translate, row: PluginRowView, mode: PluginMode): string {
    if (row.locked !== undefined) return t(lockKey(row.locked))
    if (mode === 'on') return t('plugins.on')
    if (mode === 'off') return t('plugins.off')
    return row.web === 'off'
      ? t('tag.webOff')
      : t('tag.inheritWeb', { state: t(stateKey(row.web)) })
  }

  /** Localized display name for one agent-preset id (`standard` → 标准模式). */
  function presetLabel(t: Translate, id: string): string {
    const key = `preset.${id}`
    return hasMessage(key) ? t(key) : id
  }

  /** `webFiber` → the run-state cell of the details table (`—` when unknown). */
  function fiberLabelOf(t: Translate, fiber: string | undefined): string {
    if (fiber === undefined || fiber === '') return '—'
    if (fiber === 'active') return t('fiber.active')
    if (fiber === 'failed') return t('fiber.failed')
    return fiber
  }

  /** The six detail rows every plugin card carries. */
  function pluginDetailItems(
    t: Translate,
    lang: Lang,
    row: PluginRowView,
    mode: PluginMode,
  ): ReadonlyArray<readonly [string, string]> {
    const override = row.drift
      ? t('detail.overrideDrift', { mode: pluginModeLabel(t, mode) })
      : pluginModeLabel(t, mode)
    const preset = resolveText(row.presetName, lang)
    const presetManaged = row.locked === 'preset-managed'
    const owner =
      row.group === 'session'
        ? preset === ''
          ? t('group.session')
          : t('detail.ownerPreset', { preset: presetLabel(t, preset) })
        : t('group.global')
    return [
      [t('detail.fullName'), row.moduleName],
      // A preset owns this row: its top-level `disabled` is always true, so
      // showing 开/关 here would contradict the preset that actually mounts it.
      [t('detail.web'), presetManaged ? t('detail.byPreset') : t(stateKey(row.web))],
      [t('detail.acp'), presetManaged ? t('detail.byPreset') : t(stateKey(row.acp))],
      [t('detail.override'), override],
      [t('detail.fiber'), fiberLabelOf(t, row.webFiber)],
      [t('detail.owner'), owner],
    ]
  }

  function PluginCard(props: {
    t: Translate
    lang: Lang
    row: PluginRowView
    mode: PluginMode
    open: boolean
    onToggle: () => void
    onMode: (mode: PluginMode) => void
  }): Element {
    const { t, row } = props
    const resolvedTitle = resolveText(row.title, props.lang)
    // Several packages publish their own module name as `meta.title`; the loader
    // row id (`magpie-mcp-Deepwiki`) identifies the plugin far better.
    const title =
      resolvedTitle === '' || resolvedTitle === row.moduleName || resolvedTitle === row.id
        ? row.id
        : resolvedTitle
    const desc = resolveText(row.description, props.lang)
    const meta = row.id
    const tag = pluginTagOf(t, row, props.mode)
    return h(OfficialCard, {
      t,
      id: `dac-plugin-details-${row.id}`,
      contentId: `dac-plugin-card-${row.id}`,
      title,
      titleAttr: row.moduleName,
      desc,
      meta,
      tag,
      open: props.open,
      selectable: false,
      selected: false,
      entry: row.id,
      items: pluginDetailItems(t, props.lang, row, props.mode),
      ariaLabel: `${title}, ${meta}, ${tag}`,
      trailing:
        row.locked === undefined
          ? h(Segmented, {
              t,
              value: props.mode,
              ariaLabel: `${title} — ${t('detail.override')}`,
              onChange: props.onMode,
            })
          : undefined,
      footer:
        row.locked === undefined
          ? undefined
          : h('p', { className: 'dac-card-hint' }, t(lockHintKey(row.locked))),
      onToggle: props.onToggle,
    })
  }

  function PresetCard(props: {
    t: Translate
    lang: Lang
    preset: PresetOption
    status: StatusPayload
    selected: boolean
    selectable: boolean
    open: boolean
    onToggle: () => void
    onSelect: () => void
    onKeyDown: (event: { key: string; preventDefault: () => void }) => void
  }): Element {
    const { t, preset } = props
    const resolved = resolveText(preset.title, props.lang)
    const title = resolved === '' || resolved === preset.id ? presetLabel(t, preset.id) : resolved
    // The row count already rides in the description line; the tag carries the
    // state that is actually news (this page's pick, or what the Web side runs).
    const tag = props.selected
      ? t('tag.selected')
      : props.status.agentMode.web === preset.id
        ? t('tag.webCurrent')
        : undefined
    const isDefault = props.status.agentMode.value === preset.id
    return h(OfficialCard, {
      t,
      id: `dac-preset-details-${preset.id}`,
      contentId: `dac-preset-card-${preset.id}`,
      title,
      desc:
        resolveText(preset.description, props.lang) ||
        (preset.rowCount === undefined ? undefined : t('preset.composed', { n: preset.rowCount })),
      tag,
      open: props.open,
      selectable: props.selectable,
      selected: props.selected,
      entry: preset.id,
      items: [
        [t('detail.presetId'), preset.id],
        [t('detail.source'), t('source.acp')],
        [t('detail.default'), isDefault ? t('value.yes') : t('value.no')],
      ],
      ariaLabel:
        props.selectable === true
          ? t('card.select', { name: title })
          : tag === undefined
            ? title
            : `${title}, ${tag}`,
      onToggle: props.onToggle,
      onSelect: props.onSelect,
      onKeyDown: props.onKeyDown,
    })
  }

  function SandboxCard(props: {
    t: Translate
    sandbox: SandboxMode
    status: StatusPayload
    selected: boolean
    selectable: boolean
    open: boolean
    onToggle: () => void
    onSelect: () => void
    onKeyDown: (event: { key: string; preventDefault: () => void }) => void
  }): Element {
    const { t, sandbox } = props
    const written = SANDBOX_APPROVAL[sandbox]
    // A Web preset only names the source when it agrees with what a pin writes;
    // `auto` resolves to full access with approvals while pinning writes `never`.
    const webPreset = presetForSandbox(props.status.sandbox.webPresets, sandbox)
    const source =
      webPreset !== null && webPreset.approval === written
        ? t('source.webPreset', { preset: permissionNameOf(t, webPreset.preset) })
        : t('source.builtin')
    const title = t(`sandbox.${sandbox}.title`)
    return h(OfficialCard, {
      t,
      id: `dac-sandbox-details-${sandbox}`,
      contentId: `dac-sandbox-card-${sandbox}`,
      title,
      desc: t(`sandbox.${sandbox}.desc`),
      risk: sandbox === 'danger-full-access' ? t('sandbox.dangerFullAccess.risk') : undefined,
      meta: sandbox,
      tag: props.selected
        ? t('tag.selected')
        : props.status.sandbox.web?.sandbox === sandbox
          ? t('tag.webCurrent')
          : undefined,
      open: props.open,
      selectable: props.selectable,
      selected: props.selected,
      entry: sandbox,
      items: [
        [t('detail.sandbox'), sandbox],
        [t('detail.approval'), t(`approval.${written}`)],
        [t('detail.source'), source],
      ],
      ariaLabel: props.selectable === true ? t('card.select', { name: title }) : title,
      onToggle: props.onToggle,
      onSelect: props.onSelect,
      onKeyDown: props.onKeyDown,
    })
  }

  /** The drift badge + explanation shown when an inherit choice is stale. */
  function DriftNote(props: { t: Translate; show: boolean }): Element {
    if (!props.show) return null
    return h(
      'p',
      { className: 'dac-note dac-note-warn' },
      h(Badge, {
        tone: 'warn',
        label: props.t('choice.drift'),
        title: props.t('choice.driftHint'),
      }),
      ' ',
      props.t('choice.driftHint'),
    )
  }

  function AgentModeSection(props: {
    t: Translate
    lang: Lang
    status: StatusPayload
    draft: Draft
    onChange: (choice: AgentModeChoice) => void
    openCards: Record<string, boolean>
    onToggleCard: (key: string) => void
  }): Element {
    const { t, status } = props
    const available = status.agentMode.available
    const choice = props.draft.agentMode
    const mode = choiceModeOf(choice)
    const web = status.agentMode.web
    const presetTitle = (id: string): string => {
      const match = status.presets.find((preset) => preset.id === id)
      return match === undefined ? id : resolveText(match.title, props.lang) || id
    }
    const webLabel =
      web === null
        ? t('choice.inheritUnknown')
        : t('choice.inheritWeb', { value: presetTitle(web) })
    const pinId = choice.mode === 'preset' ? choice.id : null
    const firstPin = status.presets[0]?.id ?? ''
    const inheritBlocked = web === null
    const inheritReason = status.agentMode.reason ?? t('choice.noWebValue')
    // Keep "pick a preset" reachable when a stale pin is what the page is showing:
    // otherwise the user could leave the pin but never return to it.
    const pinDisabled = !available || (status.presets.length === 0 && pinId === null)
    const selectable = mode === 'pin' && available

    const switchTo = (next: ChoiceMode): void => {
      if (next === 'inherit') {
        props.onChange({ mode: 'inherit' })
        return
      }
      if (next === 'acp-default') {
        props.onChange({ mode: 'acp-default' })
        return
      }
      const id = pinId ?? status.agentMode.value ?? firstPin
      if (id === '') return
      props.onChange({ mode: 'preset', id })
    }

    /** Arrow keys move the pinned preset and focus its card, like a radio group. */
    const onCardKey = (event: { key: string; preventDefault: () => void }, index: number): void => {
      if (!selectable) return
      const presets = status.presets
      const last = presets.length - 1
      let next = -1
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        next = index === last ? 0 : index + 1
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        next = index === 0 ? last : index - 1
      } else if (event.key === 'Home') {
        next = 0
      } else if (event.key === 'End') {
        next = last
      }
      if (next < 0) return
      const preset = presets[next]
      if (preset === undefined) return
      event.preventDefault()
      props.onChange({ mode: 'preset', id: preset.id })
      document.getElementById(`dac-preset-card-${preset.id}`)?.focus()
    }

    const cards: Element[] = status.presets.map((preset, index) =>
      h(PresetCard, {
        key: preset.id,
        t,
        lang: props.lang,
        preset,
        status,
        selected: pinId === preset.id,
        selectable,
        open: props.openCards[`preset:${preset.id}`] === true,
        onToggle: () => props.onToggleCard(`preset:${preset.id}`),
        onSelect: () => props.onChange({ mode: 'preset', id: preset.id }),
        onKeyDown: (event: { key: string; preventDefault: () => void }) => onCardKey(event, index),
      }),
    )

    return h(
      'section',
      { className: 'dac-section' },
      h(SectionHead, { title: t('agentMode.title'), desc: t('agentMode.desc') }),
      h(ChoiceSeg, {
        ariaLabel: t('agentMode.title'),
        value: mode,
        inheritLabel: webLabel,
        inheritDisabled: !available || inheritBlocked,
        inheritTitle:
          available && !inheritBlocked
            ? undefined
            : t('choice.inheritBlocked', { reason: inheritReason }),
        acpDefaultLabel: t('choice.acpDefault'),
        acpDefaultDisabled: !available,
        acpDefaultTitle: t('choice.acpDefaultBlocked'),
        pinLabel: t('choice.pinAgent'),
        pinDisabled: pinDisabled,
        pinTitle: pinDisabled ? t('choice.pinAgentHint') : undefined,
        onChange: switchTo,
      }),
      mode === 'inherit' && web !== null
        ? h('p', { className: 'dac-note' }, t('choice.inheritNote', { value: presetTitle(web) }))
        : null,
      mode === 'acp-default' ? h('p', { className: 'dac-note' }, t('choice.acpDefaultDesc')) : null,
      inheritBlocked
        ? h(
            'p',
            { className: 'dac-note dac-note-warn' },
            t('choice.inheritBlocked', { reason: inheritReason }),
          )
        : null,
      h(DriftNote, {
        t,
        show: mode === 'inherit' && status.agentMode.drift,
      }),
      status.presets.length === 0
        ? h('p', { className: 'dac-note' }, t('agentMode.empty'))
        : h(
            'ul',
            {
              className: 'dac-cards',
              role: selectable ? 'radiogroup' : undefined,
              'aria-label': selectable ? t('agentMode.title') : undefined,
            },
            cards,
          ),
      available
        ? null
        : h(
            'p',
            { className: 'dac-note dac-note-warn' },
            status.agentMode.reason === undefined
              ? t('agentMode.unavailableHint')
              : t('agentMode.unavailable', { reason: status.agentMode.reason }),
          ),
    )
  }

  function SandboxSection(props: {
    t: Translate
    status: StatusPayload
    draft: Draft
    onChange: (choice: SandboxChoice) => void
    openCards: Record<string, boolean>
    onToggleCard: (key: string) => void
  }): Element {
    const { t, status } = props
    const available = status.sandbox.available
    const choice = props.draft.sandboxMode
    const mode = choiceModeOf(choice)
    const web = status.sandbox.web
    // The Web value is a permission PRESET, not a bare mode: `auto` and
    // `danger-full-access` both resolve to full access but pair different
    // approval policies, so the preset name is what identifies the Web choice.
    const webLabel =
      web === null
        ? t('choice.inheritUnknown')
        : t('choice.inheritWeb', { value: permissionNameOf(t, web.preset) })
    const pinned = choice.mode === 'sandbox' ? choice.sandbox : null
    const inheritBlocked = web === null
    const inheritReason = status.sandbox.reason ?? t('choice.noWebValue')
    const fallbackPin: SandboxMode = status.sandbox.mode ?? 'workspace-write'
    const selectable = mode === 'pin' && available

    const switchTo = (next: ChoiceMode): void => {
      if (next === 'inherit') {
        props.onChange({ mode: 'inherit' })
        return
      }
      if (next === 'acp-default') {
        props.onChange({ mode: 'acp-default' })
        return
      }
      props.onChange({ mode: 'sandbox', sandbox: pinned ?? fallbackPin })
    }

    /** Arrow keys move the pinned sandbox level and focus its card. */
    const onCardKey = (event: { key: string; preventDefault: () => void }, index: number): void => {
      if (!selectable) return
      const last = SANDBOX_MODES.length - 1
      let next = -1
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        next = index === last ? 0 : index + 1
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        next = index === 0 ? last : index - 1
      } else if (event.key === 'Home') {
        next = 0
      } else if (event.key === 'End') {
        next = last
      }
      if (next < 0) return
      const sandbox = SANDBOX_MODES[next]
      if (sandbox === undefined) return
      event.preventDefault()
      props.onChange({ mode: 'sandbox', sandbox })
      document.getElementById(`dac-sandbox-card-${sandbox}`)?.focus()
    }

    const cards: Element[] = SANDBOX_MODES.map((sandbox, index) =>
      h(SandboxCard, {
        key: sandbox,
        t,
        sandbox,
        status,
        selected: pinned === sandbox,
        selectable,
        open: props.openCards[`sandbox:${sandbox}`] === true,
        onToggle: () => props.onToggleCard(`sandbox:${sandbox}`),
        onSelect: () => props.onChange({ mode: 'sandbox', sandbox }),
        onKeyDown: (event: { key: string; preventDefault: () => void }) => onCardKey(event, index),
      }),
    )

    return h(
      'section',
      { className: 'dac-section' },
      h(SectionHead, { title: t('sandbox.title'), desc: t('sandbox.desc') }),
      h(ChoiceSeg, {
        ariaLabel: t('sandbox.title'),
        value: mode,
        inheritLabel: webLabel,
        inheritDisabled: !available || inheritBlocked,
        inheritTitle:
          available && !inheritBlocked
            ? undefined
            : t('choice.inheritBlocked', { reason: inheritReason }),
        acpDefaultLabel: t('choice.acpDefault'),
        acpDefaultDisabled: !available,
        acpDefaultTitle: t('choice.acpDefaultBlocked'),
        pinLabel: t('choice.pinSandbox'),
        pinDisabled: !available,
        pinTitle: !available ? t('choice.pinSandboxHint') : undefined,
        onChange: switchTo,
      }),
      // The inherited preset decides BOTH the sandbox and the approval policy, and
      // that pairing is not obvious (`auto` is full access + approvals), so the
      // note spells out the exact combination the save will write.
      mode === 'inherit' && web !== null
        ? h(
            'p',
            { className: 'dac-note' },
            t('choice.inheritResolved', {
              preset: permissionNameOf(t, web.preset),
              sandbox: sandboxLabelOf(t, web.sandbox),
              approval: t(`approval.${web.approval}`),
            }),
          )
        : null,
      mode === 'acp-default' ? h('p', { className: 'dac-note' }, t('choice.acpDefaultDesc')) : null,
      inheritBlocked
        ? h(
            'p',
            { className: 'dac-note dac-note-warn' },
            t('choice.inheritBlocked', { reason: inheritReason }),
          )
        : null,
      h(DriftNote, { t, show: mode === 'inherit' && status.sandbox.drift }),
      h(
        'ul',
        {
          className: 'dac-cards',
          role: selectable ? 'radiogroup' : undefined,
          'aria-label': selectable ? t('sandbox.title') : undefined,
        },
        cards,
      ),
      available
        ? null
        : h(
            'p',
            { className: 'dac-note dac-note-warn' },
            status.sandbox.reason === undefined
              ? t('sandbox.unavailableHint')
              : t('sandbox.unavailable', { reason: status.sandbox.reason }),
          ),
    )
  }

  // -------------------------------------------------------------------------
  // Tabs, toasts and the page
  // -------------------------------------------------------------------------

  /** The four page sections in tab order; the plugin list is the landing tab. */
  type TabKey = 'plugins' | 'agent' | 'sandbox' | 'status'

  const TAB_ORDER: readonly TabKey[] = ['plugins', 'agent', 'sandbox', 'status']

  const TAB_LABEL: Record<TabKey, MessageKey> = {
    plugins: 'tab.plugins',
    agent: 'tab.agentMode',
    sandbox: 'tab.sandbox',
    status: 'tab.status',
  }

  type ToastTone = 'ok' | 'warn' | 'error'

  /**
   * One entry of the notification queue. Copy is resolved when the toast is
   * raised, so switching the locale later never rewrites what is on screen.
   */
  interface ToastItem {
    id: number
    tone: ToastTone
    title: string
    detail?: string
    /** The unsaved-changes reload confirmation: rendered with two buttons. */
    reload?: boolean
  }

  interface ToastApi {
    push: (toast: Omit<ToastItem, 'id'>) => void
    dismiss: (id: number) => void
    clearReload: () => void
    dispose: () => void
  }

  /** Monotonic toast ids: unique even after the queue drops its oldest entry. */
  let toastSeq = 0

  /** Monotonic failure markers, so one failed read raises exactly one toast. */
  let failureSeq = 0

  /**
   * The tab strip. The active tab is marked with a bottom underline (never a
   * side rule); only the active panel is mounted, so the long plugin list is the
   * only heavy subtree on screen. Drafts and queries live in `Page`, not in a
   * panel, so switching tabs cannot reset them.
   */
  function TabBar(props: {
    t: Translate
    active: TabKey
    switchable: number
    warnings: number
    onSelect: (tab: TabKey) => void
    onKeyDown: (event: { key: string; preventDefault: () => void }, index: number) => void
  }): Element {
    return h(
      'div',
      { className: 'dac-tabs', role: 'tablist', 'aria-label': props.t('tabs.label') },
      TAB_ORDER.map((tab, index) =>
        h(
          'button',
          {
            key: tab,
            type: 'button',
            role: 'tab',
            id: `dac-tab-${tab}`,
            'aria-selected': props.active === tab ? 'true' : 'false',
            'aria-controls': `dac-panel-${tab}`,
            tabIndex: props.active === tab ? 0 : -1,
            className: 'dac-tab',
            onClick: () => props.onSelect(tab),
            onKeyDown: (event: { key: string; preventDefault: () => void }) =>
              props.onKeyDown(event, index),
          },
          props.t(TAB_LABEL[tab]),
          tab === 'plugins'
            ? h(
                'span',
                { className: 'dac-tab-badge' },
                props.t('tab.switchableBadge', { n: props.switchable }),
              )
            : null,
          tab === 'status' && props.warnings > 0
            ? h('span', {
                className: 'dac-tab-dot',
                title: props.t('tab.warnings', { n: props.warnings }),
                'aria-hidden': 'true',
              })
            : null,
        ),
      ),
    )
  }

  /**
   * The toast stack: fixed above the sticky action bar, so no notification ever
   * covers the save button. Success toasts announce politely and expire by
   * themselves; warnings and errors announce through the same live region but
   * stay until dismissed.
   */
  function ToastList(props: {
    t: Translate
    toasts: ToastItem[]
    onDismiss: (id: number) => void
    onReloadConfirm: () => void
  }): Element {
    return h(
      'div',
      { className: 'dac-toasts' },
      props.toasts.map((toast) =>
        h(
          'div',
          {
            key: String(toast.id),
            className: `dac-toast dac-toast-${toast.tone}`,
            role: toast.tone === 'error' ? 'alert' : 'status',
            'aria-live': toast.tone === 'error' ? 'assertive' : 'polite',
          },
          h('span', { className: 'dac-toast-dot', 'aria-hidden': 'true' }),
          h(
            'div',
            { className: 'dac-toast-body' },
            h('span', { className: 'dac-toast-title' }, toast.title),
            toast.detail === undefined
              ? null
              : h('span', { className: 'dac-toast-detail' }, toast.detail),
            toast.reload === true
              ? h(
                  'div',
                  { className: 'dac-toast-actions' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dac-btn',
                      onClick: props.onReloadConfirm,
                    },
                    props.t('actions.reloadConfirmYes'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dac-btn',
                      onClick: () => props.onDismiss(toast.id),
                    },
                    props.t('actions.reloadConfirmNo'),
                  ),
                )
              : null,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dac-toast-close',
              'aria-label': props.t('toast.close'),
              title: props.t('toast.close'),
              onClick: () => props.onDismiss(toast.id),
            },
            '×',
          ),
        ),
      ),
    )
  }

  /**
   * The Status tab: the profile/provenance summary inside the official card
   * shell, the restart note as plain text (no side rule), and the environment
   * notices as a plain list.
   */
  function StatusSection(props: { t: Translate; status: StatusPayload }): Element {
    const { t, status } = props
    const drift = status.apply.drift
    const preset = status.agentMode.value
    const warnings = status.warnings
    return h(
      'section',
      { className: 'dac-card' },
      h(
        'div',
        { className: 'dac-card-body' },
        h(
          'div',
          { className: 'dac-kv' },
          ...kvPair(t('summary.profile'), status.acp.name, true),
          ...kvPair(t('summary.dir'), status.acp.dir, true),
          ...kvPair(t('summary.patch'), status.acp.patchPath, true),
          ...kvPair(
            t('summary.lastSaved'),
            formatWhen(status.apply.lastSavedAt, t('summary.neverSaved')),
          ),
        ),
        h(
          'p',
          { className: 'dac-note' },
          t('summary.effective', {
            agent: preset === null ? t('value.none') : preset,
            sandbox: status.sandbox.mode === null ? t('value.none') : status.sandbox.mode,
          }),
        ),
        status.acp.exists
          ? null
          : h('p', { className: 'dac-note dac-note-warn' }, t('summary.profileMissing')),
        h('p', { className: 'dac-note' }, t('summary.restart')),
        drift.length === 0
          ? null
          : h(
              'p',
              { className: 'dac-note dac-note-warn' },
              t('summary.drift', { n: drift.length }),
              ' ',
              drift.slice(0, 5).join(', '),
              drift.length > 5 ? ' …' : '',
            ),
        warnings.length === 0
          ? null
          : h(
              'ul',
              { className: 'dac-warnlist' },
              warnings.map((warning, index) => h('li', { key: `${index}:${warning}` }, warning)),
            ),
      ),
    )
  }

  function rowMatches(row: PluginRowView, needle: string, lang: Lang): boolean {
    if (needle === '') return true
    const haystack = `${row.id} ${row.moduleName} ${resolveText(row.title, lang)}`.toLowerCase()
    return haystack.includes(needle)
  }

  /** The three folded groups of the Plugins tab, in official page order. */
  type PluginGroupKey = 'session' | 'global' | 'webOnly'

  /** A group header row: chevron + title + count badge, foldable. */
  function PluginGroupHeader(props: {
    t: Translate
    id: string
    title: string
    count: number
    open: boolean
    onToggle: () => void
  }): Element {
    return h(
      'button',
      {
        type: 'button',
        className: 'dac-group-head',
        'aria-expanded': props.open ? 'true' : 'false',
        'aria-controls': props.id,
        onClick: props.onToggle,
      },
      h(Chevron, { open: props.open }),
      h('span', { className: 'dac-group-title' }, props.title),
      h(
        'span',
        { className: 'dac-group-trailing' },
        h('span', { className: 'dac-tag' }, String(props.count)),
      ),
    )
  }

  /**
   * The Plugins tab: the official search row, then the session / global /
   * not-in-ACP groups. Folded cards carry the Chinese name, its purpose, the
   * mono id and a status tag; every row's three-way control lives in the card
   * drawer, never on the folded face.
   */
  function PluginsPanel(props: {
    t: Translate
    lang: Lang
    rows: PluginRowView[]
    draft: Draft
    query: string
    onQuery: (value: string) => void
    openGroups: Record<PluginGroupKey, boolean>
    onToggleGroup: (group: PluginGroupKey) => void
    openCards: Record<string, boolean>
    onToggleCard: (key: string) => void
    onMode: (id: string, mode: PluginMode) => void
  }): Element {
    const { t, lang, rows, query } = props
    const needle = query.trim().toLowerCase()
    const filtered = rows.filter((row) => rowMatches(row, needle, lang))
    const sessionRows = filtered.filter(
      (row) => row.group === 'session' && row.locked !== 'not-in-acp',
    )
    const globalRows = filtered.filter(
      (row) => row.group === 'global' && row.locked !== 'not-in-acp',
    )
    const webOnlyRows = filtered.filter((row) => row.locked === 'not-in-acp')
    const switchable = filtered.filter((row) => row.locked === undefined)
    const lockedRows = filtered.filter(
      (row) => row.locked !== undefined && row.locked !== 'not-in-acp',
    )
    /** One group; a search expands its groups through the page-level state. */
    const renderGroup = (
      key: PluginGroupKey,
      title: string,
      desc: string,
      groupRows: PluginRowView[],
    ): Element => {
      if (groupRows.length === 0) return null
      const open = props.openGroups[key] === true
      const listId = `dac-group-${key}`
      return h(
        'section',
        { className: 'dac-group', key },
        h(PluginGroupHeader, {
          t,
          id: listId,
          title,
          count: groupRows.length,
          open,
          onToggle: () => props.onToggleGroup(key),
        }),
        h('p', { className: 'dac-group-desc' }, desc),
        h(
          'ul',
          { className: 'dac-cards', id: listId },
          open
            ? groupRows.map((row) =>
                h(PluginCard, {
                  key: row.id,
                  t,
                  lang,
                  row,
                  mode: props.draft.plugins[row.id] ?? row.mode,
                  open: props.openCards[`plugin:${row.id}`] === true,
                  onToggle: () => props.onToggleCard(`plugin:${row.id}`),
                  onMode: (mode: PluginMode) => props.onMode(row.id, mode),
                }),
              )
            : [],
        ),
      )
    }

    const groups: Element[] = []
    const sessionGroup = renderGroup(
      'session',
      t('group.session'),
      t('group.session.desc'),
      sessionRows,
    )
    if (sessionGroup !== null) groups.push(sessionGroup)
    const globalGroup = renderGroup('global', t('group.global'), t('group.global.desc'), globalRows)
    if (globalGroup !== null) groups.push(globalGroup)
    const webOnlyGroup = renderGroup(
      'webOnly',
      t('group.notInAcp'),
      t('group.notInAcp.desc'),
      webOnlyRows,
    )
    if (webOnlyGroup !== null) groups.push(webOnlyGroup)

    return h(
      'section',
      { className: 'dac-section' },
      h(
        'div',
        { className: 'dac-search-row' },
        h('input', {
          className: 'dac-search',
          type: 'search',
          value: query,
          placeholder: t('plugins.search'),
          'aria-label': t('plugins.search'),
          onChange: (event: { target: { value: string } }) => props.onQuery(event.target.value),
        }),
        query === ''
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'dac-btn',
                onClick: () => props.onQuery(''),
              },
              t('plugins.clear'),
            ),
        h(
          'span',
          { className: 'dac-count' },
          t('plugins.count', {
            switchable: switchable.length,
            locked: lockedRows.length,
          }),
        ),
      ),
      filtered.length === 0
        ? h(
            'div',
            { className: 'dac-empty' },
            needle === '' ? t('plugins.empty') : t('plugins.noMatch', { query: query.trim() }),
          )
        : h('div', { className: 'dac-groups' }, groups),
    )
  }

  function Page(): Element {
    const active = React.useSyncExternalStore(subscribeLocale, readLocale)
    const lang = langOf(active)
    const t: Translate = (key, vars?: Vars) => translate(lang, key, vars)

    const [status, setStatus] = React.useState<StatusPayload | null>(null)
    const [draft, setDraft] = React.useState<Draft | null>(null)
    const [failure, setFailure] = React.useState<{
      seq: number
      code: string
      detail: string
    } | null>(null)
    const [failureNotified, setFailureNotified] = React.useState(0)
    const [busy, setBusy] = React.useState<'save' | 'validate' | null>(null)
    const [tab, setTab] = React.useState<TabKey>('plugins')
    const [toasts, setToasts] = React.useState<ToastItem[]>([])
    const [query, setQuery] = React.useState('')
    // Folded groups and cards are disclosure state owned by the page, not by a
    // panel, so they survive tab switches (only the active panel is mounted).
    // Session rows are read-only here (the preset owns them), so the actionable
    // global group opens by default; the 36 session cards stay one click away.
    const [openGroups, setOpenGroups] = React.useState<Record<PluginGroupKey, boolean>>({
      session: false,
      global: true,
      webOnly: false,
    })
    const [openCards, setOpenCards] = React.useState<Record<string, boolean>>({})
    const [warningsNotified, setWarningsNotified] = React.useState(false)

    /**
     * The toast queue. Success toasts expire on their own (5s); warnings and
     * errors stay until dismissed. The queue is capped at three entries, dropping
     * the oldest, so an alert can never grow into a second page.
     */
    const toastApi = React.useMemo<ToastApi>(() => {
      const timers = new Set<number>()
      return {
        push: (toast) => {
          toastSeq += 1
          const id = toastSeq
          setToasts((current) => [...current, { ...toast, id }].slice(-3))
          if (toast.tone !== 'ok') return
          const timer = window.setTimeout(() => {
            timers.delete(timer)
            setToasts((current) => current.filter((item) => item.id !== id))
          }, 5000)
          timers.add(timer)
        },
        dismiss: (id) => {
          setToasts((current) => current.filter((item) => item.id !== id))
        },
        clearReload: () => {
          setToasts((current) => current.filter((item) => item.reload !== true))
        },
        dispose: () => {
          for (const timer of timers) window.clearTimeout(timer)
          timers.clear()
        },
      }
    }, [setToasts])

    React.useEffect(() => () => toastApi.dispose(), [toastApi])

    const reload = React.useMemo(
      () =>
        (silent: boolean): void => {
          void callHost<StatusPayload>(ctx, 'status', {}).then((outcome) => {
            if (outcome.ok) {
              const next = normalizeStatus(outcome.value)
              if (next === null) {
                if (!silent) {
                  failureSeq += 1
                  setFailure({ seq: failureSeq, code: 'bad-response', detail: '' })
                }
              } else {
                setStatus(next)
                setDraft(draftOf(next))
                setFailure(null)
              }
            } else {
              // A failed reload keeps whatever is already on screen; the error is
              // raised as a toast by the effect below instead of replacing the page.
              failureSeq += 1
              setFailure({ seq: failureSeq, code: outcome.code, detail: outcome.detail })
            }
          })
        },
      [],
    )

    React.useEffect(() => {
      reload(false)
    }, [reload])

    // Environment notices are worth one warn toast on the first successful read;
    // the full list lives in the Status tab. Once per mount, never again.
    React.useEffect(() => {
      if (status === null || warningsNotified || status.warnings.length === 0) return
      setWarningsNotified(true)
      toastApi.push({
        tone: 'warn',
        title: translate(lang, 'toast.warnings', { n: status.warnings.length }),
      })
    }, [status, warningsNotified, lang, toastApi])

    // One error toast per failed read that left data on screen (guarded by the
    // failure marker, so a re-render or a locale switch cannot duplicate it).
    React.useEffect(() => {
      if (failure === null || status === null || failure.seq <= failureNotified) return
      setFailureNotified(failure.seq)
      toastApi.push({
        tone: 'error',
        title: translate(lang, 'state.loadFailed'),
        detail: errorLine((key, vars) => translate(lang, key, vars), failure.code, failure.detail),
      })
    }, [failure, status, lang, toastApi, failureNotified])

    // A search expands every group so its matches are visible; the header stays
    // usable (the user can fold a group again until the next keystroke).
    React.useEffect(() => {
      if (query.trim() === '') return
      setOpenGroups((current) =>
        current.session && current.global && current.webOnly
          ? current
          : { session: true, global: true, webOnly: true },
      )
    }, [query])

    const dirty = isDirty(status, draft)

    const setPluginMode = (id: string, mode: PluginMode): void => {
      setDraft((current) =>
        current === null ? current : { ...current, plugins: { ...current.plugins, [id]: mode } },
      )
    }
    const setAgentChoice = (choice: AgentModeChoice): void => {
      setDraft((current) => (current === null ? current : { ...current, agentMode: choice }))
    }
    const setSandboxChoice = (choice: SandboxChoice): void => {
      setDraft((current) => (current === null ? current : { ...current, sandboxMode: choice }))
    }
    const toggleGroup = (group: PluginGroupKey): void => {
      setOpenGroups((current) => ({ ...current, [group]: current[group] !== true }))
    }
    const toggleCard = (key: string): void => {
      setOpenCards((current) => ({ ...current, [key]: current[key] !== true }))
    }

    const save = (): void => {
      if (status === null || draft === null || busy !== null || !dirty) return
      const request = saveRequestOf(status, draft)
      setBusy('save')
      void callHost<SavePayload>(ctx, 'save', request).then((outcome) => {
        setBusy(null)
        if (!outcome.ok) {
          toastApi.push({
            tone: 'error',
            title: t('notice.saveFailed'),
            detail: errorLine(t, outcome.code, outcome.detail),
          })
          return
        }
        const saved = normalizeSave(outcome.value)
        setStatus((current) =>
          current === null ? current : afterSave(current, draft, saved.savedAt),
        )
        toastApi.push({
          tone: 'ok',
          title:
            saved.changed.length > 0
              ? t('notice.saved', { n: saved.changed.length })
              : t('notice.savedNoChanges'),
          // Host warnings are English engine text; the toast points at the list
          // instead of pasting it into a Chinese message.
          detail:
            saved.warnings.length === 0
              ? undefined
              : t('toast.moreWarnings', { n: saved.warnings.length }),
        })
        reload(true)
      })
    }

    const validate = (): void => {
      if (busy !== null) return
      setBusy('validate')
      void callHost<unknown>(ctx, 'validate', {}).then((outcome) => {
        setBusy(null)
        if (!outcome.ok) {
          toastApi.push({
            tone: 'error',
            title: t('notice.validateFailed'),
            detail: errorLine(t, outcome.code, outcome.detail),
          })
          return
        }
        const view = normalizeValidate(outcome.value)
        toastApi.push({
          tone: 'ok',
          title: t('notice.validateOk', {
            source: t(view.source === 'live' ? 'verify.live' : 'verify.unavailable'),
            agent: view.agentMode === null ? t('value.none') : view.agentMode,
            sandbox: view.sandbox === null ? t('value.none') : view.sandbox,
          }),
          detail:
            view.warnings.length === 0
              ? undefined
              : t('toast.moreWarnings', { n: view.warnings.length }),
        })
      })
    }

    const requestReload = (): void => {
      if (busy !== null) return
      if (!dirty) {
        reload(false)
        return
      }
      // Unsaved changes are confirmed in a toast, not a modal.
      if (toasts.some((toast) => toast.reload === true)) return
      toastApi.push({ tone: 'warn', title: t('actions.reloadConfirm'), reload: true })
    }

    const confirmReload = (): void => {
      toastApi.clearReload()
      reload(false)
    }

    /** Left/right (and Home/End) move the selection, with the focus following it. */
    const onTabKeyDown = (
      event: { key: string; preventDefault: () => void },
      index: number,
    ): void => {
      const last = TAB_ORDER.length - 1
      let nextIndex = index
      if (event.key === 'ArrowRight') nextIndex = index === last ? 0 : index + 1
      else if (event.key === 'ArrowLeft') nextIndex = index === 0 ? last : index - 1
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = last
      else return
      event.preventDefault()
      const next = TAB_ORDER[nextIndex]
      if (next === undefined) return
      setTab(next)
      document.getElementById(`dac-tab-${next}`)?.focus()
    }

    const rows = status?.rows ?? []
    const switchableTotal = rows.filter((row) => row.locked === undefined).length
    const warningCount = status?.warnings.length ?? 0

    const retryButton = h(
      'button',
      { type: 'button', className: 'dac-btn', onClick: () => reload(false) },
      t('state.retry'),
    )

    let body: Element
    if (status === null) {
      if (failure !== null) {
        body = h(
          'div',
          { className: 'dac-state', role: 'alert' },
          h('span', null, t('state.loadFailed')),
          h('span', { className: 'dac-error-detail' }, errorLine(t, failure.code, failure.detail)),
          retryButton,
        )
      } else {
        body = h('div', { className: 'dac-state' }, h('span', null, t('state.loading')))
      }
    } else if (draft === null) {
      body = h('div', { className: 'dac-state' }, h('span', null, t('state.loading')))
    } else {
      const currentDraft = draft
      // Every panel reads the page-level draft/status; switching a tab only
      // changes which section renders.
      let panel: Element
      if (tab === 'agent') {
        panel = h(AgentModeSection, {
          t,
          lang,
          status,
          draft: currentDraft,
          onChange: setAgentChoice,
          openCards,
          onToggleCard: toggleCard,
        })
      } else if (tab === 'sandbox') {
        panel = h(SandboxSection, {
          t,
          status,
          draft: currentDraft,
          onChange: setSandboxChoice,
          openCards,
          onToggleCard: toggleCard,
        })
      } else if (tab === 'status') {
        panel = h(StatusSection, { t, status })
      } else {
        panel = h(PluginsPanel, {
          t,
          lang,
          rows,
          draft: currentDraft,
          query,
          onQuery: setQuery,
          openGroups,
          onToggleGroup: toggleGroup,
          openCards,
          onToggleCard: toggleCard,
          onMode: setPluginMode,
        })
      }
      body = h(
        'div',
        { className: 'dac-body' },
        h(TabBar, {
          t,
          active: tab,
          switchable: switchableTotal,
          warnings: warningCount,
          onSelect: setTab,
          onKeyDown: onTabKeyDown,
        }),
        h(
          'div',
          {
            className: 'dac-panel',
            role: 'tabpanel',
            id: `dac-panel-${tab}`,
            'aria-labelledby': `dac-tab-${tab}`,
          },
          panel,
        ),
        // Sticky bottom action bar: last child of the page flow, inside the
        // settings scroll container, so save/reload/validate stay reachable
        // without scrolling through the whole plugin list.
        h(
          'div',
          { className: 'dac-dock' },
          h(
            'div',
            { className: 'dac-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dac-btn dac-btn-primary',
                disabled: busy !== null || !dirty,
                onClick: save,
              },
              busy === 'save' ? `${t('actions.save')}…` : t('actions.save'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dac-btn',
                disabled: busy !== null,
                onClick: requestReload,
              },
              t('actions.reload'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dac-btn',
                disabled: busy !== null,
                onClick: validate,
              },
              busy === 'validate' ? `${t('actions.validate')}…` : t('actions.validate'),
            ),
            dirty
              ? h('span', { className: 'dac-dirty' }, t('actions.dirty'))
              : h('span', { className: 'dac-clean' }, t('actions.clean')),
          ),
        ),
      )
    }

    return h(
      'div',
      { className: 'dac-page' },
      h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
      h(
        'header',
        { className: 'dac-head' },
        h('h2', { className: 'dac-title' }, t('section')),
        h('p', { className: 'dac-sub' }, t('intro')),
      ),
      body,
      toasts.length === 0
        ? null
        : h(ToastList, {
            t,
            toasts,
            onDismiss: toastApi.dismiss,
            onReloadConfirm: confirmReload,
          }),
    )
  }

  return Page
}
