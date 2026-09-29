# DSH 插件开发合同（每条都真实炸过一次）

这份笔记记录开发 dsh-branchman 过程中**用真实报错换来的**宿主行为约定。
每条都是：症状（含真实报错原文）→ 原因 → 做法。
适用版本：DSH Desktop 2.0.14 / Harness 0.1.7-rc.1。

目录
- [一、清单与加载](#一清单与加载)
- [二、服务与注入](#二服务与注入)
- [三、会话与 fork API](#三会话与-fork-api)
- [四、状态与写盘](#四状态与写盘)
- [五、浏览器半边与槽位](#五浏览器半边与槽位)
- [六、验证方法](#六验证方法)

---

## 一、清单与加载

### 1. `exports["./client"]` 必须是字符串

**症状**：`client-modules: dsh-branchman declares dsh.client but exports no "./client" bundle`，
**并且宿主把整个包从 bundles / dependencies / node_modules 三处回滚**（插件彻底消失）。

**原因**：宿主的 `clientExportOf` 只认字符串（或带字符串 `default` 的对象）。
写成 `"./client.js": "./client.js"` 这种"没有 `./client` 键"的形式不算。

```json
"exports": { ".": "./index.js", "./client": "./client.js" }
```

### 2. `dsh.client` 声明决定浏览器半边是否存在

删掉 `dsh.client` → 按钮和总览入口一起消失（宿主启动时扫描，无声明就完全不加载该半边）。
用官方模板的字段组合：`platform: "web"` + `immediately: true` + `inject: [拥有目标槽位的真实包名]`。

### 3. 改任何插件文件都必须**完全重启**宿主

探针实测：改 `index.js`、`client.js`、`package.json`、`cordis.patch.yml` 后**运行中的宿主仍跑旧代码**；
`cordis.patch.yml` 的改动也不触发 fiber 重载。客户端 HMR 只对开发构建有效。

> 因此"我改了但没生效"这类现象，先怀疑没重启，而不是代码错了。

### 4. 注册 agent 工具必须用宿主 `defineTool` 包装

**症状**：模型永远调不出参数——所有带参调用到达时参数为空（无参工具正常，极具迷惑性）。

```js
let defineTool = null
try { ({ defineTool } = await import('@deepseek-ai/dsh-tools')) } catch {}
const tool = definition => defineTool === null
  ? ctx.tools.register(definition)          // 降级：仍注册，但参数可能失效
  : ctx.tools.register(defineTool(definition))
```

### 5. 插件上下文能解析裸 `@deepseek-ai/*` 导入

虽然 profile 的 `node_modules` 里没有这些包，`await import('@deepseek-ai/dsh-tools')` 在插件上下文里
能解析成功（`defineTool`、`buildForkSeed` 都靠这条）。用 `try/catch` 包起来，失败时降级而不是崩。

### 6. `client bundle` 注册的 id 必须等于包名

`window.__ModuleLoader__.load({ id: 'dsh-branchman', … })` 里的 id 与 `package.json` 的 `name` 不一致，
入口对不上。这条已进 `test/manifest.mjs` 的自动预检。

---

## 二、服务与注入

### 7. cordis 服务是 Proxy：未声明 inject 的属性访问**抛错**

**症状**：`cannot get property "sessionQuery" without inject`（宿主日志原文）。
不是返回 `undefined` —— 所以"取不到就降级"的写法在直接访问时会直接抛。

**做法**：可选服务一律 `ctx.inject([名字], child => …)`：

```js
if (typeof ctx.inject === 'function') {
  ctx.inject(['sessionQuery', 'agents', 'agentDefaultModel'], child => {
    optional.sessionQuery = child.sessionQuery   // 服务就绪时回调
  })
}
```

### 8. 但**不要**把可选服务写进 `exports.inject`

写进去以后，只要某个名字在该宿主上不出现，插件就**永远不激活**——工具与按钮一起消失，
比降级难查得多。`exports.inject` 只放"没有它插件就没意义"的服务。

### 9. `ctx.get("名字")` 是另一种安全访问

控制器的内部实现里用 `this.ctx.get("agentPresets")`。当你确知某个服务**可能存在也可能不存在**、
且只在一处用到时，`ctx.get` 比 `ctx.inject` 更省事；`typeof ctx.get === 'function'` 兜底即可。

### 10. 会话控制器内部有**私有助手类**，不是服务

**症状**：`agents.presetForObservation is not a function` —— 被 try/catch 吞掉后表现为"子会话没有历史"。

**原因**：`presetForObservation` / `composeAgent` 属于 `dsh-api-session-controller` 内部的
`ApiSessionAgentController`（`this.agents = new ApiSessionAgentController(ctx)`），**不在 ctx 上**。

**做法**：照抄它们的行为——preset 取自 `observed.projections.values.agentPreset`；
挂载走 `ctx.get('agentPresets')` 的 `resolve(id)` / `mount(agentCtx, id)`。
**看到 `this.agents.x()` 先确认那是服务还是内部类**。

### 11. 客户端 `ctx.sessions` 上没有 `open`

**症状**：`ctx.sessions.open is not a function`。切换会话只走 `uiWorkspace.openSession(id)`
（原生分支按钮和 `dsh-client-ui-workspace` 内部都走这条）。
`uiWorkspace` 也是可选服务，用 `ctx.inject(['uiWorkspace'], …)` 取，并准备降级文案。

### 12. `/api` 共享 RPC 通道只有一个拦截器名额

已被 `dsh-api-gateway` 占用，`registerInterceptor` 对同频道抛错。
所以"拦截原生 fork 让它带上 worktree"这条路是封死的；
`SessionForkRequest` 也只有 `{sessionId, atSeq}`，**没有 cwd 字段**——原生分支按钮在设计上无法隔离工作区。

---

## 三、会话与 fork API

### 13. `SessionStore.create(id, options)` 是**两个**参数

只传 options 会被当成 id，报 `session header id "[object Object]" does not match session id`。

### 14. `origin` 校验是条件性的：**省略即合法**

传 `"branchman"` 之类的自定义值会抛守卫；完全不传 `origin` 则通过。

### 15. 建"带历史的子会话"不能只用 `sessions.create`

那样只能得到空会话。照官方 fork 路径：

```
sessionQuery.observeSession(id)
  → buildForkSeed(events, boundary)        // '@deepseek-ai/dsh-session/fork'
  → agents.create({ sessionId, seed, inheritedEventCount, meta, agentOptions, setup })
```

### 16. boundary 必须取"已完成回合前缀"，不是最后一个事件

从最后一个 `turn/end` 起、吸收同回合尾部事件，遇到
`turn/start` / `user/message`+`surfaceOp:"append"` / `agent/inbox/spliced` 就停。
用最后一个事件会继承**半截回合**（`buildForkSeed` 只能用合成的 closer 收尾）。
源会话没有 `turn/end` 时宿主自己的 fork 直接拒绝；插件选择降级为空子会话并记 warn。

### 17. 客户端建会话后要先同步目录才能打开

**症状**：`sessions.retain: unknown session <id>`。

**原因**：宿主在服务端建的会话，客户端的会话目录（catalog）还没同步过来；
`uiWorkspace.openSession(id)` 内部会走 `sessions.retain(id)`，要求该会话已知。

**做法**：`await ctx.sessions.refresh()`（公开 API，"Refresh the real Session baseline"），
再做 `scope/sessionOf/prompt` 与 `openSession`。顺序错了还有第二个后果：
`scope()` 对未知会话返回 `undefined`，交接语会被**静默跳过**。

---

## 四、状态与写盘

### 18. 写盘必须串行化 + 每次唯一临时名

**症状**：`ENOENT: no such file or directory, rename 'tree.json.tmp' -> 'tree.json'`，
且 fork 输掉竞争后回滚了 worktree，错误被抛到用户弹窗。

**原因**：所有保存共用同一个临时文件名，而"创建子会话"会触发被动 `session/created` 投影同时保存，
先完成的 `rename` 吃掉了临时文件。

**做法**：写入串成一条 promise 链（**失败也要接上下一个**，否则一次失败卡死后续写入）
+ 临时名带 pid / 序号。

### 19. 被动投影要"有界"

订阅 `session/created` / `session/event` 时只更新**元数据**（标题、计数、时间戳）。
逐事件建卡片（dsh-synapse 的老路）会导致无界膨胀。树节点数 = 会话数，天然有界。

### 20. linked worktree 会污染主线的 `git status`

worktree 目录会以 untracked 形式出现在主线 `status` 里，让"干净线"守卫误判。
fork 时把 `.branches/` 写进 `<repo>/.git/info/exclude`：本地忽略，不动跟踪文件、不进历史。

---

## 五、浏览器半边与槽位

### 21. 槽位选项字段名是 `order`，不是 `priority`

`dsh-client-ui-slots` 只读 `options.order`；写 `priority` 会被静默忽略（排序不生效，且不报错）。

### 22. `scope: "session"` 的槽位，props 才是权威上下文

`conversation.chat.assistant-actions` 会把**消息所属会话**（`sessionId`）与 ownerProp（`messageId`）
传给组件。别用 `ctx.sessions.list.getSnapshot().current` 代替——切换会话中途它可能是 `undefined`，
子会话会静默丢掉继承的历史。React effect 依赖要写 `[props?.sessionId, props?.messageId]`。

### 23. 托管原生 DOM 时用 ref，不要和 reconciler 抢节点

槽位合同要的是 React 组件，而原生按钮（含 `onclick`）更好写。做法：
组件只渲染一个 `<span ref>`，在 effect 里 `host.innerHTML = ''` 后 append 自建节点，清理函数里移除。

### 24. GUI 对外部浏览器完全关闭

desktop-shell 每次启动生成 renderer 专用令牌（`x-dsh-desktop-renderer`）只发给 Electron 自己的
renderer；`decideBrowserAccess` 对无令牌请求一律拒绝（所有路径 403，连静态资源也是），
自签 cookie 无效（拒绝发生在更外层）。**所以插件要呈现的界面必须在 GUI 内自绘**，
宿主网页只在 GUI 内部可打开。

---

## 六、验证方法

### 25. 插件系统没有"跑一下看看"的便宜路径——把验证做成离线套件

GUI 拒外部浏览器、插件改动要重启、错误只出现在宿主日志或用户弹窗里。
因此每一条宿主行为都固化成了离线断言（`npm test`，140 项，不需要重启、不碰你的仓库）：

| 套件 | 覆盖 |
|---|---|
| `test/tools.mjs` | 宿主五工具全链路 + 并发写不变量 + 守卫 |
| `test/seeded.mjs` | 种子继承 / preset 挂载 / boundary 算法（用 node_modules 垫片解析裸导入） |
| `test/client.mjs` | 桩 DOM/React/fetch/ctx，真实点击按钮走完整链路 + 总览图 |
| `test/manifest.mjs` | 宿主 manifest 校验规则预检（防"加载失败 → 整包被回滚"） |

### 26. 写完回归测试，把修复**临时还原**一次确认它会红

这条不是仪式：第一版并发写测试在旧代码下**照样通过**（时序没撞上），
真正有效的那版是直接把 24 次并发写压到 `TreeStore` 上——旧代码下它能稳定复现出用户截图里的同一条 ENOENT。

### 27. 桩要按**真实 API 形状**搭

`agents` 服务上并没有 `presetForObservation`；如果桩"贴心地"提供了它，这个 bug 永远不会被测出来。
把桩写成"服务只有真实存在的成员"，插件一旦调用了不存在的东西，套件立刻红。

### 28. 视觉产物也要能离线核对

`scripts/preview-overview.mjs` 用**插件自己的绘制代码**喂数据生成 SVG，
`shot-overview.py` 截成 PNG——不启动应用就能看到布局对不对。
