// Offline test for the SEEDED fork path (p5): verifies the plugin creates the
// child conversation the way the host's own fork does — inherited history seed,
// agent composition, and cwd bound to the worktree — instead of an empty child.
//
// index.js is copied verbatim into a throwaway package whose node_modules
// shims '@deepseek-ai/dsh-tools' and '@deepseek-ai/dsh-session/fork', so the
// bare host imports resolve to stubs here. The first assertion pins that the
// copy is byte-identical to the file under test.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const GIT = process.env.GIT_PATH ?? 'git'
const PKG = join(ROOT, 'test', '.tmp', 'pkg')
const SRC = ROOT
const SCRATCH = join(PKG, 'repo')
const TREE = join(PKG, 'tree.json')
const NAME = '走向-种子测试'

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`) }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`) }
}

// ── throwaway package: real copies + shimmed peers ────────────────────────
await rm(PKG, { recursive: true, force: true })
await mkdir(PKG, { recursive: true })
for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'package.json']) {
  await copyFile(join(SRC, file), join(PKG, file))
}
const same = (await readFile(join(SRC, 'index.js'), 'utf8')) === (await readFile(join(PKG, 'index.js'), 'utf8'))
check('测试包用的是部署文件的逐字副本', same)

const shim = async (name, files) => {
  const dir = join(PKG, 'node_modules', '@deepseek-ai', name)
  await mkdir(dir, { recursive: true })
  for (const [file, body] of Object.entries(files)) await writeFile(join(dir, file), body, 'utf8')
}
await shim('dsh-tools', {
  'package.json': JSON.stringify({ name: '@deepseek-ai/dsh-tools', type: 'module', exports: { '.': './index.js' } }),
  'index.js': 'export const defineTool = definition => definition\n',
})
await shim('dsh-session', {
  'package.json': JSON.stringify({ name: '@deepseek-ai/dsh-session', type: 'module', exports: { '.': './index.js', './fork': './fork.js' } }),
  'index.js': 'export const SessionSeq = value => value\n',
  'fork.js': `export function buildForkSeed(events, boundary) {
  const prefix = events.slice(0, boundary + 1)
  prefix.push({ type: 'session/end-seed', seq: boundary + 1, data: { inherited: true } })
  return prefix
}
`,
})

// ── scratch repo ──────────────────────────────────────────────────────────
await mkdir(SCRATCH, { recursive: true })
const g = (args, cwd = SCRATCH) => exec(GIT, args, { cwd })
await g(['init', '-b', 'main'])
await g(['config', 'user.email', 'itest@local'])
await g(['config', 'user.name', 'branchman-itest'])
await writeFile(join(SCRATCH, 'README.md'), '# seeded-fork scratch\n', 'utf8')
await g(['add', '-A'])
await g(['commit', '-m', 'init'])

// ── fake host ctx WITH the richer services ────────────────────────────────
const tools = new Map()
const calls = []
// 事件序列刻意做成"两个回合"：官方边界算法 = 最后一个 turn/end（seq 3）+ 它
// 之后同回合的尾部事件（seq 4），遇到新回合（seq 5 turn/start）就停 → 边界 4，
// 即继承 5 条。若插件误用"最后一个事件"，这里会算出 6/7 条并失败。
const sourceEvents = [
  { type: 'turn/start', seq: 0, time: 1000, data: {} },
  { type: 'user/message', seq: 1, time: 1001, data: {} },
  { type: 'assistant/message', seq: 2, time: 1002, data: {} },
  { type: 'turn/end', seq: 3, time: 1003, data: {} },
  { type: 'session/title', seq: 4, time: 1004, data: {} },
  { type: 'turn/start', seq: 5, time: 1005, data: {} },
  { type: 'user/message', seq: 6, time: 1006, data: {} },
]
const EXPECTED_BOUNDARY = 4
const EXPECTED_INHERITED = 5
// 两个**完整回合**的源：验"从你点的那条消息分叉"。回合 1 结束于 seq 3，回合 2
// 结束于 seq 8 —— 两者有明显差距，所以一旦插件忽略 messageId、退回"最新完成
// 回合"，断言就会失败（不是靠时序碰巧通过）。
const twoTurnEvents = [
  { type: 'turn/start', seq: 0, time: 10, data: {} },
  { type: 'user/message', seq: 1, time: 11, data: { id: 'user-1' } },
  { type: 'assistant/message', seq: 2, time: 12, data: { message: { id: 'msg-1' } } },
  { type: 'turn/end', seq: 3, time: 13, data: {} },
  { type: 'turn/start', seq: 4, time: 14, data: {} },
  { type: 'user/message', seq: 5, time: 15, data: { id: 'user-2' } },
  { type: 'assistant/message', seq: 6, time: 16, data: { message: { id: 'msg-2' } } },
  { type: 'step/end', seq: 7, time: 17, data: {} },
  { type: 'turn/end', seq: 8, time: 18, data: {} },
]
let disposed = false

const ctx = {
  tools: { register: def => { tools.set(def.name, def); return () => {} } },
  on: () => () => {},
  effect: fn => { fn(); return () => {} },
  webServer: { register: () => () => {} },
  logger: { warn: (...a) => console.log('  [warn]', ...a), info: () => {}, error: () => {} },
  sessions: {
    create: (id, options) => { calls.push(['sessions.create', id, options?.meta]); return { id: id ?? 'session-bare-1' } },
    get: () => undefined,
  },
  // 宿主对未声明 inject 的服务访问会抛错，所以插件必须经 ctx.inject 取
  inject: (names, cb) => {
    calls.push(['inject', names.join(',')])
    cb({
      sessionQuery: {
        observeSession: async sessionId => {
          calls.push(['observeSession', sessionId])
          return {
            header: { id: sessionId, cwd: SCRATCH },
            // 官方 presetForObservation 就是读这个字段
            projections: { values: { agentPreset: 'default' } },
            // session-fresh：只有未完成的回合，官方 fork 会直接拒绝
            events: sessionId === 'session-fresh'
              ? [{ type: 'turn/start', seq: 0, time: 900, data: {} }, { type: 'user/message', seq: 1, time: 901, data: {} }]
              : sessionId === 'session-two-turns' ? twoTurnEvents : sourceEvents,
            [Symbol.dispose]() { disposed = true },
          }
        },
      },
      // 真实 `agents` 服务只有 create/get 等；presetForObservation 与
      // composeAgent 是控制器的私有助手，不存在于服务上（真实报错：
      // "agents.presetForObservation is not a function"）。桩照此形状，
      // 所以插件若再调用它们，本套件会直接失败。
      agents: {
        create: async request => { calls.push(['agents.create', request]); return { id: request.sessionId } },
      },
      agentDefaultModel: { currentSelection: () => ({ provider: 'wb', model: 'cn:deepseek-v4.1-flash' }) },
      // 真实 registry：create(path,title) 返回实体，实体自己带 attachSession；
      // 官方控制器就是这么挂子会话的（`workspace.attachSession(childId)`）。
      workspaceRegistry: {
        create: async (path, title) => {
          calls.push(['ws.create', path, title])
          return { id: 'ws-1', path, title, attachSession: async id => { calls.push(['ws.attach', id]) } }
        },
        resolveByPath: async path => { calls.push(['ws.resolveByPath', path]); return { id: 'ws-1' } },
        delete: async id => { calls.push(['ws.delete', id]); return true },
        // 归档是注册表全局的集合；被归档的会话在任何分组里都会被隐藏
        // （sessionVisible 过滤），所以树必须把这个状态报出来 —— 只挂上工作区
        // 但会话已归档的走向，在侧栏里照样看不见。
        archivedSessionIds: ['session-legacy'],
      },
    })
  },
  // 官方 composeAgent 用的是 ctx.get("agentPresets")
  get: name => (name === 'agentPresets'
    ? {
        resolve: async id => { calls.push(['presets.resolve', id]); return { id } },
        mount: async (agentCtx, id) => { calls.push(['presets.mount', id]) },
      }
    : undefined),
}

// 0.1.x 时代的走向没有任何工作区登记，而注册表自己的历史对账**只跑一次**
// （仅在其 domain 未初始化时）——所以插件必须在 activate 时自己补登记，
// 否则升级后老走向照样落在「未分组」里。
const LEGACY = '走向-老数据'
const legacyCwd = join(SCRATCH, '.branches', LEGACY)
await mkdir(legacyCwd, { recursive: true })
await writeFile(TREE, JSON.stringify({
  version: 1,
  nodes: [{
    name: LEGACY, cwd: legacyCwd, root: SCRATCH, branch: `branchman/${LEGACY}`,
    sessionId: 'session-legacy', status: 'open', messageCount: 1,
  }],
}), 'utf8')

const mod = await import(pathToFileURL(join(PKG, 'index.js')).href)
await mod.apply(ctx, { dataFile: TREE, defaultRoot: SCRATCH, gitPath: GIT })
await new Promise(resolve => setTimeout(resolve, 40))
check('六个工具全部注册（含 branch_sync）', tools.size === 6, [...tools.keys()].join(','))
check('激活时给老走向补登记工作区（否则升级后仍在「未分组」）',
  calls.some(c => c[0] === 'ws.create' && c[1] === legacyCwd && c[2] === `走向 ${LEGACY}`),
  JSON.stringify(calls.filter(c => c[0] === 'ws.create')))
check('老走向的会话也挂进该工作区',
  calls.some(c => c[0] === 'ws.attach' && c[1] === 'session-legacy'),
  JSON.stringify(calls.filter(c => c[0] === 'ws.attach')))

// ── fork with a source conversation ───────────────────────────────────────
const forked = JSON.parse(await tools.get('branch_fork').execute({
  name: NAME, root: SCRATCH, sourceSessionId: 'session-main', sourceCwd: SCRATCH,
}))
console.log(JSON.stringify(forked, null, 2))

const create = calls.find(c => c[0] === 'agents.create')
check('走了宿主同款 fork 路径（agents.create）', create !== undefined)
check('没有退回裸会话（sessions.create 未被调用）', !calls.some(c => c[0] === 'sessions.create'),
  JSON.stringify(calls.filter(c => c[0] === 'sessions.create')))
check('observeSession 读取了源会话', calls.some(c => c[0] === 'observeSession' && c[1] === 'session-main'))
check('子会话 id 为 session-<uuid>', /^session-[0-9a-f-]{36}$/.test(create?.[1]?.sessionId ?? ''), String(create?.[1]?.sessionId))
check('按官方边界算法取已完成前缀（boundary=4 → 继承 5 条）', create?.[1]?.inheritedEventCount === EXPECTED_INHERITED, String(create?.[1]?.inheritedEventCount))
check('seed 是 buildForkSeed 的产物（含 end-seed 关闭标记）',
  Array.isArray(create?.[1]?.seed) && create[1].seed.some(e => e.type === 'session/end-seed'))
check('meta.cwd 指向 worktree', String(create?.[1]?.meta?.cwd ?? '').includes('.branches'), String(create?.[1]?.meta?.cwd))
check('meta.parentSession 指向源会话', create?.[1]?.meta?.parentSession === 'session-main')
check('meta.isSeeded 为 true', create?.[1]?.meta?.isSeeded === true)
check('meta 不含 origin（否则触发 origin 守卫）', !('origin' in (create?.[1]?.meta ?? {})))
check('带上默认模型选择', create?.[1]?.agentOptions?.provider === 'wb' && create?.[1]?.agentOptions?.model === 'cn:deepseek-v4.1-flash')
check('preset 取自观察快照并经 agentPresets.resolve', calls.some(c => c[0] === 'presets.resolve' && c[1] === 'default'),
  JSON.stringify(calls.filter(c => c[0] === 'presets.resolve')))
check('meta.agentPreset 用 resolve 后的 id', create?.[1]?.meta?.agentPreset === 'default', String(create?.[1]?.meta?.agentPreset))
check('agent 组合结果传入 setup', typeof create?.[1]?.setup === 'function')
// setup 必须真的把 preset 挂上去（等价于控制器的 presets.mount）
if (typeof create?.[1]?.setup === 'function') await create[1].setup({}, {})
check('setup 执行时调用 agentPresets.mount', calls.some(c => c[0] === 'presets.mount' && c[1] === 'default'),
  JSON.stringify(calls.filter(c => c[0] === 'presets.mount')))
check('不再调用不存在的 agents.presetForObservation',
  !calls.some(c => c[0] === 'presetForObservation' || c[0] === 'composeAgent'))
check('observation 已释放', disposed === true)
check('返回体标注已继承历史', forked.seeded === true && forked.inheritedEvents === EXPECTED_INHERITED, JSON.stringify({ seeded: forked.seeded, inherited: forked.inheritedEvents }))
check('worktree 目录已建立', existsSync(forked.cwd))
check('提示语不再声称空会话', forked.hint.includes(`继承前 ${EXPECTED_INHERITED} 条事件`), forked.hint.split('\n').at(-1))

// ── 工作区记账：会话落在「未分组」的那个 bug ──────────────────────────────
// Workspace 按 cwd 全等记账（dsh-workspace: sessionPath(id) === record.path），
// 走向的子会话 cwd 是 worktree，所以不建工作区就必然落到「未分组」。
console.log('\n### 工作区记账')
check('为 worktree 建了工作区', calls.some(c => c[0] === 'ws.create' && c[1] === forked.cwd && c[2] === `走向 ${NAME}`),
  JSON.stringify(calls.filter(c => c[0] === 'ws.create')))
check('子会话挂进该工作区（官方 fork 的 workspace.attachSession 步骤）',
  calls.some(c => c[0] === 'ws.attach' && c[1] === forked.sessionId),
  JSON.stringify(calls.filter(c => c[0] === 'ws.attach')))
check('返回体带上 workspaceId', forked.workspaceId === 'ws-1', String(forked.workspaceId))
check('登记成功时不产生告警', forked.workspaceWarning === undefined, String(forked.workspaceWarning))

// ── 从"你点的那条消息"分叉（pi 的 /tree 语义） ───────────────────────────
console.log('\n### 从点的那条消息分叉')
calls.length = 0
const forkedMsg = JSON.parse(await tools.get('branch_fork').execute({
  name: '走向-精确分叉', root: SCRATCH, sourceSessionId: 'session-two-turns', sourceCwd: SCRATCH,
  messageId: 'msg-1',
}))
let seededCall = calls.find(c => c[0] === 'agents.create')
check('只继承到那条消息所在的回合（boundary=3 → 4 条）', seededCall?.[1]?.inheritedEventCount === 4,
  String(seededCall?.[1]?.inheritedEventCount))
check('返回体标注分叉点来源为 message', forkedMsg.boundarySource === 'message', String(forkedMsg.boundarySource))
check('提示语说明是从点的那条消息分叉', forkedMsg.hint.includes('你点的那条消息'), forkedMsg.hint)

calls.length = 0
const forkedTail = JSON.parse(await tools.get('branch_fork').execute({
  name: '走向-整个对话', root: SCRATCH, sourceSessionId: 'session-two-turns', sourceCwd: SCRATCH,
}))
seededCall = calls.find(c => c[0] === 'agents.create')
check('不给 messageId 时退回最新完成回合（boundary=8 → 9 条）', seededCall?.[1]?.inheritedEventCount === 9,
  String(seededCall?.[1]?.inheritedEventCount))
check('返回体标注来源为 latest-turn', forkedTail.boundarySource === 'latest-turn', String(forkedTail.boundarySource))

calls.length = 0
const forkedGhost = JSON.parse(await tools.get('branch_fork').execute({
  name: '走向-幽灵消息', root: SCRATCH, sourceSessionId: 'session-two-turns', sourceCwd: SCRATCH,
  messageId: 'no-such-message',
}))
seededCall = calls.find(c => c[0] === 'agents.create')
check('认不出的 messageId 静默退回最新完成回合（不挡路）', seededCall?.[1]?.inheritedEventCount === 9,
  String(seededCall?.[1]?.inheritedEventCount))

const tree = JSON.parse(await tools.get('branch_tree').execute({}))
const node = tree.nodes.find(n => n.name === NAME)
check('树节点记录继承事件数', node?.inheritedEvents === EXPECTED_INHERITED, JSON.stringify(node))
check('树节点记住 workspaceId（drop 时才能注销）', node?.workspaceId === 'ws-1', String(node?.workspaceId))
check('capabilities 自报 workspaceRegistry 可用', tree.capabilities?.workspaceRegistry === true, JSON.stringify(tree.capabilities))
check('补登记把 workspaceId 写回树节点（drop 时才能注销）',
  tree.nodes.find(n => n.name === LEGACY)?.workspaceId === 'ws-1',
  String(tree.nodes.find(n => n.name === LEGACY)?.workspaceId))
// 归档：注册表全局集合，被归档的会话在**所有**分组里都被隐藏 —— 挂上工作区
// 也救不回来，所以树必须把它报出来，UI 才能给"取消归档"。
check('树报出已归档的走向（只挂工作区救不了它）',
  tree.nodes.find(n => n.name === LEGACY)?.archived === true,
  JSON.stringify(tree.nodes.map(n => [n.name, n.archived])))
check('未归档的走向不会误标 archived',
  tree.nodes.find(n => n.name === NAME)?.archived === false,
  JSON.stringify(tree.nodes.map(n => [n.name, n.archived])))

// ── agent 工具路径：从"调用它的那条对话"分叉 ─────────────────────────────
// dsh-tools 调 tool.execute(args, exec)，exec.agent 就是调用方（dsh-deja 也
// 读同一处）。不读它，branch_fork 建出来的永远是空子会话，"从当前对话开一条
// 走向"这句话就是假的。
console.log('\n### agent 工具从调用它的会话分叉')
calls.length = 0
const forkedTool = JSON.parse(await tools.get('branch_fork').execute(
  { name: '走向-工具路径' },
  {
    name: 'branch_fork',
    arguments: {},
    agent: { sessionId: 'session-two-turns', session: { id: 'session-two-turns', header: { cwd: SCRATCH } } },
  },
))
seededCall = calls.find(c => c[0] === 'agents.create')
check('工具路径继承调用方会话的历史（9 条，不是空会话）', seededCall?.[1]?.inheritedEventCount === 9,
  String(seededCall?.[1]?.inheritedEventCount))
check('工具路径的 root 取自调用方 cwd', String(forkedTool.cwd ?? '').startsWith(SCRATCH), String(forkedTool.cwd))
check('工具路径同样建了工作区并挂上子会话', calls.some(c => c[0] === 'ws.attach' && c[1] === forkedTool.sessionId),
  JSON.stringify(calls.filter(c => c[0] === 'ws.attach')))

// ── 源会话没有"已完成回合"：官方直接拒绝 fork，这里必须优雅降级 ────────────
console.log('\n### 源会话没有已完成回合时')
calls.length = 0
const forked2 = JSON.parse(await tools.get('branch_fork').execute({
  name: '走向-无回合', root: SCRATCH, sourceSessionId: 'session-fresh', sourceCwd: SCRATCH,
}))
check('仍把走向建好（不因无回合挡路）', /^session-/.test(String(forked2.sessionId)), String(forked2.sessionId))
check('明确标注未继承历史', forked2.seeded === false && forked2.inheritedEvents === 0,
  JSON.stringify({ seeded: forked2.seeded, inherited: forked2.inheritedEvents }))
check('退回裸会话创建', calls.some(c => c[0] === 'sessions.create'))

// ── 拆除：工作区登记不能比走向活得久 ─────────────────────────────────────
console.log('\n### 拆除走向时注销工作区')
calls.length = 0
await tools.get('branch_drop').execute({ name: NAME })
check('drop 注销了工作区登记（不留空分组）', calls.some(c => c[0] === 'ws.delete' && c[1] === 'ws-1'),
  JSON.stringify(calls.filter(c => c[0].startsWith('ws.'))))

console.log(`\n================  ${pass} passed, ${fail} failed  ================`)
process.exit(fail === 0 ? 0 : 1)
