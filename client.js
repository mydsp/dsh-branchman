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
        'ov.empty': '还没有走向。点「⎇ 分支到新走向」开第一条。',
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
        'ov.empty': 'No directions yet. Click “⎇ Branch to a new direction” to open the first one.',
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
        body: JSON.stringify({ name, sourceSessionId: sourceId, sourceTitle, sourceCwd }),
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

    const OverviewAction = () => React.createElement(ActionButton, {
      label: tx('action.overview'),
      title: tx('action.overview.title'),
      onClick: () => setView({ kind: 'overview' }),
    })

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

      const load = React.useCallback(async () => {
        setError('')
        try {
          const res = await fetch('/branchman/api/tree')
          const body = await res.json()
          if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
          setData(body)
        } catch (e) {
          setData(null)
          setError(String(e.message || e))
        }
      }, [])

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
            className: cls,
            transform: `translate(${entry.cx} ${entry.cy})`,
            onClick: () => setSelected(entry.node),
            role: 'button',
            tabIndex: 0,
          },
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
        return React.createElement('div', { className: 'dsh-branchman-detail' },
          React.createElement('div', { className: 'dsh-branchman-detname' },
            node.isMain === true ? tx('ov.mainDetail') : `${node.name} · ${node.status ?? ''}`),
          React.createElement('div', { className: 'dsh-branchman-detmeta' }, bits.filter(Boolean).join(' · ')),
          React.createElement('div', { className: 'dsh-branchman-detpath' }, node.cwd ?? ''),
          stale ? React.createElement('div', { className: 'dsh-branchman-stale' }, tx('det.stale')) : null,
          node.isMain === true || hasSession ? null : React.createElement('div', { className: 'dsh-branchman-detmeta' }, tx('det.missing')),
          hasSession && typeof deps.openSession === 'function'
            ? React.createElement('button', {
              type: 'button', className: 'dsh-branchman-link', onClick: () => switchTo(node),
            }, tx('det.switch'))
            : null)
      }

      return React.createElement('div', {
        className: 'dsh-branchman-mask',
        onClick: event => { if (event.target === event.currentTarget) onClose() },
      }, React.createElement('div', { className: 'dsh-branchman-card dsh-branchman-overview', role: 'dialog', 'aria-label': tx('ov.title') },
        React.createElement('div', { className: 'dsh-branchman-ovhead' },
          React.createElement('h3', null, tx('ov.title')),
          React.createElement('span', { className: 'dsh-branchman-ovstats' }, stats)),
        React.createElement('div', { className: 'dsh-branchman-hint' }, tx('ov.hint')),
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
    module.exports.__test = { layoutTree, clip, NODE_W, NODE_H, H_GAP, V_GAP, VIEW_W, VIEW_H, DICT }

    return module.exports
  },
})
