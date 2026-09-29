// Offline visual check for the directions overview: renders an SVG through the
// plugin's OWN drawing code, so the layout can be reviewed without launching DSH.
//
//   node scripts/preview-overview.mjs sample                     # 5-node fixture
//   node scripts/preview-overview.mjs real                       # your $DSH_HOME tree
//   node scripts/preview-overview.mjs sample out.svg             # explicit target
//
// Then rasterise with: python scripts/shot-overview.py
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const MODE = process.argv[2] ?? 'sample'
// Scratch output by default: keeping it out of docs/ keeps the npm tarball clean.
const OUT = process.argv[3] ?? join(ROOT, 'test', '.tmp', 'preview.svg')
mkdirSync(dirname(OUT), { recursive: true })
const CLIENT = join(ROOT, 'client.js')

const makeEl = (tag = 'div') => ({
  tagName: tag, className: '', textContent: '', value: '',
  style: {}, children: [], title: '', type: '', _html: '', attrs: {},
  append(...nodes) { for (const n of nodes) this.children.push(n); return nodes[0] },
  get innerHTML() { return this._html },
  set innerHTML(v) { this._html = String(v); this.children.length = 0 },
  setAttribute(k, v) { this.attrs[k] = String(v) },
  getAttribute(k) { return this.attrs[k] ?? null },
  remove() {}, focus() {}, addEventListener() {},
  querySelector(sel) { this.q ??= {}; return (this.q[sel] ??= makeEl(sel)) },
  onclick: null,
})
const body = makeEl('body')
globalThis.document = { createElement: makeEl, createElementNS: (ns, tag) => makeEl(tag), head: makeEl('head'), body }

const hooks = []
globalThis.window = { __ModuleLoader__: { load: e => { globalThis.__entry = e } } }
const React = {
  useRef: () => { const r = { current: null }; hooks.push(r); return r },
  useEffect: fn => { hooks.push(fn) },
  createElement: (tag, props) => ({ tag, props }),
}

const realNodes = () => {
  const home = process.env.DSH_HOME
  if (home === undefined || home === '') {
    console.warn('  (DSH_HOME 未设置，real 模式回退到示例数据)')
    return sampleNodes()
  }
  try {
    return JSON.parse(readFileSync(join(home, 'branchman', 'tree.json'), 'utf8')).nodes.map(n => ({ ...n }))
  } catch (error) {
    console.warn(`  (读不到 ${join(home, 'branchman', 'tree.json')}：${error.message}；回退到示例数据)`)
    return sampleNodes()
  }
}
const sampleNodes = () => [
  { name: '走向-视觉方案', parentName: null, root: 'E:/repo', branch: 'branchman/走向-视觉方案', cwd: 'E:/repo/.branches/走向-视觉方案', status: 'open', sessionId: 'session-a', inheritedEvents: 5200, messageCount: 34, lastActivityAt: '2026-09-29T05:19:23Z' },
  { name: '走向-视觉方案-稀疏重建', parentName: '走向-视觉方案', root: 'E:/repo', branch: 'branchman/sparse', cwd: 'E:/repo/.branches/sparse', status: 'open', sessionId: 'session-b', inheritedEvents: 5280, messageCount: 6, lastActivityAt: '2026-09-29T06:02:00Z' },
  { name: '走向-控制算法', parentName: null, root: 'E:/repo', branch: 'branchman/走向-控制算法', cwd: 'E:/repo/.branches/走向-控制算法', status: 'open', sessionId: 'session-c', inheritedEvents: 4100, messageCount: 12, lastActivityAt: '2026-09-29T04:40:00Z' },
  { name: '走向-控制算法-纯追踪', parentName: '走向-控制算法', root: 'E:/repo', branch: 'branchman/pure-pursuit', cwd: 'E:/repo/.branches/pure-pursuit', status: 'dropped', sessionId: 'session-d', inheritedEvents: 4150, messageCount: 2, lastActivityAt: '2026-09-29T03:10:00Z' },
  { name: '走向-数据管线', parentName: null, root: 'E:/repo', branch: 'branchman/走向-数据管线', cwd: 'E:/repo/.branches/走向-数据管线', status: 'merged', sessionId: 'session-e', inheritedEvents: 3900, messageCount: 21, lastActivityAt: '2026-09-28T22:00:00Z' },
]
const nodes = MODE === 'real' ? realNodes() : sampleNodes()

new Function(readFileSync(CLIENT, 'utf8'))()
const registered = []
const ctx = {
  slots: { inject: (name, cb) => cb(), register: (o, C) => { registered.push({ options: o, Component: C }); return () => {} } },
  effect: fn => { fn(); return () => {} },
  inject: (names, cb) => cb({ uiWorkspace: { openSession: () => {} } }),
  sessions: {
    list: { getSnapshot: () => ({ current: 'session-main', byId: { 'session-main': {} } }) },
    refresh: async () => {},
    create: async () => 'session-x',
    scope: () => undefined,
    sessionOf: () => undefined,
  },
}
globalThis.fetch = async url => (url === '/branchman/api/tree'
  ? { ok: true, json: async () => ({ nodes }) }
  : { ok: true, json: async () => ({}) })
globalThis.__entry.factory(name => { if (name === 'react') return React; throw new Error(name) }).apply(ctx)

const treeReg = registered.find(r => r.options.id === 'dsh-branchman-tree-button')
const host = makeEl('span')
const before = hooks.length
treeReg.Component({ sessionId: 'session-main' })
for (const h of hooks.slice(before)) { if (h.current !== undefined) h.current = host }
for (const h of hooks.slice(before)) { if (typeof h === 'function') h() }
await host.children[0].onclick()

const svg = body.children.at(-1).children[0].querySelector('.dsh-branchman-canvas').children[0]
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ser = el => {
  const attrs = Object.entries(el.attrs ?? {}).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')
  if (el.tagName === 'text') return `<text${attrs}>${esc(el.textContent)}</text>`
  return `<${el.tagName}${attrs}>${(el.children ?? []).map(ser).join('')}</${el.tagName}>`
}
const CSS = `
  .dsh-branchman-box{fill:#fff;stroke:#cbd5e1;stroke-width:1.5}
  .dsh-branchman-gnode.is-main .dsh-branchman-box{fill:#111827;stroke:#111827}
  .dsh-branchman-gnode.is-main .dsh-branchman-t1{fill:#fff}
  .dsh-branchman-gnode.is-main .dsh-branchman-t2{fill:#9ca3af}
  .dsh-branchman-gnode.is-merged .dsh-branchman-box{stroke:#10b981}
  .dsh-branchman-gnode.is-merged .dsh-branchman-t1{fill:#065f46}
  .dsh-branchman-gnode.is-dropped .dsh-branchman-box{fill:#f8fafc;stroke-dasharray:4 3}
  .dsh-branchman-gnode.is-dropped .dsh-branchman-t1{fill:#9ca3af}
  .dsh-branchman-edge{stroke:#cbd5e1;stroke-width:1.6}
  .dsh-branchman-t1{font:600 12px Inter,system-ui,sans-serif;fill:#111827}
  .dsh-branchman-t2{font:10px ui-monospace,Menlo,monospace;fill:#9ca3af}
`
writeFileSync(OUT, `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="520" viewBox="${svg.attrs.viewBox}">
<style>${CSS}</style>
<rect x="0" y="0" width="960" height="520" fill="#fbfbfc"/>
${ser(svg.children[0])}
</svg>`, 'utf8')
console.log(`已生成 ${OUT}（模式=${MODE}，节点=${nodes.length}，${svg.children[0].attrs.transform}）`)
