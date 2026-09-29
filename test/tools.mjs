// Offline integration test for dsh-branchman's host half.
// Drives the REAL plugin module through a fake ctx — no host restart, no
// user involvement, and a throwaway scratch repo so your own repo is untouched.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const exec = promisify(execFile)
const ROOT = fileURLToPath(new URL('..', import.meta.url))
// git comes from PATH by default; GIT_PATH covers portable installs (Windows
// users often keep git outside PATH) and CI runners that pin a specific build.
const GIT = process.env.GIT_PATH ?? 'git'
const SCRATCH = join(ROOT, 'test', '.tmp', 'tools')
const REPO = join(SCRATCH, 'repo')
const TREE = join(SCRATCH, 'tree.json')
const MOD = pathToFileURL(join(ROOT, 'index.js')).href
const NAME = '走向-集成测试'

const g = (args, cwd = REPO) => exec(GIT, args, { cwd })

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`) }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`) }
}

// ── scratch repo ──────────────────────────────────────────────────────────
await rm(SCRATCH, { recursive: true, force: true })
await mkdir(REPO, { recursive: true })
await g(['init', '-b', 'main'])
await g(['config', 'user.email', 'itest@local'])
await g(['config', 'user.name', 'branchman-itest'])
await writeFile(join(REPO, 'README.md'), '# scratch repo for branchman integration test\n', 'utf8')
await g(['add', '-A'])
await g(['commit', '-m', 'init: scratch baseline'])
const baseline = (await g(['rev-parse', 'HEAD'])).stdout.trim()
console.log(`scratch repo ready @ ${baseline.slice(0, 8)}\n`)

// ── fake host ctx ─────────────────────────────────────────────────────────
const tools = new Map()
// The host fires session/created the moment the child session exists, while
// doFork is still writing the tree — that overlap is what used to make the
// second save die on `rename tree.json.tmp`. The fake ctx reproduces it by
// firing the registered handler during creation, twice, like the host does.
const handlers = {}
let sessionSeq = 0
let fireOnCreate = true
const ctx = {
  tools: { register: def => { tools.set(def.name, def); return () => {} } },
  on: (name, fn) => { handlers[name] = fn; return () => {} },
  effect: fn => { fn(); return () => {} },
  webServer: { register: () => () => {} },
  logger: { warn: (...a) => console.log('  [warn]', ...a), info: () => {}, error: () => {} },
  sessions: {
    create: (id, options) => {
      const session = { id: id ?? `session-fake-${++sessionSeq}`, header: { cwd: options?.meta?.cwd, parentSession: options?.meta?.parentSession }, title: null }
      if (fireOnCreate && handlers['session/created'] !== undefined) {
        handlers['session/created'](session)
        queueMicrotask(() => handlers['session/created']?.(session))
      }
      return session
    },
    get: () => undefined,
  },
}

const mod = await import(MOD)
await mod.apply(ctx, { dataFile: TREE, defaultRoot: REPO, gitPath: GIT })
console.log(`registered tools: ${[...tools.keys()].join(', ')}\n`)

// ── 0. 写入不变量：并发 save 不得撞同一个临时文件 ──────────────────────────
// 这是真实故障的机制：两次 save 同拍落地 → 先完成的 rename 吃掉 tree.json.tmp
// → 后一个报 ENOENT（宿主日志里就是这么炸的）。这里直接压这个不变量。
console.log('### 并发写入不变量（TreeStore）')
const raceTree = join(SCRATCH, 'race-tree.json')
const raceStore = new mod.TreeStore(raceTree)
await raceStore.ready
let raceErr = ''
try {
  await Promise.all(Array.from({ length: 24 }, (_, i) => raceStore.mutate(() => raceStore.upsert({ name: `并发-${i}`, cwd: SCRATCH }))))
} catch (error) { raceErr = error.message }
check('24 次并发写入全部成功（无 ENOENT）', raceErr === '', raceErr)
const raceFiles = await readdir(SCRATCH)
check('并发写入后无 .tmp 遗留', raceFiles.filter(f => f.includes('.tmp')).length === 0, raceFiles.filter(f => f.includes('.tmp')).join(','))
let raceParsed = null
try { raceParsed = JSON.parse(await readFile(raceTree, 'utf8')) } catch (error) { raceErr = error.message }
check('并发写入后文件仍是完整 JSON', raceParsed !== null && Array.isArray(raceParsed.nodes))
check('24 个节点全部落盘（无丢失）', raceParsed?.nodes.length === 24, String(raceParsed?.nodes.length))
// 失败一次不能把后续写入卡死（writeChain 必须吞掉上一次的拒绝）
await raceStore.mutate(() => raceStore.upsert({ name: '并发-收尾', cwd: SCRATCH }))
check('一次失败不会卡死后续写入', JSON.parse(await readFile(raceTree, 'utf8')).nodes.some(n => n.name === '并发-收尾'))

const call = async (name, args) => {
  const def = tools.get(name)
  if (def === undefined) throw new Error(`tool ${name} not registered`)
  const raw = await def.execute(args)
  return JSON.parse(raw)
}

// ── 1. fork ───────────────────────────────────────────────────────────────
console.log('### branch_fork')
const forked = await call('branch_fork', { name: NAME, root: REPO, sourceSessionId: 'session-main', sourceCwd: REPO })
console.log(JSON.stringify(forked, null, 2))
check('fork 返回 sessionId（子会话创建成功）', /^session-/.test(String(forked.sessionId)), String(forked.sessionId))
check('fork 返回 worktree cwd', typeof forked.cwd === 'string' && forked.cwd.includes('.branches'), String(forked.cwd))
check('worktree 目录真的存在', existsSync(forked.cwd))
const wts = (await g(['worktree', 'list'])).stdout
check('git worktree 已注册', wts.includes('branchman/'))
check('tree.json 写入节点', existsSync(TREE) && JSON.parse(await readFile(TREE, 'utf8')).nodes.some(n => n.name === NAME))
const mainStatus = (await g(['status', '--porcelain'])).stdout.trim()
check('开走向后主线仍干净（.branches 已写入本地 exclude）', mainStatus === '', mainStatus)
const tmpLeftovers = (await readdir(SCRATCH)).filter(f => f.includes('.tmp'))
check('临时文件无遗留（写入已串行化 + 唯一临时名）', tmpLeftovers.length === 0, tmpLeftovers.join(','))

// 并发写入回归：p6 之前的 save() 所有写入共用 tree.json.tmp，而创建子会话会
// 触发被动投影同时保存 —— 先完成的 rename 吃掉临时文件，后一个 ENOENT。
console.log('\n### 并发写入回归（session/created 与 doFork 的 save 重叠）')
let concurrentErr = ''
try {
  const second = await call('branch_fork', { name: '走向-并发回归', root: REPO, sourceSessionId: 'session-main', sourceCwd: REPO })
  if (!/^session-/.test(String(second.sessionId))) concurrentErr = `子会话异常: ${String(second.sessionId)}`
} catch (e) { concurrentErr = e.message }
check('并发写入下 fork 不再报 ENOENT', concurrentErr === '', concurrentErr)
check('并发回归的走向已入树', JSON.parse(await readFile(TREE, 'utf8')).nodes.some(n => n.name === '走向-并发回归'))
await call('branch_drop', { name: '走向-并发回归' })
check('并发回归走向已拆除', !existsSync(join(REPO, '.branches', '走向-并发回归')))

// ── 2. tree ───────────────────────────────────────────────────────────────
console.log('\n### branch_tree')
const tree = await call('branch_tree', {})
console.log(JSON.stringify(tree, null, 2))
const node = tree.nodes.find(n => n.name === NAME)
check('tree 含该走向且 sessionId 非空', node !== undefined && /^session-/.test(String(node.sessionId)))
check('tree 含 root 节点标记（parentName 字段存在）', node !== undefined && 'parentName' in node)

// ── 3. status ─────────────────────────────────────────────────────────────
console.log('\n### branch_status')
const status = await call('branch_status', {})
console.log(JSON.stringify(status, null, 2))
const dir = status.directions.find(d => d.name === NAME)
check('status 列出该走向', dir !== undefined)
check('status 报 ahead=0/behind=0/dirty=0', dir !== undefined && dir.ahead === 0 && dir.behind === 0 && dir.dirty === 0, JSON.stringify(dir))

// ── 4. dirty guard (main line) ────────────────────────────────────────────
console.log('\n### 脏工作区守卫（主线）')
await writeFile(join(REPO, 'dirty-in-main.txt'), 'dirty\n', 'utf8')
let dirtyErr = ''
try { await call('branch_fork', { name: '走向-应被拒', root: REPO }) } catch (e) { dirtyErr = e.message }
check('主线脏时拒绝开新走向', dirtyErr.includes('未提交'), dirtyErr)
check('被拒时未留下 worktree', !existsSync(join(REPO, '.branches', '走向-应被拒')))
await rm(join(REPO, 'dirty-in-main.txt'), { force: true })

// ── 5. merge ──────────────────────────────────────────────────────────────
console.log('\n### branch_merge（先在走向内提交）')
await writeFile(join(forked.cwd, 'feature.txt'), 'work from the direction\n', 'utf8')
await g(['add', '-A'], forked.cwd)
await g(['commit', '-m', 'feat: direction work'], forked.cwd)
const merged = await call('branch_merge', { name: NAME })
console.log(JSON.stringify(merged, null, 2))
check('merge 返回成功', merged.merged === NAME)
check('主线收到走向的提交', existsSync(join(REPO, 'feature.txt')))
const mainLog = (await g(['log', '--oneline'])).stdout
check('主线出现 merge 提交', mainLog.includes('吸收走向'))

// ── 6. drop ───────────────────────────────────────────────────────────────
console.log('\n### branch_drop')
const dropped = await call('branch_drop', { name: NAME })
console.log(JSON.stringify(dropped, null, 2))
check('drop 返回成功', dropped.dropped === NAME)
check('worktree 目录已删除', !existsSync(forked.cwd))
const after = (await g(['worktree', 'list'])).stdout
check('git 无残留 worktree', !after.includes('.branches'), after.trim())
const branches = (await g(['branch'])).stdout
check('分支已删除', !branches.includes('branchman/'))
const tree2 = await call('branch_tree', {})
const node2 = tree2.nodes.find(n => n.name === NAME)
check('树节点标记为 dropped（保留审计）', node2 !== undefined && node2.status === 'dropped', JSON.stringify(node2))

// ── 7. root resolution: the UI sends only sourceCwd, never root ────────────
console.log('\n### root 解析（UI 只发 sourceCwd）')
const uiFork = await call('branch_fork', { name: '走向-UI路径', sourceSessionId: 'session-main', sourceCwd: REPO })
check('只给 sourceCwd 时建在仓库根下', uiFork.cwd === join(REPO, '.branches', '走向-UI路径'), String(uiFork.cwd))
const subDir = join(REPO, 'sub')
await mkdir(subDir, { recursive: true })
await writeFile(join(subDir, 'a.txt'), 'x\n', 'utf8')
await g(['add', '-A'])
await g(['commit', '-m', 'chore: scratch subdirectory'])
const subFork = await call('branch_fork', { name: '走向-子目录', sourceSessionId: 'session-main', sourceCwd: subDir })
check('sourceCwd 是子目录时归一到仓库根', subFork.cwd === join(REPO, '.branches', '走向-子目录'), String(subFork.cwd))

// ── summary ───────────────────────────────────────────────────────────────
console.log(`\n================  ${pass} passed, ${fail} failed  ================`)
process.exit(fail === 0 ? 0 : 1)
