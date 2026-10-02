import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { StateStore, newId, type StateV2 } from './store.js';
import { migrateV1 } from './migrate-v1.js';
import { GitAdapter, execGitRunner, type GitRunner } from './git-adapter.js';
import { HostAdapter } from './host-adapter.js';
import { OperationsEngine, IdempotencyConflictError, type ForkRequest, type OperationRecord } from './operations.js';
import { ChangeSnapshots } from './changes.js';
import { forkBoundary } from './session-fork.js';
import { parseForkRequest, ApiValidationError, ok, errorEnvelope } from './api.js';
import { isInside, samePath, normalizeWindowsPath } from '../domain/paths.js';
import { selectLabel } from '../client/session-store.js';
import { derivePreview } from './projection.js';

type ConfigValue = { dataFile: string; defaultRoot?: string; gitPath?: string };
type Peers = { buildForkSeed: (events: readonly unknown[], boundary: number) => unknown; defineTool?: (input: any) => any };
const loadPeer = async (name: string) => import(name);
export const inject = ['webServer', 'sessions', 'tools'];
let schema: any;
try { const mod = await loadPeer('schemastery'); schema = mod.default ?? mod; } catch { /* raw config validation below */ }
export const Config = schema?.object({ dataFile: schema.string().default(''), defaultRoot: schema.string().default(''), gitPath: schema.string().default('git') });

/** One runtime per Cordis fiber: no global host bindings or operation state. */
export class BranchmanRuntime {
  readonly store: StateStore;
  readonly host: HostAdapter;
  readonly git: GitRunner;
  readonly changes: ChangeSnapshots;
  readonly operations: OperationsEngine;
  readonly services: Record<string, any> = {};
  #writes: Promise<unknown> = Promise.resolve();
  #alive = true;
  #treeFlight?: Promise<any>;
  #titles = new Map<string, { value: any; at: number }>();
  #previews = new Map<string, { text: string | null; at: number }>();
  #generation = 0;
  constructor(readonly ctx: any, readonly config: ConfigValue, readonly peers: Peers) {
    if (!config.dataFile) throw new Error('branchman: dataFile must be configured');
    this.store = new StateStore(config.dataFile);
    this.host = new HostAdapter({ sessions: ctx.sessions });
    this.git = execGitRunner(config.gitPath ?? 'git');
    this.changes = new ChangeSnapshots(this.git, join(dirname(config.dataFile), 'captures'));
    this.operations = new OperationsEngine({
      identify: cwd => this.identify(cwd),
      captureChanges: async op => {
        this.assertActive();
        if (!this.services.workspaceRegistry || !this.services.agents || !this.services.agentPresets) throw new Error('required host services unavailable');
        // Preflight inheritance before introducing a Git side effect.
        const boundary = await this.host.withObservation(op.request!.sourceSessionId, async observation => {
          if (!samePath(observation.header?.cwd ?? '', op.plan!.sourcePath) && !isInside(op.plan!.sourcePath, observation.header?.cwd ?? '')) throw new Error('source session cwd does not belong to the planned worktree');
          const preset = await this.services.agentPresets.resolve(observation.projections?.values?.agentPreset ?? observation.header?.agentPreset);
          if (!preset?.id || preset.broken) throw new Error('source agent preset unavailable or broken');
          const model = this.services.agentDefaultModel?.currentSelection?.();
          if (!model?.provider || !model?.model) throw new Error('default model selection unavailable');
          return op.request!.history === 'inherit' ? forkBoundary(observation.events, op.request!) : null;
        });
        const request = op.request!;
        if (request.codeSource.kind === 'source-head' && request.codeSource.carryChanges) await this.changes.capture(op);
        return { boundary };
      },
      createWorktree: async (repoId, branch, path, base) => {
        this.assertActive(); const root = this.repoRoot(repoId);
        await this.git.run(['rev-parse', '--verify', `${base}^{commit}`], { cwd: root });
        // git worktree add refuses an existing path/ref; never overwrite either.
        await this.git.run(['worktree', 'add', '-b', branch, path, base!], { cwd: root, timeoutMs: 60_000 });
      },
      carryChanges: async (_repo, _path, op) => this.changes.carry(op!),
      createChildSession: input => this.createChild(input),
      attachWorkspace: (path, name, id) => this.attachWorkspace(path, name, id),
      persistDirection: input => this.persistDirection(input),
      removeWorktree: (repo, path, branch) => this.removeWorktree(repo, path, branch),
      removeDirection: (_repo, id) => this.removeDirection(id),
      directionRepo: async id => this.direction(id).repoId,
      reconcile: op => this.reconcile(op),
    }, undefined, { journalDirectory: join(dirname(config.dataFile), 'operations') });
  }
  assertActive(): void { if (!this.#alive) throw new Error('branchman runtime unloaded'); }
  bind(name: string, value: any): () => void {
    this.assertActive(); this.services[name] = value; this.#generation++;
    const clear = ['sessionQuery', 'agents', 'workspaceRegistry', 'agentDefaultModel'].includes(name) ? this.host.bind(name as any, value) : () => {};
    return () => { clear(); if (this.services[name] === value) { delete this.services[name]; this.#generation++; } };
  }
  async ready(): Promise<void> { await this.store.ready(); await this.operations.ready(); }
  async dispose(): Promise<void> { this.#alive = false; this.#generation++; await this.host.dispose(); this.#titles.clear(); this.#previews.clear(); }
  async update(fn: (state: StateV2) => void): Promise<void> {
    const work = async () => { this.assertActive(); const old = this.store.read(), next = structuredClone(old); fn(next); await this.store.commit(old.revision, next); };
    const queued = this.#writes.then(work, work); this.#writes = queued.then(() => {}, () => {}); await queued;
  }
  repoRoot(id: string): string {
    const s = this.store.read(), repo = s.repositories.find(r => r.id === id), tree = s.worktrees.find(w => w.id === repo?.primaryWorktreeId);
    if (!repo?.identityVerified || !tree) throw new Error('repository identity needs Git reconciliation');
    return tree.canonicalPath;
  }
  direction(id: string) { const d = this.store.read().directions.find(d => d.id === id); if (!d) throw new ApiValidationError('not-found', 'directionId not found'); return d; }
  treePath(id: string): string { const w = this.store.read().worktrees.find(w => w.id === id); if (!w) throw new Error('worktree missing'); return w.canonicalPath; }
  async identify(cwd: string) {
    this.assertActive(); const identity = await new GitAdapter(this.git, cwd).identify();
    const porcelain = (await this.git.run(['worktree', 'list', '--porcelain'], { cwd: identity.worktreePath })).stdout;
    const paths = porcelain.split(/\r?\n\r?\n/).map(block => {
      const path = /^worktree (.+)$/m.exec(block)?.[1], branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
      return path ? { path: normalizeWindowsPath(path), branch } : null;
    }).filter(Boolean) as Array<{ path: string; branch: string | null }>;
    const primary = paths[0]; if (!primary) throw new Error('git did not identify the primary worktree');
    let repoId = '';
    await this.update(s => {
      let repo = s.repositories.find(r => samePath(r.canonicalCommonDir, identity.commonDir));
      if (!repo) repo = s.repositories.find(r => !r.identityVerified && paths.some(p => samePath(this.treePath(r.primaryWorktreeId), p.path)));
      if (!repo) { repo = { id: newId(), canonicalCommonDir: identity.commonDir, primaryWorktreeId: newId(), identityVerified: true }; s.repositories.push(repo); }
      repoId = repo.id; repo.canonicalCommonDir = identity.commonDir; repo.identityVerified = true;
      for (const [i, path] of paths.entries()) {
        let w = s.worktrees.find(w => w.repoId === repoId && samePath(w.canonicalPath, path.path));
        if (!w) {
          const planned = this.operations.list().find(op => op.plan && samePath(op.plan.worktreePath, path.path))?.plan;
          w = { id: i === 0 ? repo.primaryWorktreeId : planned?.worktreeId ?? newId(), repoId, canonicalPath: path.path, branchRef: path.branch, managedBy: planned ? 'branchman' : 'external', present: true }; s.worktrees.push(w);
        }
        w.present = true;
        if (w.managedBy === 'external') w.branchRef = path.branch;
        if (i === 0) repo.primaryWorktreeId = w.id;
      }
      for (const w of s.worktrees.filter(w => w.repoId === repoId)) if (!paths.some(p => samePath(p.path, w.canonicalPath))) w.present = false;
    });
    return { repoId, ...identity, managedRoot: primary.path };
  }
  async source(id: string): Promise<any> {
    const query = this.services.sessionQuery;
    if (!query?.listSessions) throw new Error('sessionQuery unavailable');
    const record = (await query.listSessions()).find((r: any) => r.header.id === id);
    if (!record) throw new ApiValidationError('not-found', 'source session not found');
    return record;
  }
  async fork(body: unknown) {
    const request = parseForkRequest(body);
    if (request.codeSource.kind === 'source-head' && this.operations.getByRequestId(request.requestId)) return this.operations.fork(request);
    const source = await this.source(request.sourceSessionId);
    // Derive cwd from the actual source header; a request cannot fork a different repository.
    if (!samePath(source.header.cwd ?? '', request.sourceCwd)) throw new ApiValidationError('invalid-source', 'sourceCwd differs from the source session');
    if (request.codeSource.kind === 'explicit-commit') {
      if (!/^[0-9a-f]{7,64}$/i.test(request.codeSource.oid)) throw new ApiValidationError('invalid-argument', 'explicit commit must be an OID');
      request.codeSource.oid = (await this.git.run(['rev-parse', '--verify', `${request.codeSource.oid}^{commit}`], { cwd: request.sourceCwd })).stdout.trim();
    }
    return this.operations.fork(request);
  }
  async createChild(input: Parameters<import('./operations.js').ForkEffects['createChildSession']>[0]) {
    this.assertActive(); const generation = this.#generation;
    const id = `session-${input.operationId}`, agents = this.services.agents;
    if (!agents?.create || !input.operationId) throw new Error('agent creation capability unavailable');
    const existing = await this.services.sessionQuery.listSessions();
    const found = existing.find((r: any) => r.header.id === id);
    if (found) {
      if (!samePath(found.header.cwd ?? '', input.worktreePath) || found.header.parentSession !== input.sourceSessionId) throw new Error('child identity conflict');
      return { sessionId: id, seeded: !!found.header.isSeeded, inherited: this.operations.getOperation(input.operationId)?.child?.inherited ?? 0 };
    }
    return this.host.withObservation(input.sourceSessionId, async observation => {
      const boundary = input.history === 'inherit' ? forkBoundary(observation.events, input) : null;
      const presetId = observation.projections?.values?.agentPreset ?? observation.header?.agentPreset;
      const presets = this.services.agentPresets;
      if (!presets?.resolve || !presets?.mount) throw new Error('source agent preset cannot be composed');
      const resolved = await presets.resolve(presetId);
      if (!resolved?.id || resolved.broken) throw new Error('source agent preset unavailable or broken');
      const preset = resolved.id;
        // mount returns a Cordis fiber, while agent setup may return only a
        // transaction with commit(). Keep the mounted fiber owned by agentCtx.
      const composition = { agentPreset: preset, setup: async (agentCtx: any) => { await presets.mount(agentCtx, preset); } };
      const selection = this.services.agentDefaultModel?.currentSelection?.();
      if (!selection?.provider || !selection?.model) throw new Error('default model selection unavailable');
      this.assertActive(); if (generation !== this.#generation) throw new Error('host bindings changed before child creation');
      await agents.create({ sessionId: id,
        ...(boundary === null ? {} : { seed: this.peers.buildForkSeed(observation.events, boundary), inheritedEventCount: boundary + 1 }),
        meta: { cwd: input.worktreePath, parentSession: input.sourceSessionId, ...(boundary === null ? {} : { isSeeded: true }), ...(composition.agentPreset ? { agentPreset: composition.agentPreset } : {}) },
        agentOptions: { provider: selection.provider, model: selection.model }, ...(composition.setup ? { setup: composition.setup } : {}) });
      return { sessionId: id, seeded: boundary !== null, inherited: boundary === null ? 0 : boundary + 1, boundary };
    });
  }
  async attachWorkspace(path: string, name: string, sessionId: string | null) {
    this.assertActive(); const registry = this.services.workspaceRegistry;
    if (!registry?.create) throw new Error('workspaceRegistry unavailable');
    const workspace = await registry.create(path, `走向 ${name}`);
    if (!workspace?.id || !workspace.attachSession) throw new Error('workspace attachment unavailable');
    if (sessionId) await workspace.attachSession(sessionId);
    return { workspaceId: String(workspace.id) };
  }
  async persistDirection(input: Parameters<import('./operations.js').ForkEffects['persistDirection']>[0]): Promise<void> {
    const op = this.operations.getOperation(input.operationId!);
    await this.update(s => {
      if (s.directions.some(d => d.id === input.directionId)) return;
      const repo = s.repositories.find(r => r.id === input.repoId)!;
      const sourceTree = s.worktrees.find(w => samePath(w.canonicalPath, op!.plan!.sourcePath) && w.repoId === input.repoId);
      if (!s.worktrees.some(w => w.id === input.worktreeId)) s.worktrees.push({ id: input.worktreeId, repoId: input.repoId, canonicalPath: normalizeWindowsPath(input.worktreePath!), branchRef: input.branch!, managedBy: 'branchman', present: true });
      for (const id of [input.sourceSessionId, input.primarySessionId]) if (id && !s.sessions.some(x => x.sessionId === id)) s.sessions.push({ sessionId: id, worktreeId: id === input.primarySessionId ? input.worktreeId : sourceTree?.id ?? null, presence: 'persisted', archived: false });
      s.directions.push({ id: input.directionId, repoId: input.repoId, worktreeId: input.worktreeId, displayName: input.displayName, primarySessionId: input.primarySessionId,
        baseOid: input.baseOid, upstreamRef: sourceTree?.branchRef ?? null, integrationTargetWorktreeId: sourceTree?.id ?? repo.primaryWorktreeId,
        state: 'ready', brief: input.brief ?? '', workspaceId: input.workspaceId ?? null, createdAt: new Date().toISOString() });
      if (input.sourceSessionId && input.primarySessionId) s.forkEdges.push({ id: newId(), sourceSessionId: input.sourceSessionId, targetSessionId: input.primarySessionId,
        boundarySeq: input.boundarySeq ?? null, boundaryMessageId: input.messageId ?? null, inheritedEventCount: input.inheritedEventCount ?? 0, operationId: input.operationId ?? null });
    });
  }
  async reconcile(op: OperationRecord): Promise<OperationRecord> {
    this.assertActive(); const p = op.plan!;
    await this.identify(p.sourcePath); const root = this.repoRoot(p.repoId);
    const list = (await this.git.run(['worktree', 'list', '--porcelain'], { cwd: root })).stdout;
    const block = list.split(/\r?\n\r?\n/).find(b => samePath(/^worktree (.+)$/m.exec(b)?.[1] ?? '', p.worktreePath));
    if (block) {
      if (!block.includes(`branch refs/heads/${p.branch}`)) throw new Error('planned path belongs to another branch');
      if (!op.ownedResources.includes(`worktree:${p.worktreePath}`)) op.ownedResources.push(`worktree:${p.worktreePath}`, `branch:${p.branch}`);
    } else if (op.ownedResources.includes(`worktree:${p.worktreePath}`)) throw new Error('owned worktree is missing; manual recovery required');
    const childId = `session-${op.id}`, corpus = await this.services.sessionQuery.listSessions();
    const child = corpus.find((r: any) => r.header.id === childId);
    if (child) {
      if (!block || !samePath(child.header.cwd ?? '', p.worktreePath) || child.header.parentSession !== op.request!.sourceSessionId) throw new Error('child/worktree reconciliation conflict');
      if (op.request!.history === 'inherit' && op.child?.inherited === undefined && op.resolvedBoundary == null) throw new Error('child inheritance boundary cannot be confirmed');
      const inherited = op.child?.inherited ?? (op.resolvedBoundary != null ? op.resolvedBoundary + 1 : 0);
      op.child = { sessionId: childId, seeded: !!child.header.isSeeded, inherited, boundary: inherited ? inherited - 1 : null };
      if (!op.ownedResources.includes(`session:${childId}`)) op.ownedResources.push(`session:${childId}`);
    }
    if (this.store.read().directions.some(d => d.id === p.directionId)) { op.directionId = p.directionId; op.state = 'succeeded'; op.phase = 'completed'; op.errorCode = null; }
    return op;
  }
  async clean(path: string): Promise<void> {
    const dirty = (await this.git.run(['status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).branches'], { cwd: path })).stdout.trim();
    if (dirty) throw new Error(`worktree contains uncommitted changes: ${path}`);
  }
  async removeWorktree(repoId: string, path: string, branch: string): Promise<void> {
    const root = this.repoRoot(repoId), identity = await new GitAdapter(this.git, path).identify();
    const repo = this.store.read().repositories.find(r => r.id === repoId)!;
    if (!samePath(identity.commonDir, repo.canonicalCommonDir) || identity.branchRef !== branch || samePath(path, root)) throw new Error('worktree ownership mismatch');
    await this.clean(path);
    const ahead = (await this.git.run(['rev-list', `${root === path ? 'HEAD' : (await this.git.run(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()}..${identity.headOid}`], { cwd: root })).stdout.trim();
    if (ahead) throw new Error('worktree has commits not integrated into the primary worktree');
    await this.git.run(['worktree', 'remove', path], { cwd: root, timeoutMs: 60_000 });
    await this.git.run(['branch', '-d', branch], { cwd: root });
  }
  async removeDirection(id: string) {
    const d = this.direction(id); if (d.state === 'removed') return;
    const expected = this.store.read().worktrees.find(w => w.id === d.worktreeId)!;
    const actual = await new GitAdapter(this.git, expected.canonicalPath).identify();
    if (!samePath(actual.worktreePath, expected.canonicalPath) || actual.branchRef !== expected.branchRef) throw new Error('worktree ownership changed; removal refused');
    await this.identify(expected.canonicalPath); const w = this.store.read().worktrees.find(w => w.id === d.worktreeId)!;
    if (w.managedBy !== 'branchman' || !w.branchRef) throw new Error('external worktrees cannot be removed');
    await this.removeWorktree(d.repoId, w.canonicalPath, w.branchRef);
    await this.update(s => { s.directions.find(x => x.id === id)!.state = 'removed'; s.worktrees.find(x => x.id === d.worktreeId)!.present = false; });
  }
  async integration(kind: 'merge' | 'sync', requestId: string, id: string) {
    const d = this.direction(id); if (d.state !== 'ready') throw new Error('direction needs reconciliation before integration');
    const source = this.treePath(d.worktreeId), target = this.treePath(d.integrationTargetWorktreeId);
    return this.operations.run(kind, requestId, { directionId: id }, d.repoId, async () => {
      this.assertActive();
      // External branch switches and replaced directories must not redirect a merge.
      const state = this.store.read(), repo = state.repositories.find(r => r.id === d.repoId)!;
      if (!repo.identityVerified) throw new Error('repository identity needs Git reconciliation');
      for (const worktreeId of [d.worktreeId, d.integrationTargetWorktreeId]) {
        const expected = state.worktrees.find(w => w.id === worktreeId)!;
        const actual = await new GitAdapter(this.git, expected.canonicalPath).identify();
        if (!samePath(actual.worktreePath, expected.canonicalPath) || !samePath(actual.commonDir, repo.canonicalCommonDir) || actual.branchRef !== expected.branchRef) throw new Error('integration worktree identity changed; reconcile before retry');
      }
      await this.clean(source); await this.clean(target);
      const path = kind === 'merge' ? target : source, from = kind === 'merge' ? source : target;
      const oid = (await this.git.run(['rev-parse', 'HEAD'], { cwd: from })).stdout.trim();
      try { await this.git.run(['merge', '--no-edit', oid], { cwd: path, timeoutMs: 60_000 }); }
      catch (e) {
        const conflicts = (await this.git.run(['ls-files', '-u'], { cwd: path })).stdout.trim();
        if (conflicts) await this.update(s => { s.directions.find(x => x.id === id)!.state = 'conflicted'; });
        throw e;
      }
      await this.update(s => { const dir = s.directions.find(x => x.id === id)!; dir.updatedAt = new Date().toISOString(); if (kind === 'merge') dir.mergedAt = dir.updatedAt; });
    });
  }
  async unarchive(id: string) {
    const d = this.direction(id); if (!d.primarySessionId) throw new Error('direction has no session');
    await this.attachWorkspace(this.treePath(d.worktreeId), d.displayName, d.primarySessionId);
    await this.services.workspaceRegistry.unarchiveSession(d.primarySessionId);
    return { directionId: id, sessionId: d.primarySessionId };
  }
  async checkDirection(id: string) {
    const d = this.direction(id);
    if (d.state === 'removed') throw new Error('removed directions cannot be reactivated');
    if (d.recoveryReasons?.length) throw new Error(`legacy references need repair: ${d.recoveryReasons.join('; ')}`);
    const expected = this.store.read().worktrees.find(w => w.id === d.worktreeId)!;
    const identity = await new GitAdapter(this.git, expected.canonicalPath).identify();
    if (!samePath(identity.worktreePath, expected.canonicalPath) || identity.branchRef !== expected.branchRef) throw new Error('direction worktree identity mismatch');
    const resolved = await this.identify(expected.canonicalPath);
    if (resolved.repoId !== d.repoId) throw new Error('legacy repository references need repair');
    const parent = this.store.read().worktrees.find(w => w.id === d.integrationTargetWorktreeId)!;
    const parentIdentity = await new GitAdapter(this.git, parent.canonicalPath).identify();
    if (!samePath(parentIdentity.commonDir, identity.commonDir) || !samePath(parentIdentity.worktreePath, parent.canonicalPath) || parentIdentity.branchRef !== parent.branchRef) throw new Error('parent worktree identity mismatch');
    await this.clean(expected.canonicalPath); await this.clean(parent.canonicalPath);
    for (const path of [expected.canonicalPath, parent.canonicalPath]) {
      const merging = (await this.git.run(['rev-parse', '--git-path', 'MERGE_HEAD'], {cwd:path})).stdout.trim();
      try { await access(resolve(path, merging)); throw new Error('unfinished Git merge requires completion or abort'); }
      catch(e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    await this.update(s => { const direction=s.directions.find(x=>x.id===id)!;direction.state='ready';direction.upstreamRef=parent.branchRef; });
    return {directionId:id,state:'ready',baseOidKnown:!!d.baseOid};
  }
  tree(currentSessionId?: string): Promise<any> {
    if (this.#treeFlight) return this.#treeFlight;
    const flight = this.readTree(currentSessionId).finally(() => { if (this.#treeFlight === flight) this.#treeFlight = undefined; });
    this.#treeFlight = flight; return flight;
  }
  async readTree(currentSessionId?: string) {
    this.assertActive(); const generation = this.#generation, s = this.store.read();
    const query = this.services.sessionQuery;
    let corpus: any[] = [], corpusError: string | null = null;
    try { if (!query?.listSessions) throw new Error('sessionQuery unavailable'); corpus = await query.listSessions(); }
    catch (e) { corpusError = String((e as Error).message); }
    const ids = new Set([...s.sessions.map(x => x.sessionId), ...corpus.map(x => x.header.id), ...(currentSessionId ? [currentSessionId] : [])]);
    const now = Date.now(), toRead = [...ids].filter(id => id === currentSessionId || !this.#titles.has(id) || now - this.#titles.get(id)!.at > 60_000).sort((a, b) => Number(b === currentSessionId) - Number(a === currentSessionId)).slice(0, 64);
    if (query?.readTitleSnapshots && toRead.length) {
      try { const titles = await query.readTitleSnapshots(toRead); for (const t of titles) this.#titles.set(t.sessionId, { value: t.status === 'fulfilled' ? t.value.title : undefined, at: now }); }
      catch { for (const id of toRead) this.#titles.set(id, { value: undefined, at: now }); }
    }
    this.assertActive(); if (generation !== this.#generation) throw new Error('host services changed during tree read');
    const archived = new Set(this.services.workspaceRegistry?.archivedSessionIds ?? []);
    const corpusById = new Map(corpus.map(x => [x.header.id, x])), linksById = new Map(s.sessions.map(x => [x.sessionId, x])), directionsBySession = new Map(s.directions.map(d => [d.primarySessionId, d]));
    // Read at most two missing summaries per request; empty and failed reads
    // back off too. Each observation is released by the instance adapter.
    if (query?.observeSession) {
      const missing = [...ids].filter(id => {
        const d = directionsBySession.get(id), title = this.#titles.get(id)?.value;
        const label = selectLabel({userTitle:title?.source?.kind === 'user' ? title.title : null,hostTitle:title?.title,brief:d?.brief,summary:d?.summary,sessionId:id});
        const cached = this.#previews.get(id);
        return label?.source === 'id' && (!cached || now - cached.at > 60_000) && corpusById.has(id);
      }).sort((a,b)=>Number(b === currentSessionId)-Number(a === currentSessionId)).slice(0,2);
      await Promise.all(missing.map(async id => {
        try { const text = await this.host.withObservation(id, o => derivePreview(o.events)); this.#previews.set(id,{text,at:now}); }
        catch { this.#previews.set(id,{text:null,at:now}); }
      }));
      this.assertActive(); if (generation !== this.#generation) throw new Error('host services changed during preview read');
    }
    const sessions = [...ids].map(id => {
      const record = corpusById.get(id), link = linksById.get(id), direction = directionsBySession.get(id);
      const title = this.#titles.get(id)?.value, live = this.ctx.sessions.get(id), cwd = record?.header.cwd ?? (link?.worktreeId ? this.treePath(link.worktreeId) : null);
      // Unknown subdirectory sessions stay unassigned until Git identification.
      // A prefix alone cannot distinguish a nested independent repository.
      const w = s.worktrees.find(w => w.present !== false && cwd && samePath(w.canonicalPath, cwd));
      const label = selectLabel({ userTitle: title?.source?.kind === 'user' ? title.title : null, hostTitle: live?.title?.title ?? title?.title,
        brief: direction?.brief, summary: direction?.summary || this.#previews.get(id)?.text, sessionId: id });
      return { sessionId: id, cwd, repoId: w?.repoId ?? null, worktreeId: w?.id ?? null, directionId: direction?.id ?? null,
        parentSessionId: record?.header.parentSession ?? s.forkEdges.find(e => e.targetSessionId === id)?.sourceSessionId ?? null,
        presence: live ? 'live' : record ? 'persisted' : corpusError ? 'unknown' : 'missing', archived: archived.has(id),
        label, createdAt: record?.header.createdAt ?? null };
    });
    return { ...s, sessions, operations: this.operations.summaries(), capabilities: this.host.capabilities(), corpusError };
  }
  async status(id: string) {
    const d = this.direction(id), cwd = this.treePath(d.worktreeId);
    return { directionId: id, status: (await this.git.run(['status', '--short'], { cwd })).stdout,
      branch: (await new GitAdapter(this.git, cwd).identify()).branchRef };
  }
}

async function migrateIfNeeded(dataFile: string): Promise<void> {
  // Old patch points to tree.json; the v2 path is separate and never overwrites it.
  const legacy = dataFile.replace(/tree-v2\.json$/, 'tree.json');
  if (legacy === dataFile) return;
  try { await access(dataFile); return; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let raw: unknown;
  try { raw = JSON.parse(await readFile(legacy, 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
  const report = migrateV1(raw); await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(report.state, null, 2), { flag: 'wx' });
  await writeFile(join(dirname(dataFile), 'migration-report.json'), JSON.stringify({ ...report, state: undefined }, null, 2));
}
const localRequest = (req: any): boolean => {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return false;
    return true;
  } catch { return false; }
};
async function readBody(req: any): Promise<any> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const raw = Buffer.from(chunk); size += raw.length; if (size > 64 * 1024) throw new ApiValidationError('body-too-large', 'body exceeds 64KiB'); chunks.push(raw); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiValidationError('invalid-json', 'invalid JSON body'); }
}
function send(res: any, status: number, body: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
export async function apply(ctx: any, config: ConfigValue): Promise<void> {
  if (!config?.dataFile) throw new Error('branchman: dataFile must be configured');
  const file = resolve(config.dataFile.replace(/tree\.json$/, 'tree-v2.json'));
  await migrateIfNeeded(file);
  const sessionPeer = await loadPeer('@deepseek-ai/dsh-session/fork');
  const toolsPeer = await loadPeer('@deepseek-ai/dsh-tools');
  const runtime = new BranchmanRuntime(ctx, { ...config, dataFile: file }, { buildForkSeed: sessionPeer.buildForkSeed, defineTool: toolsPeer.defineTool });
  await runtime.ready();
  ctx.effect(() => () => { void runtime.dispose(); }, 'branchman.runtime');
  for (const service of ['sessionQuery', 'agents', 'agentDefaultModel', 'workspaceRegistry', 'agentPresets']) {
    const fiber = ctx.inject([service], (child: any) => { const dispose = runtime.bind(service, child[service]); child.effect(() => dispose, `branchman.${service}`); });
    ctx.effect(() => () => fiber?.dispose?.(), `branchman.optional.${service}`);
  }
  const action = async (path: string, body: any) => {
    if (path === 'fork') return runtime.fork(body);
    if (path === 'recover') { if (typeof body.operationId !== 'string') throw new ApiValidationError('invalid-argument', 'operationId required'); return runtime.operations.recover(body.operationId); }
    if (typeof body.directionId !== 'string') throw new ApiValidationError('invalid-argument', 'directionId required');
    if (path === 'unarchive') return runtime.unarchive(body.directionId);
    if (path === 'check') return runtime.checkDirection(body.directionId);
    if (typeof body.requestId !== 'string' || !body.requestId.trim()) throw new ApiValidationError('invalid-argument', 'requestId required');
    if (path === 'remove' || path === 'drop') return runtime.operations.remove(body);
    if (path === 'merge' || path === 'sync') return runtime.integration(path, body.requestId, body.directionId);
    throw new ApiValidationError('not-found', 'unknown endpoint');
  };
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/branchman/api', handler: async (req: any, res: any) => {
    if (!localRequest(req)) return send(res, 403, errorEnvelope(new ApiValidationError('forbidden', 'request origin rejected')));
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname.split('/').at(-1);
      let result: unknown;
      if (req.method === 'GET' && path === 'tree') result = await runtime.tree(url.searchParams.get('currentSessionId') ?? undefined);
      else if (req.method === 'GET' && path === 'status') result = await runtime.status(url.searchParams.get('directionId') ?? '');
      else if (req.method === 'GET' && path === 'operations') result = runtime.operations.list();
      else if (req.method === 'POST') result = await action(path!, await readBody(req));
      else throw new ApiValidationError('not-found', 'endpoint not found');
      send(res, 200, ok(result, runtime.store.read().revision));
    } catch (e) { send(res, e instanceof IdempotencyConflictError ? 409 : e instanceof ApiValidationError ? (e.code === 'not-found' ? 404 : 400) : 500, errorEnvelope(e)); }
  } }), 'branchman.api');
  ctx.effect(() => {
    const disposers: Array<() => void> = [];
    for (const name of ['fork', 'tree', 'status', 'merge', 'sync', 'drop', 'unarchive', 'recover', 'check']) {
      const definition = { name: `branch_${name}`, description: name === 'fork' ? 'Create an isolated Git worktree and child session from the current conversation. Explicitly select inherit or blank history. Returns a durable operation status; recovery-required is not success.' : `Branchman ${name}: operates on stable directionId/operationId and returns actual operation state.`,
        parameters: name === 'tree' ? {} : name === 'fork' ? {
          displayName: { type: 'string', required: true }, brief: { type: 'string' }, history: { type: 'string', enum: ['inherit', 'blank'] }, carryChanges: { type: 'boolean' }, requestId: { type: 'string' }, messageId: { type: 'string' }, boundarySeq: { type: 'number' }
        } : name === 'recover' ? { operationId: { type: 'string', required: true } } : { directionId: { type: 'string', required: true }, requestId: { type: 'string' } },
        output: { schema: { type: 'string' }, render: (_args: any, value: unknown) => [{ type: 'text', text: String(value) }] }, execute: async (args: any, exec: any) => {
          const session = exec?.agent?.session, sessionId = exec?.agent?.sessionId ?? session?.id;
          const body = { ...args, requestId: args?.requestId ?? `tool-${exec?.id ?? randomUUID()}` };
          let result: unknown;
          if (name === 'tree') result = await runtime.tree(sessionId);
          else if (name === 'status') result = await runtime.status(body.directionId);
          else if (name === 'fork') result = await runtime.fork({ ...body, sourceSessionId: sessionId, sourceCwd: session?.header?.cwd,
            codeSource: { kind: 'source-head', carryChanges: args?.carryChanges !== false }, history: args?.history ?? 'inherit' });
          else result = await action(name, body);
          return JSON.stringify(ok(result, runtime.store.read().revision));
        } };
      disposers.push(ctx.tools.register(toolsPeer.defineTool(definition)));
    }
    return () => disposers.forEach(d => d?.());
  }, 'branchman.tools');
}
