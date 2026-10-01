# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **脏主线不再挡开走向**。此前"主线有未提交改动（N 项）。先提交或 stash，再开走向"把
  随手开堵得死死的。现在未提交改动**随分叉原样带进新走向**：已跟踪文件走
  `git diff HEAD --binary` → worktree 内 `git apply`（同一 HEAD 建出，必然干净套用）；
  **未跟踪的新文件逐个复制**（`git diff` 看不见它们，而它们恰恰是进行中工作的常态；
  `.branches/` 经本地 exclude 不进清单，CJK 文件名用 `-z` 处理）。主线一字不动——
  复制不是移动；apply/复制失败不回滚 fork，原因照实进 hint。merge/sync 的脏守卫
  保持不变（那两处拦的是反向操作）。
- **名字框预填**：开走向对话框的名字不再从空白开始——从当前对话的
  `displayTitle`（标题 → 目录名 → id 的侧栏级回退链）推导一个 git 安全短名
  （空白/标点折叠成连字符，截 24 字符，模板标题不参与），回车两下就得到可辨认的
  走向；想改名直接打字覆盖。
- **一句话交接直达树上**：对话框里的 brief 现在随 fork 请求进宿主，直接存成节点
  `preview`（用户自己的话，且此刻就可用）；没填 brief 才走"读子会话日志取
  objective/首条消息"的回退。
- **走向行自己能被认出来，不再依赖对不上号的名字**。冷 goal 会话的宿主标题永远是
  同一句模板（Reference Attachments for Goal Objective），且**归档中的走向会话
  根本不出现在侧栏**——标题配对没有对象。客户端识别模板标题（含 `(1)` 去重
  后缀）不再当主标签：可用标题 → 标题为主/摘要为辅；模板标题 → 摘要为主/
  分支名为辅；都没有 → 退回旧的单行分支名。详情头部副行同理，
  「更多信息」里给出「对话开头」与「会话标题」（原始值，供排查）。

## [0.2.0] — 2026-10-01

三个实机反馈：走向会话落在「未分组」、总览只能看不能动手、分叉点不精确。

### Fixed

- **走向的会话不再落进「未分组」**。Workspace 按 **cwd 全等**记账
  （`@deepseek-ai/dsh-workspace`：`sessionPath(id) === record.path`，`attachSession` 会拒绝
  任何"解析到别的路径"的 cwd），而走向子会话的 cwd 是 worktree —— 所以它不属于任何工作区，
  侧栏只能把它扔进「未分组」。现在 fork 后立即 `workspaceRegistry.create(worktree, '走向 <名>')`
  并 `workspace.attachSession(childId)`，与 Session Controller 自己的 fork 同款收尾步骤。
  切换到「按工作区树」分组时，走向会按路径前缀嵌在项目下面。
  登记失败**不阻断**走向，但会把原因原样报给用户（不再静默）。
- **`branch_drop` 会注销该走向的工作区登记**，不留一个名字还在、目录已没的空分组。
  （注销用 fork 时记下的 `workspaceId`；老节点退回 `resolveByPath`，且必须在删 worktree
  **之前**解析——registry 走 realpath，目录没了就解析不出来。）

### Added

- **从你点的那条消息分叉**（参照 pi 的 `/tree` 语义）。消息尾部的分支控件是按"回合尾"
  渲染的，浏览器半边唯一拿得到的手柄就是那个回合最后一条 assistant 消息的 `messageId`
  （`dsh-client-ui-chat` 传的就是 `closing.finalNode.messageId`）。现在它一路传到宿主，
  换算成边界：定位该消息所在事件 → 找它所属回合的 `turn/end` → 再用官方的尾部吸收规则
  收尾。认不出的 id 静默退回"最新完成回合"，不挡路。返回体带 `boundarySource`
  （`message` / `atSeq` / `latest-turn`）与 `boundarySeq`，便于回答"这条子会话为什么继承了这么多"。
- **总览可操作**：详情面板给每条走向四个动作 —— 切到该会话 / 合并到主线 / 同步主线 /
  拆除走向，对应新路由 `POST /branchman/api/{merge,sync,drop}`。拆除是两步确认
  （一键删 worktree + 分支太危险），操作后重取树并把选中项指向刷新后的节点。
  已合并的走向只留"拆除"，已拆除的不给动作。
- **`branch_sync` 工具**：把主线吸收进走向（`main → worktree`），`branch_merge` 的反向。
  走向跑得久、主线又往前走时用，正是"全量克隆很难同步"的那个痛点。
- **`branch_fork` 现在真的从"当前对话"分叉**：`dsh-tools` 调 `tool.execute(args, exec)`，
  `exec.agent` 就是调用方（`dsh-deja` 读同一处）。此前工具侧拿不到源会话，agent 开出来的
  走向子会话**必然是空的**。现在默认取 `exec.agent.session.id` 与 `header.cwd`，
  显式参数仍然优先。想克隆一条已有走向：`from: 'branchman/<名>'` 加上那条走向的会话。
- **已有的走向也会被带上**：0.1.x 没登记过工作区，而注册表自己的历史对账**只跑一次**
  （仅在其 domain 未初始化时），所以升级后老走向照样落在「未分组」。插件现在在 activate 时
  遍历树里未拆除的走向，逐个补登记并挂会话，再把 `workspaceId` 写回节点。
  注册表没起来、目录已被删、会话 id 缺失都只是跳过，不影响激活。
- **已归档的走向会被标出来，并可一键取消归档**。归档是注册表全局集合，而侧栏的
  `sessionVisible` 会把归档会话从**每一个**分组里过滤掉 —— 所以"给走向挂了工作区"
  并不等于"它看得见"：一条既挂好工作区、又被归档的走向依然会消失。树的每个节点现在带
  `archived` 标记（读 `workspaceRegistry.archivedSessionIds`），总览里给出警示和「取消归档」。
  取消归档走新的 `POST /branchman/api/unarchive`，它**一次做两件事**：先给走向建/补工作区，
  再 `registry.unarchiveSession` —— 只取消归档的话，会话只是从"到处看不见"变成「未分组」，
  正是这次要修的毛病。同理，激活时的补登记**跳过已归档的走向**：给一个在任何分组里都被
  隐藏的会话建工作区，只会让侧栏多出一个永远空的组。
- **总览不是盲操作**：详情面板显示这条走向的 git 状态（领先主线 / 落后 / 未提交），
  数据取自同一个 `/branchman/api/status`。**有未提交改动时「合并到主线」和「同步主线」
  直接置灰**并写明原因 —— 宿主的 `doMerge`/`doSync` 本来就拒绝脏工作区，与其点了报错，
  不如点之前就说明白。「拆除走向」不受此限制（它的设计就是强删）。
- **客户端与宿主版本错位时不给假按钮**：浏览器半边刷新页面就更新，宿主半边只能完全重启才
  更新，所以两者可能差一个版本。`/branchman/api/tree` 的 `capabilities` 新增 `operations`，
  界面只在它为 true 时摆出四个操作；否则显示一句"宿主侧还没加载新版本，完全退出 DSH 再启动"。
  没有这道门，重启前刷新一次页面就会看到一排点了 404 的按钮。
- 树节点新增 `workspaceId` 与 `archived`；`branch_tree` 的 `capabilities` 新增 `workspaceRegistry`。

### Tests

- `test/seeded.mjs`：工作区记账（create + attach + 树节点记 id + drop 注销 + **激活时给老走向补登记**
  + **跳过已归档的走向**）、**归档上报**、**走真实 web 路由的「取消归档」**（补工作区 → 挂会话 →
  `unarchiveSession` → 树不再标 archived）、按消息分叉（两个完整回合的源，`messageId` → 4 条 vs
  不给 → 9 条 vs 幽灵 id → 9 条）、agent 工具路径（`exec.agent` → 继承 9 条，不读就是 undefined）。
  每条都验过"有牙齿"：临时还原修复后对应用例确实变红。
- `test/client.mjs`：总览操作路由、两步确认、操作后重取树、分支请求带 `messageId`、
  归档警示与取消归档、**git 状态与脏工作区置灰**。
- 合计 **176 项断言**（tools 31 · seeded 56 · client 64 · manifest 25），四套件全绿。

## [0.1.1] — 2026-09-29

按宿主官方插件规范（`dsh-agent-preset/skills/cordis-plugin-development`）逐条整改。

### Changed

- **宿主半边改用规范的导出形式**：`export async function apply` + `export const inject`，
  不再用 `export default apply` 配 `apply.inject = […]`（规范明确两种形式不得混用）。
- **每处注册都由 `ctx.effect` 拥有并返回清理**：五个 agent 工具与两条 web 路由现在都会在
  插件卸载 / profile 补丁替换时被摘掉，不再留在已死的上下文上。
- **补 `export const Config`**（schemastery schema）：`dataFile` / `defaultRoot` / `gitPath`
  从此可在 `cordis.patch.yml` 里被校验与补全；取不到 schemastery 的宿主自动退回裸配置。
- **客户端重写为 React 组件**：对话框与总览注册进宿主分配的 `shell.overlay` 槽位
  （`kind: "list"`, `scope: "root"`），不再向 `document.body` 追加浮层。
- **样式只用主题令牌 `--dsw-alias-*`**（49 个令牌中的相关子集）：深色/浅色主题、以及未来的
  改版都会自动跟随，不再有写死的十六进制颜色。
- **全部可见文案走客户端 locale 服务**（`locale.register` + `locale.bind`），内置中英文案，
  服务缺失时回退到中文，界面不会露出键名。
- **插件卡片元数据**：新增 `icon.svg`（`currentColor`，跟随主题）与 `locale/{zh,en}.json` 的
  `meta.title`/`meta.description`，并在 `exports`/`files` 中声明。

### Removed

- 预览与栅格化工具链（`preview-overview.mjs`、`shot-overview.py`）移出仓库：官方验证章节
  明确不要用"抽 SVG 预览 / 模拟 React / 自定义渲染器"替代浏览器控制下的验证。

### Tests

- `test/client.mjs` 不再模拟 React/DOM。改为：真实加载产物核对模块契约、直接单测纯布局算法
  （`__test.layoutTree`）、静态核对可静态化的规范条款（不写 `document.body`、无字面颜色、
  文案全部过字典、浮层走 `shell.overlay`）。
- `test/manifest.mjs` 增加导出形式、`ctx.effect` 清理、元数据与白名单断言。
- 合计 **125 项断言**（tools 31 · seeded 26 · client 45 · manifest 23），四套件全绿。

### Distribution

- Published to npm as `dsh-branchman@0.1.1` by **GitHub Actions trusted publishing (OIDC)** — no token, no
  OTP — with a **provenance attestation**. Verified: `npm install dsh-branchman && npm audit signatures`
  reports `1 package has a verified attestation`; the unpacked tarball matches the repository file by file.

### Documentation

- 新增 [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md)：逐条对照官方规范的符合性表（含仍存的
  限制与理由），并说明视觉验证为何只能在运行中的页面里做。

## [0.1.0] — 2026-09-29

First public release.

### Added

- **`branch_fork`** — one atomic action: `git worktree add .branches/<name>` on a
  new branch, plus a child session whose `cwd` is that worktree and which
  inherits the conversation it forked from. Records the tree edge.
- **`branch_tree`** — the direction tree as JSON (who forked from whom, worktree
  paths, branches, status, inherited event count).
- **`branch_status`** — per-direction `ahead` / `behind` / uncommitted files
  against the main line.
- **`branch_merge`** — merge a finished direction back (`--no-ff`, guarded by a
  clean-main-line check).
- **`branch_drop`** — tear a direction down (worktree + branch + tree node).
- **Per-message 「⎇ branch to a new direction」 control** in the assistant action
  row: name the direction, add a one-line handoff, and the worktree, the child
  session, the inherited history and the tree edge all happen in one click.
- **Graphical overview** (「🗺 directions overview」), reachable from the message
  actions and from a persistent button next to the composer: an SVG branch map
  with the main line as a dark root node, direction boxes, bezier edges, tidy-tree
  layout, drag-to-pan, wheel/button zoom and fit-to-window. Clicking a box shows
  its details and can switch to that session.
- **Passive tree projection** — sessions whose cwd sits under `.branches/` are
  added to the tree automatically, so directions opened outside the button still
  show up. Metadata only; message bodies never enter the tree file.
- **`/branchman/` host page** and `/branchman/api/{tree,status,fork,bind}` JSON
  endpoints.
- **140 offline assertions** across four suites (`npm test`), no host restart and
  no touching of your own repositories.
- **`scripts/branchman.ps1`** — a zero-restart CLI fallback for when the plugin
  is not loaded (status / save / fork / list / sync / merge / drop).
- **`scripts/preview-overview.mjs` + `shot-overview.py`** — render the overview
  offline from the plugin's own drawing code, for visual review without launching
  the app.

### Fixed

- **Root resolution on a fresh install.** The UI sends only the session's cwd
  (`sourceCwd`), never `root`, so with a portable default the fork used to fall
  back to the host process's cwd — i.e. not the user's repository at all. The
  repository is now located with `git rev-parse --show-toplevel`, which also
  accepts a subdirectory as the starting point.

### Distribution (0.1.0)

- Published to npm as [`dsh-branchman`](https://www.npmjs.com/package/dsh-branchman) —
  `pnpm add dsh-branchman`. Published locally for this version, so the tarball checksum matches a local `npm pack`.
  Future releases go through GitHub Actions with npm trusted publishing (OIDC).

### Notes

- Verified against DSH Desktop 2.0.14 / Harness 0.1.7-rc.1.
- Plugin code is loaded at host start: editing `index.js`, `client.js`,
  `package.json` or `cordis.patch.yml` requires a full restart of DSH.
