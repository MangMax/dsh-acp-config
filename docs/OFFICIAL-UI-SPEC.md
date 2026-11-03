# 官方插件设置页的实测规格（照此对齐）

数据来自真实 GUI 的 DOM 测量（2026-11-03，DSH 0.2.1-rc.5，深色主题）。目标是让 ACP 页面「看起来就是官方插件页的一块」，不是另做一套卡片。

## 页面骨架

```
标题：内置插件
副标题：查看内置部署的插件列表
Tab：插件列表 | 插件市场          ← 我们用 插件 / Agent 模式 / 沙箱权限 / 状态
搜索：搜索插件
分组标题行（可折叠）
  [chevron] 会话插件            [右侧：PTC 模式（默认） 下拉]
  说明：由 Agent 预设按会话组成
  <ul class="cards"> …卡片… </ul>
分组标题行
  [chevron] 全局插件
  <ul class="cards"> …卡片… </ul>
```

## 卡片（折叠）

闭合态高度约 94px、宽度随列宽（官方为单列约 472px）：

```html
<li class="card" data-plugin-entry="persona" data-plugin-module="@deepseek-ai/dsh-persona">
  <button
    class="cardContent"
    aria-expanded="false"
    aria-controls="plugin-details-…"
    aria-label="智能体角色设定, persona, 已启用"
  >
    <span class="cardMainRow">
      <strong class="cardTitle" title="@deepseek-ai/dsh-persona">智能体角色设定</strong>
      <span class="cardTrailing">
        <span class="tag" data-tone="neutral">已停用</span>
        <svg class="chevron" width="12" height="12">…</svg>
      </span>
    </span>
    <span class="cardDescription">为当前智能体提供组合中定义的角色与行为说明。</span>
    <span class="cardMeta">persona</span>
  </button>
</li>
```

实测样式：

| 元素               | 值                                                                                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.card`            | `background: var(--dsw-alias-bg-layer-2)`（实测 rgb(31,35,53)）；`border: 1px solid var(--dsw-alias-border-l2)`；`border-radius: 20px`；`overflow: hidden`                                                                |
| `.cardContent`     | `display:flex; flex-direction:column; gap:2px; padding:12px 14px; width:100%; text-align:left; background:transparent; border:0`                                                                                          |
| `.cardMainRow`     | `display:flex; gap:12px; align-items:center; justify-content:space-between`                                                                                                                                               |
| `.cardTitle`       | `font-size:14px; font-weight:500; line-height:20px; color:var(--dsw-alias-label-primary)`，单行省略                                                                                                                       |
| `.cardDescription` | `font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary)`                                                                                                                                                 |
| `.cardMeta`        | `padding-top:6px; font-family:var(--ds-font-family-code, ui-monospace…); font-size:11px; line-height:16px; color:var(--dsw-alias-label-caption)`                                                                          |
| `.tag`             | `font-size:11px; font-weight:500; line-height:17px; padding:1px 8px; border-radius:999px; background:var(--dsw-alias-bg-layer-3)`（实测 rgb(64,68,85)）；`color:var(--dsw-alias-label-tertiary)`（实测 rgb(149,152,164)） |
| chevron            | 12×12 SVG，`stroke="currentColor"`，`stroke-width:1`，路径 `M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6`；折叠时朝下，展开时旋转 180°                                                       |
| 卡片列表           | `display:grid; gap:10px`（单列）                                                                                                                                                                                          |

## 展开态

```html
<div class="cardDetails" id="plugin-details-…">
  <code class="entryValue" data-loader-entry="true">persona</code>
  <dl class="details">
    <div>
      <dt>完整名称</dt>
      <dd>@deepseek-ai/dsh-persona</dd>
    </div>
    <div>
      <dt>来自</dt>
      <dd>PTC 模式</dd>
    </div>
    <div>
      <dt>配置状态</dt>
      <dd>已启用</dd>
    </div>
    <div>
      <dt>运行状态</dt>
      <dd>运行中</dd>
    </div>
  </dl>
</div>
```

实测样式：

| 元素              | 值                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `.cardDetails`    | `background: var(--dsw-alias-bg-layer-3)`；`border-top:1px solid var(--dsw-alias-border-l2)`；`padding:10px 14px 12px`                     |
| `code.entryValue` | mono、11px、`color:var(--dsw-alias-label-tertiary)`、可复制感（保留 `data-loader-entry` 语义）                                             |
| `dl.details`      | 每项一行：`dt` 12px `label-tertiary`，`dd` 12px `label-secondary`；两列对齐 `grid-template-columns: max-content minmax(0,1fr)`，行距 4–6px |
| 分组标题          | `[chevron] 会话插件`：`font-size:13px; font-weight:600; line-height:20px`，按钮透明、hover 有背景；右侧可放说明/徽标                       |
| 分组说明          | `font-size:12px; line-height:18px; color:var(--dsw-alias-label-tertiary)`                                                                  |

## 与本页的映射

| 官方           | 本页                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------ |
| 会话插件组     | ACP 组合里由 agent preset 声明的行（`presetManagedIds`）→ 只读，卡片徽标显示「由预设管理」 |
| 全局插件组     | 其余 ACP 顶层行（可切换 + 基础设施 + 仅 ACP）                                              |
| 未进入 ACP 组  | Web profile 有、ACP 没有的行 → 单独折叠组，徽标「未进入 ACP」                              |
| 卡片标题/描述  | `meta.title` / `meta.description`（zh/en 本地化），缺失回落 id                             |
| 已停用 徽标    | 本页用「ACP 关 / Web 关 / 由预设管理 / 未进入 ACP / 基础设施」等                           |
| 展开详情       | 完整名称、Loader ID、Web 端状态、ACP 组合状态、本页覆盖、归属                              |
| 本页的三态控制 | 放在**展开区**里（折叠态保持官方那种干净卡片），不要在折叠态塞三段按钮                     |

## 三条硬约束

1. **不许自创卡片形态**：圆角 20px、内边距 12/14、标题 14/500、描述 12/18、`dl` 详情，全部照上表。
2. **只用 token**：`--dsw-alias-bg-layer-2/3`、`--dsw-alias-border-l2`、`--dsw-alias-label-primary/secondary/tertiary/caption`。
3. **折叠态信息量不低于官方**：中文名 + 作用描述 + 一行 mono 标识 + 右侧状态徽标 + chevron。
