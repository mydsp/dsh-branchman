// Offline suite for dsh-branchman's CLIENT half.
//
// WHAT THIS SUITE IS, AND IS NOT
//   The plugin's UI can only be *verified* in the running Harness page. Per the
//   host's own verification guidance (cordis-plugin-development →
//   references/verification.md) this suite therefore does NOT emulate React or
//   the DOM, and does not rasterise previews to stand in for a browser: a
//   screenshot of a mock page is not verification of the running plugin.
//
//   What it does instead:
//     1. loads the real client artifact through a `window.__ModuleLoader__`
//        stub and checks the module contract the loader depends on;
//     2. exercises the pure layout maths directly (`__test.layoutTree`) — the
//        one part of the view that is plain logic;
//     3. asserts the conformance rules that ARE checkable statically: no DOM
//        written outside a component, theme tokens only, every visible string
//        routed through the locale dictionary, the sanctioned overlay slot.
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

const source = await readFile(CLIENT, 'utf8')

// ── load the artifact exactly the way the host does ───────────────────────
let loaded = null
globalThis.window = { __ModuleLoader__: { load: bundle => { loaded = bundle } } }
const requested = []
const REACT_STUB = { createElement: () => null, Fragment: Symbol('Fragment') }
const requireStub = name => { requested.push(name); return REACT_STUB }

await import(new URL('../client.js', import.meta.url).href)

check('client.js 通过 window.__ModuleLoader__.load 注册自己', loaded !== null)
check('bundle id 等于包名（宿主据此绑定槽位）', loaded?.id === 'dsh-branchman', String(loaded?.id))
check('factory 是函数', typeof loaded?.factory === 'function')

const mod = loaded.factory(requireStub)
check("只从浏览器模块表取 react（未引任何 Harness Client 包）", requested.length === 1 && requested[0] === 'react', requested.join(','))
check("inject 声明为 ['slots','sessions']", JSON.stringify(mod.inject) === JSON.stringify(['slots', 'sessions']), JSON.stringify(mod.inject))
check('apply 是函数（模块契约 { inject, apply }）', typeof mod.apply === 'function')
check('导出纯函数供离线核对（__test）', typeof mod.__test?.layoutTree === 'function')

// ── pure layout maths ─────────────────────────────────────────────────────
const { layoutTree, clip, NODE_W, NODE_H, H_GAP, V_GAP } = mod.__test
const dir = (name, parentName = null, extra = {}) => ({ name, parentName, status: 'open', cwd: `E:/repo/.branches/${name}`, branch: `branchman/${name}`, ...extra })

const empty = layoutTree([])
check('空树：只有虚拟主线根', empty.root.main === true && empty.root.children.length === 0)
check('空树尺寸不为负', empty.width >= NODE_W && empty.height >= NODE_H)

const one = layoutTree([dir('A')])
check('单条走向：叶子在 0 位', one.root.children[0].cx === 0)
check('单条走向：主线根居中于唯一子节点', one.root.cx === 0)
check('单条走向：每个层级下沉 NODE_H + V_GAP', one.root.children[0].cy === NODE_H + V_GAP)
check('单条走向：宽度=一个节点', one.width === NODE_W)

const two = layoutTree([dir('A'), dir('B')])
const [a, b] = two.root.children
check('兄弟节点不重叠（间隔 H_GAP）', b.cx - a.cx === NODE_W + H_GAP, `${a.cx} → ${b.cx}`)
check('父节点居中于两个子节点之间', two.root.cx === (a.cx + b.cx) / 2, String(two.root.cx))
check('两节点宽度 = 2 节点 + 1 间隔', two.width === 2 * NODE_W + H_GAP, String(two.width))

const tree = layoutTree([
  dir('A'), dir('B'), dir('A1', 'A'), dir('A2', 'A'), dir('B1', 'B'),
])
const nodeOf = (entry, name) => {
  if (entry.node.name === name) return entry
  for (const kid of entry.children) { const hit = nodeOf(kid, name); if (hit !== null) return hit }
  return null
}
check('多级：A1/A2 是 A 的子节点', nodeOf(tree.root, 'A1') !== null && nodeOf(tree.root, 'A2') !== null)
check('多级：A 居中于 A1/A2 之间', nodeOf(tree.root, 'A').cx === (nodeOf(tree.root, 'A1').cx + nodeOf(tree.root, 'A2').cx) / 2)
check('多级：同级不同父不重叠', nodeOf(tree.root, 'A2').cx + NODE_W + H_GAP <= nodeOf(tree.root, 'B1').cx)
check('多级：深度决定 y', nodeOf(tree.root, 'A1').cy === 2 * (NODE_H + V_GAP))
check('多级：高度覆盖最深一层', tree.height === 2 * (NODE_H + V_GAP) + NODE_H)

const orphan = layoutTree([dir('X', 'not-there')])
check('父节点不在列表时按根处理（不会崩、不会丢节点）', orphan.root.children.length === 1 && orphan.root.children[0].node.name === 'X')

check('主线根的 cwd 取自第一条走向的 root', layoutTree([dir('A', null, { root: 'E:/repo' })]).root.node.cwd === 'E:/repo')
check('clip 截断并加省略号', clip('一二三四五六七八九十', 5) === '一二三四…', clip('一二三四五六七八九十', 5))
check('clip 短串原样返回', clip('abc', 5) === 'abc')
check('clip 容忍 null', clip(null, 5) === '')

// ── 跟随父工作区：迁移决策表（真跑纯函数，不是看代码形状） ────────────────
// 走向的目录是 worktree，注册表按目录全等记账（mutate 每次写入都用
// sessionPath(id) === record.path 再过滤一遍），所以它永远进不了仓库那条记录 ——
// 想"跟随父工作区"只能靠宿主的按工作区树分组，而那个偏好在渲染进程的
// localStorage 里、没有服务可调，只能写同一个 key。既然是写别人的数据，
// 就必须证明：默认值才动，用户选过的绝不碰。
const { planGrouping } = mod.__test
const DEFAULT_VIEW = { groupBy: 'workspace', orderBy: 'updated', groupExpansion: { a: true }, sessionOrderByAccount: { x: ['s1'] }, archivedFilter: 'show' }
check('没有走向时什么都不做（不动用户的侧栏）',
  planGrouping(JSON.stringify(DEFAULT_VIEW), false) === null && planGrouping(null, false) === null)
const fresh = planGrouping(null, true)
check('首次：补全默认字段并切成按工作区树',
  fresh?.mark === 'applied' && fresh.value.groupBy === 'workspace-tree'
  && fresh.value.orderBy === 'updated' && fresh.value.archivedFilter === 'default'
  && JSON.stringify(fresh.value.groupExpansion) === '{}', JSON.stringify(fresh))
const patched = planGrouping(JSON.stringify(DEFAULT_VIEW), true)
check('默认档：只改 groupBy，其余偏好逐字保留',
  patched?.mark === 'applied' && patched.value.groupBy === 'workspace-tree'
  && patched.value.orderBy === 'updated' && patched.value.archivedFilter === 'show'
  && JSON.stringify(patched.value.groupExpansion) === '{"a":true}'
  && JSON.stringify(patched.value.sessionOrderByAccount) === '{"x":["s1"]}', JSON.stringify(patched))
check('用户已选平铺 → 记 skipped，一个字节都不写',
  planGrouping(JSON.stringify({ groupBy: 'flat' }), true)?.value === null)
check('用户已经在树上 → 同样不写（幂等）',
  planGrouping(JSON.stringify({ groupBy: 'workspace-tree' }), true)?.value === null)
check('存的值读不出来 → 宁可不动，也不覆盖',
  planGrouping('{ not json', true)?.mark === 'skipped'
  && planGrouping('{ not json', true)?.value === null)

// ── locale dictionary ─────────────────────────────────────────────────────
const { DICT } = mod.__test
const zhKeys = Object.keys(DICT.zh).sort()
const enKeys = Object.keys(DICT.en).sort()
check('中英文字典键完全一致', JSON.stringify(zhKeys) === JSON.stringify(enKeys),
  `zh=${zhKeys.length} en=${enKeys.length}`)
check('字典规模合理（覆盖全部可见文案）', zhKeys.length >= 35, String(zhKeys.length))

const usedKeys = [...source.matchAll(/\btx\('([^']+)'/g)].map(m => m[1])
const missing = [...new Set(usedKeys)].filter(key => !(key in DICT.zh) || !(key in DICT.en))
check(`源码里每个 tx('key') 都在字典里（${new Set(usedKeys).size} 个键）`, missing.length === 0, missing.join(', '))

const paramsUsed = [...source.matchAll(/tx\('([^']+)',\s*\{/g)].map(m => m[1])
check('带参数的文案确实带占位符', paramsUsed.every(key => /\{\w+\}/.test(DICT.zh[key])), paramsUsed.join(', '))

// ── conformance rules that are checkable statically ───────────────────────
// `strip` drops comments first: the file explains these rules in prose, and a
// mention of the forbidden API in a comment is not a use of it.
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const code = strip(source)

check('不向 document.body 写任何东西（规范明令禁止）',
  !/document\.body\s*[.[]?\s*(append|appendChild|prepend|innerHTML|insertBefore)/.test(code))
// One exception is the style element owned by apply's effect — the spec allows
// registering styles there. Nothing else may touch the DOM: views are React.
const created = [...code.matchAll(/document\.createElement\w*\(([^)]*)\)/g)].map(m => m[1].trim())
check('除 apply 里那一个 <style> 外不碰 DOM（视图全部由 React 渲染）',
  created.length === 1 && created[0] === "'style'" && !/createElementNS/.test(code)
  && !/\.appendChild\(/.test(code) && !/\.innerHTML\s*=/.test(code),
  `createElement: ${created.join(' | ') || '无'}`)
check('样式只引用主题令牌 --dsw-alias-*',
  [...source.matchAll(/var\((--[a-z0-9-]+)/g)].every(m => m[1].startsWith('--dsw-alias-')), '发现非令牌变量')
const literalColors = strip(source).match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)
check('没有字面颜色（字面颜色只允许出现在 artwork 里）', literalColors === null, String(literalColors))

check('浮层注册进宿主分配的 shell.overlay 槽位', /ctx\.slots\.inject\('shell\.overlay'/.test(source))
check("浮层的注册项带 locale 命名空间", /id: 'dsh-branchman-overlay'[^}]*locale: NS/.test(source))
check('消息尾部槽位注册了分支按钮与总览按钮',
  /dsh-branchman-branch-button/.test(source) && /dsh-branchman-tree-button/.test(source))
check('输入框旁常驻入口也注册了（composer dock）', /conversation\.composer\.dock/.test(source))
check('样式在 apply 内用 ctx.effect 注册并返回清理',
  /ctx\.effect\(\(\) => \{[\s\S]{0,400}return \(\) => style\.remove\(\)/.test(source))
check('走 locale 服务（register + bind）', /locale\.register\(NS, DICT\)/.test(source) && /bound = locale\.bind\(NS\)/.test(source))
check('切会话走 uiWorkspace.openSession', /workspace\.openSession\(id\)/.test(source))
check('未知会话先同步目录再打开（真实踩过 sessions.retain）', /syncCatalog/.test(source) && /ctx\.sessions\.refresh\?\.\(\)/.test(source))
check('布局常量与宿主视图尺寸一致（VIEW_W/H 用于 viewBox）',
  /viewBox: `0 0 \$\{VIEW_W\} \$\{VIEW_H\}`/.test(source))
check('滚轮缩放用非被动监听（React 的 onWheel 是 passive，preventDefault 无效）',
  /addEventListener\('wheel', onWheel, \{ passive: false \}\)/.test(source))
check('拖动用 pointer 事件并带捕获', /setPointerCapture/.test(source))

// ── 总览从"只能看"变成"能操作"，以及分叉点的精度 ─────────────────────────
// 这一组盯的是需求本身：总览要能动手（合并/同步/拆除），分叉要落在点的那条
// 消息上而不是对话末尾。两条都只有静态可查 —— 真机行为仍须在宿主页里验。
check('总览走 /branchman/api/<path> 调宿主操作', /fetch\(`\/branchman\/api\/\$\{path\}`/.test(source))
check('总览有合并到主线', /opButton\('merge', tx\('det\.merge'\)/.test(source))
check('总览有同步主线（把主线的提交吸收进走向）', /opButton\('sync', tx\('det\.sync'\)/.test(source))
check('总览有拆除走向', /opButton\('drop', tx\('det\.drop'\)/.test(source))
check('拆除是两步确认（一键删 worktree 太危险）',
  /setConfirmDrop\(node\.name\)/.test(source) && /confirmDrop === node\.name/.test(source) && /det\.dropYes/.test(source))
check('操作成功后重取树与 git 状态，并把选中项指到新节点（面板不能停在旧状态）',
  /await callApi\(kind, \{ name: node\.name \}\)[\s\S]{0,200}const refreshed = await load\(\)[\s\S]{0,600}find\(entry => entry\.name === previous\?\.name\)/.test(source))
// 盲操作是不合格的"可操作"：merge/sync 在宿主要求走向内干净，所以必须先把
// git 状态摆出来、并在脏的时候把按钮禁掉，而不是让点击失败。
check('详情面板显示 git 状态（领先/落后/未提交）',
  /loadStatus/.test(source) && /'\/branchman\/api\/status'/.test(source) && /tx\('det\.git', \{/.test(source))
check('有未提交改动时禁用合并/同步并说明原因',
  /opButton\('sync', tx\('det\.sync'\), tx\('det\.sync\.title'\), false, dirty\)/.test(source)
  && /opButton\('merge', tx\('det\.merge'\), tx\('det\.merge\.title'\), false, dirty\)/.test(source)
  && /tx\('det\.dirtyBlock'\)/.test(source))
check('拆除不受脏工作区限制（设计上就是强删）',
  /opButton\('drop', tx\('det\.drop'\), tx\('det\.drop\.title'\), true\)/.test(source))
check('status 读取失败不拖垮树（单独 try/catch）',
  /const loadStatus = React\.useCallback[\s\S]{0,700}catch \{[\s\S]{0,120}setStatus\(\{\}\)/.test(source))
check('操作按钮用 act 类且只吃主题令牌', /\.dsh-branchman-act\{/.test(source))
check('已拆除的走向不给操作按钮', /node\.status === 'dropped'/.test(source) && /opsReady === false/.test(source))
// 客户端刷新页面就更新、宿主半边只能重启才更新 —— 两个半边可能差一个版本，
// 所以界面不能在路由还不存在时就把按钮摆出来（点了就是 404）。
check('宿主还没加载新版本时不摆操作按钮，而是说明原因',
  /const opsReady = data\?\.capabilities\?\.operations === true/.test(source) && /tx\('det\.opsPending'\)/.test(source))
check('取消归档同样受 opsReady 门控', /node\.archived === true && opsReady/.test(source))
check('分支请求带上按钮所属消息的 id（否则只能从最新回合分叉）',
  /messageId: typeof props\?\.messageId === 'string' \? props\.messageId : undefined/.test(source))
check('工作区登记失败会如实告知用户', /msg\.wsWarning/.test(source) && /forked\.workspaceWarning/.test(source))
// 归档：被归档的会话在任何分组里都被隐藏，所以"挂上工作区"不等于"看得见"。
check('总览标出已归档的走向', /node\.archived === true && hasSession/.test(source) && /tx\('det\.archived'\)/.test(source))
check('已归档的走向能一键取消归档', /runUnarchive\(node\)/.test(source) && /tx\('det\.unarchive'\)/.test(source))
// 只取消归档 = 从"到处看不见"变成「未分组」，所以必须由宿主一次做完两件事。
check('取消归档走宿主路由（补工作区 + 取消归档是原子操作）',
  /callApi\('unarchive', \{ name: node\.name \}\)/.test(source) && !/uiWorkspace\.unarchiveSession/.test(source))
// 总览是**每一条**对话的地图，不是"用过分支功能的那几条"的名册 —— 否则用户
// 会以为只有方框里那一条能用分支。所以要标出"你在这里"，并在这里也能开走向。
check('总览标出当前对话（你在这里 / 当前对话）',
  /const isHere = entry =>/.test(source) && /tx\('ov\.here'\)/.test(source)
  && /tx\('ov\.currentMain'\)/.test(source))
check('总览里能直接从当前对话开走向（不是只能看历史）',
  /tx\('ov\.branchHere'\)/.test(source) && /setView\(\{ kind: 'fork', props: \{ sessionId: currentId/.test(source))
check('写明"每条对话都能开走向"（旧文案只指向消息尾按钮）',
  /tx\('ov\.anyConversation'\)/.test(source) && !/Branch to a new direction” to open the first one/.test(source))
// 走向必然与仓库并列：注册表按目录全等记账（mutate 每次写入都按 sessionPath(id)
// === record.path 再过滤一遍，attachSession 直接抛 cwd resolves to），worktree
// 所以只能自己占一格。要它"跟随父工作区"就只能靠宿主的按工作区树分组。
check('解释"走向为什么与仓库并列"，并指向宿主的按工作区树分组',
  /'ov\.grouping'/.test(source) && /'ov\.groupingDone'/.test(source)
  && /按工作区树/.test(source) && /目录全等/.test(source))
// 迁移本身由上面那张决策表真跑验证；这里只钉住"写的是哪个 key、只做一次"。
check('写的是宿主自己的视图偏好 key，且每页只尝试一次',
  /const VIEW_KEY = 'dsh\.workspace\.view\.v5'/.test(source) && /if \(followChecked\) return/.test(source)
  && /localStorage\.setItem\(VIEW_KEY, JSON\.stringify\(plan\.value\)\)/.test(source))
// 视图偏好在启动时读一次，所以新值要下一次加载才生效。让用户为此再刷一次
// （而他没理由知道要刷）就是又一次"功能没落实"—— 所以自己把这唯一一次刷新做掉，
// 且标记先落盘，绝不可能成环。
check('自己完成那唯一一次刷新，且标记先写（不可能循环）',
  /localStorage\.setItem\(FOLLOW_MARK, plan\.mark\)[\s\S]{0,700}plan\.mark === 'applied'[\s\S]{0,140}location\.reload\(\)/.test(source))
check('已应用/已跳过之后，总览文案自动换成"已切换 + 怎么改回来"',
  /tx\(groupingFollowed\(\) \? 'ov\.groupingDone' : 'ov\.grouping'\)/.test(source))

// ── 总览打开就该有东西可操作 ──────────────────────────────────────────────
// 四个操作全在详情面板里，而面板原本要点了方框才出现 —— 打开总览只看到一张图和
// "点一个方框查看详情"，读起来就是"操作根本没做"。
const at = needle => source.indexOf(needle)
check('打开总览就自动选中一个节点（面板不再是空的）',
  /setSelected\(nodes\.find\(node => node\.sessionId === currentId\) \?\? newest \?\? layout\.root\.node\)/.test(source))
// 依赖数组在 render 期求值，所以这个 effect 必须写在 nodes / currentId 之后 ——
// 早一行就是 TDZ ReferenceError，整块界面白屏。
check('自动选中声明在 nodes / currentId 之后（依赖数组在 render 期求值）',
  at('const nodes = Array.isArray(data?.nodes)') < at('if (selected !== null || layout === null) return')
  && at('const currentId = (() =>') < at('if (selected !== null || layout === null) return'),
  `${at('const nodes = Array.isArray(data?.nodes)')} / ${at('const currentId = (() =>')} / ${at('if (selected !== null || layout === null) return')}`)
// 归档**没有事件可听**（asar 里 session/archived、workspace/archived 均 0 匹配，
// 归档只是 registry 状态经 RPC 落库），所以树只能重读。
check('总览打开期间定时重读树（归档/删除没有事件可听）',
  /setInterval\(\(\) => \{ void load\(\) \}, 4000\)/.test(source)
  && /return \(\) => clearInterval\(timer\)/.test(source))
check('手动删除对话 / 手动删目录都在面板里说明白',
  /node\.sessionMissing === true \? React\.createElement[\s\S]{0,120}tx\('det\.sessionMissing'\)/.test(source)
  && /node\.missingDir === true \? React\.createElement[\s\S]{0,120}tx\('det\.missingDir'\)/.test(source))

// ── 客户端调用的路由必须真的存在，而且方法对得上 ──────────────────────────
// 这条是血换来的：迁移代码用了 `callApi('tree')`，而 callApi 一律 POST，
// 宿主的 `/branchman/api/tree` 只接受 `req.method === 'GET'` —— 于是整段迁移
// 变成静默空操作：侧栏一动不动，localStorage 里连标记都没有，表现和"功能没做"
// 完全一样。两侧的方法必须在这里对上。
const hostSource = await readFile(join(ROOT, 'index.js'), 'utf8')
const routesFor = method => new Set(
  [...hostSource.matchAll(new RegExp(`path === '/branchman/api/([\\w-]+)' && req\\.method === '${method}'`, 'g'))]
    .map(m => m[1]))
const GET_ROUTES = routesFor('GET')
const POST_ROUTES = routesFor('POST')
check('宿主确实注册了 tree / status 的 GET 路由', GET_ROUTES.has('tree') && GET_ROUTES.has('status'),
  [...GET_ROUTES].join(','))
const viaCallApi = [...source.matchAll(/callApi\('([\w-]+)'/g)].map(m => m[1])
check('callApi 只用于 POST 路由（它是 POST-only 的 helper）',
  viaCallApi.every(path => POST_ROUTES.has(path)),
  viaCallApi.filter(path => !POST_ROUTES.has(path)).join(','))
const viaGet = [...source.matchAll(/fetch\('\/branchman\/api\/([\w-]+)'\)/g)].map(m => m[1])
check('无参数的 fetch(...) 只用于 GET 路由（POST 会被宿主 404）',
  viaGet.every(path => GET_ROUTES.has(path)), viaGet.filter(path => !GET_ROUTES.has(path)).join(','))
check('读树读状态走 GET —— 迁移与总览都靠这条',
  viaGet.includes('tree') && viaGet.includes('status'), viaGet.join(','))
check('迁移不再静默失败（吞掉的异常正是它藏了一轮的原因）',
  /console\.warn\('\[branchman\] could not switch the sidebar grouping:'/.test(source))

console.log(`\n================  ${pass} passed, ${fail} failed  ================`)
if (fail > 0) process.exit(1)
