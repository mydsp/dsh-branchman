# DSH 插件开发合同（每条都真实炸过一次）

> 历史调查笔记，保留作宿主报错参考。文中入口、测试文件、部署方法和版本号来自早期实现，已经被 0.3.0 的 ARCHITECTURE、CONFORMANCE、INSTALL 与 ACCEPTANCE 替代。

这份笔记记录开发 dsh-branchman 过程中**用真实报错换来的**宿主行为约定。
每条都是：症状（含真实报错原文）→ 原因 → 做法。

> 版本标记（2026-10-02 经当前安装产物核实）：官方桌面端为
> `@deepseek-ai/dsh-desktop@0.2.0-rc.2`，Electron 标记见 `version` 文件（44.x，非 Harness 版本）。
> 旧版 `2.0.14 / Harness 0.1.7-rc.1` 标记已过时，条目中未在本轮重新核实的部分不可整份默认适用于新版。
> 已核实并固化为代码合同的两条见 §15a/§15b。

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

### 16a. `observeSession` 返回**引用计数可弃租约**（已核实，B05 根因）

**症状**：总览每 4 秒轮询一次树，`null` 摘要每轮都重读日志，`sessionQuery` 观察租约只增不减
（审计隔离复现：2 次树读取 → 2 次 observe、0 次 dispose）。

**原因**：`sessionQuery.observeSession(id)` 返回的对象带 `[Symbol.dispose]`。prepared 观察在
`retain()` 时 `refs += 1`，只有 `[Symbol.dispose]` 才 `refs -= 1`；不释放会永久 pin 住缓存条目。

**做法**：任何观察必须 `try/finally` 释放，成功、抛错、取消三条路径 dispose 恰好一次。
插件侧已收敛到 `HostAdapter.withObservation`，测试钉住「prepared/live 各一读、三路径各释放 1 次」。

### 16b. `session/disposed` 是 live 解除的配对通知，不是"磁盘已删除"（已核实，B07 根因）

**症状**：总览把 `session/disposed` 直接持久化成 `sessionMissing`，宣称会话已删除；实际
只是该会话从 live 集合 detach，日志仍在持久化 corpus 里。

**原因**：`session/disposed` 与 live entry 的 detach 配对；删除会话另有动作。混用会把"下线"
误报成"已删"，且没核对持久化目录就下结论。

**做法**：presence 分四态判定——live 优先，其次查持久化 corpus（在 → `persisted`，不在 →
`missing`，corpus 读失败 → `unknown`）。已收敛到 `HostAdapter.sessionPresence`。

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

### 23. 浮层用 `shell.overlay` 槽位；DOM 与字面颜色都不要自己造

界面最初是用原生 DOM 拼的（组件内部 `innerHTML` + `append`，对话框直接 `document.body.append`）。
那套能跑，但违反三条规范，`0.1.1` 全部改掉：

- **不要写组件之外的 DOM，更不要 `document.body.append`**。宿主给浮层留了槽位：
  `shell.overlay`（`{ kind: "list", scope: "root" }`，由 AppFrame 声明并常驻挂载）。
  做法是"常驻组件 + 模块级信号"：按钮只调 `setView(...)`，`Overlay` 订阅信号决定渲染什么——
  不要在点击时创建容器节点。
- **样式只用主题令牌 `--dsw-alias-*`**（本机实测 49 个，含 `bg-layer-1..4`、`border-l1..l4`、
  `label-primary/secondary/tertiary/dimmed/caption/error`、`button-primary-fill/hover`、
  `button-ghost-active-*`、`interactive-bg-hover/-active`、`state-success/warn/error-*`、
  `bg-mask-1`、`link`、`toast-bg`、`tooltip-bg`）。写死十六进制颜色在暗色主题下必然不跟随。
- **可见文案走客户端 locale 服务**：`ctx.inject(['locale'], …)` → `locale.register(ns, { zh, en })`
  注册字典、`locale.bind(ns)` 得到 `t(key, params)`（占位符是 `{name}`）；槽位注册项也可带
  `locale: ns`。服务缺失时的回退要自己兜住，否则界面露出键名。

### 24. GUI 对外部浏览器完全关闭

desktop-shell 每次启动生成 renderer 专用令牌（`x-dsh-desktop-renderer`）只发给 Electron 自己的
renderer；`decideBrowserAccess` 对无令牌请求一律拒绝（所有路径 403，连静态资源也是），
自签 cookie 无效（拒绝发生在更外层）。**所以插件要呈现的界面必须在 GUI 内自绘**，
宿主网页只在 GUI 内部可打开。

---

## 六、验证方法

### 25. 插件系统没有"跑一下看看"的便宜路径——把验证做成离线套件

GUI 拒外部浏览器、插件改动要重启、错误只出现在宿主日志或用户弹窗里。
因此每一条宿主行为都固化成了断言（`npm test`，**128 项**，不需要重启、不碰你的仓库）：

| 套件 | 覆盖 |
|---|---|
| `test/tools.mjs` | 宿主五工具全链路 + 并发写不变量 + 脏线守卫 + root 解析 |
| `test/seeded.mjs` | 种子继承 / preset 挂载 / boundary 算法（用 node_modules 垫片解析裸导入） |
| `test/client.mjs` | 模块契约 + **纯布局算法单测** + 可静态化的规范条款（不模拟 React/DOM） |
| `test/manifest.mjs` | manifest 校验预检 + 导出形式 / `ctx.effect` 清理 / 元数据白名单 |
| `test/domain/*.test.ts` | 领域层纯函数：Windows 路径边界、图构建、身份模型（`npm run test:domain`） |
| `test/contract/*.test.ts` | 宿主/ Git 适配器合同：观察租约释放、presence 四态、真实 Git 身份（`npm run test:contract`） |

领域层与合同层是 TypeScript 源码（`src/`），`npm run build` 编译到 `dist/`，
`npm run typecheck` 全量类型检查。这两个套件**只证明行为合同**，不充当桌面验收
（见 §28，浏览器 fixture 同样不冒充真实宿主）。

注意 `test/client.mjs` 的形态变过：`0.1.0` 之前它桩了一套 DOM + React hooks 去"真点按钮"，
但那属于规范明确不建议的做法（见 §28）。现在它只做三件站得住的事：真实加载产物核对模块契约、
直接单测纯函数、静态核对能静态化的条款。

### 26. 写完回归测试，把修复**临时还原**一次确认它会红

这条不是仪式：第一版并发写测试在旧代码下**照样通过**（时序没撞上），
真正有效的那版是直接把 24 次并发写压到 `TreeStore` 上——旧代码下它能稳定复现出用户截图里的同一条 ENOENT。

### 27. 桩要按**真实 API 形状**搭

`agents` 服务上并没有 `presetForObservation`；如果桩"贴心地"提供了它，这个 bug 永远不会被测出来。
把桩写成"服务只有真实存在的成员"，插件一旦调用了不存在的东西，套件立刻红。

### 28. 不要用"预览 / 模拟渲染"替代浏览器验证——规范明确禁止

`0.1.0` 时我做过一套离线预览：用插件的绘制代码生成 SVG，再用 Playwright 截成 PNG，
另外用桩 DOM + 桩 React 在测试里"真点按钮"。看上去很扎实，但官方验证章节直接点名禁止：

> Before or after installation, do not search for rasterizers, invoke Quick Look, **extract SVG into
> preview files, emulate React/DOM, or implement a custom renderer** to compensate for missing
> browser control. A screenshot of a mock page is not verification of the running plugin.
> —— `references/verification.md`

理由站得住：模拟出来的"通过"会让人误以为界面已经验证过了，而真实宿主里主题、槽位层级、
焦点与事件系统都可能不一样。`0.1.1` 起：

- 预览与栅格化脚本移出仓库（留在本机 `E:\tools\branchman\`）；
- `test/client.mjs` 不再模拟 React/DOM，改成单测纯布局算法 + 静态核对规范条款；
- 文档里**明确写清"视觉验证未在 agent 侧完成"**，而不是拿一张示意图充当证据。

没有浏览器控制时，规范允许的验证只有三样：JS 语法、manifest 校验、槽位注册本身。

---

## 七、规范合同（0.1.1 补齐）

宿主自带的 `cordis-plugin-development` 技能里写死了插件的导出形式、资源归属、样式与文案规则。
以下三条是**读规范才发现的**——功能一直正常，但不符合合同。

### 29. 导出形式只有两种，且不得混用

`references/host-plugin.md`：

> `index.js` exports one of these forms; do not mix them:
> `export function apply(ctx, config) {}` with optional `export const inject = ['tools']` and
> `export const Config`; or a service class as the default export.

也就是说 `export default apply` 配 `apply.inject = [...]`（很多存量插件这么写、也能跑）**不是**规范形式。
正确写法是具名导出：

```js
export async function apply(ctx, config) { … }
export const inject = ['webServer', 'sessions', 'tools']
export const Config = Schema.object({ … })
```

### 30. 每个注册都必须属于一个能清理的 effect

> Register every resource inside `apply` with `ctx.effect` or `ctx.on` and return its cleanup.

工具是 `ctx.tools.register(...)`、路由是 `ctx.webServer.register(...)`，两者**都返回 disposer**，
但如果不把它交回给 effect，插件卸载或 profile 补丁换行时它们会留在已死的上下文上。做法：

```js
ctx.effect(() => {
  const disposers = [ tool({ … }), tool({ … }) ]
  return () => { for (const d of disposers) { try { d?.() } catch {} } }
}, 'branchman: agent tools')
```

### 31. `Config` 用 schemastery 声明，且要能优雅缺席

声明 `Config` 后宿主会按 schema 校验行里的 `config`，用户才能在 `cordis.patch.yml` 里改。
写法与**守卫导入**（`schemastery` 是宿主依赖，插件上下文能解析，但不同宿主不保证）：

```js
let Schema = null
try {
  const mod = await import('schemastery')
  const candidate = mod.default ?? mod
  if (typeof candidate?.object === 'function') Schema = candidate
} catch { /* 没有 schema：退回裸配置 */ }

export const Config = Schema === null ? undefined : Schema.object({
  dataFile: Schema.string().default(''),
  gitPath: Schema.string().default('git'),
})
```

> 逐条对照表（含仍存的限制与理由）在仓库 `docs/CONFORMANCE.md`；`npm test` 里有断言钉住
> 导出形式与 effect 清理这两条，改回去就会红。
