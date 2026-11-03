// Client-side copy for the "ACP mode" settings page.
//
// The page is a dynamic Client half: it carries its own dictionaries instead of
// registering a locale namespace, and picks a dictionary from the active locale
// on every render (`ctx.locale.getLocale().active`). `en` is the source of truth
// for the key set; `zh` is typed as a complete map of it, so adding a key
// without a Chinese string is a compile error.
//
// Copy rules this file follows:
// - No literal backticks around descriptive text; a command the user should type
//   is written bare (`dsh --profile acp`), not as markdown.
// - An option's own description never repeats its section's description.

/** Locales this page ships copy in. */
export type Lang = 'en' | 'zh'

/** Variables interpolated into a message (`{n}` style). */
export type Vars = Record<string, string | number>

/** Typed translate function bound to one language. */
export type Translate = (key: MessageKey, vars?: Vars) => string

const en = {
  section: 'ACP mode',
  intro:
    'Configure how dsh --profile acp composes its plugins, which agent preset it mounts, and which sandbox permission its sessions run with.',

  'tabs.label': 'Sections',
  'tab.plugins': 'Plugins',
  'tab.agentMode': 'Agent mode',
  'tab.sandbox': 'Sandbox',
  'tab.status': 'Status',
  'tab.switchableBadge': '{n} switchable',
  'tab.warnings': '{n} environment notice(s)',

  'group.session': 'Session plugins',
  'group.session.desc': 'Declared by agent presets and mounted per conversation.',
  'group.global': 'Global plugins',
  'group.global.desc': 'Composed globally by the ACP profile.',
  'group.notInAcp': 'Not in ACP',
  'group.notInAcp.desc': 'Installed in this profile but absent from the ACP composition.',
  'tag.inheritWeb': 'Follow Web · {state}',
  'tag.webOff': 'Web disabled',
  'tag.selected': 'Selected',
  'tag.webCurrent': 'Web current',
  'detail.byPreset': 'Provided by the preset',
  'preset.composed': '{n} plugins',
  'preset.standard': 'Standard mode',
  'preset.ptc': 'PTC mode',
  'preset.minimal': 'Minimal mode',
  'preset.cordis': 'Cordis mode',
  'card.expand': 'Show details',
  'card.collapse': 'Hide details',
  'card.select': 'Select {name}',
  'detail.fullName': 'Package',
  'detail.web': 'Web',
  'detail.acp': 'ACP composition',
  'detail.override': 'Override',
  'detail.overrideDrift': '{mode} (Web changed)',
  'detail.fiber': 'Runtime',
  'detail.owner': 'Group',
  'detail.ownerPreset': 'Session plugin · {preset}',
  'detail.presetId': 'Preset ID',
  'detail.source': 'Source',
  'detail.default': 'Default',
  'detail.sandbox': 'Sandbox mode',
  'detail.approval': 'Approval',
  'source.acp': 'ACP composition',
  'source.builtin': 'Built in',
  'source.webPreset': 'Web · {preset}',
  'fiber.active': 'Running',
  'fiber.failed': 'Failed',
  'preset.rows': '{n} row(s)',
  'value.yes': 'Yes',
  'value.no': 'No',

  'summary.profile': 'ACP profile',
  'summary.dir': 'Profile directory',
  'summary.patch': 'Patch file',
  'summary.lastSaved': 'Last saved from this page',
  'summary.neverSaved': 'Never',
  'summary.effective': 'Effective now: agent mode {agent}, sandbox {sandbox}',
  'summary.restart':
    'Saved changes apply the next time the ACP profile starts. Sessions that are already running keep their current configuration.',
  'summary.drift': '{n} row(s) still inherit a stale Web state — save again to synchronize.',
  'summary.profileMissing':
    'The ACP profile directory does not exist yet; creating it is up to dsh --profile acp.',

  'plugins.search': 'Search plugins',
  'plugins.clear': 'Clear',
  'plugins.count': '{switchable} switchable · {locked} read-only',
  'plugins.inherit': 'Inherit',
  'plugins.on': 'On',
  'plugins.off': 'Off',
  'plugins.noMatch': 'No plugin matches “{query}”.',
  'plugins.empty': 'No plugins to show.',

  'state.on': 'on',
  'state.off': 'off',
  'state.absent': 'absent',
  'state.dynamic': 'dynamic',
  'state.loading': 'Loading ACP configuration…',
  'state.loadFailed': 'Could not load the ACP configuration.',

  'lock.preset-managed': 'Preset managed',
  'lock.preset-managed.hint':
    'An agent preset declares this row and ACP mounts it per session; switching it here would duplicate tools.',
  'lock.infra': 'Infrastructure',
  'lock.infra.hint': 'Owned by the ACP bundle layout; this page does not change it.',
  'lock.not-in-acp': 'Not in ACP',
  'lock.not-in-acp.hint': 'Installed in this profile but absent from the ACP composition.',
  'lock.acp-only': 'ACP only',
  'lock.acp-only.hint':
    'Present in ACP with no counterpart in this profile, so inherit has no meaning.',
  'lock.unaddressable': 'Not addressable',
  'lock.unaddressable.hint': 'This profile cannot persist a switch for this plugin.',

  'agentMode.title': 'Agent mode',
  'agentMode.desc': 'Which agent preset ACP sessions start with.',
  'agentMode.empty': 'No agent presets were discovered in the ACP composition.',
  'agentMode.unavailable': 'Unavailable: {reason}',
  'agentMode.unavailableHint':
    'The ACP composition has no agent preset registry row. Install dsh-acp-agentmode in the ACP profile to enable this section.',

  'choice.inheritWeb': 'Inherit Web ({value})',
  'choice.inheritUnknown': 'Inherit Web (unavailable)',
  'choice.acpDefault': 'ACP default',
  'choice.acpDefaultDesc': 'No override: keep whatever the ACP profile composes on its own.',
  'choice.acpDefaultBlocked':
    'The ACP composition does not expose this setting, so it cannot be chosen.',
  'choice.pinAgent': 'Pick a preset',
  'choice.pinSandbox': 'Pick a mode',
  'choice.pinAgentHint': 'Pin one of the presets the ACP composition declares.',
  'choice.pinSandboxHint': 'Pin one sandbox level; its approval policy follows the preset table.',
  'choice.inheritNote': 'Resolved from the Web profile at save time: {value}.',
  'choice.inheritResolved':
    'Resolved from the Web profile’s “{preset}” preset at save time: sandbox {sandbox}, approval {approval}.',
  'choice.inheritBlocked': 'Inherit Web is unavailable: {reason}',
  'choice.noWebValue': 'the Web profile does not expose this setting',
  'choice.drift': 'Web changed',
  'choice.driftHint':
    'The Web value changed after this choice was saved; save again to synchronize.',

  'sandbox.title': 'Sandbox permission',
  'sandbox.desc': 'The permission level ACP sessions run with.',
  'sandbox.read-only.title': 'Read only',
  'sandbox.read-only.desc': 'Read files and inspect the workspace; nothing can be written.',
  'sandbox.workspace-write.title': 'Workspace write',
  'sandbox.workspace-write.desc': 'Edit files inside the workspace root; outside stays read only.',
  'sandbox.danger-full-access.title': 'Full access',
  'sandbox.danger-full-access.desc': 'Unrestricted filesystem and command access.',
  'sandbox.dangerFullAccess.risk':
    'Risk: sessions can modify anything this user can, including files outside the workspace, and approvals are never asked.',
  'sandbox.unavailable': 'Unavailable: {reason}',
  'sandbox.unavailableHint':
    'The ACP composition exposes no sandbox-policy row, so this page cannot set its permission.',

  'approval.ask': 'ask',
  'approval.never': 'never',

  // Web permission preset names, as the Web UI labels them. These are NOT the
  // sandbox modes: `auto` shares its sandbox with `danger-full-access` but pairs
  // a different approval policy, so the preset name is what the page must show.
  'permission.read-only': 'Read only',
  'permission.workspace-write': 'Workspace write',
  'permission.danger-full-access': 'Full access',
  'permission.auto': 'Auto',

  'actions.save': 'Save',
  'actions.reload': 'Reload',
  'actions.validate': 'Validate',
  'actions.dirty': 'Unsaved changes',
  'actions.clean': 'No changes yet',
  'actions.reloadConfirm': 'Reloading discards your unsaved changes. Continue?',
  'actions.reloadConfirmYes': 'Discard and reload',
  'actions.reloadConfirmNo': 'Cancel',

  'state.retry': 'Retry',

  'error.network': 'The host could not be reached',
  'error.bad-response': 'The host returned an unexpected response',
  'error.generic': 'Request failed',
  'error.E_USAGE': 'Invalid request',
  'error.E_PROFILE': 'The ACP profile is unusable',
  'error.E_DUMP': 'Could not read the ACP composition',
  'error.E_CONFLICT': 'The ACP patch file changed on disk; reload and try again',
  'error.E_WRITE': 'Could not write the ACP configuration',
  'error.E_INTERNAL': 'Unexpected host error',

  'notice.saved': 'Saved. {n} change(s) written; restart ACP to apply them.',
  'notice.savedNoChanges': 'Saved. Nothing needed to change.',
  'notice.saveFailed': 'Save failed',
  'notice.validateOk': 'Validation: {source}. Agent mode {agent}; sandbox {sandbox}.',
  'notice.validateFailed': 'Validation failed',

  'toast.close': 'Close',
  'toast.warnings':
    '{n} environment notice(s) reported. Open the Status tab to review the full list.',
  'toast.moreWarnings': '{n} notice(s), see the Status tab.',

  'verify.live': 'read back from the live composition',
  'verify.unavailable': 'composition unavailable, nothing could be read back',
  'value.none': 'default',
} as const

/** Every message key the page can render. */
export type MessageKey = keyof typeof en

const zh: Record<MessageKey, string> = {
  section: 'ACP 模式',
  intro:
    '配置 dsh --profile acp 如何组合插件、挂载哪个 agent preset，以及会话运行在什么沙箱权限下。',

  'tabs.label': '页面分区',
  'tab.plugins': '插件',
  'tab.agentMode': 'Agent 模式',
  'tab.sandbox': '沙箱权限',
  'tab.status': '状态',
  'tab.switchableBadge': '可切换 {n}',
  'tab.warnings': '{n} 条环境提示',

  'group.session': '会话插件',
  'group.session.desc': '由 Agent 预设按会话组成。',
  'group.global': '全局插件',
  'group.global.desc': '由 ACP profile 全局组合。',
  'group.notInAcp': '未进入 ACP',
  'group.notInAcp.desc': '本 profile 已安装，但不在 ACP 组合里。',
  'tag.inheritWeb': '跟随 Web·{state}',
  'tag.webOff': 'Web 已停用',
  'tag.selected': '当前选择',
  'tag.webCurrent': 'Web 端在用',
  'detail.byPreset': '由预设提供',
  'preset.composed': '{n} 个插件',
  'preset.standard': '标准模式',
  'preset.ptc': 'PTC 模式',
  'preset.minimal': '极简模式',
  'preset.cordis': 'Cordis 模式',
  'card.expand': '展开详情',
  'card.collapse': '收起详情',
  'card.select': '选择 {name}',
  'detail.fullName': '完整名称',
  'detail.web': 'Web 端',
  'detail.acp': 'ACP 组合',
  'detail.override': '本页覆盖',
  'detail.overrideDrift': '{mode}（Web 已变更）',
  'detail.fiber': '运行状态',
  'detail.owner': '归属',
  'detail.ownerPreset': '会话插件 · {preset}',
  'detail.presetId': '预设 ID',
  'detail.source': '来源',
  'detail.default': '是否默认',
  'detail.sandbox': '沙箱模式',
  'detail.approval': '审批策略',
  'source.acp': 'ACP 组合',
  'source.builtin': '内置',
  'source.webPreset': 'Web 端 · {preset}',
  'fiber.active': '运行中',
  'fiber.failed': '异常',
  'preset.rows': '{n} 行',
  'value.yes': '是',
  'value.no': '否',

  'summary.profile': 'ACP profile',
  'summary.dir': 'Profile 目录',
  'summary.patch': '补丁文件',
  'summary.lastSaved': '上次从本页保存',
  'summary.neverSaved': '从未保存',
  'summary.effective': '当前生效：agent 模式 {agent}，沙箱 {sandbox}',
  'summary.restart': '保存后下次启动 ACP 才生效；已经在运行的会话保持当前配置。',
  'summary.drift': '有 {n} 行仍在继承过期的 Web 状态 —— 再保存一次以同步。',
  'summary.profileMissing': 'ACP profile 目录还不存在，需要由 dsh --profile acp 创建。',

  'plugins.search': '搜索插件',
  'plugins.clear': '清除',
  'plugins.count': '可切换 {switchable} · 只读 {locked}',
  'plugins.inherit': '继承',
  'plugins.on': '开启',
  'plugins.off': '关闭',
  'plugins.noMatch': '没有插件匹配“{query}”。',
  'plugins.empty': '没有可显示的插件。',

  'state.on': '开',
  'state.off': '关',
  'state.absent': '不存在',
  'state.dynamic': '动态',
  'state.loading': '正在读取 ACP 配置…',
  'state.loadFailed': '无法读取 ACP 配置。',

  'lock.preset-managed': '由预设管理',
  'lock.preset-managed.hint':
    '该行由 agent preset 声明，ACP 按会话挂载；在这里开关会重复注册工具。',
  'lock.infra': '基础设施',
  'lock.infra.hint': '由 ACP 的 bundle 布局决定，本页不改动。',
  'lock.not-in-acp': '不在 ACP',
  'lock.not-in-acp.hint': '本 profile 已安装，但不在 ACP 组合里。',
  'lock.acp-only': '仅 ACP',
  'lock.acp-only.hint': '只存在于 ACP，本 profile 没有对应项，「继承」没有意义。',
  'lock.unaddressable': '不可寻址',
  'lock.unaddressable.hint': '本 profile 无法为该插件持久化开关。',

  'agentMode.title': 'Agent 模式',
  'agentMode.desc': 'ACP 会话启动时使用哪个 agent preset。',
  'agentMode.empty': 'ACP 组合里没有发现任何 agent preset。',
  'agentMode.unavailable': '不可用：{reason}',
  'agentMode.unavailableHint':
    'ACP 组合里没有 agent preset registry 行。请在 ACP profile 里安装 dsh-acp-agentmode 以启用本区块。',

  'choice.inheritWeb': '继承 Web 端（{value}）',
  'choice.inheritUnknown': '继承 Web 端（不可用）',
  'choice.acpDefault': 'ACP 默认',
  'choice.acpDefaultDesc': '不做覆盖，保持 ACP profile 自身的组合结果。',
  'choice.acpDefaultBlocked': 'ACP 组合没有暴露该设置，无法选择。',
  'choice.pinAgent': '选具体 preset',
  'choice.pinSandbox': '选具体沙箱',
  'choice.pinAgentHint': '从 ACP 组合声明的 preset 里固定一个。',
  'choice.pinSandboxHint': '固定一个沙箱权限；审批策略按预设表自动配对。',
  'choice.inheritNote': '保存时按 Web profile 的当前值解析：{value}。',
  'choice.inheritResolved':
    '保存时按 Web profile 的「{preset}」预设解析：沙箱 {sandbox}，审批 {approval}。',
  'choice.inheritBlocked': '「继承 Web 端」不可用：{reason}',
  'choice.noWebValue': 'Web profile 没有提供该设置',
  'choice.drift': 'Web 端已变更',
  'choice.driftHint': '保存后 Web 端的值又变了；再保存一次即可同步。',

  'sandbox.title': '沙箱权限',
  'sandbox.desc': 'ACP 会话运行的权限级别。',
  'sandbox.read-only.title': '只读',
  'sandbox.read-only.desc': '可读取文件、查看工作区；不能写入。',
  'sandbox.workspace-write.title': '工作区可写',
  'sandbox.workspace-write.desc': '可修改工作区根目录内的文件；工作区外仍只读。',
  'sandbox.danger-full-access.title': '完全访问',
  'sandbox.danger-full-access.desc': '文件系统与命令访问不受限制。',
  'sandbox.dangerFullAccess.risk':
    '风险：会话可以修改当前用户能改的任何内容，包括工作区外的文件，且不再询问批准。',
  'sandbox.unavailable': '不可用：{reason}',
  'sandbox.unavailableHint': 'ACP 组合里没有 sandbox-policy 行，本页无法设置其权限。',

  'approval.ask': '询问',
  'approval.never': '从不',

  'permission.read-only': '只读',
  'permission.workspace-write': '工作区可写',
  'permission.danger-full-access': '完全权限',
  'permission.auto': '自动',

  'actions.save': '保存',
  'actions.reload': '重新读取',
  'actions.validate': '校验',
  'actions.dirty': '有未保存的改动',
  'actions.clean': '还没有改动',
  'actions.reloadConfirm': '重新读取会丢弃未保存的改动，继续吗？',
  'actions.reloadConfirmYes': '丢弃并读取',
  'actions.reloadConfirmNo': '取消',

  'state.retry': '重试',

  'error.network': '无法连接 Host',
  'error.bad-response': 'Host 返回了意外的响应',
  'error.generic': '调用失败',
  'error.E_USAGE': '请求参数不合法',
  'error.E_PROFILE': 'ACP profile 不可用',
  'error.E_DUMP': '无法读取 ACP 组合',
  'error.E_CONFLICT': 'ACP 补丁文件在磁盘上已变更，请重新读取后重试',
  'error.E_WRITE': '无法写入 ACP 配置',
  'error.E_INTERNAL': 'Host 内部错误',

  'notice.saved': '已保存，写入 {n} 处改动；重启 ACP 后生效。',
  'notice.savedNoChanges': '已保存，没有需要改动的内容。',
  'notice.saveFailed': '保存失败',
  'notice.validateOk': '校验：{source}。Agent 模式 {agent}；沙箱 {sandbox}。',
  'notice.validateFailed': '校验失败',

  'toast.close': '关闭',
  'toast.warnings': '有 {n} 条环境提示，可在「状态」tab 查看完整列表。',
  'toast.moreWarnings': '另有 {n} 条提示，见「状态」tab。',

  'verify.live': '已从实时组合回读',
  'verify.unavailable': '组合不可用，未能回读',
  'value.none': '默认',
}

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, zh }

/** Every message key, for dictionaries outside this file (kept for tests/debug). */
export const MESSAGE_KEYS = Object.keys(en) as MessageKey[]

/** Map a DSH locale tag (`zh`, `zh-TW`, `en-US`, …) onto a shipped dictionary. */
export function langOf(active: string | null | undefined): Lang {
  return typeof active === 'string' && active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** Look up one message and interpolate `{name}` placeholders. Missing keys echo the key. */
export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const dict = DICTS[lang] ?? DICTS.en
  let text = dict[key] ?? key
  if (vars !== undefined) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value))
    }
  }
  return text
}

/** True when a message key carries copy (used for host error codes, which are open-ended). */
export function hasMessage(key: string): key is MessageKey {
  return Object.hasOwn(en, key)
}
