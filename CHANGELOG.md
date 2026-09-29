# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

### Distribution

- Published to npm as [`dsh-branchman`](https://www.npmjs.com/package/dsh-branchman) —
  `pnpm add dsh-branchman`. The tarball checksum matches a local `npm pack`.
  Future releases go through GitHub Actions with npm trusted publishing (OIDC).

### Notes

- Verified against DSH Desktop 2.0.14 / Harness 0.1.7-rc.1.
- Plugin code is loaded at host start: editing `index.js`, `client.js`,
  `package.json` or `cordis.patch.yml` requires a full restart of DSH.
