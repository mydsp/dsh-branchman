// Offline test for dsh-branchman's CLIENT half.
// Stubs window.__ModuleLoader__, a minimal DOM, React hooks, fetch and the
// host ctx, then drives a real button click through the real client.js.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CLIENT = join(ROOT, 'client.js')

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`) }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`) }
}

// ── minimal DOM ───────────────────────────────────────────────────────────
const makeEl = (tag = 'div') => ({
  tagName: tag, className: '', textContent: '', innerHTML: '', value: '',
  style: {}, children: [], title: '', type: '', removed: false, focused: false, _html: '',
  // 真实 DOM 的 append 接受多个节点（插件里就有 row.append(head, meta, path)）
  append(...nodes) { for (const node of nodes) this.children.push(node); return nodes[0] },
  get innerHTML() { return this._html },
  set innerHTML(value) { this._html = String(value); this.children.length = 0 },
  // SVG 用 setAttribute/getAttribute；innerHTML 赋值按真实 DOM 语义清空子节点
  attrs: {},
  setAttribute(key, value) { this.attrs[key] = String(value) },
  getAttribute(key) { return this.attrs[key] ?? null },
  remove() { this.removed = true },
  focus() { this.focused = true },
  addEventListener(type, fn) { this.handlers ??= {}; this.handlers[type] = fn },
  querySelector(sel) { this.q ??= {}; return (this.q[sel] ??= makeEl(sel)) },
  onclick: null,
})
const head = makeEl('head')
const body = makeEl('body')
globalThis.document = { createElement: makeEl, createElementNS: (ns, tag) => makeEl(tag), head, body }

// ── minimal React ─────────────────────────────────────────────────────────
const refs = []
const effects = []
const React = {
  useRef: init => { const r = { current: init }; refs.push(r); return r },
  useEffect: fn => { effects.push(fn) },
  createElement: (type, props, ...children) => ({ type, props, children }),
}

// ── capture the registered factory ────────────────────────────────────────
let entry = null
globalThis.window = { __ModuleLoader__: { load: e => { entry = e } } }

const src = await readFile(CLIENT, 'utf8')
new Function(src)()   // the bundle registers itself on window.__ModuleLoader__

check('client bundle 调用 __ModuleLoader__.load', entry !== null)
check('bundle id 正确', entry?.id === 'dsh-branchman', String(entry?.id))
check('factory 是函数', typeof entry?.factory === 'function')

const required = []
const exports_ = entry.factory(name => {
  required.push(name)
  if (name === 'react') return React
  throw new Error(`client.js required unexpected module: ${name}`)
})
check('factory 只 require react', required.length === 1 && required[0] === 'react', required.join(','))
check('exports.inject 含 slots 与 sessions',
  Array.isArray(exports_.inject) && exports_.inject.includes('slots') && exports_.inject.includes('sessions'),
  JSON.stringify(exports_.inject))
check('exports.apply 是函数', typeof exports_.apply === 'function')

// ── fake host ctx ─────────────────────────────────────────────────────────
const calls = []
const registered = []
const injects = []
const injected = []
// 真实行为：客户端目录（catalog）在 refresh() 之前不认识宿主新建的会话，而
// openSession → sessions.retain 对未知会话直接抛错。桩按同样规则来。
const catalog = { current: 'session-main', byId: { 'session-main': { displayTitle: '主线会话', cwd: 'E:/repo' } } }
const ctx = {
  slots: {
    inject: (name, cb) => { injects.push(name); return cb() },
    register: (options, Component) => { registered.push({ options, Component }); return () => {} },
  },
  effect: fn => { fn(); return () => {} },
  // 服务只能经 ctx.inject 取：cordis 对未声明 inject 的属性访问是抛错，不是 undefined
  inject: (names, cb) => {
    injected.push(names.join(','))
    cb({
      uiWorkspace: {
        openSession: id => {
          if (catalog.byId[id] === undefined) throw new Error(`sessions.retain: unknown session ${id}`)
          calls.push(['open', id])
        },
      },
    })
  },
  sessions: {
    list: { getSnapshot: () => catalog },
    refresh: async () => {
      calls.push(['refresh'])
      for (const id of ['session-host-1', 'session-host-props']) {
        if (catalog.byId[id] === undefined) catalog.byId[id] = { displayTitle: '走向会话', cwd: 'E:/repo/.branches' }
      }
    },
    create: async ({ cwd }) => {
      calls.push(['create', cwd])
      // 客户端自己建的会话，客户端目录立刻就有（与宿主服务端建的不同）
      catalog.byId['session-client-1'] = { displayTitle: '客户端建会话', cwd }
      return 'session-client-1'
    },
    scope: id => (catalog.byId[id] === undefined ? undefined : `scope-${id}`),
    sessionOf: scope => (scope === undefined ? undefined : { prompt: async parts => { calls.push(['prompt', parts[0].text]); return { ok: true } } }),
  },
}
globalThis.fetch = async (url, init) => {
  const body_ = init?.body ? JSON.parse(init.body) : null
  calls.push(['fetch', url, body_])
  if (url === '/branchman/api/fork') {
    return { ok: true, json: async () => ({
      name: body_.name, branch: `branchman/${body_.name}`,
      cwd: `E:/repo/.branches/${body_.name}`,
      sessionId: globalThis.__hostSessionId === undefined ? 'session-host-1' : globalThis.__hostSessionId, hint: '',
    }) }
  }
  return { ok: true, json: async () => ({}) }
}

exports_.apply(ctx)
check('通过 ctx.inject 取 uiWorkspace', injected.includes('uiWorkspace'), JSON.stringify(injected))

// ── slot registration ─────────────────────────────────────────────────────
check('注册进官方槽位 conversation.chat.assistant-actions',
  injects[0] === 'conversation.chat.assistant-actions', JSON.stringify(injects))
const reg = registered[0]
check('slot 选项含 name/id/order',
  reg?.options.name === 'conversation.chat.assistant-actions' && typeof reg.options.id === 'string' && typeof reg.options.order === 'number',
  JSON.stringify(reg?.options))

// ── mount the component (real hooks, stubbed React) ───────────────────────
const host = makeEl('span')
reg.Component()
for (const r of refs) r.current = host
for (const fn of effects) fn()
const btn = host.children[0]
check('按钮挂载到槽位宿主元素', btn !== undefined)
check('按钮文案含「分支」', (btn?.textContent ?? '').includes('分支'), btn?.textContent)
check('按钮 onclick 已绑定', typeof btn?.onclick === 'function')

// ── click → dialog → submit ───────────────────────────────────────────────
btn.onclick()
const wrap = body.children.at(-1)
check('点击后弹出对话框', wrap !== undefined && wrap.className === 'dsh-branchman-dlg', wrap?.className)
const input = wrap.querySelector('input')
const brief = wrap.querySelector('textarea')
const err = wrap.querySelector('.dsh-branchman-err')
const go = wrap.querySelector('.go')
check('对话框含 go 按钮且 onclick 已绑定', typeof go.onclick === 'function')

input.value = '走向-UI测试'
brief.value = '验证 UI 链路'
await go.onclick()
console.log(`  [dialog] ${err.textContent}`)

const forkCall = calls.find(c => c[0] === 'fetch' && c[1] === '/branchman/api/fork')
check('提交时 POST /branchman/api/fork', forkCall !== undefined)
check('请求体带 name', forkCall?.[2]?.name === '走向-UI测试', JSON.stringify(forkCall?.[2]))
check('请求体带 sourceSessionId', forkCall?.[2]?.sourceSessionId === 'session-main')
check('请求体带 sourceCwd（树连边用）', forkCall?.[2]?.sourceCwd === 'E:/repo', String(forkCall?.[2]?.sourceCwd))
check('宿主已建会话时不再重复建会话', !calls.some(c => c[0] === 'create'), JSON.stringify(calls.filter(c => c[0] === 'create')))
check('交接语写入子会话', calls.some(c => c[0] === 'prompt' && String(c[1]).includes('验证 UI 链路')))
check('打开宿主返回的子会话', calls.some(c => c[0] === 'open' && c[1] === 'session-host-1'))
const refreshIdx = calls.findIndex(c => c[0] === 'refresh')
const openIdx = calls.findIndex(c => c[0] === 'open' && c[1] === 'session-host-1')
check('先同步会话目录再打开（refresh 在 open 之前）', refreshIdx !== -1 && openIdx !== -1 && refreshIdx < openIdx,
  JSON.stringify({ refreshIdx, openIdx }))
check('对话框已关闭', wrap.removed === true)
check('无异常文本残留', !/Error|error|undefined|\[object/.test(err.textContent), String(err.textContent))

// ── fallback: host could not create the session ───────────────────────────
console.log('\n### 宿主未建成会话时的客户端兜底')
globalThis.__hostSessionId = null
calls.length = 0
btn.onclick()
const wrap2 = body.children.at(-1)
wrap2.querySelector('input').value = '走向-兜底'
wrap2.querySelector('textarea').value = ''
await wrap2.querySelector('.go').onclick()
check('兜底时客户端补建会话', calls.some(c => c[0] === 'create' && String(c[1]).includes('.branches')), JSON.stringify(calls.filter(c => c[0] === 'create')))
check('兜底时回报 /branchman/api/bind 挂链',
  calls.some(c => c[0] === 'fetch' && c[1] === '/branchman/api/bind' && c[2]?.sessionId === 'session-client-1'))
check('兜底时打开客户端补建的会话', calls.some(c => c[0] === 'open' && c[1] === 'session-client-1'))

// ── error path: host rejects ──────────────────────────────────────────────
console.log('\n### 宿主报错时的界面反馈')
globalThis.fetch = async (url, init) => {
  calls.push(['fetch', url])
  return { ok: false, status: 400, json: async () => ({ error: '走向名必填' }) }
}
calls.length = 0
btn.onclick()
const wrap3 = body.children.at(-1)
wrap3.querySelector('input').value = '走向-报错'
await wrap3.querySelector('.go').onclick()
check('错误显示在对话框里（不再静默失败）', wrap3.querySelector('.dsh-branchman-err').textContent.includes('走向名必填'),
  wrap3.querySelector('.dsh-branchman-err').textContent)

// ── slot props win over "current session" ─────────────────────────────────
// 槽位把「消息所属会话」传下来时必须优先用它：靠 snap.current 在切换中途会
// 取不到值，子会话会静默丢掉继承的历史（真实踩过）。
console.log('\n### 槽位 props 的会话优先于 current')
globalThis.fetch = async (url, init) => {
  const body_ = init?.body ? JSON.parse(init.body) : null
  calls.push(['fetch', url, body_])
  if (url === '/branchman/api/fork') {
    return { ok: true, json: async () => ({ name: body_.name, cwd: `E:/repo/.branches/${body_.name}`, sessionId: 'session-host-props' }) }
  }
  return { ok: true, json: async () => ({}) }
}
calls.length = 0
const refsBefore = refs.length
const effectsBefore = effects.length
const host2 = makeEl('span')
reg.Component({ sessionId: 'session-from-props', messageId: 'msg-7' })
for (const r of refs.slice(refsBefore)) r.current = host2
for (const fn of effects.slice(effectsBefore)) fn()
const btn2 = host2.children[0]
btn2.onclick()
const wrap4 = body.children.at(-1)
wrap4.querySelector('input').value = '走向-props'
await wrap4.querySelector('.go').onclick()
const forkCall2 = calls.find(c => c[0] === 'fetch' && c[1] === '/branchman/api/fork')
check('请求用槽位传入的 sessionId（而非 current）', forkCall2?.[2]?.sourceSessionId === 'session-from-props',
  `${String(forkCall2?.[2]?.sourceSessionId)}（snap.current=session-main）`)
check('打开宿主返回的新会话', calls.some(c => c[0] === 'open' && c[1] === 'session-host-props'))

// ── no uiWorkspace: 走向仍建好，只是不能自动切过去 ────────────────────────
console.log('\n### 宿主未提供 uiWorkspace 时的降级')
const calls2 = []
const registered2 = []
const ctx2 = {
  slots: { inject: (n, cb) => cb(), register: (o, C) => { registered2.push({ options: o, Component: C }); return () => {} } },
  effect: fn => { fn(); return () => {} },
  inject: (names, cb) => { cb({}) },   // 服务存在但里面没有 uiWorkspace
  sessions: ctx.sessions,
}
const exports2 = entry.factory(name => { if (name === 'react') return React; throw new Error(name) })
exports2.apply(ctx2)
const refsBefore2 = refs.length
const effectsBefore2 = effects.length
const host3 = makeEl('span')
registered2[0].Component({ sessionId: 'session-main' })
for (const r of refs.slice(refsBefore2)) r.current = host3
for (const fn of effects.slice(effectsBefore2)) fn()
host3.children[0].onclick()
const wrap5 = body.children.at(-1)
wrap5.querySelector('input').value = '走向-降级'
await wrap5.querySelector('.go').onclick()
const msg = wrap5.querySelector('.dsh-branchman-err').textContent
check('降级时明确告知已建立、只是没自动打开', msg.includes('已建立') && msg.includes('会话列表'), msg)
check('降级时不再抛 TypeError', !msg.includes('is not a function'), msg)

// ── 目录始终不认识新会话：openSession 抛 unknown session，不许谎报失败 ────
console.log('\n### 会话目录始终不认识新会话时的兜底')
globalThis.fetch = async (url, init) => {
  const body_ = init?.body ? JSON.parse(init.body) : null
  calls.push(['fetch', url, body_])
  if (url === '/branchman/api/fork') {
    return { ok: true, json: async () => ({ name: body_.name, cwd: `E:/repo/.branches/${body_.name}`, sessionId: 'session-ghost' }) }
  }
  return { ok: true, json: async () => ({}) }
}
const registered3 = []
const ctx3 = {
  slots: { inject: (n, cb) => cb(), register: (o, C) => { registered3.push({ options: o, Component: C }); return () => {} } },
  effect: fn => { fn(); return () => {} },
  inject: (names, cb) => cb({
    uiWorkspace: { openSession: id => { throw new Error(`sessions.retain: unknown session ${id}`) } },
  }),
  sessions: {
    list: { getSnapshot: () => catalog },
    refresh: async () => { calls.push(['refresh-noop']) },   // 拉不回来
    create: async () => 'session-x',
    scope: () => undefined,
    sessionOf: () => undefined,
  },
}
const exports3 = entry.factory(name => { if (name === 'react') return React; throw new Error(name) })
exports3.apply(ctx3)
const refsBefore3 = refs.length
const effectsBefore3 = effects.length
const host4 = makeEl('span')
registered3[0].Component({ sessionId: 'session-main' })
for (const r of refs.slice(refsBefore3)) r.current = host4
for (const fn of effects.slice(effectsBefore3)) fn()
host4.children[0].onclick()
const wrap6 = body.children.at(-1)
wrap6.querySelector('input').value = '走向-幽灵'
await wrap6.querySelector('.go').onclick()
const msg6 = wrap6.querySelector('.dsh-branchman-err').textContent
check('未知会话时不谎报走向失败', msg6.includes('已建立') && msg6.includes('自动切换失败'), msg6)
check('并指出到哪里手动打开', msg6.includes('会话列表'), msg6)

// ── 走向树视图（GUI 内自绘，不依赖外部浏览器）────────────────────────────
// ── 走向总览（图形化分支图：SVG 节点/连线/缩放/详情）────────────────────
console.log('\n### 走向总览图')
const treeReg = registered.find(r => r.options.id === 'dsh-branchman-tree-button')
const dockReg = registered.find(r => r.options.id === 'dsh-branchman-tree-dock')
check('消息尾部注册了走向树按钮', treeReg !== undefined)
check('输入框旁注册了走向树入口（常驻）',
  dockReg !== undefined && dockReg.options.name === 'conversation.composer.dock', JSON.stringify(dockReg?.options))

const clickTree = async () => {
  const refsBefore = refs.length
  const effectsBefore = effects.length
  const hostEl = makeEl('span')
  treeReg.Component({ sessionId: 'session-main' })
  for (const r of refs.slice(refsBefore)) r.current = hostEl
  for (const fn of effects.slice(effectsBefore)) fn()
  const btn = hostEl.children[0]
  await btn.onclick()
  const wrap = body.children.at(-1)
  const card = wrap.children[0]
  return {
    btn,
    wrap,
    card,
    canvas: card.querySelector('.dsh-branchman-canvas'),
    detail: card.querySelector('.dsh-branchman-detail'),
    stats: card.querySelector('.dsh-branchman-ovstats'),
    err: card.querySelector('.dsh-branchman-err'),
  }
}
// SVG 图：主线 → test → sub（三级），用来验证层级布局
const treePayload = () => ({ ok: true, json: async () => ({ version: 1, nodes: [
  { name: 'test', parentName: null, root: 'E:/repo', branch: 'branchman/test', cwd: 'E:/repo/.branches/test', status: 'open', sessionId: 'session-main', inheritedEvents: 5200, messageCount: 34, lastActivityAt: '2026-09-29T05:19:23.530Z' },
  { name: 'sub', parentName: 'test', root: 'E:/repo', branch: 'branchman/sub', cwd: 'E:/repo/.branches/sub', status: 'open', sessionId: 'session-host-1', inheritedEvents: 12, messageCount: 0, lastActivityAt: '2026-09-29T05:20:00.000Z' },
  { name: 'sub2', parentName: 'test', root: 'E:/repo', branch: 'branchman/sub2', cwd: 'E:/repo/.branches/sub2', status: 'dropped', sessionId: 'session-host-2', inheritedEvents: 3, messageCount: 0, lastActivityAt: '2026-09-29T05:21:00.000Z' },
  { name: 'sub3', parentName: 'test', root: 'E:/repo', branch: 'branchman/sub3', cwd: 'E:/repo/.branches/sub3', status: 'merged', sessionId: 'session-host-3', inheritedEvents: 8, messageCount: 1, lastActivityAt: '2026-09-29T05:22:00.000Z' },
] }) })
globalThis.fetch = async (url, init) => {
  calls.push(['fetch', url, init?.body ? JSON.parse(init.body) : null])
  if (url === '/branchman/api/tree') return treePayload()
  return { ok: true, json: async () => ({}) }
}

const t1 = await clickTree()
check('打开的是总览浮层（不是小弹窗）', String(t1.wrap.className).includes('dsh-branchman-overlay'), String(t1.wrap.className))
check('入口按钮文案为「走向总览」', t1.btn.textContent.includes('走向总览'), t1.btn.textContent)
const svg = t1.canvas.children[0]
check('画布内是 SVG', svg !== undefined && svg.tagName === 'svg', String(svg?.tagName))
check('SVG 用固定 viewBox（缩放不糊）', svg?.attrs?.viewBox === '0 0 960 520', String(svg?.attrs?.viewBox))
const g = svg.children[0]
const gnodes = g.children.filter(c => String(c.attrs?.class ?? '').includes('gnode'))
const edges = g.children.filter(c => c.attrs?.class === 'dsh-branchman-edge')
check('五个节点方块（主线 + 4 条走向）', gnodes.length === 5, String(gnodes.length))
check('连线数 = 非根节点数（4 条）', edges.length === 4, String(edges.length))
check('主线节点有独立样式', gnodes.some(n => String(n.attrs.class).includes('is-main')))
const yOf = node => Number(String(node.attrs.transform).match(/translate\(([-\d.]+) ([-\d.]+)\)/)[2])
const mainNode = gnodes.find(n => String(n.attrs.class).includes('is-main'))
const testNode = gnodes.find(n => n.children.some(c => String(c.textContent).includes('test')))
const subNode = gnodes.find(n => n.children.some(c => String(c.textContent).includes('sub')))
check('主线在最上层（y=0）', yOf(mainNode) === 0, String(yOf(mainNode)))
check('一级走向在第二层（y=114）', yOf(testNode) === 114, String(yOf(testNode)))
check('二级走向在第三层（y=228）', yOf(subNode) === 228, String(yOf(subNode)))
const xOf = node => Number(String(node.attrs.transform).match(/translate\(([-\d.]+)/)[1])
const sub2Node = gnodes.find(n => n.children.some(c => String(c.textContent).includes('sub2')))
check('同级走向横向排开（不重叠）', Math.abs(xOf(subNode) - xOf(sub2Node)) === 202, `${xOf(subNode)} vs ${xOf(sub2Node)}`)
const siblingXs = gnodes.filter(n => yOf(n) === 228).map(xOf)
check('父节点居中于全部子节点之上', xOf(testNode) === (Math.min(...siblingXs) + Math.max(...siblingXs)) / 2, `${xOf(testNode)} vs ${(Math.min(...siblingXs) + Math.max(...siblingXs)) / 2}`)
check('连线是贝塞尔曲线（C 命令）', String(edges[0].attrs.d).includes(' C '), String(edges[0].attrs.d))
check('节点方块是圆角矩形', gnodes[0].children[0].tagName === 'rect' && gnodes[0].children[0].attrs.rx === '10', String(gnodes[0].children[0]?.tagName))
check('节点显示走向名与分支', testNode.children.slice(1).map(c => c.textContent).join('|').includes('test') && testNode.children.slice(1).map(c => c.textContent).join('|').includes('branchman/test'), testNode.children.map(c => c.textContent).join('|'))
check('已拆除走向用虚线样式', String(sub2Node.attrs.class).includes('is-dropped'), String(sub2Node.attrs.class))
const sub3Node = gnodes.find(n => n.children.some(c => String(c.textContent).includes('sub3')))
check('已合并走向用绿色样式', String(sub3Node.attrs.class).includes('is-merged'), String(sub3Node.attrs.class))
check('统计行给出走向数', String(t1.stats.textContent).includes('4 条走向'), String(t1.stats.textContent))
check('打开即自动适应窗口（有 scale）', String(g.attrs.transform).includes('scale('), String(g.attrs.transform))

// 点节点 → 详情
const beforeScale = Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1])
testNode.onclick()
check('点方框后详情显示走向名', String(t1.detail.children[0].textContent).includes('test'), String(t1.detail.children[0].textContent))
check('详情显示继承事件数', String(t1.detail.children[1].textContent).includes('继承 5200 事件'), String(t1.detail.children[1].textContent))
check('详情显示工作区路径', String(t1.detail.children[2].textContent).includes('.branches'), String(t1.detail.children[2].textContent))
const goLink = t1.detail.children.find(c => c.className === 'dsh-branchman-link')
check('详情提供「切到该会话」', goLink !== undefined)
await goLink.onclick()
check('切会话经 openSession 生效', calls.some(c => c[0] === 'open' && c[1] === 'session-main'))

// 缩放 / 平移
t1.card.querySelector('.zin').onclick()
const afterZoomIn = Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1])
check('放大按钮提升 scale', afterZoomIn > beforeScale, `${beforeScale} -> ${afterZoomIn}`)
t1.card.querySelector('.zout').onclick()
check('缩小按钮降低 scale', Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1]) < afterZoomIn)
const beforeWheel = Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1])
t1.canvas.onwheel({ deltaY: -100, preventDefault() {} })
check('滚轮向上放大', Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1]) > beforeWheel, `${beforeWheel} -> ${Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1])}`)
t1.card.querySelector('.fit').onclick()
check('适应窗口回到基准 scale', Number(String(g.attrs.transform).match(/scale\(([\d.]+)\)/)[1]) === beforeScale)
const beforePan = String(g.attrs.transform)
t1.canvas.onmousedown({ clientX: 100, clientY: 100 })
t1.canvas.onmousemove({ clientX: 160, clientY: 130 })
check('拖动平移改变画布位移', String(g.attrs.transform) !== beforePan, `${beforePan} -> ${g.attrs.transform}`)
t1.canvas.onmouseup()
check('松手后位移不再变', (() => { const t = String(g.attrs.transform); t1.canvas.onmousemove({ clientX: 400, clientY: 400 }); return String(g.attrs.transform) === t })())

// 刷新（重新拉取）
const fetchesBefore = calls.filter(c => c[0] === 'fetch' && c[1] === '/branchman/api/tree').length
await t1.card.querySelector('.go').onclick()
check('刷新重新拉取树数据', calls.filter(c => c[0] === 'fetch' && c[1] === '/branchman/api/tree').length === fetchesBefore + 1)
check('刷新后不重复叠加节点', t1.canvas.children.length === 1, String(t1.canvas.children.length))

// 空树
globalThis.fetch = async () => ({ ok: true, json: async () => ({ nodes: [] }) })
const t2 = await clickTree()
check('空树给友好提示', String(t2.canvas.children[0]?.textContent).includes('还没有走向'), String(t2.canvas.children[0]?.textContent))
check('空树时统计行为空态', String(t2.stats.textContent).includes('还没有走向'), String(t2.stats.textContent))

// 接口报错
globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'tree backend down' }) })
const t3 = await clickTree()
check('总览接口报错时显示原因', String(t3.err.textContent).includes('tree backend down'), String(t3.err.textContent))

console.log(`\n================  ${pass} passed, ${fail} failed  ================`)
process.exit(fail === 0 ? 0 : 1)
