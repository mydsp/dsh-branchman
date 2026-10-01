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
        'dlg.hint': 'git worktree + 完整历史子会话（工作区自动切到 .branches\\<名>）+ 树上自动连线',
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
        'ov.main': '◆ 主线',
        'ov.mainDetail': '主线（工作区主目录）',
        'det.inherited': '继承 {count} 事件',
        'det.messages': '{count} 条消息',
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
        'det.unarchive': '取消归档',
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
        'dlg.hint': 'git worktree + a child session with inherited history (its cwd switches to .branches\\<name>) + an edge in the tree',
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
        'ov.main': '◆ main',
        'ov.mainDetail': 'Main line (the workspace’s main directory)',
        'det.inherited': '{count} inherited events',
        'det.messages': '{count} messages',
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
        'det.unarchive': 'Unarchive',
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
.dsh-branchman-mask{position:absolute;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-mask-1)}
.dsh-branchman-card{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px;width:400px;max-width:92vw}
.dsh-branchman-card h3{margin:0 0 4px;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-branchman-hint{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5;margin-bottom:12px}
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
.dsh-branchman-overview{width:min(1040px,94vw);max-width:94vw;padding:16px 18px}
.dsh-branchman-ovhead{display:flex;align-items:baseline;gap:10px}
.dsh-branchman-ovstats{font:500 11px Inter,system-ui,sans-serif;color:var(--dsw-alias-label-tertiary)}
.dsh-branchman-canvas{height:58vh;min-height:340px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;cursor:grab;margin-bottom:10px;touch-action:none}
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
.dsh-branchman-detail{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);min-height:46px}
.dsh-branchman-detname{font-weight:600;color:var(--dsw-alias-label-primary)}
.dsh-branchman-detmeta{color:var(--dsw-alias-label-tertiary)}
.dsh-branchman-detpath{color:var(--dsw-alias-label-dimmed);word-break:break-all}
.dsh-branchman-link{border:0;background:transparent;color:var(--dsw-alias-link);font:600 11px Inter,system-ui,sans-serif;cursor:pointer;padding:2px 0}
.dsh-branchman-empty{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:16px}
.dsh-branchman-stale{color:var(--dsw-alias-state-warn-label)}
/* Detail-panel operations. The overview used to be a picture: everything a
   direction waits for (merge / sync / drop) required going back to chat and
   typing a tool call. Tokens are the ones already proven in this file. */
.dsh-branchman-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;align-items:center}
.dsh-branchman-act{border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:4px 10px;font:600 11px Inter,system-ui,sans-serif;cursor:pointer}
.dsh-branchman-act:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-branchman-act:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-branchman-act[disabled]{opacity:.5;cursor:default}
.dsh-branchman-act.is-danger{border-color:var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}
/* Where the reader is, and the branch action that must not be missing from a
   map of "what has been branched so far". */
.dsh-branchman-gnode.is-here .dsh-branchman-box{stroke:var(--dsw-alias-brand-primary);stroke-width:2.5}
.dsh-branchman-here{font:600 10px Inter,system-ui,sans-serif;fill:var(--dsw-alias-brand-primary)}
.dsh-branchman-ovadd{margin:0 0 10px}
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
    // Tidy tree over the direction list: leaves take sequential slots, a parent
    // is centred over its children, and every level sinks by NODE_H + V_GAP.
    // A synthetic main-line root is drawn explicitly, because a direction is
    // literally a branch grown out of the main line.
    const layoutTree = nodes => {
      const list = Array.isArray(nodes) ? nodes : []
      const byName = new Map(list.map(n => [n.name, n]))
      const kids = name => list.filter(n => n.parentName === name)
      const roots = list.filter(n => n.parentName === null || n.parentName === undefined || !byName.has(n.parentName))
      const attach = node => ({ node, main: false, children: kids(node.name).map(attach), cx: 0, cy: 0, depth: 0 })
      const root = {
        node: { name: '主线', isMain: true, status: 'main', cwd: roots[0]?.root ?? '', root: roots[0]?.root ?? '' },
        main: true,
        children: roots.map(attach),
        cx: 0,
        cy: 0,
        depth: 0,
      }
      let cursor = 0
      let maxDepth = 0
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
      return {
        root,
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
        const response = await callApi('tree')
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
      } catch { /* a sidebar preference is never worth a broken page */ }
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
      const [name, setName] = React.useState('')
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
      const [camera, setCamera] = React.useState({ x: 0, y: 0, k: 1 })
      const canvasRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const cameraRef = React.useRef(camera)
      cameraRef.current = camera

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

      const layout = React.useMemo(() => (data === null ? null : layoutTree(data.nodes)), [data])

      const fit = React.useCallback(() => {
        if (layout === null) return
        const k = Math.min(1.15, Math.min((VIEW_W - 48) / Math.max(1, layout.width), (VIEW_H - 48) / Math.max(1, layout.height)))
        setCamera({ k, x: (VIEW_W - layout.width * k) / 2, y: (VIEW_H - layout.height * k) / 2 })
      }, [layout])

      const zoom = React.useCallback(factor => {
        setCamera(previous => {
          const k = Math.max(0.25, Math.min(2.5, previous.k * factor))
          const cx = VIEW_W / 2
          const cy = VIEW_H / 2
          return { k, x: cx - (cx - previous.x) * (k / previous.k), y: cy - (cy - previous.y) * (k / previous.k) }
        })
      }, [])

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
      React.useEffect(() => { fit() }, [fit])

      // Wheel zoom needs a non-passive listener: React attaches wheel handlers
      // passively, so preventDefault inside onWheel is ignored (page scrolls).
      React.useEffect(() => {
        const node = canvasRef.current
        if (node === null) return undefined
        const onWheel = event => {
          event.preventDefault()
          zoom(event.deltaY < 0 ? 1.12 : 1 / 1.12)
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [zoom])

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

      // The tree is GLOBAL — one file for every conversation — so without this
      // the overview reads as "branching belongs to the conversations already
      // in it", which is exactly backwards. Mark where the reader is, and offer
      // the branch action from here so the map is a starting point and not a
      // record of past use.
      const currentId = (() => {
        const snapshot = deps.sessions?.list?.getSnapshot?.() ?? {}
        return typeof snapshot.current === 'string' && snapshot.current !== '' ? snapshot.current : null
      })()
      const directionIds = new Set(nodes.map(node => node.sessionId).filter(id => typeof id === 'string'))
      const isHere = entry => entry.main === true
        ? currentId !== null && !directionIds.has(currentId)
        : entry.node.sessionId === currentId

      const renderNode = entry => {
        const cls = entry.main
          ? 'dsh-branchman-gnode is-main'
          : entry.node.status === 'dropped'
            ? 'dsh-branchman-gnode is-dropped'
            : entry.node.status === 'merged' ? 'dsh-branchman-gnode is-merged' : 'dsh-branchman-gnode'
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
            entry.main ? tx('ov.main') : clip(entry.node.name, 17)),
          React.createElement('text', { className: 'dsh-branchman-t2', x: 12, y: 42 },
            entry.main ? clip(entry.node.cwd ?? '', 22) : clip(entry.node.branch ?? '', 22))),
          entry.children.map(renderNode),
        )
      }

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
        const bits = []
        if (node.isMain !== true) {
          if (node.branch !== undefined && node.branch !== null) bits.push(String(node.branch))
          bits.push(tx('det.inherited', { count: node.inheritedEvents ?? 0 }))
          bits.push(tx('det.messages', { count: node.messageCount ?? 0 }))
        }
        if (node.lastActivityAt !== undefined && node.lastActivityAt !== null) bits.push(new Date(node.lastActivityAt).toLocaleString())
        if (typeof node.sessionId === 'string' && node.sessionId !== '') bits.push(node.sessionId)
        const hasSession = typeof node.sessionId === 'string' && node.sessionId !== ''
        const opButton = (kind, label, title, danger, blocked) => React.createElement('button', {
          type: 'button',
          className: danger === true ? 'dsh-branchman-act is-danger' : 'dsh-branchman-act',
          disabled: busy !== '' || blocked === true,
          title,
          onClick: () => { if (danger === true) { setConfirmDrop(node.name); setNote(null) } else runOp(kind, node) },
        }, label)
        // The browser half reloads on a page refresh; the host half only on a
        // full restart. Offering a control whose route does not exist yet would
        // turn a page refresh into a row of 404s.
        const opsReady = data?.capabilities?.operations === true
        const operations = node.isMain === true
          ? null
          : opsReady === false
            ? React.createElement('div', { className: 'dsh-branchman-note' }, tx('det.opsPending'))
            : node.status === 'dropped'
              ? null
              : React.createElement('div', { className: 'dsh-branchman-actions' },
            React.createElement('span', { className: 'dsh-branchman-detmeta' }, tx('det.actions')),
            // Merge and sync both refuse a dirty worktree on the host, so the
            // button is disabled with the reason visible instead of letting the
            // click fail. Drop stays enabled: it force-removes by design.
            node.status === 'open' ? opButton('sync', tx('det.sync'), tx('det.sync.title'), false, dirty) : null,
            node.status === 'open' ? opButton('merge', tx('det.merge'), tx('det.merge.title'), false, dirty) : null,
            confirmDrop === node.name
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
              : opButton('drop', tx('det.drop'), tx('det.drop.title'), true),
            busy === '' ? null : React.createElement('span', { className: 'dsh-branchman-detmeta' }, tx('det.busy')))
        return React.createElement('div', { className: 'dsh-branchman-detail' },
          React.createElement('div', { className: 'dsh-branchman-detname' },
            node.isMain === true ? tx('ov.mainDetail') : `${node.name} · ${node.status ?? ''}`),
          React.createElement('div', { className: 'dsh-branchman-detmeta' }, bits.filter(Boolean).join(' · ')),
          React.createElement('div', { className: 'dsh-branchman-detpath' }, node.cwd ?? ''),
          node.isMain === true ? null : React.createElement('div', { className: 'dsh-branchman-detmeta' },
            git === undefined
              ? tx('det.gitLoading')
              : git.error !== undefined ? tx('det.gitUnknown') : tx('det.git', {
                ahead: git.ahead, behind: git.behind, dirty: git.dirty,
              })),
          stale ? React.createElement('div', { className: 'dsh-branchman-stale' }, tx('det.stale')) : null,
          dirty ? React.createElement('div', { className: 'dsh-branchman-stale' }, tx('det.dirtyBlock')) : null,
          node.isMain === true || hasSession ? null : React.createElement('div', { className: 'dsh-branchman-detmeta' }, tx('det.missing')),
          // An archived session is filtered out of every workspace group, so a
          // direction can be perfectly registered and still not appear in the
          // sidebar. Say so, and make undoing it one click.
          node.archived === true && hasSession
            ? React.createElement('div', { className: 'dsh-branchman-stale' }, tx('det.archived'))
            : null,
          hasSession && node.archived === true && opsReady
            ? React.createElement('button', {
              type: 'button', className: 'dsh-branchman-act', disabled: busy !== '',
              onClick: () => runUnarchive(node),
            }, tx('det.unarchive'))
            : null,
          hasSession && typeof deps.openSession === 'function'
            ? React.createElement('button', {
              type: 'button', className: 'dsh-branchman-link', onClick: () => switchTo(node),
            }, tx('det.switch'))
            : null,
          operations,
          note === null ? null : React.createElement('div', {
            className: note.kind === 'ok' ? 'dsh-branchman-note is-ok' : 'dsh-branchman-note is-bad',
          }, note.text))
      }

      return React.createElement('div', {
        className: 'dsh-branchman-mask',
        onClick: event => { if (event.target === event.currentTarget) onClose() },
      }, React.createElement('div', { className: 'dsh-branchman-card dsh-branchman-overview', role: 'dialog', 'aria-label': tx('ov.title') },
        React.createElement('div', { className: 'dsh-branchman-ovhead' },
          React.createElement('h3', null, tx('ov.title')),
          React.createElement('span', { className: 'dsh-branchman-ovstats' }, stats)),
        React.createElement('div', { className: 'dsh-branchman-hint' }, tx('ov.hint')),
        // The map must not read as "these are the conversations that can
        // branch". Every conversation can, so the action lives here too.
        React.createElement('div', { className: 'dsh-branchman-actions dsh-branchman-ovadd' },
          React.createElement('span', { className: 'dsh-branchman-detmeta' }, tx('ov.anyConversation')),
          React.createElement('button', {
            type: 'button', className: 'dsh-branchman-act', title: tx('ov.branchHere.title'),
            onClick: () => { onClose(); setView({ kind: 'fork', props: { sessionId: currentId ?? undefined } }) },
          }, tx('ov.branchHere'))),
        // Why a direction is a workspace of its own and not a child of its repo:
        // the registry matches on exact cwd, so it cannot be anything else. The
        // host's own answer is the tree grouping, so point at it here rather
        // than letting the sidebar look like a flat pile of siblings.
        React.createElement('div', { className: 'dsh-branchman-hint' },
          tx(groupingFollowed() ? 'ov.groupingDone' : 'ov.grouping')),
        React.createElement('div', {
          className: 'dsh-branchman-canvas',
          ref: canvasRef,
          onPointerDown,
          onPointerMove,
          onPointerUp,
          onPointerCancel: onPointerUp,
        }, nodes.length === 0
          ? React.createElement('div', { className: 'dsh-branchman-empty' }, tx('ov.empty'))
          : layout === null ? null : React.createElement('svg', {
            className: 'dsh-branchman-svg',
            viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
            preserveAspectRatio: 'xMidYMid meet',
          }, React.createElement('g', {
            transform: `translate(${Math.round(camera.x)} ${Math.round(camera.y)}) scale(${camera.k.toFixed(3)})`,
          }, renderNode(layout.root)))),
        detail(),
        React.createElement('div', { className: 'dsh-branchman-row' },
          React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: onClose }, tx('ov.close')),
          React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: () => zoom(1 / 1.2) }, tx('ov.zoomOut')),
          React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: () => zoom(1.2) }, tx('ov.zoomIn')),
          React.createElement('button', { type: 'button', className: 'dsh-branchman-no', onClick: fit }, tx('ov.fit')),
          React.createElement('button', { type: 'button', className: 'dsh-branchman-go', onClick: load }, tx('ov.refresh'))),
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
    module.exports.__test = { layoutTree, clip, NODE_W, NODE_H, H_GAP, V_GAP, VIEW_W, VIEW_H, DICT, planGrouping }

    return module.exports
  },
})
