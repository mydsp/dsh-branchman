# 架构（as-built）

> 本文描述**当前实现**，不是最初的设计稿。设计与实现的偏差在最后一节列出。

## 一、问题：两半各自存在，但不相连

模糊工程的真实工作流是「对话走到某节点 → 想试另一条走向 → 走向要改文件」。
DSH 与 git 各有一半能力，缺的正是把它们接起来的那一步：

| 已有能力 | 缺口 |
|---|---|
| GUI 的分支按钮（`forkAt(seq)` → `sessions.fork`）能分**对话** | 子会话 `cwd` 不变 → 两条走向仍写同一工作区，互相打架 |
| `git worktree` 能分**工作区** | 与对话无关联，要人肉两边操作，且没人记录"谁从谁分出来" |

dsh-branchman 把两者焊成一个原子动作，并让这棵树自己长出来、自己画出来。

## 二、一个原子动作的四个阶段

客户端点下按钮后，宿主的 `/branchman/api/fork` 与客户端交替完成四步：

```
① 宿主：git worktree add -b branchman/<名> .branches/<名>   （含 .git/info/exclude 处理）
        建子会话：seed = 父会话已完成前缀的事件，meta.cwd = worktree，meta.parentSession = 父会话
        → 返回 { name, branch, cwd, sessionId, seeded, inheritedEvents }
② 客户端：await ctx.sessions.refresh()
        宿主是在服务端建的会话，客户端的会话目录（catalog）此刻还不认识它；
        直接 openSession 会撞 `sessions.retain: unknown session <id>`。
③ 客户端：把交接语作为子会话首条消息（scope → sessionOf → prompt）
        顺序必须在 ② 之后：scope() 对未知会话返回 undefined，交接语会被静默丢弃。
④ 客户端：uiWorkspace.openSession(childId) 切过去；失败也不谎报"走向没建成"，
        而是说明"已建立 + 手动在会话列表点开"。
```

四步都有独立的失败提示，不存在"白点一次"的静默失败。

## 三、宿主半边（`index.js`）

### 3.1 TreeStore

单文件 JSON（`$DSH_HOME/branchman/tree.json`），`{ version: 1, nodes: [] }`。

- **写入串行化**：所有保存串进一条 promise 链（失败也接上下一个，否则一次失败会卡死后续写入）
- **每次唯一临时名**：`<dataFile>.<pid>.<seq>.tmp` 再 `rename`
  （早期版本所有写入共用 `tree.json.tmp`，而"创建子会话"会触发被动投影同时保存，
  先完成的 rename 吃掉临时文件 → 另一个报 `ENOENT: rename 'tree.json.tmp' -> 'tree.json'`，
  fork 输掉竞争后回滚了 worktree）
- **节点主键是走向名 + cwd**，`sessionId` 只作尽力关联：会话没了也不死卡

单个节点：

```jsonc
{
  "name": "走向-视觉方案",
  "parentName": null,              // 父走向（从主线分出来时为 null）
  "root": "E:/repo",               // 仓库根
  "cwd": "E:/repo/.branches/走向-视觉方案",
  "branch": "branchman/走向-视觉方案",
  "parentSessionId": "session-…",  // 枝的起点
  "sessionId": "session-…",        // 子会话（可能失效）
  "sessionTitle": "走向 走向-视觉方案",
  "status": "open",                // open | merged | dropped
  "messageCount": 34,
  "inheritedEvents": 5200,         // 从父会话继承的事件数
  "createdAt": "…", "updatedAt": "…", "lastActivityAt": "…",
  "parentTitle": null
}
```

### 3.2 五个 agent 工具

全部经宿主的 `defineTool` 包装注册（裸对象注册会让模型永远填不出参数）。

| 工具 | 参数 | 行为 |
|---|---|---|
| `branch_fork` | `{name, root?, from?}` | worktree + 子会话 + 树边；`from` 默认 `main` |
| `branch_tree` | `{}` | 树的 JSON（含 `capabilities`：哪些宿主服务拿到了） |
| `branch_status` | `{root?}` | 各走向相对主线的 ahead/behind/dirty |
| `branch_merge` | `{name}` | `--no-ff` 合回主线；先要求主线干净 |
| `branch_drop` | `{name}` | 拆 worktree、删分支、节点标记 dropped（保留审计） |

守卫：fork 与 merge 都要求**主线干净**（`git status --porcelain` 为空）——否则
worktree 添加或 merge 会把无关改动卷进来。

### 3.3 被动树投影（只存元数据）

```js
ctx.on('session/created', …)   // cwd 落在 .branches/ 下 → 记节点，parent 由 fork 时写入
ctx.on('session/event', …)     // 只更新 messageCount / lastActivityAt / 标题
```

设计约束来自 dsh-synapse 的教训：**消息正文永不进树**，节点数 = 会话数，天然有界。

### 3.4 Web 路由

| 路由 | 用途 |
|---|---|
| `GET /branchman/api/tree` | 树的 JSON（GUI 总览图取这份数据） |
| `GET /branchman/api/status` | 各走向 git 状态 |
| `POST /branchman/api/fork` | 原子动作的宿主半边（①） |
| `POST /branchman/api/bind` | 客户端补建会话时回填 `sessionId` |
| `GET /branchman/` | 宿主侧 HTML 树页（GUI 内可开；外部浏览器被 renderer 令牌栅栏挡住） |

### 3.5 种子 fork：真实调用链

子会话必须**继承**对话，否则"回到那一点换个方向"这件事本身就不成立。
宿主自己的 fork 路径是这样的，插件复刻了它：

```js
const observed = await sessionQuery.observeSession(sourceSessionId)
const boundary = latestCompletedPrefixBoundary(observed.events)
const seed     = buildForkSeed(observed.events, boundary)
const presetId = observed.projections?.values?.agentPreset        // 控制器私有 presetForObservation 的全部内容
const presets  = ctx.get('agentPresets')                          // 控制器私有 composeAgent 用的服务
const agentPreset = (await presets.resolve(presetId)).id
await agents.create({
  sessionId, seed,
  inheritedEventCount: boundary + 1,
  meta: { cwd: worktree, parentSession: sourceSessionId, isSeeded: true, agentPreset },
  agentOptions: { provider, model },                              // 取 agentDefaultModel.currentSelection()
  setup: async (agentCtx) => { await presets.mount(agentCtx, agentPreset) },
})
```

**boundary 算法**（复刻控制器的 `latestCompletedPrefixBoundary`）：

```
从最后一个 turn/end 起，吸收同回合的尾部事件；
遇到 turn/start、user/message(surfaceOp:"append")、agent/inbox/spliced 就停。
```

用"最后一个事件"当 boundary 会继承一个**半截回合**（`buildForkSeed` 只能用合成的 closer
收尾）。源会话没有 `turn/end` 时宿主自己的 fork 会直接拒绝；插件选择**降级为空子会话并记
warn**，不挡用户的路。

可选服务解析全部走 `ctx.inject([...])`：cordis 的服务是 Proxy，未声明 inject 的属性访问
**抛错**（不是返回 undefined），而写进 `exports.inject` 又会让插件在缺少任一服务时完全不激活。

## 四、浏览器半边（`client.js`）

按宿主的模块表合同注册：`window.__ModuleLoader__.load({ id: 包名, factory: require => … })`，
React 从 factory 的 `require('react')` 取（不打进 bundle）。factory 返回 `{ inject, apply }`，
视图全部是 React 组件，**不向 `document.body` 追加任何节点**。

注册四个槽位入口（`order` 决定同槽位内的先后）：

| 槽位 | 组件 | 作用 |
|---|---|---|
| `conversation.chat.assistant-actions` | `BranchAction`（`order: 50`） | 每条 assistant 消息尾部的「⎇ 分支到新走向」；props 带该消息所属 `sessionId` |
| `conversation.chat.assistant-actions` | `OverviewAction`（`order: 51`） | 同上的「🗺 走向总览」入口 |
| `conversation.composer.dock` | `OverviewAction`（`order: 60`） | 输入框旁常驻（树是全局的，不该只藏在消息尾部） |
| `shell.overlay` | `Overlay`（`order: 60`） | 对话框与总览图的宿主分配浮层（`kind: "list"`，`scope: "root"`） |

浮层不是在点击时创建的 DOM，而是常驻在 `shell.overlay` 里的组件：按钮只翻一个模块级信号
（`setView`），`Overlay` 订阅它决定渲染对话框、总览还是空。这样浮层自动落在宿主的层级与主题里，
也不再有"点击时 append 一个 fixed 容器"的越权操作。

**样式**：`apply` 内一个 `ctx.effect` 注册 `<style>`（返回 `remove()` 清理），CSS **只引用主题令牌**
（`--dsw-alias-bg-layer-*` / `--dsw-alias-border-l*` / `--dsw-alias-label-*` / `--dsw-alias-button-*` /
`--dsw-alias-state-*`），因此深浅色主题与未来改版都自动跟随，没有写死的颜色。

**文案**：`locale.register(NS, DICT)` 注册中英字典，`locale.bind(NS)` 拿到 `t`；`tx()` 在服务缺失时
回退到内置中文字典，界面永不露出键名。校验：`test/client.mjs` 断言源码里每个 `tx('key')` 都在两本字典里。

### 总览图

- 数据：`GET /branchman/api/tree`
- 布局：tidy tree —— 叶子按序占位（`NODE_W + H_GAP`），父节点取全部子节点的中点，
  每级下沉 `NODE_H + V_GAP`；主线是显式画出来的虚拟根节点。
  该算法是纯函数 `layoutTree(nodes)` 并经 `__test` 导出，离线套件直接单测（不需要 DOM）
- 绘制：React 渲染的 SVG（`rect` + `text` + 三次贝塞尔 `path`），外层 `<g>` 承载 `translate/scale`
- 交互：pointer 事件拖动平移（带 `setPointerCapture`）、滚轮与按钮缩放（0.25×–2.5×）、
  适应窗口、点方框出详情并可切会话。滚轮走**非被动**监听（React 的 `onWheel` 是 passive，
  `preventDefault` 无效）
- 配色：全部来自主题令牌 —— 主线用更深的层、已合并用 `state-success`、已拆除用虚线 + `label-dimmed`

## 五、与最初设计稿的偏差

| 设计稿 | 实现 | 原因 |
|---|---|---|
| 客户端是「侧栏页签」 | 消息尾部 + 输入框旁两个槽位入口 | 侧栏标签页需要 `keyed` + children 的复杂契约；消息尾部槽位自带"这条消息属于哪个会话"的语义 |
| fork 用 `SessionStore.prepare` + `sessions.create` | `sessionQuery.observeSession` → `buildForkSeed` → `agents.create` | 前者只能建**空**子会话，历史会丢 |
| 树页画卡片+连线 | GUI 内自绘 SVG 总览 | Electron 窗口没有地址栏、外部浏览器被 renderer 令牌挡住，宿主网页在 GUI 里够不到 |

## 六、不变量（改代码时别破坏）

1. 树文件只存元数据，永不存消息正文
2. 节点主键是走向名 + cwd；`sessionId` 断了不报错
3. 写盘串行 + 每次唯一临时名
4. 建 worktree 前主线必须干净；建完把 `.branches/` 写进 `.git/info/exclude`（本地忽略，不动跟踪文件）
5. 五工具必须经 `defineTool` 注册
6. 可选宿主服务一律 `ctx.inject`，绝不直接读 `ctx.x`
7. 客户端切会话只走 `uiWorkspace.openSession`（`ctx.sessions` 上没有 `open`）
8. 任何失败都要给用户一句**可操作**的话，不许静默降级
