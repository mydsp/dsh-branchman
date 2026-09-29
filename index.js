// dsh-branchman — tree-branching workspace plugin for DeepSeek Harness (DSH).
//
// One atom = "open a new engineering direction": a git worktree + a child
// session bound to that worktree's cwd (inheriting the conversation it forks
// from) + a tree edge. The conversation and the workspace fork in the same
// move, and the tree renders itself.
//
// Zero runtime dependencies: node builtins plus the host's own bare
// `@deepseek-ai/*` imports, which resolve inside the plugin context.
//
// Docs: README.md · docs/ARCHITECTURE.md · docs/PLUGIN-NOTES.md
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// p2-fix: tools MUST be defined via the host's defineTool — it normalizes the
// parameter schema for the model-facing tool list. Registering a raw object
// produces a tool whose parameters the model never fills (all calls arrive
// with empty arguments). Same contract dsh-deja uses.
let defineTool = null
try { ({ defineTool } = await import('@deepseek-ai/dsh-tools')) } catch {}

// p5-fix: a direction's child conversation must INHERIT the conversation it
// branches from, exactly like the native fork button does. The host's own fork
// path builds that seed with this helper; without it the child session is born
// empty and the whole "go back to that point and try another direction" idea
// is lost. Absent peer degrades to an unseeded child rather than failing.
let buildForkSeed = null
try { ({ buildForkSeed } = await import('@deepseek-ai/dsh-session/fork')) } catch {}

// branchman tools (see apply.inject below)

const MAX_NAME = 60

// Optional host services, resolved through ctx.inject once they exist.
//
// p8-fix: cordis serves services through a Proxy that THROWS
// `cannot get property "x" without inject` on an undeclared access — it does
// not return undefined. Reading `ctx.sessionQuery` directly is therefore a hard
// failure, and the seeded-fork path silently degraded to an empty child (the
// host log said exactly: "cannot get property sessionQuery without inject").
// Declaring them in `inject` would be worse: a name that never resolves keeps
// the whole plugin from activating, taking the tools and the UI down with it.
const optional = { sessionQuery: null, agents: null, agentDefaultModel: null }

// ────────────────────────────── state ──────────────────────────────

class TreeStore {
  constructor(dataFile) {
    if (typeof dataFile !== 'string' || dataFile.length === 0) throw new Error('branchman: config.dataFile must be a non-empty path')
    this.dataFile = dataFile
    this.state = { version: 1, nodes: [] }
    this.writeSeq = 0
    this.writeChain = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    await mkdir(dirname(this.dataFile), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.dataFile, 'utf8'))
      if (parsed?.version === 1 && Array.isArray(parsed.nodes)) this.state = parsed
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.save()
    }
  }

  /**
   * Persist the tree.
   *
   * p6-fix: saves are now SERIALIZED and each one writes through a UNIQUE temp
   * name. The previous version used the single path `tree.json.tmp` for every
   * save, so two overlapping saves raced: the first `rename` consumed the temp
   * file and the second died with
   * `ENOENT: rename 'tree.json.tmp' -> 'tree.json'`. That is not theoretical —
   * creating the child session fires the passive `session/created` projection,
   * which saves the node while `doFork` is still saving its own, and the fork
   * lost the race, rolled its worktree back and surfaced the ENOENT in the
   * dialog.
   */
  async save() {
    const write = async () => {
      await mkdir(dirname(this.dataFile), { recursive: true })
      const seq = (this.writeSeq += 1)
      const tmp = `${this.dataFile}.${process.pid}.${seq}.tmp`
      try {
        await writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8')
        await rename(tmp, this.dataFile)
      } catch (error) {
        try { await rm(tmp, { force: true }) } catch { /* the temp may already be gone */ }
        throw error
      }
    }
    // Chain on both outcomes: one failed save must not wedge every later one.
    const queued = this.writeChain.then(write, write)
    this.writeChain = queued.then(() => undefined, () => undefined)
    return queued
  }

  async mutate(action) {
    await this.ready
    const result = action()
    await this.save()
    return result
  }

  /**
   * Insert or merge one direction node, keyed by name. Defined fields in
   * `patch` win; undefined fields keep their stored value. Returns the node.
   *
   * p3-fix: this method was missing entirely — every doFork call died at the
   * write step with "store.upsert is not a function", after the worktree had
   * already been created (leaving an orphan directory behind).
   */
  upsert(patch) {
    if (patch === null || typeof patch !== 'object') throw new Error('branchman: upsert needs an object')
    const name = String(patch.name ?? '').trim()
    if (name === '') throw new Error('branchman: upsert needs a non-empty name')
    const now = new Date().toISOString()
    let node = this.state.nodes.find(item => item.name === name)
    if (node === undefined) {
      node = {
        name, parentName: null, root: null, cwd: null, branch: null,
        parentSessionId: null, sessionId: null, sessionTitle: null,
        status: 'open', messageCount: 0, createdAt: now, lastActivityAt: now,
      }
      this.state.nodes.push(node)
    }
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || key === 'name') continue
      node[key] = value
    }
    node.updatedAt = now
    return node
  }
}

// ─────────────────────────── git plumbing ────────────────────────────

function git(gitPath, cwd, args) {
  return new Promise((resolvePromise, reject) => {
    execFile(gitPath, args, { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`git ${args[0]} failed: ${(stderr || error.message).slice(0, 300)}`))
      else resolvePromise(String(stdout))
    })
  })
}

async function assertRepo(gitPath, root) {
  if (!existsSync(join(root, '.git'))) throw new Error(`${root} 不是 git 仓。先 git init + 首次提交。`)
}

async function assertCleanRepo(gitPath, root) {
  const status = await git(gitPath, root, ['status', '--porcelain'])
  if (status.trim() !== '') throw new Error(`主线有未提交改动（${status.trim().split('\n').length} 项）。先提交或 stash，再开走向。`)
}

/**
 * Keep the direction directory out of the main repo's status.
 *
 * A linked worktree living under `.branches/` shows up as an untracked
 * directory in the parent repo, so every later cleanliness check (and the
 * merge guard) sees a dirty root. Adding `.branches/` to the repo's LOCAL
 * exclude file fixes that without touching any tracked file — the user does
 * not have to edit .gitignore, and nothing enters their history.
 */
async function ensureBranchesIgnored(root) {
  const excludeFile = join(root, '.git', 'info', 'exclude')
  try {
    await mkdir(dirname(excludeFile), { recursive: true })
    let current = ''
    try { current = await readFile(excludeFile, 'utf8') } catch { /* absent is fine */ }
    if (current.split(/\r?\n/).some(line => line.trim() === '.branches/')) return
    const next = `${current}${current !== '' && !current.endsWith('\n') ? '\n' : ''}# branchman direction worktrees\n.branches/\n`
    await writeFile(excludeFile, next, 'utf8')
  } catch {
    // A bare or unusual repo layout must not break forking; the guard below
    // simply keeps reporting honestly if the directory stays visible.
  }
}

// ─────────────────────────── core actions ────────────────────────────

/**
 * Create a direction's child conversation: bound to the worktree, carrying the
 * source conversation's history.
 *
 * Mirrors the host's own fork path (observe source → inclusive boundary →
 * buildForkSeed → compose agent → create with cwd). The bare `sessions.create`
 * call alone produces an EMPTY child — no inherited conversation and no agent
 * composition — which would make "go back to that point and try another
 * direction" meaningless. Degrades to that bare form only if the richer
 * services are unavailable, and says which one it used.
 */
/**
 * Mirror of the Session Controller's private `latestCompletedPrefixBoundary`:
 * the last `turn/end`, plus the trailing events that belong to that same turn,
 * stopping before a new turn (or an appended user message, or an inbox splice)
 * starts. Forking from the raw last event instead would inherit a
 * half-finished turn — buildForkSeed would have to close it with synthetic
 * "forked" results.
 */
function latestCompletedPrefixBoundary(events) {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append') || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

async function createChildSession(ctx, { worktree, sourceSessionId, boundarySeq }) {
  const childId = `session-${randomUUID()}`
  const hasSource = typeof sourceSessionId === 'string' && sourceSessionId !== ''
  const { sessionQuery, agents, agentDefaultModel } = optional
  if (hasSource && buildForkSeed !== null && sessionQuery !== null && agents !== null) {
    try {
      const observed = await sessionQuery.observeSession(sourceSessionId)
      const events = observed?.events
      if (Array.isArray(events) && events.length > 0) {
        const requested = Number.isSafeInteger(boundarySeq) && events[boundarySeq]?.seq === boundarySeq ? boundarySeq : undefined
        const boundary = requested ?? latestCompletedPrefixBoundary(events)
        if (Number.isSafeInteger(boundary) && events[boundary]?.seq === boundary) {
          const seed = buildForkSeed(events, boundary)
          // p9-fix: the controller's own fork path uses two PRIVATE helpers
          // (`ApiSessionAgentController.presetForObservation` / `.composeAgent`)
          // that do not exist on the `agents` service — calling them there
          // produced "agents.presetForObservation is not a function" and
          // silently produced an empty child. Their bodies are thin, so they are
          // mirrored here:
          //   presetForObservation(obs) -> obs.projections.values.agentPreset
          //   composeAgent(presetId)    -> ctx.get('agentPresets').resolve/mount
          const presetId = observed.projections?.values?.agentPreset
          let agentPreset
          let setup
          const presets = typeof ctx.get === 'function' ? ctx.get('agentPresets') : undefined
          if (presets !== undefined && presetId !== undefined) {
            try {
              agentPreset = (await presets.resolve(presetId)).id
              setup = async (agentCtx) => { await presets.mount(agentCtx, agentPreset) }
            } catch (error) {
              ctx.logger?.warn?.(`branchman: preset compose failed (${error.message}); child keeps the default preset`)
              agentPreset = undefined
              setup = undefined
            }
          }
          const selection = agentDefaultModel?.currentSelection?.() ?? {}
          await agents.create({
            sessionId: childId,
            seed,
            inheritedEventCount: boundary + 1,
            meta: {
              cwd: worktree,
              parentSession: sourceSessionId,
              isSeeded: true,
              ...(agentPreset === undefined ? {} : { agentPreset }),
            },
            ...(selection.provider === undefined || selection.model === undefined
              ? {}
              : { agentOptions: { provider: selection.provider, model: selection.model } }),
            ...(setup === undefined ? {} : { setup }),
          })
          try { observed[Symbol.dispose]?.() } catch { /* observation release is best-effort */ }
          return { sessionId: childId, seeded: true, inherited: boundary + 1, preset: agentPreset ?? null }
        }
        // 宿主自己的 fork 在这种情况下是直接拒绝的（"has no completed turn to
        // fork from"）。这里选择降级而不是报错：走向仍然建好，只是子会话从空
        // 开始——用户点的那条消息还没形成完整回合时，这是唯一不挡路的行为。
        ctx.logger?.warn?.('branchman: no completed turn to fork from — child is created without inherited history')
      }
    } catch (error) {
      ctx.logger?.warn?.(`branchman: seeded child failed (${error.message}); falling back to an unseeded session`)
    }
  } else if (hasSource) {
    ctx.logger?.warn?.('branchman: sessionQuery/agents unavailable — child is created without inherited history')
  }
  const created = ctx.sessions.create
    ? ctx.sessions.create(childId, { meta: { cwd: worktree, ...(hasSource ? { parentSession: sourceSessionId } : {}) } })
    : null
  const id = created?.id ?? created?.sessionId ?? null
  return { sessionId: id, seeded: false, inherited: 0 }
}

async function doFork(ctx, store, config, args) {
  const name = String(args?.name ?? '').trim()
  if (!name || name.length > MAX_NAME) throw new Error(`走向名必填且 ≤ ${MAX_NAME} 字符`)
  if (!/^[^\\/:*?"<>|]+$/.test(name)) throw new Error('走向名不能包含 \\ / : * ? " < > |')
  const root = resolve(String(args?.root ?? config.defaultRoot))
  const gitPath = config.gitPath
  await assertRepo(gitPath, root)
  await assertCleanRepo(gitPath, root)
  await ensureBranchesIgnored(root)

  const branch = `branchman/${name}`
  const worktree = join(root, '.branches', name)
  if (existsSync(worktree)) throw new Error(`走向目录已存在: ${worktree}`)

  await git(gitPath, root, ['worktree', 'add', '-b', branch, worktree, args?.from ?? 'main'])

  // p1-fix2 (2026-09-28): the origin guard is CONDITIONAL — omitting `origin`
  // passes validation entirely (validateSessionHeader only rejects a present
  // origin that isn't "subagent"). The earlier "origin must be subagent"
  // failure was self-inflicted: we were the ones passing origin:'branchman'.
  //
  // p3-fix: the whole post-worktree half rolls the worktree back on failure,
  // so a failed fork can never leave an orphan directory or branch.
  // p5-fix: the child is now created through the host's own fork shape, so it
  // inherits the source conversation instead of starting empty.
  let childSessionId = null
  let child
  let node
  try {
    child = await createChildSession(ctx, {
      worktree,
      // The tool contract names it currentSessionId; the Web body names it
      // sourceSessionId. Accept either so neither caller silently loses the
      // history seed (a missing source degrades to an empty child).
      sourceSessionId: args?.currentSessionId ?? args?.sourceSessionId,
      boundarySeq: args?.boundarySeq,
    })
    childSessionId = child.sessionId

    // Tree edges need the parent DIRECTION, not just the parent session: when
    // the source conversation itself sits in a direction worktree, that
    // direction becomes this node's parent.
    const sourceCwd = typeof args?.sourceCwd === 'string' ? args.sourceCwd : null
    const parentName = sourceCwd !== null && /(^|[\\/])\.branches[\\/]/.test(sourceCwd)
      ? (sourceCwd.split(/[\\/]/).filter(Boolean).at(-1) ?? null)
      : null

    node = await store.mutate(() => store.upsert({
      name, cwd: worktree, root, branch, parentName,
      parentSessionId: args?.currentSessionId ?? undefined, parentTitle: null,
      sessionId: childSessionId, sessionTitle: `走向 ${name}`,
      inheritedEvents: child.inherited,
    }))
  } catch (error) {
    try {
      await git(gitPath, root, ['worktree', 'remove', worktree.replace(/\\/g, '/'), '--force'])
      await git(gitPath, root, ['worktree', 'prune'])
      await git(gitPath, root, ['branch', '-D', branch])
      ctx.logger?.warn?.(`branchman: fork failed, worktree rolled back: ${error.message}`)
    } catch (rollbackError) {
      ctx.logger?.warn?.(`branchman: fork failed AND rollback failed: ${rollbackError.message}`)
    }
    throw error
  }

  return {
    name: node.name, branch: node.branch, cwd: node.cwd, sessionId: node.sessionId,
    seeded: child.seeded, inheritedEvents: child.inherited,
    hint: `走向「${name}」已建立。\n  目录: ${worktree}\n  分支: ${branch}`
      + (node.sessionId === null
        ? '\n  （子会话创建失败，但 worktree 可用——可手动指向该目录）'
        : child.seeded
          ? `\n  新会话: ${node.sessionId}（继承前 ${child.inherited} 条事件，工作区=worktree 目录）`
          : `\n  新会话: ${node.sessionId}（⚠ 未继承历史——新会话是空的，工作区=worktree 目录）`),
  }
}

async function doTree(store) {
  await store.ready
  return {
    version: store.state.version,
    // Self-report so a support question is one call away: if defineTool is
    // false the model sees un-normalized parameters (args arrive empty), and
    // if buildForkSeed is false direction children cannot inherit history.
    capabilities: {
      defineTool: defineTool !== null,
      buildForkSeed: buildForkSeed !== null,
      sessionQuery: optional.sessionQuery !== null,
      agents: optional.agents !== null,
      agentDefaultModel: optional.agentDefaultModel !== null,
    },
    nodes: store.state.nodes.map(node => ({
      name: node.name, parentName: node.parentName, root: node.root, cwd: node.cwd, branch: node.branch,
      status: node.status, sessionId: node.sessionId, sessionTitle: node.sessionTitle,
      messageCount: node.messageCount, lastActivityAt: node.lastActivityAt,
      inheritedEvents: node.inheritedEvents ?? 0,
    })),
  }
}

async function doStatus(ctx, store, config, args) {
  const gitPath = config.gitPath
  const out = []
  for (const node of store.state.nodes) {
    if (node.status !== 'open') continue
    try {
      const ahead = (await git(gitPath, node.cwd, ['rev-list', '--count', `main..${node.branch}`])).trim()
      const behind = (await git(gitPath, node.cwd, ['rev-list', '--count', `${node.branch}..main`])).trim()
      const dirty = (await git(gitPath, node.cwd, ['status', '--porcelain'])).trim().split('\n').filter(Boolean).length
      out.push({ name: node.name, ahead: Number(ahead), behind: Number(behind), dirty })
    } catch (error) {
      out.push({ name: node.name, error: error.message.slice(0, 120) })
    }
  }
  return { root: config.defaultRoot, directions: out }
}

async function doMerge(ctx, store, config, args) {
  const name = String(args?.name ?? '').trim()
  const node = store.state.nodes.find(item => item.name === name && item.status === 'open')
  if (node === undefined) throw new Error(`没有进行中的走向「${name}」`)
  const gitPath = config.gitPath
  const dirty = (await git(gitPath, node.cwd, ['status', '--porcelain'])).trim()
  if (dirty !== '') throw new Error(`走向有未提交改动，先在其目录内提交（${dirty.split('\n').length} 项）`)
  // The main line must be clean too: merging into a dirty root mixes unrelated
  // work into the absorption, and the p4-fix dropped the old `git add -A`
  // which silently staged whatever the user had open.
  await ensureBranchesIgnored(node.root)
  await assertCleanRepo(gitPath, node.root)
  // --no-ff: an absorbed direction must leave a merge commit naming it. A plain
  // fast-forward erases the fact that a direction existed at all, which is the
  // one thing the tree is for.
  await git(gitPath, node.root, ['merge', '--no-ff', node.branch, '--no-edit', '-m', `merge: 吸收走向 ${name}`])
  node.status = 'merged'
  node.mergedAt = new Date().toISOString()
  await store.mutate(() => undefined)
  return { merged: name, root: node.root, hint: `已合回主线 ${node.root}（merge commit 记录在案）。确认后可 branch_drop 拆除 worktree。` }
}

async function doDrop(ctx, store, config, args) {
  const name = String(args?.name ?? '').trim()
  // p4-fix: a MERGED direction still owns a worktree and a branch. Matching
  // only 'open' made merged directions un-droppable — the worktree stayed on
  // disk forever with no way to reclaim it.
  const node = store.state.nodes.find(item => item.name === name && item.status !== 'dropped')
  if (node === undefined) throw new Error(`没有可拆除的走向「${name}」（已拆除或不存在）`)
  const gitPath = config.gitPath
  const wtGit = node.cwd.replace(/\\/g, '/')
  try { await git(gitPath, node.root, ['worktree', 'remove', wtGit, '--force']) } catch { /* already gone */ }
  try { await git(gitPath, node.root, ['worktree', 'prune']) } catch { /* noop */ }
  try { await git(gitPath, node.root, ['branch', '-D', node.branch]) } catch { /* already gone */ }
  node.status = 'dropped'
  node.droppedAt = new Date().toISOString()
  await store.mutate(() => undefined)
  return { dropped: name }
}

// ─────────────────────────── plugin entry ────────────────────────────

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('body too large')); req.destroy(); return } chunks.push(chunk) })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const apply = async (ctx, config) => {
  const store = new TreeStore(config?.dataFile)
  // Config normalisation. A published install must not depend on any local
  // path: `git` resolves from PATH and the repository root falls back to the
  // process cwd, so the plugin works with an empty config block. (Users who
  // keep git outside PATH — e.g. a portable Windows install — can still set
  // config.gitPath explicitly.)
  const cfg = {
    ...config,
    gitPath: typeof config?.gitPath === 'string' && config.gitPath !== '' ? config.gitPath : 'git',
    defaultRoot: typeof config?.defaultRoot === 'string' && config.defaultRoot !== '' ? config.defaultRoot : process.cwd(),
  }

  // Resolve the optional services the seeded-fork path needs. ctx.inject only
  // fires once they exist, so the plugin still activates (and still forks, just
  // without inherited history) on a host that lacks them.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['sessionQuery', 'agents', 'agentDefaultModel'], (child) => {
      optional.sessionQuery = child.sessionQuery
      optional.agents = child.agents
      optional.agentDefaultModel = child.agentDefaultModel
      ctx.logger?.info?.('branchman: seeded-fork services resolved')
    })
  }

  // ── agent tools ──
  const TOOL_OUTPUT = { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] }
  // p2-fix: wrap in defineTool (host-normalized schema) when available; fall
  // back to raw registration only if the peer import failed (degrades like deja).
  const tool = definition => {
    if (defineTool === null) return ctx.tools.register(definition)
    return ctx.tools.register(defineTool(definition))
  }

  tool({
    name: 'branch_fork',
    description: 'Open a new engineering direction from the current conversation: creates a git worktree (isolated workspace on its own branch) and a child session bound to it. Use when the user wants to try an alternative approach without disturbing the main line. The main repo must have no uncommitted changes.',
    parameters: {
      name: { type: 'string', required: true, description: '走向名，如 走向A-激进方案。也是目录与分支名。' },
      root: { type: 'string', description: '仓库根目录。默认用配置的 defaultRoot。' },
      from: { type: 'string', description: '起点 ref（默认 main）。' },
    },
    output: TOOL_OUTPUT,
    execute: args => doFork(ctx, store, cfg, args).then(value => JSON.stringify(value, null, 2)),
  })
  tool({
    name: 'branch_tree',
    description: 'Show the branch tree of engineering directions: which direction forked from which, worktree paths, branches and activity. Zero cost — read from local state.',
    parameters: {},
    output: TOOL_OUTPUT,
    execute: () => doTree(store).then(value => JSON.stringify(value, null, 2)),
  })
  tool({
    name: 'branch_status',
    description: 'Per-direction git status vs the main line: commits ahead, behind, uncommitted files. Run before deciding to merge or drop a direction.',
    parameters: { root: { type: 'string', description: '仓库根目录（默认配置值）。' } },
    output: TOOL_OUTPUT,
    execute: args => doStatus(ctx, store, cfg, args).then(value => JSON.stringify(value, null, 2)),
  })
  tool({
    name: 'branch_merge',
    description: 'Merge a finished direction back into the main line. The direction must have no uncommitted changes in its worktree.',
    parameters: { name: { type: 'string', required: true, description: '走向名。' } },
    output: TOOL_OUTPUT,
    execute: args => doMerge(ctx, store, cfg, args).then(value => JSON.stringify(value, null, 2)),
  })
  tool({
    name: 'branch_drop',
    description: 'Tear down a direction: remove its worktree, delete its branch, mark it dropped in the tree (kept for audit).',
    parameters: { name: { type: 'string', required: true, description: '走向名。' } },
    output: TOOL_OUTPUT,
    execute: args => doDrop(ctx, store, cfg, args).then(value => JSON.stringify(value, null, 2)),
  })

  // ── passive tree projection (bounded: metadata only) ──
  ctx.on('session/created', session => {
    const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : null
    const isBranchSession = cwd !== null && /(^|[\\/])\.branches[\\/]/.test(cwd)
    const isBranchman = session?.header?.meta?.origin === 'branchman' || session?.header?.origin === 'branchman'
    if (!isBranchSession && !isBranchman) return
    const name = (cwd.split(/[\\/]/).at(-1) ?? '走向').slice(0, MAX_NAME)
    store.mutate(() => store.upsert({
      name, cwd, root: resolve(join(cwd, '..', '..')),
      parentSessionId: session?.header?.parentSession ?? undefined,
      sessionId: session.id, sessionTitle: session.title ?? null,
    })).catch(() => {})
  })

  ctx.on('session/event', (session, event) => {
    if (event?.type !== 'user/message' && event?.type !== 'assistant/message' && event?.type !== 'session/title') return
    const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : null
    if (cwd === null || !/(^|[\\/])\.branches[\\/]/.test(cwd)) return
    const name = cwd.split(/[\\/]/).at(-1)
    const node = store.state.nodes.find(item => item.name === name)
    if (node === undefined) return
    node.messageCount += 1
    node.lastActivityAt = new Date().toISOString()
    if (event.type === 'session/title' && typeof event.data?.title === 'string') node.sessionTitle = event.data.title.slice(0, 120)
    store.mutate(() => undefined).catch(() => {})
  })

  // ── web endpoints ──
  const trustedHosts = new Set(['localhost', '127.0.0.1'])
  const hostOk = req => {
    const host = typeof req.headers.host === 'string' ? req.headers.host.replace(/:\d+$/, '').toLowerCase() : ''
    return trustedHosts.has(host)
  }
  const sendJson = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)) }

  ctx.effect(() => {
    ctx.webServer.register({
      kind: 'prefix', path: '/branchman/api',
      handler: async (req, res) => {
        if (!hostOk(req)) return sendJson(res, 403, { error: 'forbidden' })
        const path = new URL(req.url ?? '/', 'http://dsh.local').pathname
        if (path === '/branchman/api/tree' && req.method === 'GET') return sendJson(res, 200, await doTree(store))
        if (path === '/branchman/api/status' && req.method === 'GET') return sendJson(res, 200, await doStatus(ctx, store, cfg, {}))
        if (path === '/branchman/api/fork' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req))
            const name = String(body?.name ?? '').trim()
            if (!name) return sendJson(res, 400, { error: '走向名必填' })
            const forkArgs = { name, root: body?.root }
            if (typeof body?.sourceSessionId === 'string') forkArgs.currentSessionId = body.sourceSessionId
            // The source conversation's own cwd lets the host derive the parent
            // DIRECTION, so the rendered tree gets its edge.
            if (typeof body?.sourceCwd === 'string') forkArgs.sourceCwd = body.sourceCwd
            // The host creates the child session itself (origin omitted, which
            // validateSessionHeader accepts) and binds it to the worktree cwd.
            // The client only opens what this route returns.
            const result = await doFork(ctx, store, cfg, forkArgs)
            return sendJson(res, 201, result)
          } catch (error) {
            return sendJson(res, 400, { error: error.message })
          }
        }
        if (path === '/branchman/api/bind' && req.method === 'POST') {
          // p1-fix companion: the client created the session itself and
          // reports the id here so the tree node carries a live link.
          try {
            const body = JSON.parse(await readBody(req))
            const name = String(body?.name ?? '').trim()
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
            const node = store.state.nodes.find(item => item.name === name && item.status === 'open')
            if (node === undefined) return sendJson(res, 404, { error: `没有进行中的走向「${name}」` })
            if (sessionId === '') return sendJson(res, 400, { error: 'sessionId 必填' })
            await store.mutate(() => store.upsert({
              name, sessionId, sessionTitle: typeof body?.sessionTitle === 'string' ? body.sessionTitle : undefined,
            }))
            return sendJson(res, 200, { bound: name, sessionId })
          } catch (error) {
            return sendJson(res, 400, { error: error.message })
          }
        }
        return sendJson(res, 404, { error: 'not found' })
      },
    })
    ctx.webServer.register({
      kind: 'exact', path: '/branchman/',
      handler: (_req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page()) },
    })
  }, 'branchman: web routes')
}

function page() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Branchman — 工程走向树</title><style>
body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#0f1115;color:#e6e6e6;margin:0;padding:24px}
h1{font-size:18px;font-weight:600;margin:0 0 4px}
.sub{color:#8b8f98;font-size:12px;margin-bottom:20px}
.node{border:1px solid #2a2e37;border-radius:10px;padding:10px 14px;max-width:520px;margin:10px 0;background:#161a22}
.node .name{font-weight:600;font-size:14px}
.node .meta{color:#8b8f98;font-size:11px;margin-top:4px;word-break:break-all}
.node .stale{color:#b4686b;font-size:11px;margin-top:2px}
.edge{border-left:1px dashed #3a3f4a;height:18px;margin-left:24px}
.main{border-color:#3d6b54}
.badge{display:inline-block;font-size:10px;border:1px solid #3a3f4a;border-radius:99px;padding:1px 8px;margin-left:8px;color:#8b8f98}
</style></head><body><h1>Branchman · 工程走向树</h1><div class="sub">一个节点 = 一条走向（git worktree + 会话）。数据只含元数据，不含消息正文。</div><div id="tree">加载中…</div>
<script>
fetch('/branchman/api/tree').then(r=>r.json()).then(d=>{
  const el=document.getElementById('tree');
  if(!d.nodes.length){el.innerHTML='<div class="sub">还没有走向。在对话里让 agent 调 branch_fork 开第一条。</div>';return}
  const byName={};d.nodes.forEach(n=>byName[n.name]=n);
  const roots=d.nodes.filter(n=>!n.parentName||!byName[n.parentName]);
  const kids=n=>d.nodes.filter(m=>m.parentName===n.name);
  const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  function render(n,depth){
    const stale=(Date.now()-new Date(n.lastActivityAt))/864e5>3;
    let html='<div class="node'+(depth===0?' main':'')+'">'
      +'<div class="name">'+esc(n.name)+(depth===0?'<span class="badge">main 线</span>':'<span class="badge">'+esc(n.status)+'</span>')+'</div>'
      +'<div class="meta">'+esc(n.cwd)+(n.sessionTitle?'<br>'+esc(n.sessionTitle):'')+'<br>消息 '+n.messageCount+' · 最后活动 '+new Date(n.lastActivityAt).toLocaleString()+'</div>'
      +(stale?'<div class="stale">已 3 天无活动 — 考虑 merge 或 drop</div>':'')+'</div>';
    kids(n).forEach(k=>{html+='<div class="edge"></div>';html+=render(k,depth+1)});
    return html;
  }
  roots.forEach(r=>{el.innerHTML+=render(r,0)});
}).catch(e=>{document.getElementById('tree').textContent='加载失败: '+e});
</script></body></html>`
}

apply.inject = ['webServer', 'sessions', 'tools']
export default apply

// Exported for the offline suites: the store's write invariant (concurrent
// saves must never collide on one temp path) is the one thing that cannot be
// exercised through the tools alone, because it depends on two writers landing
// in the same tick.
export { TreeStore }

