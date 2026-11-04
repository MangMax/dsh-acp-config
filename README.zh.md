# dsh-acp-config

给 **`dsh --profile acp`**（DSH 的 Agent Client Protocol 自动化模式）做一个可视化配置页，就长在你正在用的这个 Web 界面的「设置」里。

ACP 是独立 profile：它没有自己的窗口，Web 界面里的插件开关、agent preset、权限设置都传不过去。这个插件用一页三个区块补上这段路：

| 区块           | 写什么                                                          | 在 ACP 里的效果                                        |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| **插件开关**   | ACP profile 补丁层里的 `- id: <行>` / `disabled: true \| false` | 逐插件选择「**继承 Web 端开关**」或强制开启 / 强制关闭 |
| **Agent Mode** | `agent-preset-registry.config.default`                          | 不带 `--agentmode` 启动时，每个新 ACP 会话用的 preset  |
| **沙箱权限**   | `sandbox-policy.config.mode` + `approval.config.policy`         | `read-only` / `workspace-write` / `danger-full-access` |

页面装在**当前 Web 界面所属 profile**，写入的是 **ACP profile 自己的补丁层**。不往 ACP 里装包、不启动/重启 ACP 进程。

## 生效方式

保存时向 `$DSH_HOME/profiles/acp/cordis.patch.yml` 写入一段带标记的托管块：

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
# <<< dsh-acp-config:managed
```

标记之外的内容**逐字节保留**。ACP profile 的补丁层是 `patchReload: startup`，所以改动在**下次启动 ACP 时生效**；页面会明确写出这一点，不会假装已经实时生效。

## 从 GitHub 直接安装

仓库里已提交构建产物（`dist/`），**不需要本地构建**：

- **Web profile**：`dsh plugin --profile web add github:MangMax/dsh-acp-config`
- **桌面端（当前 GUI）**：设置 → 插件 → 安装，目标填 `github:MangMax/dsh-acp-config`（也可以填本地目录）。桌面 profile 由 Electron 独占管理，`dsh plugin --profile desktop …` 会被拒绝。
- **固定到某个提交**：`github:MangMax/dsh-acp-config#<commit-sha>`

## 从本地目录安装

要改源码时用这条路径：

```bash
git clone https://github.com/MangMax/dsh-acp-config.git
cd dsh-acp-config && pnpm install && pnpm build
dsh plugin --profile web add /绝对路径/dsh-acp-config
```

> 改完源码请 `pnpm build` 并**把 `dist/` 一起提交**——仓库里的产物就是给 `github:` 安装用的。

包里同时带 Host 行（`acp-config`）和 `dsh.client` 浏览器半区。安装后**刷新页面**（⌘R / Ctrl+R），设置里会出现「**ACP 模式**」。

## 前置条件

- 必须已存在 ACP profile（`$DSH_HOME/profiles/acp`）。
- **Agent Mode** 需要 ACP profile 里装了 [`dsh-acp-agentmode`](https://github.com/MangMax/dsh-acp-agentmode)——`agent-preset-registry` 行由它插入。没装时该区块会禁用并说明原因。
- 只有**同时存在于两个组合里**的插件行才能切换。只装在 Web profile 的插件会显示为「未进入 ACP」；先 `dsh plugin --profile acp add <spec>` 装进 ACP，再刷新本页。

## 「继承」到底是什么意思

`inherit` 在**保存时**解析：把 Web 端当前的开关状态写成 ACP 行的 `disabled`，页面记住当时用的快照。之后 Web 端改了，这一行会出现 **drift** 徽标——再保存一次即可重新同步。这样 ACP 补丁文件始终自包含、可直接检查，ACP 启动时不做任何求值。

被 agent preset 管理的行（工具、技能、指令、压缩等）是**锁定**的：ACP 把 agent 平面搬进 preset、按会话挂载，顶层再覆盖会重复注册。ACP 模式 bundle 自己决定的基础设施行（`hmr`、`settings`、`plugin-manager` 等）也锁定。

## 安全措施

- 只改托管块；标记缺失/不配对时**拒绝写入**，不猜测。
- 原子写（临时文件 + rename）、首次写入留 `.bak`、保留文件权限；mtime/size 冲突时重读重试一次，仍冲突则失败。
- profile 名做白名单校验，所有写路径必须落在 ACP profile 目录内。
- 组合用 `dsh --profile acp --dump-config` 读取（异步、30 秒超时、超时 kill）；读不到时页面降级为只读 + 警告，而不是报错崩掉。

## 限制

- **只在启动时生效**：ACP 下次启动才应用。
- **继承是快照**，不是实时联动。
- 保存过沙箱权限后，`DSH_PERMISSION_MODE` 不再决定 ACP 的默认模式，以页面为准。
- 安装后需要刷新页面；正式版 DSH 不会热加载新的 client bundle。
- 保存 Agent Mode 时会同时写 `selectedDefault: null`，让本页设置压过以前的 `--agentmode … --remember`；页面 warnings 里有说明。

## 只动这些文件

| 路径                                          | 内容                      |
| --------------------------------------------- | ------------------------- |
| `$DSH_HOME/profiles/acp/cordis.patch.yml`     | 仅托管块                  |
| `$DSH_HOME/profiles/acp/.dsh-acp-config.json` | 本页保存的选择 + 继承快照 |

不改 profile 的 `package.json`、不装包、不管进程。

## 开发

```bash
pnpm install
pnpm check      # vp check：格式化 + oxlint（类型感知）+ tsc
pnpm test       # vp test run
pnpm build      # vp pack：dist/index.mjs（Host）、dist/client.iife.js（Client）
pnpm verify     # check + test + build
node scripts/acp-dump-check.mjs   # 查看本页可改的 ACP 组合现状
```

设计规则见 [`docs/DESIGN.md`](docs/DESIGN.md)。工具链是 **pnpm + Vite+**，零运行时依赖；React 由 DSH 的浏览器模块表提供，不会打进 bundle。
