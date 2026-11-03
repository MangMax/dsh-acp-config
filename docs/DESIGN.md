# dsh-acp-config — 设计说明（团队唯一事实来源）

> 目标：在 **当前 Web GUI 所属 profile**（本机是 `desktop`）的设置页里，为 **`dsh --profile acp`** 提供可视化配置：
> ① 逐插件选择「继承 Web 端开关 / 强制开启 / 强制关闭」；② 选择 ACP 会话的 agent preset；③ 选择 ACP 的沙箱权限。
>
> 构建工具链：**pnpm + Vite+（`vp check` / `vp test run` / `vp pack`）+ TypeScript**，零运行时依赖。
> 最后通过 `plugin_manager` 的 `install_bundle` 安装到桌面 profile，并在本机 GUI 验证。

## 1. 为什么是这个架构

- ACP 是**独立 profile**（`$DSH_HOME/profiles/acp`），它的进程里没有 Web UI；Web 设置页只存在于 GUI profile。
- 现有 `dsh-acp-agentmode` 只提供 CLI 参数 `--agentmode`，没有界面，也不能管理插件/沙箱。
- 因此本插件分两半：
  - **Host 半**（装在 GUI profile）：读 ACP profile 的**真实组合结果**（`dsh --profile acp --dump-config`），读当前 profile 的**实时插件状态**（`ctx.pluginManager.listPlugins()`），把用户选择写进 ACP profile 的补丁层 `cordis.patch.yml`。
  - **Client 半**（同一包里 `dsh.client`）：在 `settings.section` 槽注册「ACP 模式」页，通过 `ctx.connection.rpc.call('/api', 'dsh-acp-config', …)` 调 Host。
- ACP profile 是 `patchReload: startup`：**保存后下次启动 ACP 生效**，页面必须如实说明。
- 不改 ACP 的 `package.json`、不装包、不启动/重启 ACP 进程；只写 profile 补丁层（带标记的托管块）+ 一个状态 JSON。**用户手写内容必须原样保留。**

## 2. 已验证的环境事实（不要再假设）

- GUI 进程是 Electron main（`ELECTRON_RUN_AS_NODE=1`），`process.argv` 形如：
  `[app, …/dsh-desktop-host/lib/index.js, <dshRoot app.asar/dsh>, <profileDir>, …/primary-runtime, …/pnpm.mjs, …/runtime/bin]`。
- 宿主进程**能读 app.asar**（`readFileSync` 成功），但**不需要**读它。
- 宿主进程里 `spawnSync('dsh', ['--profile','acp','--dump-config'])` **可用**（exit 0，输出 ~54KB），PATH 含 `~/.vite-plus/bin`。
- `runtime/bin/node` 是包装脚本，直接 spawn 会 127；**不要**用它。备选命令：`process.execPath`（Electron）+ `ELECTRON_RUN_AS_NODE=1` + `<dshRoot>/node_modules/@deepseek-ai/dsh/lib/bin.js`。
- `dsh --profile desktop …` 由 Electron 独占管理，**不要**用 CLI 改桌面 profile；安装走 `plugin_manager`。
- 宿主侧 `connection.fetch.register` 的真实用法（来自 dsh-themes，已验证）：
  ```ts
  ctx.connection.fetch.register({
    path: '/api/dsh-acp-config',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => Response,
  }) // 返回 disposer
  ```
  Client 侧：`ctx.connection.rpc.call('/api', 'dsh-acp-config', { method, args })`，返回 Host 回包里的 `result` 字段。
  回包信封：请求 `{type:'client-request', rpcId, payload:{method,args}}`；响应 `{type:'server-response', rpcId, result}`（见 `src/shared/contract.ts`）。

## 3. 数据来源

### 3.1 ACP 组合（Host 侧）

`runDump()`：`spawnSync` 执行 `dsh --profile <acpName> --dump-config`（默认 profile 名 `acp`，超时 30s，utf8）。
命令解析顺序：`process.env.DSH_ACP_CONFIG_CLI` → `dsh` → `process.execPath` + dshRoot 的 `lib/bin.js`（带 `ELECTRON_RUN_AS_NODE=1`）。
dshRoot 从 `process.argv` 里找结尾为 `/dsh` 的绝对路径；取不到就只用前两种。

输出是**组合后的行数组**（YAML），只需一个窄解析器，不要引入 yaml 依赖：

- 顶层行：行首 `- id: <id>`（0 缩进）。
- 行字段：2 空格缩进的 `name: <moduleName>`、`disabled: <true|false|!!js …>`。
- `disabled: !!js …`（可能折行）记为 `'dynamic'`。
- 行内 `config:` 下 4 空格缩进的标量键值（如 `default: standard`、`mode: workspace-write`）。
- preset 声明行：`id` 以 `preset-` 开头，其 `config.plugins` 里的嵌套项（缩进 ≥ 6 的 `- id:`）集合 = **preset 管理的行 id**。
- preset 候选：`preset-*` 行的 `config.id`（如 `standard`），按 `config.order` 排序。

容错：dump 失败 → `source: 'fallback'`/`warnings`，状态页仍要能打开（插件列表降级为只读 + 提示），**不得抛 500**。

### 3.2 当前 profile 的实时插件状态（Host 侧）

`ctx.get('pluginManager')?.listPlugins()` → `PluginInfo[]`（`patchId?`、`moduleName`、`enabled`、`fiberPhase`、`meta.title/description`）。
`ctx.get('agentPresets')?.list()` → preset 的 `id/title/description`（用于本地化标题；取不到就用 id）。
务必用 `ctx.get(...)` 取可选服务，缺失时降级而不是崩。

### 3.3 本插件自己保存的状态

`<acpProfileDir>/.dsh-acp-config.json`：

```json
{
  "version": 1,
  "savedAt": "2026-11-03T08:00:00.000Z",
  "profile": "acp",
  "plugins": { "tool-web": { "mode": "inherit", "web": true } },
  "base": { "tool-web": false },
  "agentMode": "ptc",
  "sandboxMode": "workspace-write",
  "agentModeChoice": { "mode": "inherit" },
  "sandboxChoice": { "mode": "inherit" },
  "agentModeWeb": "ptc",
  "sandboxWeb": "workspace-write",
  "agentModeBase": "standard",
  "sandboxBase": "workspace-write"
}
```

字段含义：

- `agentMode` / `sandboxMode`：**实际解析出的写入值**（`null` = 本页没有覆盖），供校验与旧版本兼容读取。
- `agentModeChoice` / `sandboxChoice`：本页的选择（`inherit` / `acp-default` / 具体值），旧文件缺失时按 `acp-default`。
- `agentModeWeb` / `sandboxWeb`：`inherit` 时快照的 Web 值，用于 drift。`sandboxWeb` 存的是**预设名**（如 `danger-full-access`），不是 mode：`auto` 与 `danger-full-access` 的 mode 相同但 approval 不同，只有预设名能区分。
- `agentModeBase` / `sandboxBase`：覆盖前该段的基础值，用于「解析值与基础值一致就不写」；没有它，已有覆盖时组合只会报我们自己的覆盖，会把「清除」误判成「本来就一致」。
- `base`：插件行的基础 `disabled` 快照，作用同上（按行）。

`web` 是上次保存时解析 `inherit` 用的 Web 端快照，用于 `drift`（Web 端后来改了 → 页面提示“Web 端已变更，重新保存以同步”）。

## 4. 托管块（唯一写 ACP 补丁层的入口）

只改 `cordis.patch.yml` 中下面这一对标记之间的内容，其余字节原样保留：

```yaml
# >>> dsh-acp-config:managed (generated; edits inside this block are overwritten on save)
- id: agent-preset-registry
  config:
    default: standard
    selectedDefault: null
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()
- id: approval
  config:
    policy: ask
- id: tool-web
  disabled: true
# <<< dsh-acp-config:managed
```

规则：

- 段落顺序固定：agent preset → sandbox（`sandbox-policy` 再 `approval`）→ 插件行覆盖（按 id 排序）。
- 某类内容没有可写项时**整段省略**；全部为空则把整个托管块从文件里删掉（连同标记）。
- `sandbox-policy` 必须同时给 `mode` 和 `workspaceRoot: !!js process.cwd()`（补丁的 `config` 是**整体替换**，不能只给 mode）。
- `approval` 的 `config` 也是整体替换，只写 `policy`。
- `agent-preset-registry` 只在 ACP 组合里存在该行时才写（需要 `dsh-acp-agentmode`）。config 必须同时给 `default` 和 `selectedDefault: null`：schema 里 `default` 是必填、`selectedDefault` 是 volatile 用户字段，且 `dsh-acp-agentmode` 的解析公式是 `selectedDefault ?? default`；写 null 才能让本页选择成为权威，否则用户以前 `--remember` 的值会压住它（页面要在 warnings 里说明这一点）。
- 若 ACP 组合里存在 `permission`（`@deepseek-ai/dsh-permission-presets`）行，不要改它的 `presets`：它只是目录；默认权限由 `sandbox-policy.mode` + `approval.policy` 决定。
- 写入：先写 `cordis.patch.yml.dsh-acp-config.tmp` 再 `rename`；首次写入前备份 `cordis.patch.yml.dsh-acp-config.bak`（已存在则不覆盖）。保留原文件权限。
- 并发保护：写入前比对读取时的 mtime+size；变化则重读重试一次，仍冲突返回 `ok:false`（code `conflict`）。
- 路径安全：profile 名必须匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；所有写路径必须 `realpath` 落在 ACP profile 目录内。

## 5. 插件行判定规则（务必按此实现）

数据：`acpRows`（dump 解析的顶层行）+ `webRows`（`pluginManager.listPlugins()`）+ `presetIds`（preset 声明的行 id 集合）+ 状态 JSON。

行合并键：优先 `id`（两边 patchId 相同），否则 `moduleName`（同一个插件包）。一行两边的状态：

| 字段  | 取值                                                           |
| ----- | -------------------------------------------------------------- |
| `web` | `on` / `off`（`enabled`）/ `absent`（当前 profile 没有该插件） |
| `acp` | `on` / `off` / `dynamic`（`disabled` 是 `!!js`）/ `absent`     |

锁定（`locked`，页面上只读并显示原因）：

- `preset-managed`：acp 行 id ∈ `presetIds`（ACP 把 agent 平面搬进 preset，直接开关会重复注册工具）。
- `infra`：id ∈ 固定集合 `hmr`、`session-title-llm`、`plugin-manager`、`tool-plugin-manager`、`config-editor`、`settings`、`remote-access`、`typert`、`typert-loader`、`typert-gateway`（ACP 组合由模式 bundle 决定，界面不该动）。
- `unaddressable`：web 行没有可持久化的 `patchId`（`pluginManager` 的 `readOnlyReason`）。
- `not-in-acp`：只有 web 行（留着展示，提示可 `dsh plugin --profile acp add`）。
- `acp-only`：只有 acp 行（没有 Web 端对照，默认 `inherit` 无意义 → 只读）。

可切换行（无 `locked`）：`mode` 默认 `inherit`，持久化在状态 JSON；页面三段式按钮「继承 / 开启 / 关闭」。

### Agent Mode / 沙箱的三态选择（新增）

两类设置都改为三选一，语义与插件开关的「继承」同构，都在**保存时**解析：

| 选择                               | 写入 ACP 托管块 | 解析来源                                                                                             |
| ---------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| `inherit`                          | 解析后的具体值  | Web profile 的当前值：preset = `agentPresets.resolve()` 的 id；sandbox = `sandboxPolicy.defaultMode` |
| `acp-default`                      | 不写这一段      | 保留 ACP 自身组合的结果                                                                              |
| 具体值（preset id / sandbox mode） | 该值            | 用户显式选择                                                                                         |

要点：

- `inherit` 与插件开关一样是**快照**：状态 JSON 记 `agentModeWeb` / `sandboxWeb`，Web 端之后改了显示 drift，再保存即同步。
- Web 值读不到时（纯 Node、或该 profile 没有 `agentPresets` / `sandboxPolicy`），`inherit` 选项禁用并说明原因，不允许静默降级成 `acp-default`。
- 失败边界（已实现）：**请求里显式给了 `inherit` 而 Web 值读不到** → `E_USAGE` 硬失败，patch 与 state 都不落盘；**请求没提这个字段、但 state 里存的是 `inherit` 而当前读不到** → 保留上次写入的覆盖并给 warning，不让一次无关的保存整体失败（降级环境里页面仍可保存插件开关）。
- 旧版本状态文件（没有 choice 字段）按 `acp-default` 处理：第一次保存会移除老覆盖并给 warning（不是静默）。
- 旧形状入参（裸字符串 / `null`）现在一律 `E_USAGE`，不做猜测式兼容。
- `inherit` 解析出的值与 ACP 现有基础值一致时**不写该段**（补丁最小化，规则与插件行相同）。
- sandbox 的 `inherit` 解析出 mode 后，approval 仍按预设表配对（read-only/workspace-write → ask，danger-full-access → never）。
- Web 端来源（宿主实测，2026-11-03 修正）：
  - preset：`agentPresets.resolve()` → `{ id: 'ptc' }`。
  - **权限：`permissionPresets.catalog().defaultPreset` + `permissionPresets.resolve(该预设)`**，不是 `sandboxPolicy.defaultMode`。后者只是**部署默认**（`DSH_PERMISSION_MODE ?? 'workspace-write'`），与用户在 Web UI 里选的权限预设是两回事；读它会把「完全权限」显示成「工作区可写」。
  - `catalog()` 实测形状：`{ options: [{value,name}], defaultOptions, defaultPreset }`，本机 `defaultPreset: 'danger-full-access'`；`resolve('danger-full-access')` → `{ sandbox: 'danger-full-access', approval: 'never' }`。
  - 预设名与 sandbox 不是一一对应：`auto` 解析为 `{ sandbox: 'danger-full-access', approval: 'ask' }`。所以**继承必须带预设名**，并且 approval 用该预设解析出的值，不能按 mode 反查配对表。
  - 都要惰性 `ctx.get(...)`，取不到就报「读不到」而不是猜。

界面（第 7 节补充）：

- **对齐官方插件页**：折叠卡片（`docs/OFFICIAL-UI-SPEC.md` 是从真实 GUI 量出的硬指标）、会话插件 / 全局插件分组、卡片写本地化中文名与作用、展开看详细状态。本页的三态控件放展开区，折叠态只显示名字、作用、状态 tag 与 chevron。

- 两个区块都用「继承 Web 端 / ACP 默认 / 具体值」三态；继承项括号内直接显示 Web 端当前值（如「继承 Web 端（ptc）」），让用户不用切页面就知道会继承到什么。
- `web === null` 或 `available === false` 时继承项禁用并给出原因；`choice.mode === 'inherit'` 且 `drift` 时显示 drift 徽标。
- 三态切换与插件行的三段开关视觉一致（同一套 `dac-seg` 控件），不另造控件形态。

### 保存入参语义

- `agentMode` / `sandboxMode`：`AgentModeChoice` / `SandboxChoice`；**undefined = 保留本页上次的选择**，给出对象则按其 mode 解析（`inherit` / `acp-default` / 具体值）。
- `plugins`：undefined = 保留状态里的 mode；给出时逐行覆盖。
- 每次保存都从状态**整体重建**托管块：相同输入重复保存必须逐字节幂等（`changed: []`）。

### 解析（保存时）

- `on` → `disabled: false`；`off` → `disabled: true`。
- `inherit` → `disabled = !web.enabled`；若解析值与 ACP **原有**状态一致则**不写**该行（保持补丁最小、避免覆盖 `!!js`）；`acp === 'dynamic'` 且 `mode === 'inherit'` 时也不写；`mode` 为 `on/off` 时总是写（用户显式意图）。
- `web === 'absent'` 的继承行不写。
- 保存后把 `{mode, web}` 写回状态 JSON（`drift` 用）。

### drift

`drift = mode==='inherit' && web !== absent && 状态里记录的 web !== 当前 web`。`apply.drift` 列出这些行 id；保存后清零。

## 6. Host 模块与职责（`src/host/**`）

| 文件             | 职责                                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `paths.ts`       | `$DSH_HOME`（默认 `~/.dsh`）、`<home>/profiles/<name>`、patch/state 路径；安全校验                         |
| `dump.ts`        | 定位命令、`spawnSync`、解析组合 YAML（窄解析器）、preset 管理 id、容错                                     |
| `patch-block.ts` | 读/解析/替换/删除托管块；序列化条目；原子写 + 备份 + mtime 冲突检测                                        |
| `state.ts`       | 状态 JSON 读写（损坏文件按空状态处理并给 warning）                                                         |
| `status.ts`      | 组装 `StatusPayload`（第 5 节）                                                                            |
| `save.ts`        | 解析选择 → 生成托管块 → 写入 → 重新 dump 校验 → `SavePayload`                                              |
| `errors.ts`      | 稳定错误码（`E_USAGE` `E_PROFILE` `E_DUMP` `E_CONFLICT` `E_WRITE` `E_INTERNAL`）                           |
| `ports.ts`       | 可注入依赖（`fs`、`runDump`、`now`、`env`、`dshRoot`），供单测注入假对象                                   |
| `index.ts`       | Cordis 入口：`export const name/inject`、`apply(ctx)`、注册路由、`ctx.effect` 清理；所有业务逻辑走上面模块 |

约束：无顶层副作用；不 `eval`/`Function`/动态 import；不读 stdin；不 `process.exit`；所有定时器/路由用 `ctx.effect` 或返回 disposer 清理。

## 7. Client 模块与职责（`src/client/**`）

`src/client/index.ts` 是 IIFE 入口，必须长这样（React 由模块表提供，**不要**打包 React、不要 `require` Harness 的 UI 包）：

```ts
const w = window as any
w.__ModuleLoader__.load({
  id: 'dsh-acp-config',
  factory(require: (id: string) => any) {
    const React = require('react')
    // …组件
    return {
      inject: ['slots', 'locale', 'connection'],
      apply(ctx: any) {
        /* 注册 settings.section */
      },
    }
  },
})
```

页面要求：

- 注册：`ctx.slots.inject('settings.section', () => ctx.slots.register({ name:'settings.section', id:'acp-config', order:22, label:()=>t('section') }, Page))`；`Page` 组件收到 `{ close }`。
- 数据：`const call = (method, args) => ctx.connection.rpc.call('/api','dsh-acp-config',{ method, args })`；挂载时 `status`；`save` 提交。
- 三个区块 + 顶部信息：
  1. 概要卡：ACP profile 名/路径/补丁路径、上次保存时间、“保存后下次启动 ACP 生效”的说明、drift 提示。
  2. **插件开关**：搜索框；可切换行三段按钮「继承 / 开启 / 关闭」+ Web 端状态徽标 + ACP 端状态 + drift 徽标；锁定行显示原因徽标与只读状态；「仅 Web」行折叠展示。
  3. **Agent Mode**：preset 单选卡（标题+描述），不可用时整块禁用并说明（需要 `dsh-acp-agentmode`）。
  4. **沙箱权限**：三选一卡（只读 / 工作区可写 / 完全访问），完全访问显示显式风险提示；说明与 approval 的联动。
- 底部操作条：`保存`（有改动才可用）、`重新读取`、`校验`（调 validate）；保存中禁用；成功/失败内联提示（错误码+消息），失败不清空草稿。
- 样式：自带 `<style>`（用 `React.createElement('style', …)` 或组件内渲一次），类名前缀 `dac-`；只用 `--dsw-alias-*` 主题 token（参考 `cordis_inspect_query` 的 `Theme`），禁止硬编码颜色（图标/装饰除外）；布局参考现有设置页：分区标题 + 说明文字 + 行卡片。
- 文案：`src/client/locale.ts` 里自己维护 `en`/`zh` 字典，通过 `ctx.locale.getLocale().active` 选（`zh*` → zh，否则 en），并订阅 locale 变化重渲染；不要依赖 `locale.bind` 的命名空间注册。
- 组件要防御：数据未到、Host 报错、数组为空都要有稳定渲染；`require('react')` 只调用一次。

## 8. 构建与命令

- `pnpm build`：`vp pack` 产出 `dist/index.mjs`（ESM Host）、`dist/index.d.mts`、`dist/client.iife.js`（IIFE Client）。
- `pnpm check`：`vp check`（格式 + oxlint 类型感知 + tsc）。
- `pnpm test`：`vp test run`（`tests/**/*.test.ts`，纯逻辑 + 假端口）。
- `pnpm verify`：三者串行。
- 产物文件名由 `vite.config.ts` 的 `pack` 数组决定；如果实际文件名不同，**报告给 Lead**，不要私自改 `package.json` 的 exports（Lead 统一改）。

## 9. 验收标准

1. `pnpm verify` 全绿（0 error 0 warning）。
2. 单测覆盖：托管块读写（保留用户内容/幂等/删除空块）、dump 解析（disabled 三态、preset 集合）、inherit 解析与最小写入、drift、路径安全、状态文件损坏降级。
3. 安装后 Client `settings.section` 出现 `acp-config`（`cordis_inspect_query` 验证）。
4. 保存一次：ACP 补丁层出现托管块；`dsh --profile acp --dump-config` 中对应行 / `agent-preset-registry.default` / `sandbox-policy.mode` 与选择一致；用户原有 patch 内容原样保留；再次保存幂等。
5. 页面在本机 GUI 可打开（截图/人工确认由 Lead 完成），无控制台崩溃；恢复测试前的 ACP 补丁内容。

## 9.1 已验证结果（本机 0.2.1-rc.5）

- `pnpm check`：0 error / 0 warning；`pnpm test`：7 文件 / 86 用例全绿；`pnpm build`：Host 56.21 kB、Client 36.50 kB。
- `node scripts/smoke.mjs`：临时 `$DSH_HOME`（base + acp-app + dsh-acp-agentmode）上 status → save → 幂等 → validate → dump → clear 全 PASS，含“清除后用户 patch 逐字节还原”。
- 安装到 desktop profile 后：`include:acp-config` active；Client `settings.section` occupant `acp-config` order 22 active。
- 真实宿主进程内（临时探针，已移除）：`connection.createSharedFetchHandler('/api').fetch(request, browserPeer)` 对 `POST /api/dsh-acp-config` 返回 200、`{result:{ok:true,value:{...}}}`；status 含 224 行（77 可切换 / 23 preset-managed / 9 infra / 103 not-in-acp / 9 unaddressable / 3 acp-only），preset 4 个，agentMode available。
- 未验证：页面视觉/排版与真实浏览器交互（本机无辅助功能/屏幕录制权限，无法截图或点击）；需人工打开 设置 → ACP 模式 确认。

## 10. 文件归属（并行写作用域）

- Lead：`package.json`、`vite.config.ts`、`tsconfig.json`、`cordis.patch.yml`、`locale/**`、`icon.svg`、`docs/**`、`README*`、安装与验证；`src/host/index.ts` 的**路由接线**由 Host 负责人写，Lead 只 review。
- Host 负责人：`src/host/**`、`tests/**`。
- Client 负责人：`src/client/**`。
- 不要改别人作用域里的文件；需要改就发消息给 Lead。
