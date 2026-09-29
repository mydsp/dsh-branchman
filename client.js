// dsh-branchman — browser half.
//
// Registered through the host's module loader: `window.__ModuleLoader__.load`
// with an id equal to the package name, and a factory that receives `require`.
// React comes from the browser module table (official
// cordis-plugin-development / ui-plugin.md) instead of being bundled.
//
// Declared services are 'slots' and 'sessions'; `uiWorkspace` is optional and
// resolved through ctx.inject when the host provides it (an undeclared access
// on a cordis service throws rather than yielding undefined).
window.__ModuleLoader__.load({
  id: 'dsh-branchman',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    module.exports.inject = ['slots', 'sessions']
    module.exports.apply = ctx => {
      const style = document.createElement('style')
      style.textContent = '.dsh-branchman-btn{display:inline-flex;align-items:center;gap:4px;height:24px;border:0;border-radius:6px;background:transparent;padding:0 8px;color:#6b7280;font:500 11px Inter,system-ui,sans-serif;cursor:pointer}.dsh-branchman-btn:hover{background:#eef2f6;color:#111827}.dsh-branchman-dlg{position:fixed;z-index:120;inset:0;background:rgba(15,17,21,.4);display:flex;align-items:center;justify-content:center}.dsh-branchman-card{background:#fff;border-radius:12px;padding:18px;width:380px;box-shadow:0 8px 30px rgba(0,0,0,.18)}.dsh-branchman-card h3{margin:0 0 4px;font-size:14px}.dsh-branchman-card .hint{color:#6b7280;font-size:11px;margin-bottom:12px}.dsh-branchman-card input{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font-size:13px;margin-bottom:8px}.dsh-branchman-card textarea{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:7px 10px;font:12px Inter,system-ui,sans-serif;resize:vertical;min-height:56px;margin-bottom:10px}.dsh-branchman-card .row{display:flex;gap:8px;justify-content:flex-end}.dsh-branchman-card button{border:0;border-radius:8px;padding:7px 14px;font:600 12px Inter,system-ui,sans-serif;cursor:pointer}.dsh-branchman-card .go{background:#111827;color:#fff}.dsh-branchman-card .no{background:#f3f4f6;color:#374151}.dsh-branchman-err{color:#b4686b;font-size:11px;margin-bottom:8px;min-height:14px}.dsh-branchman-overlay{z-index:200}.dsh-branchman-overview{width:min(1040px,94vw);max-width:94vw;padding:16px 18px}.dsh-branchman-ovhead{display:flex;align-items:baseline;gap:10px}.dsh-branchman-ovstats{font:500 11px Inter,system-ui,sans-serif;color:#6b7280}.dsh-branchman-canvas{height:58vh;min-height:340px;border:1px solid #e5e7eb;border-radius:10px;background:#fbfbfc;overflow:hidden;cursor:grab;margin-bottom:10px}.dsh-branchman-canvas:active{cursor:grabbing}.dsh-branchman-svg{width:100%;height:100%;display:block}.dsh-branchman-box{fill:#fff;stroke:#cbd5e1;stroke-width:1.5}.dsh-branchman-gnode{cursor:pointer}.dsh-branchman-gnode:hover .dsh-branchman-box{stroke:#111827;stroke-width:2}.dsh-branchman-gnode.is-main .dsh-branchman-box{fill:#111827;stroke:#111827}.dsh-branchman-gnode.is-main .dsh-branchman-t1{fill:#fff}.dsh-branchman-gnode.is-main .dsh-branchman-t2{fill:#9ca3af}.dsh-branchman-gnode.is-merged .dsh-branchman-box{stroke:#10b981}.dsh-branchman-gnode.is-merged .dsh-branchman-t1{fill:#065f46}.dsh-branchman-gnode.is-dropped .dsh-branchman-box{fill:#f8fafc;stroke-dasharray:4 3}.dsh-branchman-gnode.is-dropped .dsh-branchman-t1{fill:#9ca3af}.dsh-branchman-edge{stroke:#cbd5e1;stroke-width:1.6}.dsh-branchman-t1{font:600 12px Inter,system-ui,sans-serif;fill:#111827}.dsh-branchman-t2{font:10px ui-monospace,Menlo,monospace;fill:#9ca3af}.dsh-branchman-detail{border-top:1px solid #eef1f4;padding-top:8px;margin-bottom:8px;min-height:44px}.dsh-branchman-detname{font:600 12px Inter,system-ui,sans-serif;color:#111827}.dsh-branchman-detmeta{font:11px Inter,system-ui,sans-serif;color:#4b5563;margin-top:2px}.dsh-branchman-detpath{font:10px ui-monospace,Menlo,monospace;color:#9ca3af;word-break:break-all}.dsh-branchman-empty{color:#6b7280;font-size:12px;padding:18px}.dsh-branchman-link{margin-top:6px;border:0;border-radius:6px;background:#eef2f6;color:#111827;font:600 10px Inter,system-ui,sans-serif;padding:4px 10px;cursor:pointer}.dsh-branchman-link:hover{background:#e0e7ef}'
      document.head.append(style)
      // 官方规范：apply 内注册的资源用 ctx.effect 返回清理函数
      ctx.effect(() => () => { style.remove() })

      // 切到新会话必须用 uiWorkspace.openSession —— 原生分支按钮走的也是这条
      // （dsh-client-ui-chat: ctx.uiWorkspace.openSession(childId)）。直接读
      // ctx.uiWorkspace 会因未声明 inject 抛 "cannot get property ... without
      // inject"，所以用 ctx.inject 在服务就绪时取；ctx.sessions 上没有 open。
      let openSession = null
      if (typeof ctx.inject === 'function') {
        ctx.inject(['uiWorkspace'], child => {
          const workspace = child.uiWorkspace
          if (workspace !== undefined && typeof workspace.openSession === 'function') {
            openSession = id => workspace.openSession(id)
          }
        })
      }

      // 把宿主新建的会话拉进客户端目录：sessions.refresh() 会重新拉取宿主的
      // 会话基线（该方法是官方公开 API："Refresh the real Session baseline"）。
      // 拉不到就轮询几次，返回会话是否已被客户端认识。
      const syncCatalog = async (id, attempts = 6) => {
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const seen = ctx.sessions.list?.getSnapshot?.()?.byId?.[id]
          if (seen !== undefined) return true
          try { await ctx.sessions.refresh?.() } catch { /* 老宿主可能没有 refresh，靠轮询 */ }
          await new Promise(resolve => setTimeout(resolve, 150))
        }
        return ctx.sessions.list?.getSnapshot?.()?.byId?.[id] !== undefined
      }

      // props 来自槽位：scope 为 session 的槽位会传下「消息所属会话」，
      // ownerProp 传下该条消息的 id。
      const openDialog = props => {
        const wrap = document.createElement('div')
        wrap.className = 'dsh-branchman-dlg'
        wrap.innerHTML = '<div class="dsh-branchman-card"><h3>开新工程走向</h3>'
          + '<div class="hint">git worktree + 完整历史子会话（工作区自动切到 .branches\\<名>）+ 树上自动连线</div>'
          + '<input placeholder="走向名，如：走向-视觉方案" maxlength="60">'
          + '<textarea placeholder="一句话交接：这条走向要验证什么？（会写进子会话的首条上下文）"></textarea>'
          + '<div class="dsh-branchman-err"></div>'
          + '<div class="row"><button type="button" class="no">取消</button><button type="button" class="go">开走向</button></div></div>'
        document.body.append(wrap)
        const input = wrap.querySelector('input')
        const brief = wrap.querySelector('textarea')
        const err = wrap.querySelector('.dsh-branchman-err')
        const close = () => wrap.remove()
        wrap.querySelector('.no').onclick = close
        wrap.onclick = e => { if (e.target === wrap) close() }
        input.focus()
        const submit = async () => {
          const name = input.value.trim()
          if (!name) { err.textContent = '走向名必填'; return }
          const briefText = brief.value.trim()
          const snap0 = ctx.sessions.list.getSnapshot()
          // 优先用槽位传下来的会话 id，而不是「当前会话」：每条消息上的控件
          // 属于它那一段对话，而 current 在切换中途可能取不到值——那会让
          // 子会话静默丢掉本该继承的历史。
          const currentId = props?.sessionId ?? snap0.current ?? null
          const sourceTitle = snap0.byId[currentId]?.displayTitle ?? null
          const sourceCwd = snap0.byId[currentId]?.cwd ?? null
          try {
            // ① host: git worktree + 子会话一步到位。宿主持有 git，也用
            //    sessions.create(id 省略、meta.cwd=worktree、不带 origin) 建好子会话；
            //    sourceCwd 让宿主推出父方向，树才能连出边。
            err.textContent = '① 建 worktree 与子会话…'
            const res = await fetch('/branchman/api/fork', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name, sourceSessionId: currentId, sourceTitle, sourceCwd }),
            })
            const forked = await res.json()
            if (!res.ok) throw new Error(forked.error || ('HTTP ' + res.status))

            // ② 子会话：宿主建好了就直接用；万一宿主那步失败（老宿主/权限变化），
            //    由客户端补建并回报给树，保证按钮不会白点。
            let childId = typeof forked.sessionId === 'string' && forked.sessionId !== '' ? forked.sessionId : null
            if (childId === null) {
              err.textContent = '② 宿主未建成会话，客户端补建…'
              childId = await ctx.sessions.create({ cwd: forked.cwd })
              await fetch('/branchman/api/bind', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name, sessionId: childId, sessionTitle: `走向 ${name}` }),
              }).catch(() => {})
            }

            // ② 让客户端的会话目录认识这个新会话。宿主是在服务端建的会话，
            //    客户端的 catalog 还没同步过来——直接 openSession 会在
            //    `sessions.retain` 处报 "unknown session"（真实踩过）。而
            //    scope() 对未知会话返回 undefined，交接语也会被静默跳过。
            err.textContent = '② 同步会话目录…'
            await syncCatalog(childId)

            // ③ 交接语作为子会话首条消息（scope → sessionOf → prompt）
            if (briefText !== '') {
              err.textContent = '③ 写入交接…'
              const scope = ctx.sessions.scope(childId)
              const session = scope === undefined ? undefined : ctx.sessions.sessionOf(scope)
              if (session !== undefined && typeof session.prompt === 'function') {
                const r = await session.prompt([{ type: 'text', text: `[branchman 交接] 本走向「${name}」从「${sourceTitle ?? '主线'}」分叉，工作区=${forked.cwd}。要验证的假设：${briefText}。请先浏览工作区文件再行动。` }], 'queue')
                if (r && r.ok === false) throw new Error(r.error?.message ?? '交接写入被拒')
              }
            }

            // ④ 打开新会话（与原生分支按钮同一个收尾动作）。
            //    打开失败绝不能把已建好的走向说成失败——那是"白点了一次"的
            //    错觉来源，所以单独兜住并给出可操作的提示。
            err.textContent = '④ 打开会话…'
            if (typeof openSession === 'function') {
              try {
                openSession(childId)
                // 宿主明确回报"没继承历史"时不要静默了事：那是空会话，
                // 用户以为带了上下文、实际没有，是最难查的一类问题。
                if (forked.seeded === false) {
                  err.textContent = `走向「${name}」已建立并切过去了，但子会话未继承历史（宿主未提供 sessionQuery/agents）——如需带历史请重启 DSH 后再试。`
                } else {
                  close()
                }
              } catch (openError) {
                err.textContent = `走向「${name}」已建立（worktree + 子会话 ${childId}），但自动切换失败：${openError.message}。请在左侧会话列表中点开它。`
              }
            } else {
              err.textContent = `走向「${name}」已建立（worktree + 子会话 ${childId}），但当前宿主未提供 uiWorkspace，请在左侧会话列表中点开它。`
            }
          } catch (e) { err.textContent = String(e.message || e) }
        }
        wrap.querySelector('.go').onclick = submit
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit() })
      }

      const Button = props => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'dsh-branchman-btn'
        el.textContent = '⎇ 分支到新走向'
        el.title = 'git worktree + 子会话（完整历史）+ 树上连线，一步完成'
        el.onclick = () => openDialog(props)
        return el
      }

      // ── 走向树视图 ──────────────────────────────────────────────────────
      // 宿主早就提供了 /branchman/ 网页，但 GUI 里没有地址栏、外部浏览器又被
      // renderer 令牌挡住——所以树必须在界面内自绘（数据取自同一个 /tree 接口，
      // 只含元数据、不含消息正文）。
      // ── 走向总览（图形化分支图）────────────────────────────────────────
      // 剧情分支图那套：节点方块 + 连线 + 自动布局 + 平移缩放。宿主早就提供了
      // /branchman/ 网页，但 GUI 里没有地址栏、外部浏览器又被 renderer 令牌挡住
      // ——所以总览必须在界面内自绘（数据取自同一个 /tree 接口，只含元数据）。
      const SVG_NS = 'http://www.w3.org/2000/svg'
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
      const svgNode = (tag, attrs) => {
        const el = document.createElementNS(SVG_NS, tag)
        const keys = Object.keys(attrs ?? {})
        for (let i = 0; i < keys.length; i += 1) el.setAttribute(keys[i], String(attrs[keys[i]]))
        return el
      }

      const openTree = async () => {
        const wrap = document.createElement('div')
        wrap.className = 'dsh-branchman-dlg dsh-branchman-overlay'
        const card = document.createElement('div')
        card.className = 'dsh-branchman-card dsh-branchman-overview'
        card.innerHTML = '<div class="dsh-branchman-ovhead"><h3>工程走向总览</h3><span class="dsh-branchman-ovstats"></span></div>'
          + '<div class="hint">一个方框 = 一条走向（git worktree + 会话）。点方框看详情，拖动平移，滚轮缩放。</div>'
          + '<div class="dsh-branchman-canvas"></div>'
          + '<div class="dsh-branchman-detail">点一个方框查看详情</div>'
          + '<div class="dsh-branchman-err"></div>'
          + '<div class="row"><button type="button" class="no">关闭</button><button type="button" class="zout">缩小</button><button type="button" class="zin">放大</button><button type="button" class="fit">适应窗口</button><button type="button" class="go">刷新</button></div>'
        wrap.append(card)
        document.body.append(wrap)
        const canvas = card.querySelector('.dsh-branchman-canvas')
        const stats = card.querySelector('.dsh-branchman-ovstats')
        const detail = card.querySelector('.dsh-branchman-detail')
        const errEl = card.querySelector('.dsh-branchman-err')
        const close = () => wrap.remove()
        card.querySelector('.no').onclick = close
        wrap.onclick = e => { if (e.target === wrap) close() }

        let view = { x: 0, y: 0, k: 1 }
        let contentW = VIEW_W
        let contentH = VIEW_H
        let rootG = null

        const applyView = () => {
          if (rootG === null) return
          rootG.setAttribute('transform', `translate(${Math.round(view.x)} ${Math.round(view.y)}) scale(${view.k.toFixed(3)})`)
        }
        const fit = () => {
          const k = Math.min(1.15, Math.min((VIEW_W - 48) / Math.max(1, contentW), (VIEW_H - 48) / Math.max(1, contentH)))
          view = { k, x: (VIEW_W - contentW * k) / 2, y: (VIEW_H - contentH * k) / 2 }
          applyView()
        }
        const zoom = factor => {
          const k = Math.max(0.25, Math.min(2.5, view.k * factor))
          const cx = VIEW_W / 2
          const cy = VIEW_H / 2
          view = { k, x: cx - (cx - view.x) * (k / view.k), y: cy - (cy - view.y) * (k / view.k) }
          applyView()
        }

        const showDetail = node => {
          detail.innerHTML = ''
          const title = document.createElement('div')
          title.className = 'dsh-branchman-detname'
          title.textContent = node.isMain === true ? '主线（工作区主目录）' : `${node.name} · ${node.status ?? ''}`
          const meta = document.createElement('div')
          meta.className = 'dsh-branchman-detmeta'
          const bits = []
          if (node.isMain !== true) {
            if (node.branch !== undefined && node.branch !== null) bits.push(node.branch)
            bits.push(`继承 ${node.inheritedEvents ?? 0} 事件`)
            bits.push(`${node.messageCount ?? 0} 条消息`)
          }
          if (node.lastActivityAt !== undefined && node.lastActivityAt !== null) {
            bits.push(new Date(node.lastActivityAt).toLocaleString())
          }
          if (node.sessionId !== undefined && node.sessionId !== null && node.sessionId !== '') {
            bits.push(String(node.sessionId))
          }
          meta.textContent = bits.filter(Boolean).join(' · ')
          const path = document.createElement('div')
          path.className = 'dsh-branchman-detpath'
          path.textContent = node.cwd ?? ''
          detail.append(title, meta, path)
          if (typeof node.sessionId === 'string' && node.sessionId !== '' && typeof openSession === 'function') {
            const go = document.createElement('button')
            go.type = 'button'
            go.className = 'dsh-branchman-link'
            go.textContent = '切到该会话'
            go.onclick = async () => {
              try {
                await syncCatalog(node.sessionId)
                openSession(node.sessionId)
                close()
              } catch (e) { errEl.textContent = String(e.message || e) }
            }
            detail.append(go)
          }
        }

        const render = data => {
          canvas.innerHTML = ''
          const nodes = Array.isArray(data.nodes) ? data.nodes : []
          const live = nodes.filter(n => n.status !== 'dropped').length
          stats.textContent = nodes.length === 0 ? '还没有走向' : `${nodes.length} 条走向 · ${live} 条在用`
          if (nodes.length === 0) {
            const empty = document.createElement('div')
            empty.className = 'dsh-branchman-empty'
            empty.textContent = '还没有走向。点「⎇ 分支到新走向」开第一条。'
            canvas.append(empty)
            return
          }
          const byName = new Map(nodes.map(n => [n.name, n]))
          const kids = name => nodes.filter(n => n.parentName === name)
          const roots = nodes.filter(n => n.parentName === null || n.parentName === undefined || !byName.has(n.parentName))
          const attach = node => ({
            node,
            main: false,
            children: kids(node.name).map(attach),
            cx: 0,
            cy: 0,
            depth: 0,
          })
          // 主线作为虚拟根显式画出来：走向是"从主线长出来的枝"
          const tree = [{
            node: { name: '主线', isMain: true, status: 'main', cwd: roots[0].root ?? '', root: roots[0].root ?? '' },
            main: true,
            children: roots.map(attach),
            cx: 0,
            cy: 0,
            depth: 0,
          }]
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
          place(tree[0], 0)
          contentW = Math.max(NODE_W, cursor - H_GAP)
          contentH = Math.max(NODE_H, maxDepth * (NODE_H + V_GAP) + NODE_H)

          const svg = svgNode('svg', {
            class: 'dsh-branchman-svg',
            viewBox: `0 0 ${VIEW_W} ${VIEW_H}`,
            preserveAspectRatio: 'xMidYMid meet',
          })
          rootG = svgNode('g', {})
          svg.append(rootG)

          const drawEdge = (parent, child) => {
            const x1 = parent.cx + NODE_W / 2
            const y1 = parent.cy + NODE_H
            const x2 = child.cx + NODE_W / 2
            const y2 = child.cy
            const mid = (y1 + y2) / 2
            rootG.append(svgNode('path', {
              class: 'dsh-branchman-edge',
              fill: 'none',
              d: `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,
            }))
          }
          const walkEdges = entry => {
            for (const kid of entry.children) {
              drawEdge(entry, kid)
              walkEdges(kid)
            }
          }
          walkEdges(tree[0])

          const drawNode = entry => {
            const cls = entry.main
              ? 'dsh-branchman-gnode is-main'
              : (entry.node.status === 'dropped'
                  ? 'dsh-branchman-gnode is-dropped'
                  : (entry.node.status === 'merged' ? 'dsh-branchman-gnode is-merged' : 'dsh-branchman-gnode'))
            const g = svgNode('g', { class: cls, transform: `translate(${entry.cx} ${entry.cy})` })
            g.append(svgNode('rect', { class: 'dsh-branchman-box', width: NODE_W, height: NODE_H, rx: 10 }))
            const line1 = svgNode('text', { class: 'dsh-branchman-t1', x: 12, y: 24 })
            line1.textContent = entry.main ? '◆ 主线' : clip(entry.node.name, 17)
            const line2 = svgNode('text', { class: 'dsh-branchman-t2', x: 12, y: 42 })
            line2.textContent = entry.main
              ? clip(entry.node.cwd ?? '', 22)
              : clip(entry.node.branch ?? '', 22)
            g.append(line1, line2)
            g.onclick = () => showDetail(entry.node)
            rootG.append(g)
            for (const kid of entry.children) drawNode(kid)
          }
          drawNode(tree[0])
          canvas.append(svg)
        }

        let dragging = null
        canvas.onmousedown = e => { dragging = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y } }
        canvas.onmousemove = e => {
          if (dragging === null) return
          view.x = dragging.vx + (e.clientX - dragging.x)
          view.y = dragging.vy + (e.clientY - dragging.y)
          applyView()
        }
        canvas.onmouseup = () => { dragging = null }
        canvas.onmouseleave = () => { dragging = null }
        canvas.onwheel = e => {
          if (typeof e.preventDefault === 'function') e.preventDefault()
          zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12)
        }

        const load = async () => {
          errEl.textContent = ''
          try {
            const res = await fetch('/branchman/api/tree')
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status))
            render(data)
            fit()
          } catch (e) {
            canvas.innerHTML = ''
            errEl.textContent = String(e.message || e)
          }
        }
        card.querySelector('.go').onclick = load
        card.querySelector('.fit').onclick = fit
        card.querySelector('.zin').onclick = () => zoom(1.2)
        card.querySelector('.zout').onclick = () => zoom(1 / 1.2)
        await load()
      }

      const TreeButton = () => {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'dsh-branchman-btn'
        el.textContent = '🗺 走向总览'
        el.title = '图形化总览：主线与各条走向的分支关系；点方框看详情并切到该会话'
        el.onclick = () => openTree()
        return el
      }

      /**
       * Host a plain DOM button inside a slot: the slot contract wants a React
       * component, and owning the node keeps us out of the host reconciler's way.
       */
      const hosted = make => function Hosted(props) {
        const ref = React.useRef(null)
        React.useEffect(() => {
          const host = ref.current
          if (host === null) return undefined
          host.innerHTML = ''
          const btn = make(props)
          host.append(btn)
          return () => { btn.remove() }
        }, [props?.sessionId, props?.messageId])
        return React.createElement('span', { ref, style: { display: 'inline-flex' } })
      }

      const BranchButton = hosted(props => Button(props))
      const TreeButtonSlot = hosted(() => TreeButton())
      const ASSISTANT_ACTIONS = 'conversation.chat.assistant-actions'

      // 每条 assistant 消息尾部：开走向 + 看树
      ctx.slots.inject(ASSISTANT_ACTIONS, () => ctx.slots.register({
        name: ASSISTANT_ACTIONS,
        id: 'dsh-branchman-branch-button',
        // 字段名是 order（dsh-client-ui-slots 的 options.order），原来的 priority 会被忽略
        order: 50,
      }, BranchButton))
      ctx.slots.inject(ASSISTANT_ACTIONS, () => ctx.slots.register({
        name: ASSISTANT_ACTIONS,
        id: 'dsh-branchman-tree-button',
        order: 51,
      }, TreeButtonSlot))
      // 输入框旁常驻一个入口：树是全局的，不该只藏在消息尾部
      ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock',
        id: 'dsh-branchman-tree-dock',
        order: 60,
      }, TreeButtonSlot))
    }
    return module.exports
  },
})
