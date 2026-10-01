// dsh-branchman — browser half (Client module of the bundle).
//
// Registered through the host's module loader: `window.__ModuleLoader__.load`
// with an id equal to the package name, returning `{ inject, apply }`. React
// comes from the browser module table (`require('react')`), never from a bundled
// copy, and no Harness Client package is imported as a module.
//
// Conformance notes (cordis-plugin-development → references/ui-plugin.md and
// references/practices.md):
//   · every view is a React component registered through `ctx.slots.inject` —
//     nothing is appended to `document.body`, and no DOM is written outside a
//     component;
//   · the dialog and the overview render in the `shell.overlay` slot
//     (`{ kind: 'list', scope: 'root' }`), which is the surface the host
//     allocates for overlays;
//   · styles are registered once in `apply` through `ctx.effect` (cleanup
//     returned) and reference ONLY `--dsw-alias-*` theme tokens, so the plugin
//     follows light/dark and any future re-theming;
//   · every visible string goes through the Client locale service
//     (`locale.register` + `locale.bind`), with the Chinese copy as the
//     fallback for a host that resolves neither.
window.__ModuleLoader__.load({
  id: 'dsh-branchman',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }

    // ── locale ────────────────────────────────────────────────────────────
    // The dictionary is inlined: this artifact is a plain script evaluated by
    // the module loader, so it cannot import JSON. `locale/*.json` next to the
    // manifest carries the plugin-card metadata the host reads without
    // activating the plugin.
    const NS = 'dsh-branchman'
    const DICT = {
      zh: {
        'action.branch': '⎇ 分支到新走向',
        'action.branch.title': 'git worktree + 完整历史子会话 + 树上连线，一步完成',
        'action.overview': '🗺 走向总览',
        'action.overview.title': '看整个工程的走向树：谁从谁分出来、各走向状态、随时切过去',
        'dlg.title': '开新工程走向',
        'dlg.hint': 'git worktree + 完整历史子会话（工作区自动切到 .branches\\<名>）+ 树上自动连线。主线有未提交改动也能直接开：改动会原样带进走向（未跟踪的新文件除外），主线保持不动。',
        'dlg.name': '走向名，如：走向-视觉方案',
        'dlg.brief': '一句话交接：这条走向要验证什么？（会写进子会话的首条上下文）',
        'dlg.cancel': '取消',
        'dlg.create': '开走向',
        'err.nameRequired': '走向名必填',
        'step.worktree': '① 建 worktree 与子会话…',
        'step.child': '② 宿主未建成会话，客户端补建…',
        'step.sync': '② 同步会话目录…',
        'step.handoff': '③ 写入交接…',
        'step.open': '④ 打开会话…',
        'msg.noSeeded': '走向「{name}」已建立并切过去了，但子会话未继承历史（宿主未提供 sessionQuery/agents）——如需带历史请重启 DSH 后再试。',
        'msg.noWorkspace': '走向「{name}」已建立（worktree + 子会话 {id}），但当前宿主未提供 uiWorkspace，请在左侧会话列表中点开它。',
        'msg.openFailed': '走向「{name}」已建立（worktree + 子会话 {id}），但自动切换失败：{error}。请在左侧会话列表中点开它。',
        'msg.handoff': '[branchman 交接] 本走向「{name}」从「{source}」分叉，工作区={cwd}。要验证的假设：{brief}。请先浏览工作区文件再行动。',
        'ov.title': '工程走向总览',
        'ov.hint': '一个方框 = 一条走向（git worktree + 会话）。点方框看详情，拖动平移，滚轮缩放。',
        'ov.empty': '还没有走向。点下面的「⎇ 从当前对话开一条走向」开第一条。',
        'ov.anyConversation': '每条对话都能开走向 —— 上面的方框只是已经开过的那些。从你正在看的这条对话开：',
        'ov.grouping': '侧栏把每条走向平铺成一个工作区、与仓库并列 —— 宿主的 Workspace 按「目录全等」记账，而走向的目录是 worktree，所以它只能自己占一格。想让它跟随父工作区、嵌在仓库下面：把「工作区」那一行的视图选项 → 分组方式，切成「按工作区树」。',
        'ov.groupingDone': '已把侧栏分组切成「按工作区树」—— 走向会跟随父工作区，嵌在仓库下面（刷新页面后生效）。想改回来：「工作区」那一行的视图选项 → 分组方式 → 按工作区。',
        'ov.branchHere': '⎇ 从当前对话开一条走向',
        'ov.branchHere.title': '从这条对话的最新完成回合分叉。想从某个更早的位置分叉，就用那条消息尾部的分支按钮。',
        'ov.here': '你在这里',
        'ov.currentMain': '当前对话',
        'ov.none': '还没有走向',
        'ov.stats': '{total} 条走向 · {live} 条在用',
        'ov.close': '关闭',
        'ov.zoomIn': '放大',
        'ov.zoomOut': '缩小',
        'ov.fit': '适应窗口',
        'ov.refresh': '刷新',
        'ov.pickHint': '点一个方框查看详情',
        'ov.main': '◆ 主线·主目录',
        'ov.mainDetail': '主线（工作区主目录）',
        'ov.mainRow': '主线 · 仓库主目录',
        'ov.mainHint': '主线 = 仓库主目录这条结构线，不是某一条对话；● 标记你当前所在的位置。归档的走向会话不在侧栏里，只有这里能找到它们。',
        'ov.onMain': '当前对话：{title}',
        'ov.moreConversations': '另有 {count} 条对话在主线上（未上树的日常对话，见侧栏）',
        'ov.viewList': '列表',
        'ov.viewGraph': '图形',
        'ov.groupingShort': '侧栏：按工作区树',
        'ov.groupingShortOff': '侧栏：按工作区',
        'det.inherited': '继承 {count} 事件',
        'det.messages': '{count} 条消息',
        'det.branch': '分支 {branch}',
        'det.lastActive': '最后活动 {time}',
        'det.path': '目录 {path}',
        'det.session': '会话 {id}',
        'det.sessionTitle': '会话标题：{title}',
        'det.preview': '对话开头：{preview}',
        'det.switch': '切到该会话',
        'det.stale': '已 3 天无活动 — 考虑 merge 或 drop',
        'det.missing': '这条走向还没有绑定会话：会话可能在别处被删除，或还没建立。',
        'det.actions': '操作',
        'det.merge': '合并到主线',
        'det.merge.title': '把这条走向合回主线（走向内需先提交）',
        'det.sync': '同步主线',
        'det.sync.title': '把主线的最新提交吸收进这条走向',
        'det.drop': '拆除走向',
        'det.drop.title': '删除 worktree 与分支；未合并的成果会一起丢掉',
        'det.dropConfirm': '确认拆除「{name}」？worktree 与分支会一并删除',
        'det.dropYes': '确认拆除',
        'det.cancel': '取消',
        'det.busy': '执行中…',
        'det.done.merge': '已合回主线。确认无误后可拆除 worktree。',
        'det.done.sync': '已把主线的提交吸收进这条走向。',
        'det.done.drop': '已拆除：worktree、分支与工作区登记都没了。',
        'det.merged': '已合并',
        'det.dropped': '已拆除',
        'det.archived': '⚠ 这条走向的会话处于「已归档」——侧栏在所有分组里都会把它藏起来。取消归档后它会回到自己的工作区分组。',
        'det.sessionMissing': '⚠ 这条走向的对话已被删除（worktree 和分支都还在，提交也没丢）。可以「拆除走向」把它一并清掉，或另开一条走向接上这个目录。',
        'det.missingDir': '⚠ 这条走向的目录已经不在了——worktree 被插件之外的操作删掉了。合并和同步都会失败，只能「拆除走向」清掉登记。',
        'det.unarchive': '取消归档',
        'det.unarchive.title': '取消归档，并补上它自己的工作区',
        'det.open': '打开这条对话',
        'det.open.title': '切到这条走向的会话继续工作',
        'det.more': '更多（目录 / 会话 id / 分支）',
        'det.less': '收起',
        // One word per direction, shared by the list row and the detail header.
        'state.main': '主线',
        'state.trunk': '主线对话',
        'state.trunkArchived': '主线对话·已归档',
        'state.open': '进行中',
        'state.merged': '已合并',
        'state.archived': '已归档',
        'state.sessionMissing': '对话已删',
        'state.missingDir': '目录已失',
        'state.dropped': '已拆除',
        'chip.ahead': '领先 {count}',
        'chip.behind': '落后 {count}',
        'chip.dirty': '未提交 {count}',
        'chip.clean': '干净',
        'det.done.unarchive': '已取消归档：这条走向的会话现在会出现在自己的工作区分组里。',
        'det.git': 'git：领先主线 {ahead} · 落后 {behind} · 未提交 {dirty}',
        'det.gitLoading': 'git：读取中…',
        'det.gitUnknown': 'git：状态不可读（目录可能已不在）',
        'det.dirtyBlock': '⚠ 有未提交改动 —— 先在这条走向的目录里提交，才能合并或同步（拆除不受限制）',
        'det.opsPending': '合并 / 同步 / 拆除 / 取消归档 需要宿主侧加载新版本后才会出现 —— 完全退出 DSH（含托盘）再启动即可，界面本身刷新页面就够。',
        'msg.wsWarning': '走向「{name}」已建立，但工作区登记有问题：{warning}',
      },
      en: {
        'action.branch': '⎇ Branch to a new direction',
        'action.branch.title': 'A git worktree, a child session with inherited history, and the tree edge — in one step',
        'action.overview': '🗺 Direction overview',
        'action.overview.title': 'The whole direction tree: what forked from what, each direction’s state, jump to any of them',
        'dlg.title': 'Open a new engineering direction',
        'dlg.hint': 'git worktree + a child session with inherited history (its cwd switches to .branches\\<name>) + an edge in the tree. Uncommitted changes on main are carried into the direction as-is (untracked files excepted); main stays untouched.',
        'dlg.name': 'Direction name, e.g. direction-visual',
        'dlg.brief': 'One-line handoff: what is this direction meant to verify? (becomes the child session’s first context)',
        'dlg.cancel': 'Cancel',
        'dlg.create': 'Open direction',
        'err.nameRequired': 'A direction name is required',
        'step.worktree': '① creating the worktree and child session…',
        'step.child': '② the host did not create the session; creating it here…',
        'step.sync': '② syncing the session catalogue…',
        'step.handoff': '③ writing the handoff…',
        'step.open': '④ opening the session…',
        'msg.noSeeded': 'Direction “{name}” is created and opened, but the child session did NOT inherit history (the host exposes no sessionQuery/agents). Restart DSH and retry for an inherited one.',
        'msg.noWorkspace': 'Direction “{name}” is created (worktree + child session {id}), but this host exposes no uiWorkspace — open it from the session list on the left.',
        'msg.openFailed': 'Direction “{name}” is created (worktree + child session {id}), but switching to it failed: {error}. Open it from the session list on the left.',
        'msg.handoff': '[branchman handoff] Direction “{name}” forks from “{source}”, workspace={cwd}. Hypothesis to verify: {brief}. Browse the workspace files before acting.',
        'ov.title': 'Direction overview',
        'ov.hint': 'One box = one direction (a git worktree + a session). Click a box for details, drag to pan, scroll to zoom.',
        'ov.empty': 'No directions yet. Click “⎇ Branch from this conversation” below to open the first one.',
        'ov.anyConversation': 'Every conversation can branch — the boxes above are only the ones already opened. Branch from the conversation you are reading:',
        'ov.grouping': 'The sidebar lists every direction as a workspace side by side with its repo — the host accounts Workspaces by exact directory, and a direction’s directory is a worktree, so it has to own one. To make it follow its parent workspace and nest under the repo, switch the grouping on the “Workspaces” row to “by workspace tree”.',
        'ov.groupingDone': 'The sidebar grouping is now “by workspace tree”, so directions follow their parent workspace and nest under their repo (takes effect after a page reload). To undo it: the “Workspaces” row → view options → grouping → “by workspace”.',
        'ov.branchHere': '⎇ Branch from this conversation',
        'ov.branchHere.title': 'Forks from this conversation’s latest finished turn. To fork from an earlier point, use the branch button under that message.',
        'ov.here': 'you are here',
        'ov.currentMain': 'this conversation',
        'ov.none': 'No directions yet',
        'ov.stats': '{total} directions · {live} live',
        'ov.close': 'Close',
        'ov.zoomIn': 'Zoom in',
        'ov.zoomOut': 'Zoom out',
        'ov.fit': 'Fit',
        'ov.refresh': 'Refresh',
        'ov.pickHint': 'Click a box to see its details',
        'ov.main': '◆ main (repo root)',
        'ov.mainDetail': 'Main line (the workspace’s main directory)',
        'ov.mainRow': 'Main line · repo root',
        'ov.moreConversations': '{count} more conversations on this main line (see sidebar)',
        'ov.mainHint': 'The main line is the repo-root structural node, not a conversation; ● marks where you are. Archived direction sessions are not in the sidebar — only here.',
        'ov.onMain': 'Current conversation: {title}',
        'ov.viewList': 'List',
        'ov.viewGraph': 'Graph',
        'ov.groupingShort': 'Sidebar: by workspace tree',
        'ov.groupingShortOff': 'Sidebar: by workspace',
        'det.inherited': '{count} inherited events',
        'det.messages': '{count} messages',
        'det.branch': 'branch {branch}',
        'det.lastActive': 'last active {time}',
        'det.path': 'dir {path}',
        'det.session': 'session {id}',
        'det.sessionTitle': 'Session title: {title}',
        'det.preview': 'Opening lines: {preview}',
        'det.switch': 'Switch to this session',
        'det.stale': 'No activity for 3 days — consider merge or drop',
        'det.missing': 'This direction has no session bound: it may have been deleted elsewhere, or never created.',
        'det.actions': 'Actions',
        'det.merge': 'Merge into main',
        'det.merge.title': 'Absorb this direction back into the main line (commit inside the direction first)',
        'det.sync': 'Sync main in',
        'det.sync.title': 'Absorb the main line’s latest commits into this direction',
        'det.drop': 'Drop direction',
        'det.drop.title': 'Delete the worktree and the branch; unmerged work goes with them',
        'det.dropConfirm': 'Drop “{name}”? The worktree and the branch are deleted with it',
        'det.dropYes': 'Drop it',
        'det.cancel': 'Cancel',
        'det.busy': 'working…',
        'det.done.merge': 'Merged into the main line. Drop the worktree once you have confirmed it.',
        'det.done.sync': 'The main line’s commits are now in this direction.',
        'det.done.drop': 'Dropped: worktree, branch and workspace registration are gone.',
        'det.merged': 'merged',
        'det.dropped': 'dropped',
        'det.archived': '⚠ This direction’s session is archived — the sidebar hides archived sessions in every grouping. Unarchive it and it returns to its own workspace group.',
        'det.sessionMissing': '⚠ This direction’s conversation was deleted (the worktree, the branch and its commits are all still there). Drop the direction to clear it, or open a new direction onto this directory.',
        'det.missingDir': '⚠ This direction’s directory is gone — the worktree was removed outside the plugin. Merge and sync will fail; dropping is the way to clear the record.',
        'det.unarchive': 'Unarchive',
        'det.unarchive.title': 'Take it out of the archive and give it its own workspace',
        'det.open': 'Open this conversation',
        'det.open.title': 'Switch to this direction’s session and carry on',
        'det.more': 'More (dir / session id / branch)',
        'det.less': 'Less',
        'state.main': 'main',
        'state.trunk': 'trunk conversation',
        'state.trunkArchived': 'trunk (archived)',
        'state.open': 'active',
        'state.merged': 'merged',
        'state.archived': 'archived',
        'state.sessionMissing': 'conversation deleted',
        'state.missingDir': 'directory gone',
        'state.dropped': 'dropped',
        'chip.ahead': '{count} ahead',
        'chip.behind': '{count} behind',
        'chip.dirty': '{count} uncommitted',
        'chip.clean': 'clean',
        'det.done.unarchive': 'Unarchived: this direction’s session now shows up in its own workspace group.',
        'det.git': 'git: {ahead} ahead · {behind} behind · {dirty} uncommitted',
        'det.gitLoading': 'git: reading…',
        'det.gitUnknown': 'git: state unreadable (the directory may be gone)',
        'det.dirtyBlock': '⚠ Uncommitted changes — commit inside this direction before merging or syncing (dropping is unrestricted)',
        'det.opsPending': 'Merge / sync / drop / unarchive appear once the host half carries the new version — quit DSH completely (tray included) and start it again; the page itself only needs a refresh.',
        'msg.wsWarning': 'Direction “{name}” is created, but its workspace registration reported: {warning}',
      },
    }
    let bound = null
    const fill = (template, params) => {
      if (params === undefined || params === null) return template
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match))
    }
    // Locale service first, inlined Chinese as the fallback: a host without the
    // service still renders copy rather than raw keys.
    const tx = (key, params) => {
      let value
      if (typeof bound === 'function') {
        try { value = bound(key, params) } catch { value = undefined }
      }
      if (typeof value !== 'string' || value === '') value = DICT.zh[key]
      if (typeof value !== 'string' || value === '') return key
      return fill(value, params)
    }

    // ── styles: theme tokens only ─────────────────────────────────────────
    const CSS = `
.dsh-branchman-btn{display:inline-flex;align-items:center;gap:4px;height:24px;border:0;border-radius:6px;background:transparent;padding:0 8px;color:var(--dsw-alias-label-secondary);font:500 11px Inter,system-ui,sans-serif;cursor:pointer}
.dsh-branchman-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-branchman-btn:active{background:var(--dsw-alias-interactive-bg-active)}
.dsh-branchman-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-branchman-mask{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1);padding:16px;box-sizing:border-box;overflow:hidden}
.dsh-branchman-card{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px;width:400px;max-width:100%;max-height:100%;box-sizing:border-box}
.dsh-branchman-card h3{margin:0 0 4px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-branchman-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.6;margin-bottom:12px}
.dsh-branchman-card input,.dsh-branchman-card textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;font-size:13px;margin-bottom:8px}
.dsh-branchman-card textarea{font:12px Inter,system-ui,sans-serif;resize:vertical;min-height:56px;margin-bottom:10px}
.dsh-branchman-card input::placeholder,.dsh-branchman-card textarea::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-branchman-row{display:flex;gap:8px;justify-content:flex-end;align-items:center}
.dsh-branchman-card button{border:1px solid transparent;border-radius:8px;padding:7px 14px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.dsh-branchman-go{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsh-branchman-go:hover{background:var(--dsw-alias-button-primary-hover)}
.dsh-branchman-go[disabled]{opacity:.55;cursor:default}
.dsh-branchman-no{background:transparent;border-color:var(--dsw-alias-button-ghost-active-border);color:var(--dsw-alias-label-secondary)}
.dsh-branchman-no:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-branchman-err{color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5;margin:8px 0 0;min-height:14px}
.dsh-branchman-status{color:var(--dsw-alias-label-tertiary);font-size:11px;margin:6px 0 0;min-height:14px}
/* The overview is a column that ALWAYS fits the window: the card is capped at
   the mask's inner box, the canvas eats whatever is left, and the detail panel
   scrolls instead of pushing the footer out. The old version had no max-height
   and a fixed 58vh canvas, so a short window clipped the title off the top and
   the buttons off the bottom — the flex centring pushed the overflow both ways. */
.dsh-branchman-overview{width:min(1040px,100%);padding:16px 18px;display:flex;flex-direction:column;gap:10px;overflow:hidden}
.dsh-branchman-overview>*{flex:0 0 auto}
.dsh-branchman-ovhead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-branchman-ovstats{font:500 11px Inter,system-ui,sans-serif;color:var(--dsw-alias-label-tertiary)}
.dsh-branchman-overview .dsh-branchman-hint{margin:0}
.dsh-branchman-canvas{flex:1 1 auto;min-height:150px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;cursor:grab;touch-action:none}
.dsh-branchman-canvas:active{cursor:grabbing}
.dsh-branchman-svg{width:100%;height:100%;display:block}
.dsh-branchman-edge{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:1.4}
.dsh-branchman-box{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l2);stroke-width:1.4}
.dsh-branchman-gnode{cursor:pointer}
.dsh-branchman-gnode:hover .dsh-branchman-box{stroke:var(--dsw-alias-brand-primary)}
.dsh-branchman-gnode.is-main .dsh-branchman-box{fill:var(--dsw-alias-bg-layer-4)}
.dsh-branchman-gnode.is-merged .dsh-branchman-box{stroke:var(--dsw-alias-state-success-primary)}
.dsh-branchman-gnode.is-dropped .dsh-branchman-box{stroke:var(--dsw-alias-border-l3);stroke-dasharray:4 3;fill:var(--dsw-alias-bg-layer-1)}
.dsh-branchman-t1{font:600 12px Inter,system-ui,sans-serif;fill:var(--dsw-alias-label-primary)}
.dsh-branchman-t2{font:11px Inter,system-ui,sans-serif;fill:var(--dsw-alias-label-tertiary)}
.dsh-branchman-gnode.is-dropped .dsh-branchman-t1{fill:var(--dsw-alias-label-dimmed)}
.dsh-branchman-detail{flex:0 1 380px;min-width:0;font-size:12px;line-height:1.75;color:var(--dsw-alias-label-secondary);overflow:auto;padding-left:14px;border-left:1px solid var(--dsw-alias-border-l2)}
.dsh-branchman-detname{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-branchman-detmeta{color:var(--dsw-alias-label-tertiary)}
.dsh-branchman-detpath{color:var(--dsw-alias-label-dimmed);word-break:break-all}
.dsh-branchman-link{border:0;background:transparent;color:var(--dsw-alias-link);font:600 11px Inter,system-ui,sans-serif;cursor:pointer;padding:2px 0}
.dsh-branchman-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:16px}
.dsh-branchman-stale{color:var(--dsw-alias-state-warn-label)}
/* Detail-panel operations. The overview used to be a picture: everything a
   direction waits for (merge / sync / drop) required going back to chat and
   typing a tool call. Tokens are the ones already proven in this file. */
.dsh-branchman-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);align-items:center}
.dsh-branchman-act{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:6px 12px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.dsh-branchman-act:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-branchman-act:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-branchman-act[disabled]{opacity:.5;cursor:default}
.dsh-branchman-act.is-danger{border-color:var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
/* Where the reader is, and the branch action that must not be missing from a
   map of "what has been branched so far". */
.dsh-branchman-gnode.is-here .dsh-branchman-box{stroke:var(--dsw-alias-brand-primary);stroke-width:2.5}
.dsh-branchman-here{font:600 10px Inter,system-ui,sans-serif;fill:var(--dsw-alias-brand-primary)}
/* Master–detail: the browsable surface on the left, the selected direction on
   the right. The list is the default because two to five directions do not need
   a canvas to be understood; the graph is still there, as the alternate pane.
   Every chip and dot on a row is decided by the pure nodeState/rowChips helpers,
   so a row and the panel below can never disagree. */
.dsh-branchman-ovbody{flex:1 1 auto;min-height:0;display:flex;gap:14px;align-items:stretch}
.dsh-branchman-vlist{flex:1 1 auto;min-width:0;overflow:auto;display:flex;flex-direction:column;gap:2px}
.dsh-branchman-vrow{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;text-align:left;background:transparent;border:1px solid transparent;border-radius:8px;padding:8px 10px;cursor:pointer;color:var(--dsw-alias-label-primary)}
.dsh-branchman-vrow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-branchman-vrow.is-on{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-brand-primary)}
.dsh-branchman-vrow.is-main{color:var(--dsw-alias-label-secondary)}
.dsh-branchman-vdot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.dsh-branchman-vdot.is-ok{background:var(--dsw-alias-state-success-primary)}
.dsh-branchman-vdot.is-warn{background:var(--dsw-alias-state-warn-label)}
.dsh-branchman-vdot.is-bad{background:var(--dsw-alias-label-error)}
.dsh-branchman-vname{flex:1 1 auto;min-width:0;font:600 13px Inter,system-ui,sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-branchman-vcol{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.dsh-branchman-vcol .dsh-branchman-vname{flex:0 1 auto}
.dsh-branchman-vsub{font:400 11px Inter,system-ui,sans-serif;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-branchman-detsub{flex:1 1 auto;min-width:0;font:400 11px Inter,system-ui,sans-serif;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-branchman-vchips{flex:0 0 auto;display:flex;gap:4px;align-items:center}
.dsh-branchman-heretag{flex:0 0 auto;font:600 10px Inter,system-ui,sans-serif;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-brand-primary);border-radius:999px;padding:0 6px}
.dsh-branchman-chip{font:500 10.5px Inter,system-ui,sans-serif;border-radius:999px;padding:1px 7px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1)}
.dsh-branchman-chip.is-ok{color:var(--dsw-alias-state-success-primary)}
.dsh-branchman-chip.is-warn{color:var(--dsw-alias-state-warn-label)}
.dsh-branchman-chip.is-bad{color:var(--dsw-alias-label-error)}
.dsh-branchman-tab{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-tertiary);border-radius:6px;padding:4px 10px;font:600 11px Inter,system-ui,sans-serif;cursor:pointer}
.dsh-branchman-tab:hover{color:var(--dsw-alias-label-primary)}
.dsh-branchman-tab.is-on{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.dsh-branchman-dethead{display:flex;align-items:center;gap:8px;margin-bottom:4px}
.dsh-branchman-more{margin-top:10px;border:0;background:transparent;color:var(--dsw-alias-link);font:600 11px Inter,system-ui,sans-serif;cursor:pointer;padding:2px 0}
.dsh-branchman-morebox{margin-top:6px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.dsh-branchman-ovnote{font:500 11px Inter,system-ui,sans-serif;color:var(--dsw-alias-label-dimmed);cursor:default}
.dsh-branchman-act.is-primary{border-color:var(--dsw-alias-button-primary-fill);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
/* View controls read as a toolbar, not as five equal buttons: the zoom group on
   the left, refresh and close on the right. */
.dsh-branchman-ovfoot{display:flex;gap:8px;align-items:center;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-branchman-grow{flex:1 1 auto}
.dsh-branchman-ovfoot .dsh-branchman-grow{flex:1 1 auto}
.dsh-branchman-note{font-size:11px;line-height:1.5;margin-top:6px;color:var(--dsw-alias-label-tertiary)}
.dsh-branchman-note.is-bad{color:var(--dsw-alias-label-error)}
.dsh-branchman-note.is-ok{color:var(--dsw-alias-state-success-primary)}
`

    // ── shared view state: the buttons open, the overlay renders ──────────
    // `shell.overlay` is a root-scoped list slot that is always mounted, so the
    // overlay component watches a module-level signal instead of being created
    // on click (which is what would have forced a DOM append).
    const view = { current: null }
    const watchers = new Set()
    const setView = next => {
      view.current = next
      for (const fn of Array.from(watchers)) { try { fn(next) } catch { /* stale watcher */ } }
    }
    const subscribeView = fn => {
      watchers.add(fn)
      return () => { watchers.delete(fn) }
    }
    const useView = () => {
      const [value, set] = React.useState(view.current)
      React.useEffect(() => subscribeView(set), [])
      return value
    }

    // ── pure layout (exported for the offline suites) ─────────────────────
    const NODE_W = 176
    const NODE_H = 56
    const H_GAP = 26
    const V_GAP = 58
    const VIEW_W = 960
    const VIEW_H = 520
    const clip = (text, max) => {
      const s = String(text ?? '')
      return s.length > max ? `${s.slice(0, max - 1)}…` : s
    }

    // 随手开是常态（名字随手填、描述空着），所以识别信息必须不依赖输入质量。
    // 这把尺子同时服务两处：标签侧把模板标题降级（下面 Overview），输入侧把
    // 预填名从模板标题之外的来源推导（ForkDialog 的 suggestDirectionName）。
    const BOILERPLATE_TITLE_RE = /^\s*reference attachments for (?:the )?goal objective\.?(?:\s*\(\d+\))?\s*$/i
    const slugifyName = raw => String(raw ?? '')
      .replace(/[\s\\/:*?"<>|'`[\]()（）·，。；：！？—…]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/g, '')
    const suggestDirectionName = () => {
      try {
        const snapshot = deps.sessions?.list?.getSnapshot?.() ?? {}
        const id = typeof snapshot.current === 'string' && snapshot.current !== '' ? snapshot.current : null
        if (id === null) return ''
        const row = snapshot.byId?.[id]
        // displayTitle 是侧栏级别的显示名（标题 → 目录名 → id 的回退链），title
        // 是裸标题；模板标题两个都不能要。
        for (const candidate of [row?.displayTitle, row?.title]) {
          if (typeof candidate !== 'string' || candidate === '') continue
          if (BOILERPLATE_TITLE_RE.test(candidate)) continue
          const slug = slugifyName(candidate)
          if (slug !== '') return slug
        }
        return ''
      } catch { return '' }
    }

    // One word for "how is this direction doing", shared by the list row and the
    // detail header so the two can never disagree about it. Returns a locale KEY
    // (not text) so the offline suite can test the precedence without a locale.
    // Order matters: a missing directory outranks everything, and a deleted
    // conversation outranks the archived flag, which outranks "in progress".
    const nodeState = node => {
      if (node.isMain === true) return { kind: 'main', key: 'state.main' }
      if (node.isTrunk === true) {
        return node.archived === true
          ? { kind: 'muted', key: 'state.trunkArchived' }
          : { kind: 'ok', key: 'state.trunk' }
      }
      if (node.status === 'dropped') return { kind: 'muted', key: 'state.dropped' }
      if (node.missingDir === true) return { kind: 'bad', key: 'state.missingDir' }
      if (node.sessionMissing === true) return { kind: 'warn', key: 'state.sessionMissing' }
      if (node.archived === true) return { kind: 'warn', key: 'state.archived' }
      if (node.status === 'merged') return { kind: 'ok', key: 'state.merged' }
      return { kind: 'ok', key: 'state.open' }
    }

    // The handful of facts worth putting on a row, in the order they matter:
    // uncommitted work first (it blocks merge/sync), then what the main line has
    // that this direction has not absorbed, then what it is ready to give back.
    const rowChips = (node, git) => {
      const chips = []
      if (node.isMain === true || node.isTrunk === true || node.status === 'dropped') return chips
      if (git === undefined || git.error !== undefined) return chips
      const dirty = Number(git.dirty ?? 0)
      const behind = Number(git.behind ?? 0)
      const ahead = Number(git.ahead ?? 0)
      if (dirty > 0) chips.push({ kind: 'warn', key: 'chip.dirty', params: { count: dirty } })
      if (behind > 0) chips.push({ kind: 'muted', key: 'chip.behind', params: { count: behind } })
      if (ahead > 0) chips.push({ kind: 'ok', key: 'chip.ahead', params: { count: ahead } })
      if (dirty === 0 && behind === 0 && ahead === 0) chips.push({ kind: 'muted', key: 'chip.clean' })
      return chips
    }
    // Tidy tree over the direction list: leaves take sequential slots, a parent
    // is centred over its children, and every level sinks by NODE_H + V_GAP.
    // A synthetic main-line root is drawn per REPO, because a direction is
    // literally a branch grown out of THAT repo's main line — the tree file is
    // global (one tree.json for every conversation), and hanging dsproject's
    // and fpga's directions under one "主线" quietly stole other repos into
    // whichever repo happened to be first.
    const layoutTree = (nodes, mainline = [], currentId = null) => {
      const list = Array.isArray(nodes) ? nodes : []
      // 空树也要有虚拟主线根（总览空态与自动选中都依赖它存在）。
      if (list.length === 0) {
        const root = { node: { name: '主线', isMain: true, status: 'main', cwd: '', root: '' }, main: true, children: [], cx: 0, cy: 0, depth: 0 }
        return { groups: [{ root, nodes: [], lastActive: '' }], root, width: NODE_W, height: NODE_H }
      }
      // 仓库根：优先节点自带的 root；没有就从 cwd 推导（<repo>/.branches/<名>
      // → <repo>），测试数据走的正是这条路。
      const repoRootOf = node => {
        const explicit = String(node.root ?? '').replace(/[\\/]+$/, '')
        if (explicit !== '') return explicit
        const cwd = String(node.cwd ?? '')
        const at = cwd.search(/[\\/]\.branches(?:[\\/]|$)/)
        return at > 0 ? cwd.slice(0, at) : cwd
      }
      // 主线对话（树干）：宿主按仓库根列出的、从没被分支过的现存对话。键与
      // 分组键同规（小写、去尾分隔符）。
      const trunkByRoot = new Map()
      for (const entry of Array.isArray(mainline) ? mainline : []) {
        const key = String(entry?.root ?? '').replace(/[\\/]+$/, '').toLowerCase()
        if (key === '' || !Array.isArray(entry.sessions)) continue
        trunkByRoot.set(key, entry.sessions)
      }
      const groups = new Map()
      for (const node of list) {
        const key = repoRootOf(node).replace(/[\\/]+$/, '').toLowerCase()
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(node)
      }
      const baseName = root => {
        const parts = String(root ?? '').split(/[\\/]/).filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : '主线'
      }
      let cursor = 0
      let maxDepth = 0
      const groupLayouts = []
      for (const [, groupNodes] of groups) {
        const byName = new Map(groupNodes.map(n => [n.name, n]))
        const kids = name => groupNodes.filter(n => n.parentName === name)
        const attach = node => ({ node, main: false, children: kids(node.name).map(attach), cx: 0, cy: 0, depth: 0 })
        // 父边只在本仓库内解析：parentName 指向别的仓库时，本仓库里它就是根。
        const repoRoots = groupNodes.filter(n => n.parentName === null || n.parentName === undefined || !byName.has(n.parentName))
        const rootPath = repoRootOf(groupNodes[0] ?? {})
        // 树干：这条主线上现存的对话。走向按 parentSessionId 长在具体的树干
        // 对话下——"从那条对话分叉"原本就是这个意思；对不上号的老走向退回
        // 直接挂在主线下。
        //
        // 但树干不必逐条上树：这张图讲的是分支的故事，只有**分叉点**（有走向
        // 从它长出来的对话）和你**当前所在**的对话是故事的一部分；其余日常
        // 对话属于侧栏，它们的数量计在主线行上（另有 N 条），不逐条刷屏。
        const forkParents = new Set(list
          .map(n => (typeof n.parentSessionId === 'string' && n.parentSessionId !== '' ? n.parentSessionId : null))
          .filter(Boolean))
        const allTrunk = trunkByRoot.get(rootPath.toLowerCase()) ?? []
        const visibleTrunk = allTrunk.filter(session =>
          typeof session?.sessionId === 'string' && session.sessionId !== ''
          && (forkParents.has(session.sessionId) || session.sessionId === currentId))
        const hiddenConversations = allTrunk.length - visibleTrunk.length
        const trunkEntries = new Map()
        const trunkChildren = []
        for (const session of visibleTrunk) {
          trunkChildren.push({
            node: {
              name: session.sessionId, isTrunk: true, status: 'trunk',
              sessionId: session.sessionId, cwd: session.cwd ?? rootPath, root: rootPath,
              archived: session.archived === true,
              ...(typeof session.title === 'string' && session.title !== '' ? { title: session.title } : {}),
            },
            main: false, children: [], cx: 0, cy: 0, depth: 0,
          })
          trunkEntries.set(session.sessionId, trunkChildren[trunkChildren.length - 1])
        }
        const mainChildren = [...trunkChildren]
        for (const node of repoRoots) {
          const entry = attach(node)
          const parentTrunk = typeof node.parentSessionId === 'string' ? trunkEntries.get(node.parentSessionId) : undefined
          if (parentTrunk !== undefined) parentTrunk.children.push(entry)
          else mainChildren.push(entry)
        }
        const root = {
          node: { name: `主线 · ${baseName(rootPath)}`, isMain: true, status: 'main', cwd: rootPath, root: rootPath, hiddenConversations },
          main: true,
          children: mainChildren,
          cx: 0,
          cy: 0,
          depth: 0,
        }
        const place = (entry, depth) => {
          let cx
          if (entry.children.length === 0) {
            cx = cursor
            cursor += NODE_W + H_GAP
          } else {
            const xs = entry.children.map(kid => place(kid, depth + 1).cx)
            cx = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2
          }
          entry.cx = cx
          entry.cy = depth * (NODE_H + V_GAP)
          entry.depth = depth
          if (depth > maxDepth) maxDepth = depth
          return entry
        }
        place(root, 0)
        // 组节点清单不含主线根自己（flatten 会把它算进去——列表里"主线"曾因此
        // 出现两次），只收真实的走向/树干节点，父先于子。
        const flatten = entry => entry.children.flatMap(child => [child.node, ...flatten(child)])
        const lastActive = groupNodes.reduce((latest, n) => {
          const at = String(n.lastActivityAt ?? '')
          return at > latest ? at : latest
        }, '')
        groupLayouts.push({ root, nodes: flatten(root), lastActive })
      }
      // 活跃仓库排前面：总览是张地图，读者所在的那片应最先出现。
      groupLayouts.sort((a, b) => String(b.lastActive).localeCompare(String(a.lastActive)))
      return {
        groups: groupLayouts,
        root: groupLayouts[0]?.root ?? null,
        width: Math.max(NODE_W, cursor - H_GAP),
        height: Math.max(NODE_H, maxDepth * (NODE_H + V_GAP) + NODE_H),
      }
    }

    // ── host dependencies, filled in by apply ─────────────────────────────
    // Components reach the host through this object instead of closing over the
    // context: the slot callbacks may run before/after apply in any order.
    const deps = {
      sessions: null,
      openSession: null,
      syncCatalog: async () => false,
    }

    // The "directions follow their repo in the sidebar" migration runs at most
    // once per page load, not once per mounted entry point.
    let followChecked = false

    // ── fork flow ─────────────────────────────────────────────────────────
    // The four steps and their degradation messages are the product of real
    // failures: a host-created session is unknown to the client catalogue until
    // `sessions.refresh()`, and an open failure must never be reported as a
    // failed direction.
    const runFork = async ({ name, brief, props }, report) => {
      const snapshot = deps.sessions?.list?.getSnapshot?.() ?? {}
      // Slot props are authoritative: the control belongs to the message it sits
      // under, while `current` can be undefined mid-switch — which silently
      // dropped the inherited history of the child session.
      const sourceId = props?.sessionId ?? snapshot.current ?? null
      const sourceTitle = snapshot.byId?.[sourceId]?.displayTitle ?? null
      const sourceCwd = snapshot.byId?.[sourceId]?.cwd ?? null
      report(tx('step.worktree'))
      const res = await fetch('/branchman/api/fork', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name, sourceSessionId: sourceId, sourceTitle, sourceCwd,
          // 一句话交接同时是这条走向的"内容摘要"（宿主存成 node.preview），
          // 随手开+空描述时才有树上的日志回退。
          brief: typeof brief === 'string' && brief.trim() !== '' ? brief.trim() : undefined,
          // The control belongs to the turn it is rendered under, and the only
          // handle the browser half gets is that turn's final message id. The
          // host turns it into the cut, so the child starts at THAT section
          // instead of at the tail of the conversation.
          messageId: typeof props?.messageId === 'string' ? props.messageId : undefined,
        }),
      })
      const forked = await res.json()
      if (!res.ok) throw new Error(forked.error || `HTTP ${res.status}`)

      let childId = typeof forked.sessionId === 'string' && forked.sessionId !== '' ? forked.sessionId : null
      if (childId === null) {
        report(tx('step.child'))
        childId = await deps.sessions.create({ cwd: forked.cwd })
        await fetch('/branchman/api/bind', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, sessionId: childId, sessionTitle: `走向 ${name}` }),
        }).catch(() => {})
      }

      report(tx('step.sync'))
      await deps.syncCatalog(childId)

      if (typeof brief === 'string' && brief !== '') {
        report(tx('step.handoff'))
        const scope = deps.sessions.scope(childId)
        const session = scope === undefined ? undefined : deps.sessions.sessionOf(scope)
        if (session !== undefined && typeof session.prompt === 'function') {
          const result = await session.prompt([{
            type: 'text',
            text: tx('msg.handoff', { name, source: sourceTitle ?? tx('ov.main'), cwd: forked.cwd, brief }),
          }], 'queue')
          if (result && result.ok === false) throw new Error(result.error?.message ?? 'handoff rejected')
        }
      }

      report(tx('step.open'))
      if (typeof deps.openSession !== 'function') {
        return { done: false, message: tx('msg.noWorkspace', { name, id: childId }) }
      }
      try {
        deps.openSession(childId)
      } catch (error) {
        return { done: false, message: tx('msg.openFailed', { name, id: childId, error: error.message }) }
      }
      if (forked.seeded === false) {
        return { done: true, message: tx('msg.noSeeded', { name }) }
      }
      // Registration failing does not fail the direction, but the user is the
      // only one who can see where the session landed — so say it rather than
      // let it show up as a session under 未分组 with no explanation.
      if (typeof forked.workspaceWarning === 'string' && forked.workspaceWarning !== '') {
        return { done: true, message: tx('msg.wsWarning', { name, warning: forked.workspaceWarning }) }
      }
      return { done: true, message: null }
    }

    // ── action buttons (React, inside the slots that allocate space) ──────
    const ActionButton = ({ label, title, onClick }) => React.createElement('button', {
      type: 'button',
      className: 'dsh-branchman-btn',
      title,
      onClick,
    }, label)

    const BranchAction = props => React.createElement(ActionButton, {
      label: tx('action.branch'),
      title: tx('action.branch.title'),
      onClick: () => setView({ kind: 'fork', props }),
    })

    // ── make a direction follow its parent workspace ──────────────────────
    // The host registry matches members by EXACT directory —
    // `sessionPath(id) === record.path`, and `mutate()` re-filters on *every*
    // write, while `attachSession` throws `its cwd resolves to '<x>'`. So a
    // direction, whose directory is a worktree, can never sit inside its repo's
    // workspace record. The only way it "follows" the parent is the sidebar's
    // own tree grouping, which the host already has: `owningParentFolder()`
    // nests a workspace under the longest registered ancestor that strictly
    // contains it, so `E:\repo\.branches\<dir>` lands under `E:\repo`.
    //
    // That preference is persisted in the renderer's localStorage
    // (`attachPersistence(api, name)` → `localStorage.getItem(name)`), and
    // `createWorkspaceViewStore()` is module-private inside
    // `dsh-client-ui-workspace.apply()` — there is no client service to call.
    // Writing the same key is the only handle available. Done ONCE, and only
    // while the user is still on the default, so a deliberate switch back to
    // 「按工作区」 is never fought.
    const VIEW_KEY = 'dsh.workspace.view.v5'
    const FOLLOW_MARK = 'dsh.branchman.followParent.v1'
    // Pure decision table, kept apart from the effects so the offline suite can
    // prove "a deliberate choice is never fought" without a DOM:
    //   no directions            → null (do nothing at all)
    //   nothing stored yet       → write the defaults, with tree grouping
    //   stored, still "workspace"→ write it back with ONLY groupBy changed
    //   stored, anything else    → record "skipped" and never look again
    //   stored, unparseable      → same as above: never clobber what we cannot read
    const planGrouping = (raw, hasDirections) => {
      if (hasDirections !== true) return null
      let view = null
      if (raw !== null) {
        try { view = JSON.parse(raw) } catch { return { mark: 'skipped', value: null } }
      }
      if (view !== null && (typeof view !== 'object' || view.groupBy !== 'workspace')) {
        return { mark: 'skipped', value: null }
      }
      return {
        mark: 'applied',
        value: view === null
          ? { groupBy: 'workspace-tree', orderBy: 'updated', groupExpansion: {}, sessionOrderByAccount: {}, archivedFilter: 'default' }
          : { ...view, groupBy: 'workspace-tree' },
      }
    }
    const followParentWorkspace = async () => {
      try {
        if (typeof localStorage === 'undefined') return
        if (localStorage.getItem(FOLLOW_MARK) !== null) return
        // `callApi` always POSTs, and the tree route is `req.method === 'GET'`
        // only — so this MUST be a plain GET. Getting it wrong made the whole
        // migration a silent no-op (the marker never appeared, the sidebar never
        // changed) — hence the explicit warn below instead of a bare catch.
        const response = await fetch('/branchman/api/tree').then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          return res.json()
        })
        const nodes = Array.isArray(response?.nodes) ? response.nodes : []
        const plan = planGrouping(localStorage.getItem(VIEW_KEY), nodes.length > 0)
        if (plan === null) return
        if (plan.value !== null) localStorage.setItem(VIEW_KEY, JSON.stringify(plan.value))
        localStorage.setItem(FOLLOW_MARK, plan.mark)
        // The workspace store reads localStorage once, at boot, so the new value
        // only lands on the next load. Do that one reload ourselves — otherwise
        // "directions follow their repo" needs a refresh the user has no reason
        // to expect. The marker is already written, so this can never loop.
        if (plan.mark === 'applied' && typeof location !== 'undefined' && typeof location.reload === 'function') {
          location.reload()
        }
      } catch (error) {
        // Still never break the page — but say so, because "swallowed" is how a
        // wrong HTTP method hid here for a whole round.
        console.warn('[branchman] could not switch the sidebar grouping:', error)
      }
    }
    const groupingFollowed = () => {
      try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(FOLLOW_MARK) === 'applied'
      } catch { return false }
    }

    const OverviewAction = () => {
      // Once per page load, from the always-mounted dock entry — opening the
      // overview should not be a prerequisite for the sidebar making sense.
      React.useEffect(() => {
        if (followChecked) return
        followChecked = true
        void followParentWorkspace()
      }, [])
      return React.createElement(ActionButton, {
        label: tx('action.overview'),
        title: tx('action.overview.title'),
        onClick: () => setView({ kind: 'overview' }),
      })
    }

    // ── fork dialog ───────────────────────────────────────────────────────
    const ForkDialog = ({ props, onClose }) => {
      // 随手开是常态：名字框预填一个从当前对话推导的 git 安全短名，回车两下
      // 就能得到可辨认的走向；想改名直接打字覆盖。
      const [name, setName] = React.useState(() => suggestDirectionName())
      const [brief, setBrief] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const submit = async () => {
        const trimmed = name.trim()
        if (trimmed === '') { setError(tx('err.nameRequired')); return }
        setError('')
        setBusy(true)
        try {
          const outcome = await runFork({ name: trimmed, brief: brief.trim(), props }, setStatus)
          if (outcome.done && outcome.message === null) { onClose(); return }
          // Established but not usable as expected: keep the dialog open with the
          // exact state so the user can act on it instead of guessing.
          setStatus('')
          setError(outcome.message ?? '')
        } catch (e) {
          setStatus('')
          setError(String(e.message || e))
        } finally {
          setBusy(false)
        }
      }

      return React.createElement('div', {
        className: 'dsh-branchman-mask',
        onClick: event => { if (event.target === event.currentTarget && !busy) onClose() },
      }, React.createElement('div', { className: 'dsh-branchman-card', role: 'dialog', 'aria-label': tx('dlg.title') },
        React.createElement('h3', null, tx('dlg.title')),
        React.createElement('div', { className: 'dsh-branchman-hint' }, tx('dlg.hint')),
        React.createElement('input', {
          autoFocus: true,
          maxLength: 60,
          placeholder: tx('dlg.name'),
          value: name,
          disabled: busy,
          onChange: event => setName(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') submit() },
        }),
        React.createElement('textarea', {
          placeholder: tx('dlg.brief'),
          value: brief,
          disabled: busy,
          onChange: event => setBrief(event.target.value),
        }),
        React.createElement('div', { className: 'dsh-branchman-row' },
          React.createElement('button', {
            type: 'button', className: 'dsh-branchman-no', disabled: busy, onClick: onClose,
          }, tx('dlg.cancel')),
          React.createElement('button', {
            type: 'button', className: 'dsh-branchman-go', disabled: busy, onClick: submit,
          }, tx('dlg.create')),
        ),
        React.createElement('div', { className: 'dsh-branchman-status' }, status),
        React.createElement('div', { className: 'dsh-branchman-err' }, error),
      ))
    }

    // ── overview (the story map) ──────────────────────────────────────────
    const Overview = ({ onClose }) => {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [selected, setSelected] = React.useState(null)
      // The graph used to be the whole surface. For the two-to-five directions a
      // repository actually has, a drawn tree with pan and zoom is mostly empty
      // space that has to be "fitted" before it is readable — so the list is the
      // default and the graph is the alternate view.
      const [mode, setMode] = React.useState('list')
      // Reference material (path, session id, branch ref) is behind 更多 — it is
      // not what you open this dialog to read.
      const [showMore, setShowMore] = React.useState(false)
      const [camera, setCamera] = React.useState({ x: 0, y: 0, k: 1 })
      const canvasRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const cameraRef = React.useRef(camera)
      cameraRef.current = camera
      // 画布实测尺寸：viewBox 跟着容器走（窗口/面板一变就重适配），不再写死
      // 960×520——那是"窗口一变图形就不跟"的根源。
      const [canvasSize, setCanvasSize] = React.useState({ w: VIEW_W, h: VIEW_H })
      React.useEffect(() => {
        const node = canvasRef.current
        if (node === null || typeof React.ResizeObserver !== 'function') return undefined
        const observer = new React.ResizeObserver(entries => {
          const rect = entries[0]?.contentRect
          if (rect !== undefined) setCanvasSize({ w: Math.max(1, rect.width), h: Math.max(1, rect.height) })
        })
        observer.observe(node)
        return () => observer.disconnect()
      }, [])

      // ── operations ──────────────────────────────────────────────────────
      // The overview is the one surface that knows every direction's state, so
      // it is also the only place the three things a direction waits for can be
      // one click away. Dropping is two-step: it deletes a worktree and a
      // branch, and an accidental single click would take unmerged work with it.
      const [busy, setBusy] = React.useState('')
      const [confirmDrop, setConfirmDrop] = React.useState('')
      const [note, setNote] = React.useState(null)
      // name → {ahead, behind, dirty} | {error}
      const [status, setStatus] = React.useState({})

      const callApi = React.useCallback(async (path, body) => {
        const res = await fetch(`/branchman/api/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`)
        return payload
      }, [])

      // Per-direction git state, from the same endpoint the agent tool uses.
      // Without it the operations are blind: merge and sync both refuse a dirty
      // worktree on the host, so the panel must show WHY before the click, not
      // as an error after it.
      const loadStatus = React.useCallback(async () => {
        try {
          const res = await fetch('/branchman/api/status')
          const body = await res.json()
          if (!res.ok) { setStatus({}); return {} }
          const map = {}
          for (const entry of Array.isArray(body?.directions) ? body.directions : []) {
            if (entry !== null && typeof entry === 'object' && typeof entry.name === 'string') map[entry.name] = entry
          }
          setStatus(map)
          return map
        } catch {
          // A status failure must not take the tree down with it.
          setStatus({})
          return {}
        }
      }, [])

      const load = React.useCallback(async () => {
        setError('')
        try {
          const res = await fetch('/branchman/api/tree')
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
          setData(body)
          await loadStatus()
          return body
        } catch (e) {
          setData(null)
          setError(String(e.message || e))
          return undefined
        }
      }, [loadStatus])

      const runOp = React.useCallback(async (kind, node) => {
        setBusy(kind)
        setNote(null)
        try {
          await callApi(kind, { name: node.name })
          const refreshed = await load()
          // Selection is held by value, so re-point it at the refreshed node —
          // otherwise the panel keeps showing the status the operation changed.
          if (refreshed !== undefined) {
            setSelected(previous => refreshed.nodes?.find(entry => entry.name === previous?.name) ?? previous)
          }
          setConfirmDrop('')
          setNote({ kind: 'ok', text: tx(`det.done.${kind}`) })
        } catch (e) {
          setNote({ kind: 'bad', text: String(e.message || e) })
        } finally {
          setBusy('')
        }
      }, [callApi, load])

      // Unarchiving needs BOTH halves — the host route registers the direction's
      // workspace first and then unarchives, because unarchiving a session that
      // owns no workspace only moves it from "hidden" to 未分组.
      const runUnarchive = React.useCallback(async node => {
        setBusy('unarchive')
        setNote(null)
        try {
          await callApi('unarchive', { name: node.name })
          const refreshed = await load()
          if (refreshed !== undefined) {
            setSelected(previous => refreshed.nodes?.find(entry => entry.name === previous?.name) ?? previous)
          }
          setNote({ kind: 'ok', text: tx('det.done.unarchive') })
        } catch (e) {
          setNote({ kind: 'bad', text: String(e.message || e) })
        } finally {
          setBusy('')
        }
      }, [callApi, load])

      React.useEffect(() => { load() }, [load])

      // Everything outside this dialog changes the tree too: archiving a
      // conversation from the sidebar, deleting one, removing a worktree by hand.
      // None of those fire anything the plugin can hear, so while the overview is
      // open it re-reads the (local, metadata-only) tree instead of showing a
      // snapshot of whenever it happened to be opened.
      React.useEffect(() => {
        const timer = setInterval(() => { void load() }, 4000)
        return () => clearInterval(timer)
      }, [load])

      const onPointerDown = event => {
        dragRef.current = { x: event.clientX, y: event.clientY, ...cameraRef.current }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }
      const onPointerMove = event => {
        const drag = dragRef.current
        if (drag === null) return
        setCamera({ k: drag.k, x: drag.vx + (event.clientX - drag.x), y: drag.vy + (event.clientY - drag.y) })
      }
      const onPointerUp = () => { dragRef.current = null }

      const switchTo = async node => {
        try {
          await deps.syncCatalog(node.sessionId)
          deps.openSession(node.sessionId)
          onClose()
        } catch (e) {
          setError(String(e.message || e))
        }
      }

      const nodes = Array.isArray(data?.nodes) ? data.nodes : []
      const live = nodes.filter(node => node.status !== 'dropped').length
      const stats = nodes.length === 0 ? tx('ov.none') : tx('ov.stats', { total: nodes.length, live })

      // ── 当前对话的定位：必须先于 layout（TDZ 实锤，见下） ────────────────
      // The tree is GLOBAL — one file for every conversation — so without this
      // the overview reads as "branching belongs to the conversations already
      // in it", which is exactly backwards. Mark where the reader is, and offer
      // the branch action from here so the map is a starting point and not a
      // record of past use.
      const currentId = (() => {
        const snapshot = deps.sessions?.list?.getSnapshot?.() ?? {}
        return typeof snapshot.current === 'string' && snapshot.current !== '' ? snapshot.current : null
      })()
      // 当前对话自己的 cwd：它落在哪个仓库根下，那棵"主线"才是"你在这里"。
      const currentCwd = (() => {
        if (currentId === null) return null
        const cwd = deps.sessions?.list?.getSnapshot?.()?.byId?.[currentId]?.cwd
        return typeof cwd === 'string' && cwd !== '' ? cwd : null
      })()
      const directionIds = new Set(nodes.map(node => node.sessionId).filter(id => typeof id === 'string'))
      // Where the reader is. A main line "is current" precisely when the open
      // conversation lives under THAT repo root and is not one of the
      // directions; a direction is current when it IS the open conversation.
      const isCurrent = node => node.isMain === true
        ? (currentCwd !== null && typeof node.root === 'string' && node.root !== ''
          && currentCwd.toLowerCase().startsWith(node.root.toLowerCase())
          && !directionIds.has(currentId))
        : node.sessionId === currentId
      const isHere = entry => isCurrent(entry.node)

      // ── 图形相机：必须在 currentId/directionIds 之后声明 ────────────────
      // layout 的树干可见性依赖 currentId；fit/zoom 依赖 layout。声明顺序错
      // 一行就是 TDZ（'Cannot access currentId before initialization'，2026-10-01
      // 实锤踩过：总览整个打不开）。
      const layout = React.useMemo(() => (data === null ? null : layoutTree(data.nodes, data.mainline, currentId)), [data, currentId])

      const fit = React.useCallback(() => {
        if (layout === null) return
        const k = Math.min(1.15, Math.min((canvasSize.w - 24) / Math.max(1, layout.width), (canvasSize.h - 24) / Math.max(1, layout.height)))
        setCamera({ k, x: (canvasSize.w - layout.width * k) / 2, y: (canvasSize.h - layout.height * k) / 2 })
      }, [layout, canvasSize.w, canvasSize.h])

      // 缩放围绕一个锚点（滚轮=光标，按钮=画布中心）：图形在光标下不漂移。
      const zoomAt = React.useCallback((factor, px, py) => {
        setCamera(previous => {
          const k = Math.max(0.2, Math.min(2.5, previous.k * factor))
          const scale = k / previous.k
          return { k, x: px - (px - previous.x) * scale, y: py - (py - previous.y) * scale }
        })
      }, [])
      const zoom = React.useCallback(factor => {
        zoomAt(factor, canvasSize.w / 2, canvasSize.h / 2)
      }, [zoomAt, canvasSize.w, canvasSize.h])

      React.useEffect(() => { fit() }, [fit])

      // Wheel zoom needs a non-passive listener: React attaches wheel handlers
      // passively, so preventDefault inside onWheel is ignored (page scrolls).
      React.useEffect(() => {
        const node = canvasRef.current
        if (node === null) return undefined
        const onWheel = event => {
          event.preventDefault()
          // 以光标为锚点缩放：指哪放大哪，图形不会朝屏幕中心漂。
          const rect = node.getBoundingClientRect()
          zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - rect.left, event.clientY - rect.top)
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [zoomAt])

      // The sidebar shows session TITLES — but a cold goal session's title is
      // always the same boilerplate, and an ARCHIVED direction is not in the
      // sidebar at all. So titles alone cannot identify a row: the tree also
      // carries a content preview per node (host: /goal objective or first
      // genuine human message, cached in tree.json). Labels lead with whatever
      // actually distinguishes the conversation:
      //   usable title  → title first, preview second
      //   boilerplate   → preview first, branch name second
      //   nothing       → branch name, exactly like the old rows
      const BOILERPLATE_TITLE_RE = /^\s*reference attachments for (?:the )?goal objective\.?(?:\s*\(\d+\))?\s*$/i
      const titleOf = sessionId => {
        if (typeof sessionId !== 'string' || sessionId === '') return null
        const row = deps.sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
        const title = row?.title
        return typeof title === 'string' && title !== '' ? title : null
      }
      const previewOf = node => (typeof node?.preview === 'string' && node.preview !== '' ? node.preview : null)
      // 宿主直接给的字段标题（树干节点带，走向节点不带）：快照缺标题时的兜底。
      const hostTitleOf = node => (typeof node?.title === 'string' && node.title !== '' ? node.title : null)
      const usableTitleOf = node => {
        const title = titleOf(node.sessionId) ?? hostTitleOf(node)
        return title !== null && !BOILERPLATE_TITLE_RE.test(title) ? title : null
      }
      // Cold titles only land in the snapshot once the projections are pulled;
      // ask once per open (the 4s poll re-renders and picks them up as they
      // arrive). Best effort — a host without refresh still gets live titles
      // for every session it already knows.
      React.useEffect(() => {
        try { void deps.sessions?.refresh?.() } catch { /* older host */ }
      }, [])

      // The operations live in the detail panel, and the panel used to stay
      // empty until a box was clicked — so opening the overview showed a picture
      // and nothing to do with it, which reads exactly like "no operations".
      // Pick something on open: your own conversation if it is a direction, else
      // the most recently active live one, else the main line. Declared here, not
      // with the other effects, because the dependency array is evaluated during
      // render and `nodes` / `currentId` are not initialized yet up there.
      React.useEffect(() => {
        if (selected !== null || layout === null) return
        const newest = nodes
          .filter(node => node.status !== 'dropped')
          .slice()
          .sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')))[0]
        // 自动选中：你所在的对话（走向或树干）优先，其次最近活跃的走向，
        // 最后才是第一棵主线的根。flatAll 覆盖树干节点。
        const flatAll = layout.groups.flatMap(group => group.nodes)
        setSelected(flatAll.find(node => node.sessionId === currentId) ?? newest ?? flatAll[0] ?? layout.root.node)
      }, [layout, selected, nodes, currentId])

      const renderNode = entry => {
        const cls = entry.main
          ? 'dsh-branchman-gnode is-main'
          : entry.node.status === 'dropped'
            ? 'dsh-branchman-gnode is-dropped'
            : entry.node.status === 'merged' ? 'dsh-branchman-gnode is-merged' : 'dsh-branchman-gnode'
        // Same pairing as the list rows: whatever distinguishes the
        // conversation on top (usable title, else preview), identity underneath.
        // 树干节点例外：直接用宿主标题（快照缺冷标题时不至于显示裸 id）。
        const nodeTitle = entry.main ? null : usableTitleOf(entry.node)
        const nodePreview = entry.main ? null : previewOf(entry.node)
        const trunkLabel = entry.node.isTrunk === true
          ? (titleOf(entry.node.sessionId) ?? hostTitleOf(entry.node) ?? `会话 ${String(entry.node.sessionId).slice(5, 13)}`)
          : null
        return React.createElement(React.Fragment, { key: `${entry.node.name}-${entry.depth}-${entry.cx}` },
          entry.children.map(child => React.createElement('path', {
            key: `e-${child.node.name}`,
            className: 'dsh-branchman-edge',
            d: `M ${entry.cx + NODE_W / 2} ${entry.cy + NODE_H} C ${entry.cx + NODE_W / 2} ${(entry.cy + NODE_H + child.cy) / 2}, ${child.cx + NODE_W / 2} ${(entry.cy + NODE_H + child.cy) / 2}, ${child.cx + NODE_W / 2} ${child.cy}`,
          })),
          React.createElement('g', {
            className: isHere(entry) ? `${cls} is-here` : cls,
            transform: `translate(${entry.cx} ${entry.cy})`,
            onClick: () => setSelected(entry.node),
            role: 'button',
            tabIndex: 0,
          },
          // Above the box: the incoming edge lands at the box's top centre, so
          // the left-aligned marker never collides with it.
          isHere(entry)
            ? React.createElement('text', { className: 'dsh-branchman-here', x: 2, y: -8 },
              `● ${entry.main === true ? tx('ov.currentMain') : tx('ov.here')}`)
            : null,
          React.createElement('rect', { className: 'dsh-branchman-box', width: NODE_W, height: NODE_H, rx: 10 }),
          React.createElement('text', { className: 'dsh-branchman-t1', x: 12, y: 24 },
            entry.main ? entry.node.name : clip(trunkLabel ?? nodeTitle ?? nodePreview ?? entry.node.name, 17)),
          React.createElement('text', { className: 'dsh-branchman-t2', x: 12, y: 42 },
            entry.main
              ? clip(entry.node.cwd ?? '', 22)
              : entry.node.isTrunk === true
                ? tx('state.trunk')
                : clip(nodeTitle !== null ? (nodePreview ?? entry.node.name) : entry.node.name, 22))),
          entry.children.map(renderNode),
        )
      }

      // A row is the whole story at a glance: state dot, name, where you are,
      // what git says, and one word for the state. Everything on it is decided
      // by the pure helpers above, so the row and the detail panel cannot drift
      // apart. Rows are buttons: selecting one is the only way to get actions,
      // and a bare box in a canvas never advertised that.
      const listRow = node => {
        const state = nodeState(node)
        const chips = rowChips(node, status[node.name])
        // Lead with whatever distinguishes the conversation (usable title, else
        // content preview); the second line is the other half of the pair, or
        // the branch name when there is nothing else. No title/preview at all
        // degrades to the old single-name row.
        //
        // 三类节点的标签来源不同：
        //   主线（结构节点）→ '主线 · <目录名>'，无副行——它是地点不是对话；
        //   树干（主线上现存的对话）→ 会话标题（快照→宿主→短 id 兜底）；
        //   走向 → 可用标题优先、摘要次之，最后退回分支名。
        const title = usableTitleOf(node)
        const preview = previewOf(node)
        const trunkLabel = node.isTrunk === true
          ? (titleOf(node.sessionId) ?? hostTitleOf(node) ?? `会话 ${String(node.sessionId).slice(5, 13)}`)
          : null
        const primary = node.isMain === true
          ? node.name
          : node.isTrunk === true
            ? trunkLabel
            : (title ?? preview ?? node.name)
        const sub = node.isMain === true
          ? (Number(node.hiddenConversations ?? 0) > 0
            ? tx('ov.moreConversations', { count: node.hiddenConversations })
            : null)
          : node.isTrunk === true
            ? null
            : primary === title
              ? (preview ?? (title !== node.name ? node.name : null))
              : node.name
        const rowHint = node.isMain === true ? tx('ov.mainHint') : undefined
        return React.createElement('button', {
          key: `row-${node.name}-${node.isMain === true ? 'main' : 'dir'}`,
          type: 'button',
          title: rowHint,
          className: `dsh-branchman-vrow${selected !== null && selected.name === node.name ? ' is-on' : ''}${node.isMain === true ? ' is-main' : ''}`,
          onClick: () => setSelected(node),
        },
          React.createElement('span', { className: `dsh-branchman-vdot is-${state.kind}` }),
          React.createElement('span', { className: 'dsh-branchman-vcol' },
            React.createElement('span', { className: 'dsh-branchman-vname' }, primary),
            sub !== null ? React.createElement('span', { className: 'dsh-branchman-vsub' }, sub) : null),
          isCurrent(node)
            ? React.createElement('span', { className: 'dsh-branchman-heretag' }, tx('ov.here'))
            : null,
          React.createElement('span', { className: 'dsh-branchman-vchips' },
            chips.map((chip, index) => React.createElement('span', {
              key: `chip-${index}`, className: `dsh-branchman-chip is-${chip.kind}`,
            }, tx(chip.key, chip.params)))),
          React.createElement('span', { className: `dsh-branchman-chip is-${state.kind}` }, tx(state.key)))
      }
      // 列表按仓库分组铺开：每棵主线后跟它自己的走向（父先于子）。
      const listRows = layout === null ? [] : layout.groups.flatMap(group => [group.root.node, ...group.nodes])

      const detail = () => {
        if (selected === null) {
          return React.createElement('div', { className: 'dsh-branchman-detail' }, tx('ov.pickHint'))
        }
        const node = selected
        // Git state for this direction, if the status endpoint has answered yet.
        // `dirty` gates merge/sync, because the host refuses both on a dirty
        // worktree — the panel shows the reason before the click.
        const git = status[node.name]
        const dirty = git !== undefined && git.error === undefined && (git.dirty ?? 0) > 0
        const stale = node.lastActivityAt !== undefined && node.lastActivityAt !== null
          && (Date.now() - new Date(node.lastActivityAt).getTime()) / 86400000 > 3
        // ── actions ───────────────────────────────────────────────────────
        // Ordered by what you actually came here to do. Before this, every
        // operation was visible at once and split across two places, so none of
        // them read as "the thing to do" — 切到该会话, 取消归档, 同步, 合并,
        // 拆除 all carried equal weight and equal styling.
        const hasSession = typeof node.sessionId === 'string' && node.sessionId !== ''
        const isMain = node.isMain === true
        const isTrunk = node.isTrunk === true
        const dropped = node.status === 'dropped'
        const opsReady = data?.capabilities?.operations === true
        const broken = node.missingDir === true || node.sessionMissing === true
        const archived = node.archived === true
        const canSwitch = hasSession && typeof deps.openSession === 'function'
        // Merge and sync refuse a dirty worktree on the host, so they are shown
        // disabled with the reason rather than failing after the click.
        const act = (kind, label, opts = {}) => React.createElement('button', {
          type: 'button',
          className: `dsh-branchman-act${opts.primary === true ? ' is-primary' : ''}${opts.danger === true ? ' is-danger' : ''}`,
          disabled: busy !== '' || opts.blocked === true,
          title: opts.title,
          onClick: () => {
            if (kind === 'switch') return switchTo(node)
            if (kind === 'unarchive') return runUnarchive(node)
            if (opts.danger === true) { setConfirmDrop(node.name); setNote(null); return }
            runOp(kind, node)
          },
        }, label)
        const archivedIsPrimary = opsReady && hasSession && archived
        const openIsPrimary = !archivedIsPrimary && canSwitch && dropped !== true && broken !== true
        // 树干是对话本身，不是工程操作的对象：只有一个动作——打开它。
        const actions = isMain
          ? null
          : isTrunk === true
            ? [canSwitch
              ? act('switch', tx('det.open'), { primary: true, title: tx('det.open.title') })
              : React.createElement('span', { key: 'trunk', className: 'dsh-branchman-note' }, tx('det.session', { id: node.sessionId }))]
              .filter(Boolean)
          : opsReady === false
            // The browser half reloads on a page refresh, the host half only on a
            // full restart. Offering a control whose route does not exist yet
            // turns a refresh into a row of 404s.
            ? [React.createElement('span', { key: 'pending', className: 'dsh-branchman-note' }, tx('det.opsPending'))]
            : [
            archivedIsPrimary
              ? act('unarchive', tx('det.unarchive'), { primary: true, title: tx('det.unarchive.title') })
              : openIsPrimary
                ? act('switch', tx('det.open'), { primary: true, title: tx('det.open.title') })
                : null,
            dropped !== true && node.status === 'open'
              ? act('sync', tx('det.sync'), { blocked: dirty, title: tx('det.sync.title') })
              : null,
            dropped !== true && node.status === 'open'
              ? act('merge', tx('det.merge'), { blocked: dirty, title: tx('det.merge.title') })
              : null,
            // Unarchiving is only ever offered once, and never twice: when it is
            // the primary action above it does not repeat down here.
            !archivedIsPrimary && opsReady && hasSession && archived
              ? act('unarchive', tx('det.unarchive'), { title: tx('det.unarchive.title') })
              : null,
            dropped === true
              ? null
              : confirmDrop === node.name
                ? React.createElement(React.Fragment, null,
                  React.createElement('span', { className: 'dsh-branchman-detmeta' }, tx('det.dropConfirm', { name: node.name })),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-branchman-act is-danger', disabled: busy !== '',
                    onClick: () => runOp('drop', node),
                  }, tx('det.dropYes')),
                  React.createElement('button', {
                    type: 'button', className: 'dsh-branchman-act', disabled: busy !== '',
                    onClick: () => setConfirmDrop(''),
                  }, tx('det.cancel')))
                : act('drop', tx('det.drop'), { danger: true, title: tx('det.drop.title') }),
            busy === '' ? null : React.createElement('span', { className: 'dsh-branchman-detmeta' }, tx('det.busy')),
          ].filter(part => part !== null && part !== undefined && part !== false)

        // Only what is a decision stays on arrival. The directory path and the
        // 36-character session id are reference material — they used to be the
        // second and third things on screen.
        const facts = []
        if (isMain !== true) {
          if (Number(node.inheritedEvents ?? 0) > 0) facts.push(tx('det.inherited', { count: node.inheritedEvents }))
          if (Number(node.messageCount ?? 0) > 0) facts.push(tx('det.messages', { count: node.messageCount }))
        }
        if (node.lastActivityAt !== undefined && node.lastActivityAt !== null) {
          facts.push(tx('det.lastActive', { time: new Date(node.lastActivityAt).toLocaleString() }))
        }
        const warnings = []
        if (node.missingDir === true) warnings.push(tx('det.missingDir'))
        if (node.sessionMissing === true) warnings.push(tx('det.sessionMissing'))
        if (archived && hasSession) warnings.push(tx('det.archived'))
        if (isMain !== true && hasSession !== true) warnings.push(tx('det.missing'))
        if (stale) warnings.push(tx('det.stale'))
        if (dirty) warnings.push(tx('det.dirtyBlock'))
        const more = [
          React.createElement('div', { className: 'dsh-branchman-detpath', key: 'path' },
            tx('det.path', { path: node.cwd ?? '' })),
          previewOf(node) !== null
            ? React.createElement('div', { className: 'dsh-branchman-detpath', key: 'preview' },
              tx('det.preview', { preview: previewOf(node) }))
            : null,
          titleOf(node.sessionId) !== null
            ? React.createElement('div', { className: 'dsh-branchman-detpath', key: 'title' },
              tx('det.sessionTitle', { title: titleOf(node.sessionId) }))
            : null,
          hasSession
            ? React.createElement('div', { className: 'dsh-branchman-detpath', key: 'sid' },
              tx('det.session', { id: node.sessionId }))
            : null,
          node.branch !== undefined && node.branch !== null
            ? React.createElement('div', { className: 'dsh-branchman-detpath', key: 'branch' },
              tx('det.branch', { branch: String(node.branch) }))
            : null,
        ].filter(Boolean)
        const state = nodeState(node)
        return React.createElement('div', { className: 'dsh-branchman-detail' },
          React.createElement('div', { className: 'dsh-branchman-dethead' },
            React.createElement('span', { className: 'dsh-branchman-detname' },
              node.isTrunk === true
                ? (titleOf(node.sessionId) ?? hostTitleOf(node) ?? `会话 ${String(node.sessionId).slice(5, 13)}`)
                : node.name),
            (() => {
              // Whatever identifies this conversation next to the branch name:
              // the session title when it says something, else the preview.
              // 树干节点标题已在主名位置，副行跳过避免重复。
              if (node.isTrunk === true) return null
              const title = usableTitleOf(node)
              const preview = previewOf(node)
              const sub = title ?? preview
              return sub !== null
                ? React.createElement('span', { className: 'dsh-branchman-detsub' }, sub)
                : null
            })(),
            React.createElement('span', { className: `dsh-branchman-chip is-${state.kind}` }, tx(state.key))),
          facts.length === 0
            ? null
            : React.createElement('div', { className: 'dsh-branchman-detmeta' }, facts.join(' · ')),
          isMain || isTrunk
            ? null
            : React.createElement('div', { className: 'dsh-branchman-detmeta' },
              git === undefined
                ? tx('det.gitLoading')
                : git.error !== undefined ? tx('det.gitUnknown') : tx('det.git', {
                  ahead: git.ahead, behind: git.behind, dirty: git.dirty,
                })),
          warnings.map((text, index) => React.createElement('div', {
            className: 'dsh-branchman-stale', key: `w${index}`,
          }, text)),
          actions === null || actions.length === 0
            ? null
            : React.createElement('div', { className: 'dsh-branchman-actions' }, actions),
          React.createElement('button', {
            type: 'button', className: 'dsh-branchman-more',
            onClick: () => setShowMore(value => !value),
          }, tx(showMore ? 'det.less' : 'det.more')),
          showMore ? React.createElement('div', { className: 'dsh-branchman-morebox' }, more) : null,
          note === null ? null : React.createElement('div', {
            className: note.kind === 'ok' ? 'dsh-branchman-note is-ok' : 'dsh-branchman-note is-bad',
          }, note.text))
      }

      return React.createElement('div', {
        className: 'dsh-branchman-mask',
        onClick: event => { if (event.target === event.currentTarget) onClose() },
      }, React.createElement('div', { className: 'dsh-branchman-card dsh-branchman-overview', role: 'dialog', 'aria-label': tx('ov.title') },
        // One header, one primary entry point, one view switch. There used to be
        // two paragraphs of explanation and a third row of chrome stacked above
        // the content — reading was the price of admission.
        React.createElement('div', { className: 'dsh-branchman-ovhead' },
          React.createElement('h3', null, tx('ov.title')),
          React.createElement('span', { className: 'dsh-branchman-ovstats' }, stats),
          React.createElement('span', { className: 'dsh-branchman-grow' }),
          React.createElement('button', {
            type: 'button', className: `dsh-branchman-tab${mode === 'list' ? ' is-on' : ''}`,
            onClick: () => setMode('list'),
          }, tx('ov.viewList')),
          React.createElement('button', {
            type: 'button', className: `dsh-branchman-tab${mode === 'graph' ? ' is-on' : ''}`,
            onClick: () => setMode('graph'),
          }, tx('ov.viewGraph')),
          React.createElement('button', {
            type: 'button', className: 'dsh-branchman-act is-primary', title: tx('ov.branchHere.title'),
            onClick: () => { onClose(); setView({ kind: 'fork', props: { sessionId: currentId ?? undefined } }) },
          }, tx('ov.branchHere'))),
        // Master–detail: the browsable surface on the left, the selected
        // direction on the right. The graph is now the alternate left pane
        // rather than the whole dialog.
        React.createElement('div', { className: 'dsh-branchman-ovbody' },
          mode === 'graph'
            ? React.createElement('div', {
              className: 'dsh-branchman-canvas',
              ref: canvasRef,
              onPointerDown,
              onPointerMove,
              onPointerUp,
              onPointerCancel: onPointerUp,
              onDoubleClick: () => fit(),
            }, nodes.length === 0 || layout === null
              ? React.createElement('div', { className: 'dsh-branchman-empty' }, tx('ov.empty'))
              : React.createElement('svg', {
                className: 'dsh-branchman-svg',
                viewBox: `0 0 ${canvasSize.w} ${canvasSize.h}`,
                preserveAspectRatio: 'xMidYMid meet',
              }, React.createElement('g', {
                transform: `translate(${Math.round(camera.x)} ${Math.round(camera.y)}) scale(${camera.k.toFixed(3)})`,
              }, layout.groups.map(group => renderNode(group.root)))))
            : React.createElement('div', { className: 'dsh-branchman-vlist' },
              nodes.length === 0
                ? React.createElement('div', { className: 'dsh-branchman-empty' }, tx('ov.empty'))
                : listRows.map(listRow)),
          detail()),
        React.createElement('div', { className: 'dsh-branchman-ovfoot' },
          // The grouping note is one chip with the full explanation on hover —
          // it is context, not something to read on arrival.
          React.createElement('span', {
            className: 'dsh-branchman-ovnote',
            title: tx(groupingFollowed() ? 'ov.groupingDone' : 'ov.grouping'),
          }, tx(groupingFollowed() ? 'ov.groupingShort' : 'ov.groupingShortOff')),
          React.createElement('span', { className: 'dsh-branchman-grow' }),
          mode === 'graph'
            ? React.createElement(React.Fragment, null,
              React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: () => zoom(1 / 1.2) }, tx('ov.zoomOut')),
              React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: () => zoom(1.2) }, tx('ov.zoomIn')),
              React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: fit }, tx('ov.fit')))
            : null,
          React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: load }, tx('ov.refresh')),
          React.createElement('button', { type: 'button', className: 'dsh-branchman-go', onClick: onClose }, tx('ov.close'))),
        React.createElement('div', { className: 'dsh-branchman-err' }, error)))
    }

    // The overlay surface: one component, watching the signal above.
    const Overlay = () => {
      const current = useView()
      if (current === null) return null
      const close = () => setView(null)
      if (current.kind === 'fork') return React.createElement(ForkDialog, { props: current.props, onClose: close })
      return React.createElement(Overview, { onClose: close })
    }

    module.exports.inject = ['slots', 'sessions']
    module.exports.apply = ctx => {
      // Styles: one element for the plugin, owned by an effect.
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      }, 'branchman: styles')

      // Locale: register the dictionary and bind `t`. Absence is fine — `tx`
      // falls back to the inlined Chinese copy.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['locale'], child => {
          const locale = child.locale
          if (locale === undefined || typeof locale.register !== 'function') return
          try {
            locale.register(NS, DICT)
            bound = locale.bind(NS)
          } catch { /* keep the fallback */ }
        })
      }

      // Session switching goes through uiWorkspace.openSession — the native
      // branch button uses the same call. Reading ctx.uiWorkspace directly throws
      // ("cannot get property ... without inject"), and ctx.sessions has no open.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiWorkspace'], child => {
          const workspace = child.uiWorkspace
          if (workspace !== undefined && typeof workspace.openSession === 'function') {
            deps.openSession = id => workspace.openSession(id)
          }
        })
      }
      deps.sessions = ctx.sessions

      // A session the host created is unknown to the Client catalogue until
      // `sessions.refresh()` pulls the real baseline; opening it first fails at
      // `sessions.retain` with "unknown session". Poll a few times for hosts
      // without refresh.
      deps.syncCatalog = async (id, attempts = 6) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (ctx.sessions.list?.getSnapshot?.()?.byId?.[id] !== undefined) return true
          try { await ctx.sessions.refresh?.() } catch { /* older host: poll */ }
          await new Promise(resolve => setTimeout(resolve, 150))
        }
        return ctx.sessions.list?.getSnapshot?.()?.byId?.[id] !== undefined
      }

      const ASSISTANT_ACTIONS = 'conversation.chat.assistant-actions'
      ctx.slots.inject(ASSISTANT_ACTIONS, () => ctx.slots.register({
        name: ASSISTANT_ACTIONS, id: 'dsh-branchman-branch-button', order: 50,
      }, BranchAction))
      ctx.slots.inject(ASSISTANT_ACTIONS, () => ctx.slots.register({
        name: ASSISTANT_ACTIONS, id: 'dsh-branchman-tree-button', order: 51,
      }, OverviewAction))
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'dsh-branchman-tree-dock', order: 60,
      }, OverviewAction))
      // Overlays belong to the root-scoped `shell.overlay` list, not to a div
      // appended to document.body.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'dsh-branchman-overlay', order: 60, locale: NS,
      }, Overlay))
    }

    // Pure helpers for the offline suites (`test/client.mjs`): the layout must be
    // verifiable without a DOM, and the suites deliberately do not emulate React.
    module.exports.__test = { layoutTree, clip, NODE_W, NODE_H, H_GAP, V_GAP, VIEW_W, VIEW_H, DICT, planGrouping, nodeState, rowChips }

    return module.exports
  },
})
