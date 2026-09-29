# 规范符合性对照（Conformance）

对照对象：宿主自带的插件开发规范
`$DSH_APP/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`
（`SKILL.md` + `references/{host-plugin,ui-plugin,practices,verification}.md`）。

本文件记录**逐条核对结果**，包括仍然存在的限制及其理由。它随代码一起维护：规范改了、
或本插件改了行为，这里必须同步——`npm test` 里有几条断言正是钉在这张表上的条款。

图例：✅ 符合 · ⚠️ 有意的偏离（写明理由） · ❌ 不符合（不得存在）

## 一、包与清单

| # | 规范要求 | 出处 | 本插件 | 判定 |
|---|---|---|---|---|
| 1 | bundle 的 `package.json` 声明 `dsh.bundle.patch`，补丁插入插件行 | host-plugin.md L3, L9-27 | `dsh.bundle.patch: ./cordis.patch.yml`，单行 `id: branchman` | ✅ |
| 2 | 行 `config` 与插件名唯一 | host-plugin.md L3 | 包名 `dsh-branchman`，行 id `branchman`，不与他人冲突 | ✅ |
| 3 | 显示元数据放 `locale/{en,zh}.json` 的 `meta`，图标是顶层 `icon` | host-plugin.md L29-45 | `locale/zh.json`、`locale/en.json`、`icon.svg`（`currentColor`，跟随主题） | ✅ |
| 4 | `exports`/`files` 要包含元数据文件 | host-plugin.md L38-43 | `exports["./locale/*.json"]`、`files` 含 `locale/*.json` 与 `icon.svg` | ✅ |
| 5 | `dsh.client` 声明 `platform`/`immediately`/`inject` | ui-plugin.md L3 | 三者齐备，`inject` 指向真实包 | ✅ |

## 二、宿主半边（`index.js`）

| # | 规范要求 | 出处 | 本插件 | 判定 |
|---|---|---|---|---|
| 6 | 导出形式二选一、不得混用：`export function apply`（+ `inject`/`Config`）或默认导出 service class | host-plugin.md L49-52 | `export async function apply(ctx, config)` + `export const inject` + `export const Config`；无默认导出 | ✅ |
| 7 | `apply` 内每个注册都用 `ctx.effect`/`ctx.on` 登记**并返回清理** | host-plugin.md L54 | 五工具一个 `ctx.effect`（收集 disposer 并逐个释放）、两条 web 路由一个 `ctx.effect`（保留两个 disposer）、两个会话事件走 `ctx.on` | ✅ |
| 8 | 可调值放 `Config`，用户才能在 `cordis.patch.yml` 里改 | host-plugin.md L54 · practices L22 | `Config`（schemastery）：`dataFile` / `defaultRoot` / `gitPath`；解析不到 schemastery 的宿主退回裸配置读取 | ✅ |
| 9 | 可选服务用 `inject` 或 `ctx.inject([...])`，缺服务时插件仍应激活 | practices L20 | 必需服务走 `export const inject = ['webServer','sessions','tools']`；可选的 `sessionQuery`/`agents`/`agentDefaultModel` 走 `ctx.inject` | ✅ |
| 10 | 不新增 session event type（未知事件会让会话无法重开） | practices L21 | 只读会话事件、只写自己的 `tree.json` | ✅ |
| 11 | 插件自有数据放存储服务，不写进会话日志 | practices L21 | 元数据在 `$DSH_HOME/branchman/tree.json`，只存走向元信息、不含消息正文 | ✅ |
| 12 | 不要用 shell 复刻安装步骤，安装走 `plugin_manager install_bundle` | host-plugin.md L58 | 本机 Desktop profile 被 Electron 托管、CLI `plugin add` 被 `rejectElectronProfile` 拒绝（见 PLUGIN-NOTES §1）；因此 `docs/INSTALL.md` 列出 4 条路径并标明各自前提 | ⚠️ 环境限制，已写明 |
| 13 | 每会话派生状态优先用 `ctx.sessionProjections`，不要自己订阅+重扫 | practices L26 | 本插件需要的是**跨会话**的走向聚合（不是单会话投影），因此被动监听 `session/created`、`session/event` **只增量更新元数据**（不重扫事件、不缓存正文），写盘仍是插件自有数据 | ⚠️ 机制不重合，理由见下 |

> 关于 #13：`sessionProjections` 的单位是「一个会话内的派生状态」，而走向树横跨多个会话与
> 工作区目录（还包含不是本插件创建的会话）。用它反而要把每个会话都挂一个投影再全局汇总，
> 成本与耦合都更高。当前实现的边界是明确的：只记 `messageCount`/`lastActivityAt` 这类计数，
> 不保留消息内容，因此不存在"派生缓存与日志不一致"的隐患。

## 三、浏览器半边（`client.js`）

| # | 规范要求 | 出处 | 本插件 | 判定 |
|---|---|---|---|---|
| 14 | 用 `window.__ModuleLoader__.load`，factory 的 id 等于包名，返回 `{ inject, apply }` | ui-plugin.md L9 | `id: 'dsh-branchman'`，返回 `{ inject: ['slots','sessions'], apply, __test }` | ✅ |
| 15 | React 取自浏览器模块表；不得 import 任何 Harness Client 包 | ui-plugin.md L9 · practices L35 | 只 `require('react')`，未引入 `dsh-client-ui-primitives` 等 | ✅ |
| 16 | 每个视图都是槽位里的 React 组件 | ui-plugin.md L11-13 · practices L33 | 分支按钮、总览按钮、对话框、总览图全部是 React 组件 | ✅ |
| 17 | 不写组件之外的 DOM、不 append 到 `document.body` | practices L36 | 浮层注册进 `shell.overlay`；全文件仅 `apply` 里建一个 `<style>`（规范允许在 apply 内用 `ctx.effect` 注册样式） | ✅ |
| 18 | 需要浮层时用 `shell.overlay` 槽位（`kind: "list"`, `scope: "root"`） | ui-plugin.md L5 | 对话框与总览都在 `shell.overlay` 内按模块级信号切换 | ✅ |
| 19 | 样式只用主题令牌 `--dsw-alias-*`；字面颜色只属于 artwork | practices L34 · SKILL L15 | CSS 全部引用令牌（`bg-layer-*`/`border-l*`/`label-*`/`button-*`/`state-*`），无十六进制、无 `rgb()`；`icon.svg` 用 `currentColor` | ✅ |
| 20 | 可见文案走客户端 locale 服务 | ui-plugin.md L13 | `locale.register(NS, DICT)` + `locale.bind(NS)`；中英双字典；服务缺失时回退中文 | ✅ |
| 21 | 工厂函数无副作用；样式等资源在 `apply` 内 `ctx.effect` 登记并返回清理 | ui-plugin.md L13 | factory 只组装对象；样式元素由 effect 拥有并 `remove()` | ✅ |
| 22 | 不替换 app root、不挂第二个应用 | ui-plugin.md L13 | 只注册槽位，不接触 root | ✅ |
| 23 | 槽位注册项字段名为 `order`；`scope:"session"` 槽位的 props 才是权威上下文 | practices · PLUGIN-NOTES §21-22 | 三个入口分别 `order: 50/51/60`；分支按钮用 `props.sessionId`，不回退到 `current` | ✅ |
| 24 | 不在宿主页里嵌 iframe 展示 Host 提供的 HTML | practices L33 | 界面全是槽位组件；`/branchman/` 只是给 CLI/诊断用的只读端点，从未被 iframe 嵌过 | ✅ |

## 四、验证方式

| # | 规范要求 | 出处 | 本插件 | 判定 |
|---|---|---|---|---|
| 25 | 没有浏览器控制时，验证限于 JS 语法、manifest 校验与槽位注册本身 | verification.md L3 | `npm test`（128 项）：语法 + manifest + 工具全链路 + 种子路径 + 纯布局算法 + 静态规范条款 | ✅ |
| 26 | 不要用抽 SVG 预览、模拟 React/DOM、自定义渲染器替代浏览器验证；模拟页截图不算验证 | verification.md L3 | 0.1.1 起**移除了**预览/栅格化工具链与非被动模拟套件；本文档明确声明视觉验证未在 agent 侧完成 | ✅ |
| 27 | 明确说明验证的局限，不得把"装上/注册上"当作"用户看得见" | SKILL.md L15 · verification.md L3 | README 与本文档均写明：UI 的实际呈现由用户在运行中的页面确认 | ✅ |

**当前明确的验证局限**（不得省略）：

- agent 侧**没有**浏览器控制（GUI 对外部浏览器全部 403，见 PLUGIN-NOTES §24），因此
  `0.1.1` 的界面改动（浮层迁到 `shell.overlay`、主题令牌、locale 化）**只做了静态与逻辑层核对**，
  没有截图证据。请以运行中的界面为准；若有异常，按 `docs/PLUGIN-NOTES.md` 的问题定位法反馈。
- `docs/overview.png` 是**文档插图**（概念示意），不是运行验证的证据。
- CI 在 ubuntu 上跑同一套 `npm test`；其中"inject 指向真实模块"一条在无 DSH 安装的机器上报
  SKIP 而非 FAIL。

## 五、仍然有意的取舍

| 事项 | 现状 | 理由 |
|---|---|---|
| `/branchman/` 只读 HTML 端点 | 保留 | 规范禁止的是"用 Host 提供的 HTML 页 + iframe 当界面"。该端点不含 iframe 依赖，且在没有 GUI 槽位能力的环境（脚本、诊断）里仍有价值；界面本身完全走槽位 |
| `export { TreeStore }` | 保留 | 规范约束的是插件**导出形式二选一**（apply / service class）。额外的具名导出在官方插件里同样常见（如 `export { Config, apply, inject, name }`），且它是离线套件能压测"并发写不变量"的唯一入口 |
| 可选服务不写进 `exports.inject` | 保留 | 一旦把可选服务写进 `inject`，缺该服务的 profile 会让插件**永不激活**（工具与按钮一起消失）——这是实测踩过的坑（PLUGIN-NOTES §8） |
