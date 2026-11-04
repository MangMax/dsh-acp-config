;(function () {
  let e = {
      section: `ACP mode`,
      intro: `Configure how dsh --profile acp composes its plugins, which agent preset it mounts, and which sandbox permission its sessions run with.`,
      'tabs.label': `Sections`,
      'tab.plugins': `Plugins`,
      'tab.agentMode': `Agent mode`,
      'tab.sandbox': `Sandbox`,
      'tab.status': `Status`,
      'tab.switchableBadge': `{n} switchable`,
      'tab.warnings': `{n} environment notice(s)`,
      'group.session': `Session plugins`,
      'group.session.desc': `Declared by agent presets and mounted per conversation.`,
      'group.global': `Global plugins`,
      'group.global.desc': `Composed globally by the ACP profile.`,
      'group.notInAcp': `Not in ACP`,
      'group.notInAcp.desc': `Installed in this profile but absent from the ACP composition.`,
      'tag.inheritWeb': `Follow Web · {state}`,
      'tag.webOff': `Web disabled`,
      'tag.selected': `Selected`,
      'tag.webCurrent': `Web current`,
      'detail.byPreset': `Provided by the preset`,
      'preset.composed': `{n} plugins`,
      'preset.standard': `Standard mode`,
      'preset.ptc': `PTC mode`,
      'preset.minimal': `Minimal mode`,
      'preset.cordis': `Cordis mode`,
      'card.expand': `Show details`,
      'card.collapse': `Hide details`,
      'card.select': `Select {name}`,
      'detail.fullName': `Package`,
      'detail.web': `Web`,
      'detail.acp': `ACP composition`,
      'detail.override': `Override`,
      'detail.overrideDrift': `{mode} (Web changed)`,
      'detail.fiber': `Runtime`,
      'detail.owner': `Group`,
      'detail.ownerPreset': `Session plugin · {preset}`,
      'detail.presetId': `Preset ID`,
      'detail.source': `Source`,
      'detail.default': `Default`,
      'detail.sandbox': `Sandbox mode`,
      'detail.approval': `Approval`,
      'source.acp': `ACP composition`,
      'source.builtin': `Built in`,
      'source.webPreset': `Web · {preset}`,
      'fiber.active': `Running`,
      'fiber.failed': `Failed`,
      'preset.rows': `{n} row(s)`,
      'value.yes': `Yes`,
      'value.no': `No`,
      'summary.profile': `ACP profile`,
      'summary.dir': `Profile directory`,
      'summary.patch': `Patch file`,
      'summary.lastSaved': `Last saved from this page`,
      'summary.neverSaved': `Never`,
      'summary.effective': `Effective now: agent mode {agent}, sandbox {sandbox}`,
      'summary.restart': `Saved changes apply the next time the ACP profile starts. Sessions that are already running keep their current configuration.`,
      'summary.drift': `{n} row(s) still inherit a stale Web state — save again to synchronize.`,
      'summary.profileMissing': `The ACP profile directory does not exist yet; creating it is up to dsh --profile acp.`,
      'plugins.search': `Search plugins`,
      'plugins.clear': `Clear`,
      'plugins.count': `{switchable} switchable · {locked} read-only`,
      'plugins.inherit': `Inherit`,
      'plugins.on': `On`,
      'plugins.off': `Off`,
      'plugins.noMatch': `No plugin matches “{query}”.`,
      'plugins.empty': `No plugins to show.`,
      'state.on': `on`,
      'state.off': `off`,
      'state.absent': `absent`,
      'state.dynamic': `dynamic`,
      'state.loading': `Loading ACP configuration…`,
      'state.loadFailed': `Could not load the ACP configuration.`,
      'lock.preset-managed': `Preset managed`,
      'lock.preset-managed.hint': `An agent preset declares this row and ACP mounts it per session; switching it here would duplicate tools.`,
      'lock.infra': `Infrastructure`,
      'lock.infra.hint': `Owned by the ACP bundle layout; this page does not change it.`,
      'lock.not-in-acp': `Not in ACP`,
      'lock.not-in-acp.hint': `Installed in this profile but absent from the ACP composition.`,
      'lock.acp-only': `ACP only`,
      'lock.acp-only.hint': `Present in ACP with no counterpart in this profile, so inherit has no meaning.`,
      'lock.unaddressable': `Not addressable`,
      'lock.unaddressable.hint': `This profile cannot persist a switch for this plugin.`,
      'agentMode.title': `Agent mode`,
      'agentMode.desc': `Which agent preset ACP sessions start with.`,
      'agentMode.empty': `No agent presets were discovered in the ACP composition.`,
      'agentMode.unavailable': `Unavailable: {reason}`,
      'agentMode.unavailableHint': `The ACP composition has no agent preset registry row. Install dsh-acp-agentmode in the ACP profile to enable this section.`,
      'choice.inheritWeb': `Inherit Web ({value})`,
      'choice.inheritUnknown': `Inherit Web (unavailable)`,
      'choice.acpDefault': `ACP default`,
      'choice.acpDefaultDesc': `No override: keep whatever the ACP profile composes on its own.`,
      'choice.acpDefaultBlocked': `The ACP composition does not expose this setting, so it cannot be chosen.`,
      'choice.pinAgent': `Pick a preset`,
      'choice.pinSandbox': `Pick a mode`,
      'choice.pinAgentHint': `Pin one of the presets the ACP composition declares.`,
      'choice.pinSandboxHint': `Pin one sandbox level; its approval policy follows the preset table.`,
      'choice.inheritNote': `Resolved from the Web profile at save time: {value}.`,
      'choice.inheritResolved': `Resolved from the Web profile’s “{preset}” preset at save time: sandbox {sandbox}, approval {approval}.`,
      'choice.inheritBlocked': `Inherit Web is unavailable: {reason}`,
      'choice.noWebValue': `the Web profile does not expose this setting`,
      'choice.drift': `Web changed`,
      'choice.driftHint': `The Web value changed after this choice was saved; save again to synchronize.`,
      'sandbox.title': `Sandbox permission`,
      'sandbox.desc': `The permission level ACP sessions run with.`,
      'sandbox.read-only.title': `Read only`,
      'sandbox.read-only.desc': `Read files and inspect the workspace; nothing can be written.`,
      'sandbox.workspace-write.title': `Workspace write`,
      'sandbox.workspace-write.desc': `Edit files inside the workspace root; outside stays read only.`,
      'sandbox.danger-full-access.title': `Full access`,
      'sandbox.danger-full-access.desc': `Unrestricted filesystem and command access.`,
      'sandbox.dangerFullAccess.risk': `Risk: sessions can modify anything this user can, including files outside the workspace, and approvals are never asked.`,
      'sandbox.unavailable': `Unavailable: {reason}`,
      'sandbox.unavailableHint': `The ACP composition exposes no sandbox-policy row, so this page cannot set its permission.`,
      'approval.ask': `ask`,
      'approval.never': `never`,
      'permission.read-only': `Read only`,
      'permission.workspace-write': `Workspace write`,
      'permission.danger-full-access': `Full access`,
      'permission.auto': `Auto`,
      'actions.save': `Save`,
      'actions.reload': `Reload`,
      'actions.validate': `Validate`,
      'actions.dirty': `Unsaved changes`,
      'actions.clean': `No changes yet`,
      'actions.reloadConfirm': `Reloading discards your unsaved changes. Continue?`,
      'actions.reloadConfirmYes': `Discard and reload`,
      'actions.reloadConfirmNo': `Cancel`,
      'state.retry': `Retry`,
      'error.network': `The host could not be reached`,
      'error.bad-response': `The host returned an unexpected response`,
      'error.generic': `Request failed`,
      'error.E_USAGE': `Invalid request`,
      'error.E_PROFILE': `The ACP profile is unusable`,
      'error.E_DUMP': `Could not read the ACP composition`,
      'error.E_CONFLICT': `The ACP patch file changed on disk; reload and try again`,
      'error.E_WRITE': `Could not write the ACP configuration`,
      'error.E_INTERNAL': `Unexpected host error`,
      'notice.saved': `Saved. {n} change(s) written; restart ACP to apply them.`,
      'notice.savedNoChanges': `Saved. Nothing needed to change.`,
      'notice.saveFailed': `Save failed`,
      'notice.validateOk': `Validation: {source}. Agent mode {agent}; sandbox {sandbox}.`,
      'notice.validateFailed': `Validation failed`,
      'toast.close': `Close`,
      'toast.warnings': `{n} environment notice(s) reported. Open the Status tab to review the full list.`,
      'toast.moreWarnings': `{n} notice(s), see the Status tab.`,
      'verify.live': `read back from the live composition`,
      'verify.unavailable': `composition unavailable, nothing could be read back`,
      'value.none': `default`,
    },
    t = {
      en: e,
      zh: {
        section: `ACP 模式`,
        intro: `配置 dsh --profile acp 如何组合插件、挂载哪个 agent preset，以及会话运行在什么沙箱权限下。`,
        'tabs.label': `页面分区`,
        'tab.plugins': `插件`,
        'tab.agentMode': `Agent 模式`,
        'tab.sandbox': `沙箱权限`,
        'tab.status': `状态`,
        'tab.switchableBadge': `可切换 {n}`,
        'tab.warnings': `{n} 条环境提示`,
        'group.session': `会话插件`,
        'group.session.desc': `由 Agent 预设按会话组成。`,
        'group.global': `全局插件`,
        'group.global.desc': `由 ACP profile 全局组合。`,
        'group.notInAcp': `未进入 ACP`,
        'group.notInAcp.desc': `本 profile 已安装，但不在 ACP 组合里。`,
        'tag.inheritWeb': `跟随 Web·{state}`,
        'tag.webOff': `Web 已停用`,
        'tag.selected': `当前选择`,
        'tag.webCurrent': `Web 端在用`,
        'detail.byPreset': `由预设提供`,
        'preset.composed': `{n} 个插件`,
        'preset.standard': `标准模式`,
        'preset.ptc': `PTC 模式`,
        'preset.minimal': `极简模式`,
        'preset.cordis': `Cordis 模式`,
        'card.expand': `展开详情`,
        'card.collapse': `收起详情`,
        'card.select': `选择 {name}`,
        'detail.fullName': `完整名称`,
        'detail.web': `Web 端`,
        'detail.acp': `ACP 组合`,
        'detail.override': `本页覆盖`,
        'detail.overrideDrift': `{mode}（Web 已变更）`,
        'detail.fiber': `运行状态`,
        'detail.owner': `归属`,
        'detail.ownerPreset': `会话插件 · {preset}`,
        'detail.presetId': `预设 ID`,
        'detail.source': `来源`,
        'detail.default': `是否默认`,
        'detail.sandbox': `沙箱模式`,
        'detail.approval': `审批策略`,
        'source.acp': `ACP 组合`,
        'source.builtin': `内置`,
        'source.webPreset': `Web 端 · {preset}`,
        'fiber.active': `运行中`,
        'fiber.failed': `异常`,
        'preset.rows': `{n} 行`,
        'value.yes': `是`,
        'value.no': `否`,
        'summary.profile': `ACP profile`,
        'summary.dir': `Profile 目录`,
        'summary.patch': `补丁文件`,
        'summary.lastSaved': `上次从本页保存`,
        'summary.neverSaved': `从未保存`,
        'summary.effective': `当前生效：agent 模式 {agent}，沙箱 {sandbox}`,
        'summary.restart': `保存后下次启动 ACP 才生效；已经在运行的会话保持当前配置。`,
        'summary.drift': `有 {n} 行仍在继承过期的 Web 状态 —— 再保存一次以同步。`,
        'summary.profileMissing': `ACP profile 目录还不存在，需要由 dsh --profile acp 创建。`,
        'plugins.search': `搜索插件`,
        'plugins.clear': `清除`,
        'plugins.count': `可切换 {switchable} · 只读 {locked}`,
        'plugins.inherit': `继承`,
        'plugins.on': `开启`,
        'plugins.off': `关闭`,
        'plugins.noMatch': `没有插件匹配“{query}”。`,
        'plugins.empty': `没有可显示的插件。`,
        'state.on': `开`,
        'state.off': `关`,
        'state.absent': `不存在`,
        'state.dynamic': `动态`,
        'state.loading': `正在读取 ACP 配置…`,
        'state.loadFailed': `无法读取 ACP 配置。`,
        'lock.preset-managed': `由预设管理`,
        'lock.preset-managed.hint': `该行由 agent preset 声明，ACP 按会话挂载；在这里开关会重复注册工具。`,
        'lock.infra': `基础设施`,
        'lock.infra.hint': `由 ACP 的 bundle 布局决定，本页不改动。`,
        'lock.not-in-acp': `不在 ACP`,
        'lock.not-in-acp.hint': `本 profile 已安装，但不在 ACP 组合里。`,
        'lock.acp-only': `仅 ACP`,
        'lock.acp-only.hint': `只存在于 ACP，本 profile 没有对应项，「继承」没有意义。`,
        'lock.unaddressable': `不可寻址`,
        'lock.unaddressable.hint': `本 profile 无法为该插件持久化开关。`,
        'agentMode.title': `Agent 模式`,
        'agentMode.desc': `ACP 会话启动时使用哪个 agent preset。`,
        'agentMode.empty': `ACP 组合里没有发现任何 agent preset。`,
        'agentMode.unavailable': `不可用：{reason}`,
        'agentMode.unavailableHint': `ACP 组合里没有 agent preset registry 行。请在 ACP profile 里安装 dsh-acp-agentmode 以启用本区块。`,
        'choice.inheritWeb': `继承 Web 端（{value}）`,
        'choice.inheritUnknown': `继承 Web 端（不可用）`,
        'choice.acpDefault': `ACP 默认`,
        'choice.acpDefaultDesc': `不做覆盖，保持 ACP profile 自身的组合结果。`,
        'choice.acpDefaultBlocked': `ACP 组合没有暴露该设置，无法选择。`,
        'choice.pinAgent': `选具体 preset`,
        'choice.pinSandbox': `选具体沙箱`,
        'choice.pinAgentHint': `从 ACP 组合声明的 preset 里固定一个。`,
        'choice.pinSandboxHint': `固定一个沙箱权限；审批策略按预设表自动配对。`,
        'choice.inheritNote': `保存时按 Web profile 的当前值解析：{value}。`,
        'choice.inheritResolved': `保存时按 Web profile 的「{preset}」预设解析：沙箱 {sandbox}，审批 {approval}。`,
        'choice.inheritBlocked': `「继承 Web 端」不可用：{reason}`,
        'choice.noWebValue': `Web profile 没有提供该设置`,
        'choice.drift': `Web 端已变更`,
        'choice.driftHint': `保存后 Web 端的值又变了；再保存一次即可同步。`,
        'sandbox.title': `沙箱权限`,
        'sandbox.desc': `ACP 会话运行的权限级别。`,
        'sandbox.read-only.title': `只读`,
        'sandbox.read-only.desc': `可读取文件、查看工作区；不能写入。`,
        'sandbox.workspace-write.title': `工作区可写`,
        'sandbox.workspace-write.desc': `可修改工作区根目录内的文件；工作区外仍只读。`,
        'sandbox.danger-full-access.title': `完全访问`,
        'sandbox.danger-full-access.desc': `文件系统与命令访问不受限制。`,
        'sandbox.dangerFullAccess.risk': `风险：会话可以修改当前用户能改的任何内容，包括工作区外的文件，且不再询问批准。`,
        'sandbox.unavailable': `不可用：{reason}`,
        'sandbox.unavailableHint': `ACP 组合里没有 sandbox-policy 行，本页无法设置其权限。`,
        'approval.ask': `询问`,
        'approval.never': `从不`,
        'permission.read-only': `只读`,
        'permission.workspace-write': `工作区可写`,
        'permission.danger-full-access': `完全权限`,
        'permission.auto': `自动`,
        'actions.save': `保存`,
        'actions.reload': `重新读取`,
        'actions.validate': `校验`,
        'actions.dirty': `有未保存的改动`,
        'actions.clean': `还没有改动`,
        'actions.reloadConfirm': `重新读取会丢弃未保存的改动，继续吗？`,
        'actions.reloadConfirmYes': `丢弃并读取`,
        'actions.reloadConfirmNo': `取消`,
        'state.retry': `重试`,
        'error.network': `无法连接 Host`,
        'error.bad-response': `Host 返回了意外的响应`,
        'error.generic': `调用失败`,
        'error.E_USAGE': `请求参数不合法`,
        'error.E_PROFILE': `ACP profile 不可用`,
        'error.E_DUMP': `无法读取 ACP 组合`,
        'error.E_CONFLICT': `ACP 补丁文件在磁盘上已变更，请重新读取后重试`,
        'error.E_WRITE': `无法写入 ACP 配置`,
        'error.E_INTERNAL': `Host 内部错误`,
        'notice.saved': `已保存，写入 {n} 处改动；重启 ACP 后生效。`,
        'notice.savedNoChanges': `已保存，没有需要改动的内容。`,
        'notice.saveFailed': `保存失败`,
        'notice.validateOk': `校验：{source}。Agent 模式 {agent}；沙箱 {sandbox}。`,
        'notice.validateFailed': `校验失败`,
        'toast.close': `关闭`,
        'toast.warnings': `有 {n} 条环境提示，可在「状态」tab 查看完整列表。`,
        'toast.moreWarnings': `另有 {n} 条提示，见「状态」tab。`,
        'verify.live': `已从实时组合回读`,
        'verify.unavailable': `组合不可用，未能回读`,
        'value.none': `默认`,
      },
    }
  Object.keys(e)
  function n(e) {
    return typeof e == `string` && e.toLowerCase().startsWith(`zh`) ? `zh` : `en`
  }
  function r(e, n, r) {
    let i = (t[e] ?? t.en)[n] ?? n
    if (r !== void 0) for (let [e, t] of Object.entries(r)) i = i.split(`{${e}}`).join(String(t))
    return i
  }
  function i(t) {
    return Object.hasOwn(e, t)
  }
  let a = [`read-only`, `workspace-write`, `danger-full-access`],
    o = { 'read-only': `ask`, 'workspace-write': `ask`, 'danger-full-access': `never` },
    s = [`on`, `off`, `absent`],
    c = [`on`, `off`, `dynamic`, `absent`],
    l = [`inherit`, `on`, `off`],
    u = [`preset-managed`, `infra`, `not-in-acp`, `acp-only`, `unaddressable`]
  function d(e) {
    return typeof e == `object` && !!e && !Array.isArray(e)
  }
  function f(e) {
    return typeof e == `string` ? e : ``
  }
  function p(e, t) {
    return typeof e == `boolean` ? e : t
  }
  function m(e) {
    return Array.isArray(e) ? e : []
  }
  function h(e) {
    return typeof e == `string`
  }
  function g(e, t, n) {
    return typeof e == `string` && t.includes(e) ? e : n
  }
  function _(e, t) {
    return typeof e == `string` && t.includes(e) ? e : void 0
  }
  function v(e) {
    return _(e, a) ?? null
  }
  function y(e) {
    return _(e, [`ask`, `never`]) ?? null
  }
  function b(e, t = []) {
    if (typeof e == `string`) {
      let n = v(e)
      return n === null
        ? (t.find((t) => t.preset === e) ?? null)
        : { preset: e, sandbox: n, approval: o[n] }
    }
    if (!d(e)) return null
    let n = f(e.preset),
      r = v(e.sandbox) ?? v(n)
    if (r === null) {
      let e = t.find((e) => e.preset === n)
      return e === void 0 ? null : e
    }
    return { preset: n === `` ? r : n, sandbox: r, approval: y(e.approval) ?? o[r] }
  }
  function x(e) {
    let t = []
    for (let n of m(e)) {
      let e = b(n)
      e !== null && t.push(e)
    }
    return t
  }
  function S(e) {
    if (d(e)) {
      if (e.mode === `inherit`) return { mode: `inherit` }
      if (e.mode === `preset`) {
        let t = f(e.id)
        if (t !== ``) return { mode: `preset`, id: t }
      }
    }
    return { mode: `acp-default` }
  }
  function C(e) {
    if (d(e)) {
      if (e.mode === `inherit`) return { mode: `inherit` }
      if (e.mode === `sandbox`) {
        let t = v(e.sandbox)
        if (t !== null) return { mode: `sandbox`, sandbox: t }
      }
    }
    return { mode: `acp-default` }
  }
  function w(e) {
    if (typeof e == `string`) return e === `` ? void 0 : { en: e }
    if (!d(e)) return
    let t = f(e.en)
    if (t === ``) return
    let n = { en: t }
    for (let [t, r] of Object.entries(e)) t !== `en` && typeof r == `string` && (n[t] = r)
    return n
  }
  function T(e) {
    if (!d(e)) return null
    let t = f(e.id)
    if (t === ``) return null
    let n = _(e.locked, u)
    return {
      id: t,
      group:
        e.group === `session`
          ? `session`
          : e.group === `global`
            ? `global`
            : n === `preset-managed`
              ? `session`
              : `global`,
      presetName: w(e.presetName),
      moduleName: f(e.moduleName) || t,
      title: w(e.title),
      description: w(e.description),
      web: g(e.web, s, `absent`),
      acp: g(e.acp, c, `absent`),
      webFiber: f(e.webFiber) || void 0,
      mode: g(e.mode, l, `inherit`),
      locked: n,
      drift: e.drift === !0,
    }
  }
  function E(e) {
    if (!d(e)) return null
    let t = f(e.id)
    if (t === ``) return null
    let n = e.rowCount
    return {
      id: t,
      title: w(e.title),
      description: w(e.description),
      rowCount: typeof n == `number` && Number.isFinite(n) ? n : void 0,
    }
  }
  function ee(e) {
    if (!d(e)) return null
    let t = d(e.acp) ? e.acp : {},
      n = d(e.agentMode) ? e.agentMode : {},
      r = d(e.sandbox) ? e.sandbox : {},
      i = d(e.apply) ? e.apply : {},
      a = []
    for (let t of m(e.rows)) {
      let e = T(t)
      e !== null && a.push(e)
    }
    let o = []
    for (let t of m(e.presets)) {
      let e = E(t)
      e !== null && o.push(e)
    }
    let s = f(n.reason),
      c = f(r.reason),
      l = x(r.webPresets)
    return {
      ok: !0,
      acp: {
        name: f(t.name) || `acp`,
        dir: f(t.dir),
        exists: p(t.exists, !0),
        patchPath: f(t.patchPath),
        bundles: m(t.bundles).filter(h),
      },
      rows: a,
      presets: o,
      agentMode: {
        value: f(n.value) || null,
        choice: S(n.choice),
        web: f(n.web) || null,
        drift: n.drift === !0,
        available: p(n.available, !1),
        ...(s === `` ? {} : { reason: s }),
      },
      sandbox: {
        mode: v(r.mode),
        approval: y(r.approval),
        choice: C(r.choice),
        web: b(r.web, l),
        webPresets: l,
        drift: r.drift === !0,
        available: p(r.available, !1),
        ...(c === `` ? {} : { reason: c }),
      },
      apply: { lastSavedAt: f(i.lastSavedAt) || null, drift: m(i.drift).filter(h) },
      warnings: m(e.warnings).filter(h),
    }
  }
  function D(e) {
    return d(e)
      ? {
          savedAt: f(e.savedAt) || null,
          changed: m(e.changed).filter(h),
          warnings: m(e.warnings).filter(h),
        }
      : { savedAt: null, changed: [], warnings: [] }
  }
  function te(e) {
    let t = d(e) ? e : {}
    return {
      source: (d(t.verification) ? t.verification : {}).source === `live` ? `live` : `unavailable`,
      agentMode: f(t.agentMode) || null,
      sandbox: v(t.sandbox),
      warnings: m(t.warnings).filter(h),
    }
  }
  function O(e) {
    return e instanceof Error ? e.message : typeof e == `string` ? e : ``
  }
  async function k(e, t, n) {
    let r
    try {
      r = await e.connection.rpc.call(`/api`, `dsh-acp-config`, { method: t, args: n })
    } catch (e) {
      return { ok: !1, code: `network`, detail: O(e) }
    }
    if (!d(r))
      return r === void 0
        ? { ok: !1, code: `bad-response`, detail: `` }
        : { ok: !1, code: `bad-response`, detail: O(r) }
    if (r.ok === !0)
      return d(r.value) ? { ok: !0, value: r.value } : { ok: !1, code: `bad-response`, detail: `` }
    let i = r.error
    return d(i)
      ? { ok: !1, code: f(i.code) || `generic`, detail: f(i.message) }
      : typeof i == `string`
        ? { ok: !1, code: `generic`, detail: i }
        : { ok: !1, code: `bad-response`, detail: `` }
  }
  function ne(e) {
    let t = {}
    for (let n of e.rows) n.locked === void 0 && (t[n.id] = n.mode)
    return { plugins: t, agentMode: e.agentMode.choice, sandboxMode: e.sandbox.choice }
  }
  function A(e, t) {
    return e.mode === t.mode ? e.mode !== `preset` || t.mode !== `preset` || e.id === t.id : !1
  }
  function j(e, t) {
    return e.mode === t.mode
      ? e.mode !== `sandbox` || t.mode !== `sandbox` || e.sandbox === t.sandbox
      : !1
  }
  function re(e, t) {
    if (e === null || t === null) return !1
    if (
      (e.agentMode.available && !A(t.agentMode, e.agentMode.choice)) ||
      (e.sandbox.available && !j(t.sandboxMode, e.sandbox.choice))
    )
      return !0
    for (let n of e.rows)
      if (n.locked === void 0 && (t.plugins[n.id] ?? n.mode) !== n.mode) return !0
    return !1
  }
  function ie(e, t) {
    let n = {}
    for (let r of e.rows) r.locked === void 0 && (n[r.id] = t.plugins[r.id] ?? r.mode)
    let r = { plugins: n }
    return (
      e.agentMode.available && !A(t.agentMode, e.agentMode.choice) && (r.agentMode = t.agentMode),
      e.sandbox.available && !j(t.sandboxMode, e.sandbox.choice) && (r.sandboxMode = t.sandboxMode),
      r
    )
  }
  function M(e, t) {
    return t.mode === `preset`
      ? t.id
      : t.mode === `inherit`
        ? (e.agentMode.web ?? e.agentMode.value)
        : e.agentMode.value
  }
  function N(e, t) {
    return t.mode === `sandbox`
      ? t.sandbox
      : t.mode === `inherit`
        ? (e.sandbox.web?.sandbox ?? e.sandbox.mode)
        : e.sandbox.mode
  }
  function P(e, t) {
    return t.mode === `sandbox`
      ? o[t.sandbox]
      : t.mode === `inherit`
        ? (e.sandbox.web?.approval ?? e.sandbox.approval)
        : e.sandbox.approval
  }
  function ae(e, t, n) {
    let r = e.rows.map((e) =>
      e.locked === void 0
        ? { ...e, mode: t.plugins[e.id] ?? e.mode, drift: !1 }
        : { ...e, drift: !1 },
    )
    return {
      ...e,
      rows: r,
      agentMode: {
        ...e.agentMode,
        choice: t.agentMode,
        value: e.agentMode.available ? M(e, t.agentMode) : e.agentMode.value,
        drift: !1,
      },
      sandbox: {
        ...e.sandbox,
        choice: t.sandboxMode,
        mode: e.sandbox.available ? N(e, t.sandboxMode) : e.sandbox.mode,
        approval: e.sandbox.available ? P(e, t.sandboxMode) : e.sandbox.approval,
        drift: !1,
      },
      apply: { lastSavedAt: n ?? e.apply.lastSavedAt, drift: [] },
    }
  }
  function F(e, t) {
    if (e === void 0) return ``
    let n = e[t]
    if (typeof n == `string` && n !== ``) return n
    if (typeof e.en == `string` && e.en !== ``) return e.en
    for (let t of Object.values(e)) if (typeof t == `string` && t !== ``) return t
    return ``
  }
  function I(e, t) {
    if (e === null || e === ``) return t
    let n = new Date(e)
    if (Number.isNaN(n.getTime())) return e
    try {
      return n.toLocaleString()
    } catch {
      return e
    }
  }
  function L(e, t, n) {
    let r = `error.${t}`,
      a = i(r) ? e(r) : e(`error.generic`),
      o = t === `` ? `` : `[${t}] `,
      s = n.trim(),
      c = `${o}${a}`
    return s === `` ? c : `${c}: ${s}`
  }
  function R(e) {
    return `state.${e}`
  }
  function z(e) {
    return `lock.${e}`
  }
  function B(e) {
    return `lock.${e}.hint`
  }
  function V(e, t) {
    let n = `permission.${t}`
    return i(n) ? e(n) : t
  }
  function H(e, t) {
    let n = `permission.${t}`
    return i(n) ? e(n) : e(`sandbox.${t}.title`)
  }
  function U(e, t) {
    let n = e.find((e) => e.preset === t)
    return n === void 0 ? (e.find((e) => e.sandbox === t) ?? null) : n
  }
  function W(e) {
    return e.mode === `inherit` ? `inherit` : e.mode === `acp-default` ? `acp-default` : `pin`
  }
  function G(e, t) {
    let s = (t, n, ...r) => e.createElement(t, n, ...r),
      c = (e) => {
        try {
          return t.locale.subscribe(e)
        } catch {
          return () => {}
        }
      },
      l = () => {
        try {
          let e = t.locale.getLocale().active
          return typeof e == `string` ? e : `en`
        } catch {
          return `en`
        }
      }
    function u(e) {
      return s(
        `span`,
        { className: `dac-badge dac-badge-${e.tone}`, title: e.title },
        s(`span`, { className: `dac-dot`, 'aria-hidden': `true` }),
        e.label,
        e.value === void 0 ? null : ` `,
        e.value === void 0 ? null : e.value,
      )
    }
    function d(e) {
      return s(
        `div`,
        { className: `dac-section-head` },
        s(`h3`, { className: `dac-section-title` }, e.title),
        e.desc === void 0 ? null : s(`p`, { className: `dac-section-desc` }, e.desc),
      )
    }
    function f(e, t, n = !1) {
      return [
        s(`div`, { className: `dac-kv-key`, key: `${e}-key` }, e),
        s(
          `div`,
          { className: n ? `dac-kv-val dac-mono` : `dac-kv-val`, key: `${e}-val` },
          t === `` ? `—` : t,
        ),
      ]
    }
    function p(e) {
      return s(
        `div`,
        { className: `dac-seg`, role: `radiogroup`, 'aria-label': e.ariaLabel },
        [
          [`inherit`, `plugins.inherit`],
          [`on`, `plugins.on`],
          [`off`, `plugins.off`],
        ].map(([t, n]) =>
          s(
            `button`,
            {
              key: t,
              type: `button`,
              role: `radio`,
              'aria-checked': e.value === t ? `true` : `false`,
              className: `dac-seg-btn`,
              onClick: () => e.onChange(t),
            },
            e.t(n),
          ),
        ),
      )
    }
    function m(e) {
      let t = [
        {
          mode: `inherit`,
          label: e.inheritLabel,
          disabled: e.inheritDisabled,
          title: e.inheritTitle,
        },
        {
          mode: `acp-default`,
          label: e.acpDefaultLabel,
          disabled: e.acpDefaultDisabled,
          title: e.acpDefaultDisabled ? e.acpDefaultTitle : void 0,
        },
        { mode: `pin`, label: e.pinLabel, disabled: e.pinDisabled, title: e.pinTitle },
      ]
      return s(
        `div`,
        { className: `dac-seg`, role: `radiogroup`, 'aria-label': e.ariaLabel },
        t.map((t) =>
          s(
            `button`,
            {
              key: t.mode,
              type: `button`,
              role: `radio`,
              'aria-checked': e.value === t.mode ? `true` : `false`,
              className: `dac-seg-btn`,
              disabled: t.disabled,
              title: t.title,
              onClick: () => e.onChange(t.mode),
            },
            t.label,
          ),
        ),
      )
    }
    function h(e) {
      return s(
        `svg`,
        {
          className: e.open ? `dac-chevron dac-chevron-open` : `dac-chevron`,
          width: 12,
          height: 12,
          viewBox: `0 0 16 16`,
          'aria-hidden': `true`,
          focusable: `false`,
        },
        s(`path`, {
          d: `M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6`,
          fill: `none`,
          stroke: `currentColor`,
          'stroke-width': 1,
          'stroke-linecap': `round`,
          'stroke-linejoin': `round`,
        }),
      )
    }
    function g(e) {
      return s(
        `div`,
        { className: `dac-card-details`, id: e.id },
        s(`code`, { className: `dac-entry`, 'data-loader-entry': `true` }, e.entry),
        s(
          `dl`,
          { className: `dac-card-dl` },
          e.items.map(([e, t]) =>
            s(`div`, { className: `dac-card-dl-row`, key: e }, s(`dt`, null, e), s(`dd`, null, t)),
          ),
        ),
        e.footer === void 0 ? null : e.footer,
      )
    }
    function _(e) {
      let t = [
          s(`strong`, { className: `dac-card-title`, title: e.titleAttr }, e.title),
          e.desc === void 0 || e.desc === ``
            ? null
            : s(`span`, { className: `dac-card-desc` }, e.desc),
          e.risk === void 0 || e.risk === ``
            ? null
            : s(`span`, { className: `dac-card-risk` }, e.risk),
          e.meta === void 0 ? null : s(`span`, { className: `dac-card-meta` }, e.meta),
        ],
        n = e.selectable
          ? s(
              `button`,
              {
                type: `button`,
                className: `dac-card-content`,
                id: e.contentId,
                role: `radio`,
                'aria-checked': e.selected ? `true` : `false`,
                'aria-label': e.ariaLabel,
                tabIndex: e.selected ? 0 : -1,
                onClick: e.onSelect,
                onKeyDown: e.onKeyDown,
              },
              ...t,
            )
          : s(
              `button`,
              {
                type: `button`,
                className: `dac-card-content`,
                id: e.contentId,
                'aria-expanded': e.open ? `true` : `false`,
                'aria-controls': e.id,
                'aria-label': e.ariaLabel,
                onClick: e.onToggle,
                onKeyDown: e.onKeyDown,
              },
              ...t,
            ),
        r = s(
          `div`,
          { className: `dac-card-aside` },
          e.tag === void 0 ? null : s(`span`, { className: `dac-tag` }, e.tag),
          e.trailing === void 0 ? null : e.trailing,
          s(
            `button`,
            {
              type: `button`,
              className: `dac-card-toggle`,
              'aria-expanded': e.open ? `true` : `false`,
              'aria-controls': e.id,
              'aria-label': e.open ? e.t(`card.collapse`) : e.t(`card.expand`),
              onClick: e.onToggle,
            },
            s(h, { open: e.open }),
          ),
        )
      return s(
        `li`,
        {
          className: [
            `dac-card`,
            e.selectable ? `dac-card-select` : ``,
            e.selected ? `dac-card-on` : ``,
          ]
            .filter((e) => e !== ``)
            .join(` `),
        },
        s(`div`, { className: `dac-card-head` }, n, r),
        e.open ? s(g, { id: e.id, entry: e.entry, items: e.items, footer: e.footer }) : null,
      )
    }
    function v(e, t) {
      return e(t === `on` ? `plugins.on` : t === `off` ? `plugins.off` : `plugins.inherit`)
    }
    function y(e, t, n) {
      return t.locked === void 0
        ? n === `on`
          ? e(`plugins.on`)
          : n === `off`
            ? e(`plugins.off`)
            : t.web === `off`
              ? e(`tag.webOff`)
              : e(`tag.inheritWeb`, { state: e(R(t.web)) })
        : e(z(t.locked))
    }
    function b(e, t) {
      let n = `preset.${t}`
      return i(n) ? e(n) : t
    }
    function x(e, t) {
      return t === void 0 || t === ``
        ? `—`
        : t === `active`
          ? e(`fiber.active`)
          : t === `failed`
            ? e(`fiber.failed`)
            : t
    }
    function S(e, t, n, r) {
      let i = n.drift ? e(`detail.overrideDrift`, { mode: v(e, r) }) : v(e, r),
        a = F(n.presetName, t),
        o = n.locked === `preset-managed`,
        s =
          n.group === `session`
            ? a === ``
              ? e(`group.session`)
              : e(`detail.ownerPreset`, { preset: b(e, a) })
            : e(`group.global`)
      return [
        [e(`detail.fullName`), n.moduleName],
        [e(`detail.web`), e(o ? `detail.byPreset` : R(n.web))],
        [e(`detail.acp`), e(o ? `detail.byPreset` : R(n.acp))],
        [e(`detail.override`), i],
        [e(`detail.fiber`), x(e, n.webFiber)],
        [e(`detail.owner`), s],
      ]
    }
    function C(e) {
      let { t, row: n } = e,
        r = F(n.title, e.lang),
        i = r === `` || r === n.moduleName || r === n.id ? n.id : r,
        a = F(n.description, e.lang),
        o = n.id,
        c = y(t, n, e.mode)
      return s(_, {
        t,
        id: `dac-plugin-details-${n.id}`,
        contentId: `dac-plugin-card-${n.id}`,
        title: i,
        titleAttr: n.moduleName,
        desc: a,
        meta: o,
        tag: c,
        open: e.open,
        selectable: !1,
        selected: !1,
        entry: n.id,
        items: S(t, e.lang, n, e.mode),
        ariaLabel: `${i}, ${o}, ${c}`,
        trailing:
          n.locked === void 0
            ? s(p, {
                t,
                value: e.mode,
                ariaLabel: `${i} — ${t(`detail.override`)}`,
                onChange: e.onMode,
              })
            : void 0,
        footer:
          n.locked === void 0 ? void 0 : s(`p`, { className: `dac-card-hint` }, t(B(n.locked))),
        onToggle: e.onToggle,
      })
    }
    function w(e) {
      let { t, preset: n } = e,
        r = F(n.title, e.lang),
        i = r === `` || r === n.id ? b(t, n.id) : r,
        a = e.selected
          ? t(`tag.selected`)
          : e.status.agentMode.web === n.id
            ? t(`tag.webCurrent`)
            : void 0,
        o = e.status.agentMode.value === n.id
      return s(_, {
        t,
        id: `dac-preset-details-${n.id}`,
        contentId: `dac-preset-card-${n.id}`,
        title: i,
        desc:
          F(n.description, e.lang) ||
          (n.rowCount === void 0 ? void 0 : t(`preset.composed`, { n: n.rowCount })),
        tag: a,
        open: e.open,
        selectable: e.selectable,
        selected: e.selected,
        entry: n.id,
        items: [
          [t(`detail.presetId`), n.id],
          [t(`detail.source`), t(`source.acp`)],
          [t(`detail.default`), t(o ? `value.yes` : `value.no`)],
        ],
        ariaLabel:
          e.selectable === !0 ? t(`card.select`, { name: i }) : a === void 0 ? i : `${i}, ${a}`,
        onToggle: e.onToggle,
        onSelect: e.onSelect,
        onKeyDown: e.onKeyDown,
      })
    }
    function T(e) {
      let { t, sandbox: n } = e,
        r = o[n],
        i = U(e.status.sandbox.webPresets, n),
        a =
          i !== null && i.approval === r
            ? t(`source.webPreset`, { preset: V(t, i.preset) })
            : t(`source.builtin`),
        c = t(`sandbox.${n}.title`)
      return s(_, {
        t,
        id: `dac-sandbox-details-${n}`,
        contentId: `dac-sandbox-card-${n}`,
        title: c,
        desc: t(`sandbox.${n}.desc`),
        risk: n === `danger-full-access` ? t(`sandbox.dangerFullAccess.risk`) : void 0,
        meta: n,
        tag: e.selected
          ? t(`tag.selected`)
          : e.status.sandbox.web?.sandbox === n
            ? t(`tag.webCurrent`)
            : void 0,
        open: e.open,
        selectable: e.selectable,
        selected: e.selected,
        entry: n,
        items: [
          [t(`detail.sandbox`), n],
          [t(`detail.approval`), t(`approval.${r}`)],
          [t(`detail.source`), a],
        ],
        ariaLabel: e.selectable === !0 ? t(`card.select`, { name: c }) : c,
        onToggle: e.onToggle,
        onSelect: e.onSelect,
        onKeyDown: e.onKeyDown,
      })
    }
    function E(e) {
      return e.show
        ? s(
            `p`,
            { className: `dac-note dac-note-warn` },
            s(u, { tone: `warn`, label: e.t(`choice.drift`), title: e.t(`choice.driftHint`) }),
            ` `,
            e.t(`choice.driftHint`),
          )
        : null
    }
    function O(e) {
      let { t, status: n } = e,
        r = n.agentMode.available,
        i = e.draft.agentMode,
        a = W(i),
        o = n.agentMode.web,
        c = (t) => {
          let r = n.presets.find((e) => e.id === t)
          return r === void 0 ? t : F(r.title, e.lang) || t
        },
        l = o === null ? t(`choice.inheritUnknown`) : t(`choice.inheritWeb`, { value: c(o) }),
        u = i.mode === `preset` ? i.id : null,
        f = n.presets[0]?.id ?? ``,
        p = o === null,
        h = n.agentMode.reason ?? t(`choice.noWebValue`),
        g = !r || (n.presets.length === 0 && u === null),
        _ = a === `pin` && r,
        v = (t) => {
          if (t === `inherit`) {
            e.onChange({ mode: `inherit` })
            return
          }
          if (t === `acp-default`) {
            e.onChange({ mode: `acp-default` })
            return
          }
          let r = u ?? n.agentMode.value ?? f
          r !== `` && e.onChange({ mode: `preset`, id: r })
        },
        y = (t, r) => {
          if (!_) return
          let i = n.presets,
            a = i.length - 1,
            o = -1
          if (
            (t.key === `ArrowDown` || t.key === `ArrowRight`
              ? (o = r === a ? 0 : r + 1)
              : t.key === `ArrowUp` || t.key === `ArrowLeft`
                ? (o = r === 0 ? a : r - 1)
                : t.key === `Home`
                  ? (o = 0)
                  : t.key === `End` && (o = a),
            o < 0)
          )
            return
          let s = i[o]
          s !== void 0 &&
            (t.preventDefault(),
            e.onChange({ mode: `preset`, id: s.id }),
            document.getElementById(`dac-preset-card-${s.id}`)?.focus())
        },
        b = n.presets.map((r, i) =>
          s(w, {
            key: r.id,
            t,
            lang: e.lang,
            preset: r,
            status: n,
            selected: u === r.id,
            selectable: _,
            open: e.openCards[`preset:${r.id}`] === !0,
            onToggle: () => e.onToggleCard(`preset:${r.id}`),
            onSelect: () => e.onChange({ mode: `preset`, id: r.id }),
            onKeyDown: (e) => y(e, i),
          }),
        )
      return s(
        `section`,
        { className: `dac-section` },
        s(d, { title: t(`agentMode.title`), desc: t(`agentMode.desc`) }),
        s(m, {
          ariaLabel: t(`agentMode.title`),
          value: a,
          inheritLabel: l,
          inheritDisabled: !r || p,
          inheritTitle: r && !p ? void 0 : t(`choice.inheritBlocked`, { reason: h }),
          acpDefaultLabel: t(`choice.acpDefault`),
          acpDefaultDisabled: !r,
          acpDefaultTitle: t(`choice.acpDefaultBlocked`),
          pinLabel: t(`choice.pinAgent`),
          pinDisabled: g,
          pinTitle: g ? t(`choice.pinAgentHint`) : void 0,
          onChange: v,
        }),
        a === `inherit` && o !== null
          ? s(`p`, { className: `dac-note` }, t(`choice.inheritNote`, { value: c(o) }))
          : null,
        a === `acp-default` ? s(`p`, { className: `dac-note` }, t(`choice.acpDefaultDesc`)) : null,
        p
          ? s(
              `p`,
              { className: `dac-note dac-note-warn` },
              t(`choice.inheritBlocked`, { reason: h }),
            )
          : null,
        s(E, { t, show: a === `inherit` && n.agentMode.drift }),
        n.presets.length === 0
          ? s(`p`, { className: `dac-note` }, t(`agentMode.empty`))
          : s(
              `ul`,
              {
                className: `dac-cards`,
                role: _ ? `radiogroup` : void 0,
                'aria-label': _ ? t(`agentMode.title`) : void 0,
              },
              b,
            ),
        r
          ? null
          : s(
              `p`,
              { className: `dac-note dac-note-warn` },
              n.agentMode.reason === void 0
                ? t(`agentMode.unavailableHint`)
                : t(`agentMode.unavailable`, { reason: n.agentMode.reason }),
            ),
      )
    }
    function A(e) {
      let { t, status: n } = e,
        r = n.sandbox.available,
        i = e.draft.sandboxMode,
        o = W(i),
        c = n.sandbox.web,
        l =
          c === null
            ? t(`choice.inheritUnknown`)
            : t(`choice.inheritWeb`, { value: V(t, c.preset) }),
        u = i.mode === `sandbox` ? i.sandbox : null,
        f = c === null,
        p = n.sandbox.reason ?? t(`choice.noWebValue`),
        h = n.sandbox.mode ?? `workspace-write`,
        g = o === `pin` && r,
        _ = (t) => {
          t === `inherit`
            ? e.onChange({ mode: `inherit` })
            : t === `acp-default`
              ? e.onChange({ mode: `acp-default` })
              : e.onChange({ mode: `sandbox`, sandbox: u ?? h })
        },
        v = (t, n) => {
          if (!g) return
          let r = a.length - 1,
            i = -1
          if (
            (t.key === `ArrowDown` || t.key === `ArrowRight`
              ? (i = n === r ? 0 : n + 1)
              : t.key === `ArrowUp` || t.key === `ArrowLeft`
                ? (i = n === 0 ? r : n - 1)
                : t.key === `Home`
                  ? (i = 0)
                  : t.key === `End` && (i = r),
            i < 0)
          )
            return
          let o = a[i]
          o !== void 0 &&
            (t.preventDefault(),
            e.onChange({ mode: `sandbox`, sandbox: o }),
            document.getElementById(`dac-sandbox-card-${o}`)?.focus())
        },
        y = a.map((r, i) =>
          s(T, {
            key: r,
            t,
            sandbox: r,
            status: n,
            selected: u === r,
            selectable: g,
            open: e.openCards[`sandbox:${r}`] === !0,
            onToggle: () => e.onToggleCard(`sandbox:${r}`),
            onSelect: () => e.onChange({ mode: `sandbox`, sandbox: r }),
            onKeyDown: (e) => v(e, i),
          }),
        )
      return s(
        `section`,
        { className: `dac-section` },
        s(d, { title: t(`sandbox.title`), desc: t(`sandbox.desc`) }),
        s(m, {
          ariaLabel: t(`sandbox.title`),
          value: o,
          inheritLabel: l,
          inheritDisabled: !r || f,
          inheritTitle: r && !f ? void 0 : t(`choice.inheritBlocked`, { reason: p }),
          acpDefaultLabel: t(`choice.acpDefault`),
          acpDefaultDisabled: !r,
          acpDefaultTitle: t(`choice.acpDefaultBlocked`),
          pinLabel: t(`choice.pinSandbox`),
          pinDisabled: !r,
          pinTitle: r ? void 0 : t(`choice.pinSandboxHint`),
          onChange: _,
        }),
        o === `inherit` && c !== null
          ? s(
              `p`,
              { className: `dac-note` },
              t(`choice.inheritResolved`, {
                preset: V(t, c.preset),
                sandbox: H(t, c.sandbox),
                approval: t(`approval.${c.approval}`),
              }),
            )
          : null,
        o === `acp-default` ? s(`p`, { className: `dac-note` }, t(`choice.acpDefaultDesc`)) : null,
        f
          ? s(
              `p`,
              { className: `dac-note dac-note-warn` },
              t(`choice.inheritBlocked`, { reason: p }),
            )
          : null,
        s(E, { t, show: o === `inherit` && n.sandbox.drift }),
        s(
          `ul`,
          {
            className: `dac-cards`,
            role: g ? `radiogroup` : void 0,
            'aria-label': g ? t(`sandbox.title`) : void 0,
          },
          y,
        ),
        r
          ? null
          : s(
              `p`,
              { className: `dac-note dac-note-warn` },
              n.sandbox.reason === void 0
                ? t(`sandbox.unavailableHint`)
                : t(`sandbox.unavailable`, { reason: n.sandbox.reason }),
            ),
      )
    }
    let j = [`plugins`, `agent`, `sandbox`, `status`],
      M = {
        plugins: `tab.plugins`,
        agent: `tab.agentMode`,
        sandbox: `tab.sandbox`,
        status: `tab.status`,
      },
      N = 0,
      P = 0
    function G(e) {
      return s(
        `div`,
        { className: `dac-tabs`, role: `tablist`, 'aria-label': e.t(`tabs.label`) },
        j.map((t, n) =>
          s(
            `button`,
            {
              key: t,
              type: `button`,
              role: `tab`,
              id: `dac-tab-${t}`,
              'aria-selected': e.active === t ? `true` : `false`,
              'aria-controls': `dac-panel-${t}`,
              tabIndex: e.active === t ? 0 : -1,
              className: `dac-tab`,
              onClick: () => e.onSelect(t),
              onKeyDown: (t) => e.onKeyDown(t, n),
            },
            e.t(M[t]),
            t === `plugins`
              ? s(
                  `span`,
                  { className: `dac-tab-badge` },
                  e.t(`tab.switchableBadge`, { n: e.switchable }),
                )
              : null,
            t === `status` && e.warnings > 0
              ? s(`span`, {
                  className: `dac-tab-dot`,
                  title: e.t(`tab.warnings`, { n: e.warnings }),
                  'aria-hidden': `true`,
                })
              : null,
          ),
        ),
      )
    }
    function K(e) {
      return s(
        `div`,
        { className: `dac-toasts` },
        e.toasts.map((t) =>
          s(
            `div`,
            {
              key: String(t.id),
              className: `dac-toast dac-toast-${t.tone}`,
              role: t.tone === `error` ? `alert` : `status`,
              'aria-live': t.tone === `error` ? `assertive` : `polite`,
            },
            s(`span`, { className: `dac-toast-dot`, 'aria-hidden': `true` }),
            s(
              `div`,
              { className: `dac-toast-body` },
              s(`span`, { className: `dac-toast-title` }, t.title),
              t.detail === void 0 ? null : s(`span`, { className: `dac-toast-detail` }, t.detail),
              t.reload === !0
                ? s(
                    `div`,
                    { className: `dac-toast-actions` },
                    s(
                      `button`,
                      { type: `button`, className: `dac-btn`, onClick: e.onReloadConfirm },
                      e.t(`actions.reloadConfirmYes`),
                    ),
                    s(
                      `button`,
                      { type: `button`, className: `dac-btn`, onClick: () => e.onDismiss(t.id) },
                      e.t(`actions.reloadConfirmNo`),
                    ),
                  )
                : null,
            ),
            s(
              `button`,
              {
                type: `button`,
                className: `dac-toast-close`,
                'aria-label': e.t(`toast.close`),
                title: e.t(`toast.close`),
                onClick: () => e.onDismiss(t.id),
              },
              `×`,
            ),
          ),
        ),
      )
    }
    function q(e) {
      let { t, status: n } = e,
        r = n.apply.drift,
        i = n.agentMode.value,
        a = n.warnings
      return s(
        `section`,
        { className: `dac-card` },
        s(
          `div`,
          { className: `dac-card-body` },
          s(
            `div`,
            { className: `dac-kv` },
            ...f(t(`summary.profile`), n.acp.name, !0),
            ...f(t(`summary.dir`), n.acp.dir, !0),
            ...f(t(`summary.patch`), n.acp.patchPath, !0),
            ...f(t(`summary.lastSaved`), I(n.apply.lastSavedAt, t(`summary.neverSaved`))),
          ),
          s(
            `p`,
            { className: `dac-note` },
            t(`summary.effective`, {
              agent: i === null ? t(`value.none`) : i,
              sandbox: n.sandbox.mode === null ? t(`value.none`) : n.sandbox.mode,
            }),
          ),
          n.acp.exists
            ? null
            : s(`p`, { className: `dac-note dac-note-warn` }, t(`summary.profileMissing`)),
          s(`p`, { className: `dac-note` }, t(`summary.restart`)),
          r.length === 0
            ? null
            : s(
                `p`,
                { className: `dac-note dac-note-warn` },
                t(`summary.drift`, { n: r.length }),
                ` `,
                r.slice(0, 5).join(`, `),
                r.length > 5 ? ` …` : ``,
              ),
          a.length === 0
            ? null
            : s(
                `ul`,
                { className: `dac-warnlist` },
                a.map((e, t) => s(`li`, { key: `${t}:${e}` }, e)),
              ),
        ),
      )
    }
    function J(e, t, n) {
      return t === `` || `${e.id} ${e.moduleName} ${F(e.title, n)}`.toLowerCase().includes(t)
    }
    function Y(e) {
      return s(
        `button`,
        {
          type: `button`,
          className: `dac-group-head`,
          'aria-expanded': e.open ? `true` : `false`,
          'aria-controls': e.id,
          onClick: e.onToggle,
        },
        s(h, { open: e.open }),
        s(`span`, { className: `dac-group-title` }, e.title),
        s(
          `span`,
          { className: `dac-group-trailing` },
          s(`span`, { className: `dac-tag` }, String(e.count)),
        ),
      )
    }
    function oe(e) {
      let { t, lang: n, rows: r, query: i } = e,
        a = i.trim().toLowerCase(),
        o = r.filter((e) => J(e, a, n)),
        c = o.filter((e) => e.group === `session` && e.locked !== `not-in-acp`),
        l = o.filter((e) => e.group === `global` && e.locked !== `not-in-acp`),
        u = o.filter((e) => e.locked === `not-in-acp`),
        d = o.filter((e) => e.locked === void 0),
        f = o.filter((e) => e.locked !== void 0 && e.locked !== `not-in-acp`),
        p = (r, i, a, o) => {
          if (o.length === 0) return null
          let c = e.openGroups[r] === !0,
            l = `dac-group-${r}`
          return s(
            `section`,
            { className: `dac-group`, key: r },
            s(Y, {
              t,
              id: l,
              title: i,
              count: o.length,
              open: c,
              onToggle: () => e.onToggleGroup(r),
            }),
            s(`p`, { className: `dac-group-desc` }, a),
            s(
              `ul`,
              { className: `dac-cards`, id: l },
              c
                ? o.map((r) =>
                    s(C, {
                      key: r.id,
                      t,
                      lang: n,
                      row: r,
                      mode: e.draft.plugins[r.id] ?? r.mode,
                      open: e.openCards[`plugin:${r.id}`] === !0,
                      onToggle: () => e.onToggleCard(`plugin:${r.id}`),
                      onMode: (t) => e.onMode(r.id, t),
                    }),
                  )
                : [],
            ),
          )
        },
        m = [],
        h = p(`session`, t(`group.session`), t(`group.session.desc`), c)
      h !== null && m.push(h)
      let g = p(`global`, t(`group.global`), t(`group.global.desc`), l)
      g !== null && m.push(g)
      let _ = p(`webOnly`, t(`group.notInAcp`), t(`group.notInAcp.desc`), u)
      return (
        _ !== null && m.push(_),
        s(
          `section`,
          { className: `dac-section` },
          s(
            `div`,
            { className: `dac-search-row` },
            s(`input`, {
              className: `dac-search`,
              type: `search`,
              value: i,
              placeholder: t(`plugins.search`),
              'aria-label': t(`plugins.search`),
              onChange: (t) => e.onQuery(t.target.value),
            }),
            i === ``
              ? null
              : s(
                  `button`,
                  { type: `button`, className: `dac-btn`, onClick: () => e.onQuery(``) },
                  t(`plugins.clear`),
                ),
            s(
              `span`,
              { className: `dac-count` },
              t(`plugins.count`, { switchable: d.length, locked: f.length }),
            ),
          ),
          o.length === 0
            ? s(
                `div`,
                { className: `dac-empty` },
                a === `` ? t(`plugins.empty`) : t(`plugins.noMatch`, { query: i.trim() }),
              )
            : s(`div`, { className: `dac-groups` }, m),
        )
      )
    }
    function X() {
      let i = n(e.useSyncExternalStore(c, l)),
        a = (e, t) => r(i, e, t),
        [o, u] = e.useState(null),
        [d, f] = e.useState(null),
        [p, m] = e.useState(null),
        [h, g] = e.useState(0),
        [_, v] = e.useState(null),
        [y, b] = e.useState(`plugins`),
        [x, S] = e.useState([]),
        [C, w] = e.useState(``),
        [T, E] = e.useState({ session: !1, global: !0, webOnly: !1 }),
        [M, F] = e.useState({}),
        [I, R] = e.useState(!1),
        z = e.useMemo(() => {
          let e = /* @__PURE__ */ new Set()
          return {
            push: (t) => {
              N += 1
              let n = N
              if ((S((e) => [...e, { ...t, id: n }].slice(-3)), t.tone !== `ok`)) return
              let r = window.setTimeout(() => {
                ;(e.delete(r), S((e) => e.filter((e) => e.id !== n)))
              }, 5e3)
              e.add(r)
            },
            dismiss: (e) => {
              S((t) => t.filter((t) => t.id !== e))
            },
            clearReload: () => {
              S((e) => e.filter((e) => e.reload !== !0))
            },
            dispose: () => {
              for (let t of e) window.clearTimeout(t)
              e.clear()
            },
          }
        }, [S])
      e.useEffect(() => () => z.dispose(), [z])
      let B = e.useMemo(
        () => (e) => {
          k(t, `status`, {}).then((t) => {
            if (t.ok) {
              let n = ee(t.value)
              n === null
                ? e || ((P += 1), m({ seq: P, code: `bad-response`, detail: `` }))
                : (u(n), f(ne(n)), m(null))
            } else ((P += 1), m({ seq: P, code: t.code, detail: t.detail }))
          })
        },
        [],
      )
      ;(e.useEffect(() => {
        B(!1)
      }, [B]),
        e.useEffect(() => {
          o === null ||
            I ||
            o.warnings.length === 0 ||
            (R(!0),
            z.push({ tone: `warn`, title: r(i, `toast.warnings`, { n: o.warnings.length }) }))
        }, [o, I, i, z]),
        e.useEffect(() => {
          p === null ||
            o === null ||
            p.seq <= h ||
            (g(p.seq),
            z.push({
              tone: `error`,
              title: r(i, `state.loadFailed`),
              detail: L((e, t) => r(i, e, t), p.code, p.detail),
            }))
        }, [p, o, i, z, h]),
        e.useEffect(() => {
          C.trim() !== `` &&
            E((e) =>
              e.session && e.global && e.webOnly ? e : { session: !0, global: !0, webOnly: !0 },
            )
        }, [C]))
      let V = re(o, d),
        H = (e, t) => {
          f((n) => (n === null ? n : { ...n, plugins: { ...n.plugins, [e]: t } }))
        },
        U = (e) => {
          f((t) => (t === null ? t : { ...t, agentMode: e }))
        },
        W = (e) => {
          f((t) => (t === null ? t : { ...t, sandboxMode: e }))
        },
        J = (e) => {
          E((t) => ({ ...t, [e]: t[e] !== !0 }))
        },
        Y = (e) => {
          F((t) => ({ ...t, [e]: t[e] !== !0 }))
        },
        X = () => {
          if (o === null || d === null || _ !== null || !V) return
          let e = ie(o, d)
          ;(v(`save`),
            k(t, `save`, e).then((e) => {
              if ((v(null), !e.ok)) {
                z.push({
                  tone: `error`,
                  title: a(`notice.saveFailed`),
                  detail: L(a, e.code, e.detail),
                })
                return
              }
              let t = D(e.value)
              ;(u((e) => (e === null ? e : ae(e, d, t.savedAt))),
                z.push({
                  tone: `ok`,
                  title:
                    t.changed.length > 0
                      ? a(`notice.saved`, { n: t.changed.length })
                      : a(`notice.savedNoChanges`),
                  detail:
                    t.warnings.length === 0
                      ? void 0
                      : a(`toast.moreWarnings`, { n: t.warnings.length }),
                }),
                B(!0))
            }))
        },
        se = () => {
          _ === null &&
            (v(`validate`),
            k(t, `validate`, {}).then((e) => {
              if ((v(null), !e.ok)) {
                z.push({
                  tone: `error`,
                  title: a(`notice.validateFailed`),
                  detail: L(a, e.code, e.detail),
                })
                return
              }
              let t = te(e.value)
              z.push({
                tone: `ok`,
                title: a(`notice.validateOk`, {
                  source: a(t.source === `live` ? `verify.live` : `verify.unavailable`),
                  agent: t.agentMode === null ? a(`value.none`) : t.agentMode,
                  sandbox: t.sandbox === null ? a(`value.none`) : t.sandbox,
                }),
                detail:
                  t.warnings.length === 0
                    ? void 0
                    : a(`toast.moreWarnings`, { n: t.warnings.length }),
              })
            }))
        },
        ce = () => {
          _ === null &&
            (V
              ? x.some((e) => e.reload === !0) ||
                z.push({ tone: `warn`, title: a(`actions.reloadConfirm`), reload: !0 })
              : B(!1))
        },
        Z = () => {
          ;(z.clearReload(), B(!1))
        },
        le = (e, t) => {
          let n = j.length - 1,
            r = t
          if (e.key === `ArrowRight`) r = t === n ? 0 : t + 1
          else if (e.key === `ArrowLeft`) r = t === 0 ? n : t - 1
          else if (e.key === `Home`) r = 0
          else if (e.key === `End`) r = n
          else return
          e.preventDefault()
          let i = j[r]
          i !== void 0 && (b(i), document.getElementById(`dac-tab-${i}`)?.focus())
        },
        Q = o?.rows ?? [],
        ue = Q.filter((e) => e.locked === void 0).length,
        de = o?.warnings.length ?? 0,
        fe = s(
          `button`,
          { type: `button`, className: `dac-btn`, onClick: () => B(!1) },
          a(`state.retry`),
        ),
        $
      if (o === null)
        $ =
          p === null
            ? s(`div`, { className: `dac-state` }, s(`span`, null, a(`state.loading`)))
            : s(
                `div`,
                { className: `dac-state`, role: `alert` },
                s(`span`, null, a(`state.loadFailed`)),
                s(`span`, { className: `dac-error-detail` }, L(a, p.code, p.detail)),
                fe,
              )
      else if (d === null)
        $ = s(`div`, { className: `dac-state` }, s(`span`, null, a(`state.loading`)))
      else {
        let e = d,
          t
        ;((t =
          y === `agent`
            ? s(O, {
                t: a,
                lang: i,
                status: o,
                draft: e,
                onChange: U,
                openCards: M,
                onToggleCard: Y,
              })
            : y === `sandbox`
              ? s(A, { t: a, status: o, draft: e, onChange: W, openCards: M, onToggleCard: Y })
              : y === `status`
                ? s(q, { t: a, status: o })
                : s(oe, {
                    t: a,
                    lang: i,
                    rows: Q,
                    draft: e,
                    query: C,
                    onQuery: w,
                    openGroups: T,
                    onToggleGroup: J,
                    openCards: M,
                    onToggleCard: Y,
                    onMode: H,
                  })),
          ($ = s(
            `div`,
            { className: `dac-body` },
            s(G, { t: a, active: y, switchable: ue, warnings: de, onSelect: b, onKeyDown: le }),
            s(
              `div`,
              {
                className: `dac-panel`,
                role: `tabpanel`,
                id: `dac-panel-${y}`,
                'aria-labelledby': `dac-tab-${y}`,
              },
              t,
            ),
            s(
              `div`,
              { className: `dac-dock` },
              s(
                `div`,
                { className: `dac-actions` },
                s(
                  `button`,
                  {
                    type: `button`,
                    className: `dac-btn dac-btn-primary`,
                    disabled: _ !== null || !V,
                    onClick: X,
                  },
                  _ === `save` ? `${a(`actions.save`)}…` : a(`actions.save`),
                ),
                s(
                  `button`,
                  { type: `button`, className: `dac-btn`, disabled: _ !== null, onClick: ce },
                  a(`actions.reload`),
                ),
                s(
                  `button`,
                  { type: `button`, className: `dac-btn`, disabled: _ !== null, onClick: se },
                  _ === `validate` ? `${a(`actions.validate`)}…` : a(`actions.validate`),
                ),
                V
                  ? s(`span`, { className: `dac-dirty` }, a(`actions.dirty`))
                  : s(`span`, { className: `dac-clean` }, a(`actions.clean`)),
              ),
            ),
          )))
      }
      return s(
        `div`,
        { className: `dac-page` },
        s(`style`, {
          dangerouslySetInnerHTML: {
            __html: `
.dac-page{--dac-dock-h:56px;display:flex;flex-direction:column;gap:14px;width:100%;max-width:820px;box-sizing:border-box}
.dac-head{display:flex;flex-direction:column;gap:4px;padding:0 2px}
.dac-title{margin:0;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px}
.dac-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dac-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.dac-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 2px;overflow-x:auto;scrollbar-width:none}
.dac-tab{position:relative;display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px 10px;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0;transition:color .12s ease}
.dac-tab:hover{color:var(--dsw-alias-label-primary)}
.dac-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.dac-tab::after{content:'';position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px;background:transparent;transition:background .12s ease}
.dac-tab[aria-selected="true"]::after{background:var(--dsw-alias-brand-primary)}
.dac-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-tab-badge{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 6px;font-size:11px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums}
.dac-tab-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
.dac-panel{display:flex;flex-direction:column;gap:14px;min-width:0}

/* Official card shell and folded face (docs/OFFICIAL-UI-SPEC.md). */
.dac-card{position:relative;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:20px;overflow:hidden;box-sizing:border-box}
.dac-card-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dac-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:0;padding:0;list-style:none}
.dac-cards:empty{display:none}
.dac-card-head{display:flex;align-items:center;gap:10px;padding-right:12px}
.dac-card-head .dac-card-content{flex:1;min-width:0}
.dac-card-aside{flex:none;display:inline-flex;align-items:center;gap:8px}
.dac-card-content{display:flex;flex-direction:column;gap:2px;width:100%;padding:12px 14px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dac-card-content:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-card-row{display:flex;gap:12px;align-items:center;justify-content:space-between;min-width:0}
.dac-card-title{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-card-trailing{flex:none;display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary)}
.dac-tag{display:inline-flex;align-items:center;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.dac-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dac-chevron-open{transform:rotate(180deg)}
.dac-card-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dac-card-risk{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;padding-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dac-card-meta{padding-top:6px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-card-select .dac-card-content{padding-right:46px}
.dac-card-toggle{position:absolute;top:11px;right:10px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dac-card-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-card-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dac-card-on{border-color:var(--dsw-alias-brand-primary)}

/* Details drawer: layer-3 surface, top border, 10/14/12 padding. */
.dac-card-details{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-3);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px 12px}
.dac-entry{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dac-card-dl{margin:0;display:flex;flex-direction:column;gap:4px}
.dac-card-dl-row{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:14px;font-size:12px;line-height:18px}
.dac-card-dl-row dt{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dac-card-dl-row dd{margin:0;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
.dac-card-controls{display:flex;flex-direction:column;gap:6px;padding-top:2px}
.dac-card-control-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dac-card-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}

/* Folded groups: header row + description + card list. */
.dac-groups{display:flex;flex-direction:column;gap:16px}
.dac-group{display:flex;flex-direction:column;gap:6px}
.dac-group-head{display:flex;gap:8px;align-items:center;width:100%;padding:6px 4px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:20px;text-align:left;cursor:pointer}
.dac-group-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dac-group-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-group-trailing{flex:none;display:inline-flex;align-items:center;gap:6px}
.dac-group-desc{margin:0;padding:0 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}

.dac-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;font-size:13px;line-height:20px}
.dac-kv-key{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dac-kv-val{color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.dac-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;overflow-wrap:anywhere;word-break:break-word}
.dac-warnlist{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-section{display:flex;flex-direction:column;gap:10px}
.dac-section-head{display:flex;flex-direction:column;gap:4px;padding:0 2px}
.dac-section-title{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dac-section-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-search-row{display:flex;gap:8px;align-items:center}
.dac-search{box-sizing:border-box;flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;line-height:20px}
.dac-search::placeholder{color:var(--dsw-alias-label-caption)}
.dac-search:hover{border-color:var(--dsw-alias-border-l1)}
.dac-search:focus,.dac-search:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dac-count{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dac-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:0 7px;font-size:12px;line-height:18px;white-space:nowrap}
.dac-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none}
.dac-badge-warn .dac-dot{background:var(--dsw-alias-state-warn-primary)}
.dac-card-aside .dac-seg{flex:none;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dac-card-aside .dac-seg-btn{padding:2px 8px;font-size:12px;line-height:18px;border-radius:6px}
.dac-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:8px;padding:2px;gap:2px}
.dac-seg-btn{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:normal;text-align:center;transition:background .12s ease,color .12s ease}
.dac-seg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-seg-btn[aria-checked="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dac-seg-btn:disabled{opacity:.45;cursor:default}
.dac-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dac-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-note-warn{color:var(--dsw-alias-state-warn-primary)}
.dac-error-detail{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-state{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dac-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:14px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:2px}
.dac-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;flex:none;transition:background .12s ease,border-color .12s ease}
.dac-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dac-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dac-btn:disabled{opacity:.5;cursor:default}
.dac-btn-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.dac-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover);border-color:var(--dsw-alias-button-info-hover)}
.dac-dirty{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.dac-clean{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}

.dac-dock{position:sticky;bottom:0;z-index:3;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0 6px;margin-top:4px}
.dac-toasts{position:fixed;right:24px;bottom:calc(24px + var(--dac-dock-h,56px));z-index:20;display:flex;flex-direction:column;gap:8px;width:320px;max-width:calc(100vw - 48px);pointer-events:none}
.dac-toast{pointer-events:auto;display:flex;gap:8px;align-items:flex-start;width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:13px;line-height:20px}
.dac-toast-dot{flex:none;width:6px;height:6px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.dac-toast-ok .dac-toast-dot{background:var(--dsw-alias-state-success-primary)}
.dac-toast-warn .dac-toast-dot{background:var(--dsw-alias-state-warn-primary)}
.dac-toast-error .dac-toast-dot{background:var(--dsw-alias-state-error-primary)}
.dac-toast-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dac-toast-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.dac-toast-ok .dac-toast-title{color:var(--dsw-alias-state-success-primary)}
.dac-toast-warn .dac-toast-title{color:var(--dsw-alias-state-warn-primary)}
.dac-toast-error .dac-toast-title{color:var(--dsw-alias-state-error-primary)}
.dac-toast-detail{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-toast-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.dac-toast-actions .dac-btn{padding:3px 10px;font-size:12px;line-height:18px}
.dac-toast-close{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:18px;padding:0 2px;cursor:pointer;border-radius:4px}
.dac-toast-close:hover{color:var(--dsw-alias-label-primary)}
.dac-toast-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media (max-width:720px){
.dac-page{--dac-dock-h:96px}
.dac-kv{grid-template-columns:minmax(0,1fr);gap:0}
.dac-kv-key{white-space:normal;font-size:12px;line-height:18px;margin-top:8px}
.dac-kv-key:first-child{margin-top:0}
.dac-kv-val{font-size:13px;line-height:20px;overflow-wrap:anywhere;word-break:break-word}
.dac-seg{width:100%}
.dac-seg-btn{flex:1 1 auto}
.dac-tabs{padding:0}
.dac-card-dl-row{grid-template-columns:minmax(0,1fr);gap:0}
.dac-card-dl-row dt{margin-top:4px}
.dac-dock{padding-bottom:2px}
.dac-dock .dac-actions{row-gap:6px}
.dac-dock .dac-actions .dac-dirty,.dac-dock .dac-actions .dac-clean{flex-basis:100%}
.dac-toasts{left:12px;right:12px;width:auto;bottom:calc(16px + var(--dac-dock-h,96px))}
}
`,
          },
        }),
        s(
          `header`,
          { className: `dac-head` },
          s(`h2`, { className: `dac-title` }, a(`section`)),
          s(`p`, { className: `dac-sub` }, a(`intro`)),
        ),
        $,
        x.length === 0 ? null : s(K, { t: a, toasts: x, onDismiss: z.dismiss, onReloadConfirm: Z }),
      )
    }
    return X
  }
  window.__ModuleLoader__.load({
    id: `dsh-acp-config`,
    factory(e) {
      let t = e('react'),
        i = (e) => {
          try {
            return e.locale.getLocale().active
          } catch {
            return `en`
          }
        }
      return {
        inject: [`slots`, `locale`, `connection`],
        apply(e) {
          let a = G(t, e)
          e.slots.inject(`settings.section`, () =>
            e.slots.register(
              {
                name: `settings.section`,
                id: `acp-config`,
                order: 22,
                label: () => r(n(i(e)), `section`),
              },
              a,
            ),
          )
        },
      }
    },
  })
})()
