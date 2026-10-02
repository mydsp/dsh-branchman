import { mkdir, readdir, readFile, rename, rm, open } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from './store.js';

export type OperationKind = 'fork' | 'merge' | 'sync' | 'remove';
export type OperationState = 'running' | 'succeeded' | 'failed' | 'recovery-required';
export type ForkRequest = {
  requestId: string; sourceSessionId: string; sourceCwd: string; messageId?: string;
  boundarySeq?: number; displayName: string; brief: string;
  codeSource: { kind: 'source-head'; carryChanges: boolean }
    | { kind: 'explicit-commit'; oid: string; carryChanges: false };
  history: 'inherit' | 'blank';
};
export type RemoveRequest = { requestId: string; directionId: string };
export type Plan = {
  repoId: string; sourcePath: string; headOid: string; baseOid: string;
  directionId: string; worktreeId: string; worktreePath: string; branch: string;
};
export type OperationRecord = {
  id: string; requestId: string; kind: OperationKind; phase: string; state: OperationState;
  ownedResources: string[]; errorCode: string | null; requestDigest: string; createdAt: string;
  request?: ForkRequest; plan?: Plan; child?: { sessionId: string; seeded: boolean; inherited: number; boundary?: number | null };
  workspaceId?: string; directionId?: string;
  resolvedBoundary?: number | null;
};
export type OperationResult = {
  operationId: string; directionId: string | null; state: OperationState;
  phase: string; code: string | null; retryable: boolean;
};
export type ForkEffects = {
  identify(sourceCwd: string): Promise<{ repoId: string; worktreePath: string; headOid: string; branchRef: string | null; managedRoot?: string }>;
  captureChanges?(operation: OperationRecord): Promise<void | { boundary: number | null }>;
  createWorktree(repoId: string, branch: string, path: string, baseRef: string | null): Promise<void>;
  carryChanges(repoId: string, path: string, operation?: OperationRecord): Promise<{ carried: string[]; failed: string[] }>;
  createChildSession(input: {
    worktreePath: string; sourceSessionId: string; history: 'inherit' | 'blank';
    messageId?: string; boundarySeq?: number; operationId?: string;
  }): Promise<{ sessionId: string; seeded: boolean; inherited: number; boundary?: number | null }>;
  attachWorkspace(path: string, name: string, sessionId: string | null): Promise<{ workspaceId?: string; warning?: string }>;
  persistDirection(input: {
    directionId: string; repoId: string; worktreeId: string; displayName: string; baseOid: string;
    primarySessionId: string | null; worktreePath?: string; branch?: string; brief?: string;
    sourceSessionId?: string; messageId?: string; boundarySeq?: number; inheritedEventCount?: number;
    workspaceId?: string; operationId?: string;
  }): Promise<void>;
  removeWorktree(repoId: string, path: string, branch: string): Promise<void>;
  removeDirection(repoId: string, directionId: string, branch: string): Promise<void>;
  directionRepo?(directionId: string): Promise<string>;
  reconcile?(operation: OperationRecord): Promise<OperationRecord>;
};

export function requestDigest(body: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return JSON.stringify(canonical(body));
}
export class IdempotencyConflictError extends Error {
  constructor(id: string) { super(`requestId "${id}" was already used with a different body`); this.name = 'IdempotencyConflictError'; }
}

// Production supplies journalDirectory. Omitting it is reserved for pure tests.
export class OperationsEngine {
  #effects: ForkEffects; #now: () => string; #journal?: string;
  #records = new Map<string, OperationRecord>(); #byRequest = new Map<string, string>();
  #inflight = new Map<string, { digest: string; promise: Promise<OperationResult> }>();
  #queues = new Map<string, Promise<unknown>>(); #ready: Promise<void>;
  constructor(effects: ForkEffects, now: () => string = () => new Date().toISOString(), options: { journalDirectory?: string } = {}) {
    this.#effects = effects; this.#now = now; this.#journal = options.journalDirectory; this.#ready = this.#load();
  }
  async ready(): Promise<void> { await this.#ready; }
  async #load(): Promise<void> {
    if (!this.#journal) return;
    await mkdir(this.#journal, { recursive: true });
    for (const file of await readdir(this.#journal)) {
      if (!/^[\da-f-]{36}\.json$/i.test(file)) continue;
      const r = JSON.parse(await readFile(join(this.#journal, file), 'utf8')) as OperationRecord;
      if (typeof r.id !== 'string' || file !== `${r.id}.json` || typeof r.requestId !== 'string'
        || !['fork', 'merge', 'sync', 'remove'].includes(r.kind)
        || !['running', 'succeeded', 'failed', 'recovery-required'].includes(r.state)
        || !Array.isArray(r.ownedResources) || typeof r.requestDigest !== 'string') throw new Error(`invalid operation journal: ${file}`);
      const interrupted = r.state === 'running';
      if (interrupted) { r.state = 'recovery-required'; r.errorCode = 'interrupted'; }
      if (this.#byRequest.has(r.requestId)) throw new Error(`duplicate requestId in operation journal: ${r.requestId}`);
      this.#records.set(r.id, r); this.#byRequest.set(r.requestId, r.id);
      if (interrupted) await this.#save(r);
    }
  }
  async #save(record: OperationRecord): Promise<void> {
    if (this.#journal) {
      const dest = join(this.#journal, `${record.id}.json`), tmp = `${dest}.${newId()}.tmp`;
      try {
        const handle = await open(tmp, 'wx');
        try { await handle.writeFile(JSON.stringify(record, null, 2)); await handle.sync(); } finally { await handle.close(); }
        await rename(tmp, dest);
      } catch (error) { await rm(tmp, { force: true }).catch(() => {}); throw error; }
    }
    this.#records.set(record.id, structuredClone(record)); this.#byRequest.set(record.requestId, record.id);
  }
  #enqueue<T>(repoId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.#queues.get(repoId) ?? Promise.resolve();
    const run = prev.then(work, work); const tail = run.then(() => undefined, () => undefined);
    this.#queues.set(repoId, tail);
    void tail.then(() => { if (this.#queues.get(repoId) === tail) this.#queues.delete(repoId); });
    return run;
  }
  getOperation(id: string): OperationRecord | undefined { const r = this.#records.get(id); return r ? structuredClone(r) : undefined; }
  getByRequestId(id: string): OperationRecord | undefined { const key = this.#byRequest.get(id); return key ? this.getOperation(key) : undefined; }
  list(): OperationRecord[] { return [...this.#records.values()].map(r => structuredClone(r)); }
  summaries() {
    return [...this.#records.values()].map(r => ({id:r.id,kind:r.kind,state:r.state,phase:r.phase,
      errorCode:r.errorCode?.slice(0,1000) ?? null,createdAt:r.createdAt,directionId:r.directionId ?? null}))
      .sort((a,b)=>a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }
  #result(r: OperationRecord): OperationResult {
    return { operationId: r.id, directionId: r.directionId ?? null, state: r.state, phase: r.phase,
      code: r.errorCode, retryable: r.state === 'failed' || r.state === 'recovery-required' };
  }
  #reserve(requestId: string, digest: string, work: () => Promise<OperationResult>): Promise<OperationResult> {
    const prior = this.#inflight.get(requestId);
    if (prior) return prior.digest === digest ? prior.promise : Promise.reject(new IdempotencyConflictError(requestId));
    const promise = Promise.resolve().then(work);
    const slot = { digest, promise }; this.#inflight.set(requestId, slot);
    void promise.then(() => { if (this.#inflight.get(requestId) === slot) this.#inflight.delete(requestId); }, () => { if (this.#inflight.get(requestId) === slot) this.#inflight.delete(requestId); });
    return promise;
  }
  fork(request: ForkRequest): Promise<OperationResult> {
    const snapshot = structuredClone(request), digest = requestDigest({ kind: 'fork', request: snapshot });
    return this.#reserve(snapshot.requestId, digest, async () => {
      await this.#ready;
      const prior = this.getByRequestId(snapshot.requestId);
      if (prior) { if (prior.requestDigest !== digest) throw new IdempotencyConflictError(snapshot.requestId); return this.#result(prior); }
      const identity = await this.#effects.identify(snapshot.sourceCwd);
      return this.#enqueue(identity.repoId, async () => {
        const record: OperationRecord = { id: newId(), requestId: snapshot.requestId, kind: 'fork', phase: 'plan',
          state: 'running', ownedResources: [], errorCode: null, requestDigest: digest, createdAt: this.#now(), request: snapshot };
        const directionId = newId();
        record.plan = { repoId: identity.repoId, sourcePath: identity.worktreePath, headOid: identity.headOid,
          baseOid: snapshot.codeSource.kind === 'explicit-commit' ? snapshot.codeSource.oid : identity.headOid,
          directionId, worktreeId: newId(), branch: `branchman/${directionId}`,
          worktreePath: join(identity.managedRoot ?? identity.worktreePath, '.branches', directionId) };
        await this.#save(record); return this.#runFork(record);
      });
    });
  }
  async recover(operationId: string): Promise<OperationResult> {
    await this.#ready; const record = this.getOperation(operationId);
    if (!record) throw new Error(`unknown operation ${operationId}`);
    if (record.state === 'succeeded') return this.#result(record);
    if (record.kind !== 'fork' || !record.request || !record.plan) throw new Error(`manual recovery required for ${record.kind}`);
    return this.#reserve(record.requestId, record.requestDigest, () => this.#enqueue(record.plan!.repoId, async () => {
      let reconciled = record;
      if (this.#effects.reconcile) reconciled = await this.#effects.reconcile(record);
      else if (record.ownedResources.length > 0) { record.state = 'recovery-required'; record.errorCode = 'resource-reconciliation-required'; await this.#save(record); return this.#result(record); }
      if (reconciled.state === 'succeeded') { await this.#save(reconciled); return this.#result(reconciled); }
      return this.#runFork(reconciled);
    }));
  }
  async #runFork(record: OperationRecord): Promise<OperationResult> {
    const request = record.request!, plan = record.plan!;
    const phase = async (value: string) => { record.phase = value; record.state = 'running'; record.errorCode = null; await this.#save(record); };
    try {
      if (!record.ownedResources.includes(`worktree:${plan.worktreePath}`)) {
        await phase('capture'); const captured = await this.#effects.captureChanges?.(structuredClone(record));
        if (captured) { record.resolvedBoundary = captured.boundary; await this.#save(record); }
        await phase('create-worktree');
        await this.#effects.createWorktree(plan.repoId, plan.branch, plan.worktreePath, plan.baseOid);
        record.ownedResources.push(`worktree:${plan.worktreePath}`, `branch:${plan.branch}`); await this.#save(record);
      }
      if (!record.child) {
        if (request.codeSource.kind === 'source-head' && request.codeSource.carryChanges) {
          await phase('carry'); const carry = await this.#effects.carryChanges(plan.repoId, plan.worktreePath, structuredClone(record));
          if (carry.failed.length) throw new Error(`carry-incomplete: ${carry.failed.join(', ')}`);
        }
        await phase('create-session');
        record.child = await this.#effects.createChildSession({ worktreePath: plan.worktreePath, sourceSessionId: request.sourceSessionId,
          history: request.history, ...(request.messageId ? { messageId: request.messageId } : {}),
          ...(record.resolvedBoundary != null ? { boundarySeq: record.resolvedBoundary } : request.boundarySeq !== undefined ? { boundarySeq: request.boundarySeq } : {}), operationId: record.id });
        record.ownedResources.push(`session:${record.child.sessionId}`); await this.#save(record);
      }
      if (request.history === 'inherit' && !record.child.seeded) throw new Error('history-not-inherited');
      await phase('attach-workspace');
      const workspace = await this.#effects.attachWorkspace(plan.worktreePath, request.displayName, record.child.sessionId);
      if (workspace.warning) throw new Error(`workspace-incomplete: ${workspace.warning}`);
      if (workspace.workspaceId) { record.workspaceId = workspace.workspaceId; record.ownedResources.push(`workspace:${workspace.workspaceId}`); await this.#save(record); }
      await phase('commit-direction');
      await this.#effects.persistDirection({ directionId: plan.directionId, repoId: plan.repoId, worktreeId: plan.worktreeId,
        displayName: request.displayName, baseOid: plan.baseOid, primarySessionId: record.child.sessionId,
        worktreePath: plan.worktreePath, branch: plan.branch, brief: request.brief, sourceSessionId: request.sourceSessionId,
        ...(request.messageId ? { messageId: request.messageId } : {}),
        ...(record.child.boundary != null ? { boundarySeq: record.child.boundary } : request.boundarySeq !== undefined ? { boundarySeq: request.boundarySeq } : {}),
        inheritedEventCount: record.child.inherited, ...(record.workspaceId ? { workspaceId: record.workspaceId } : {}), operationId: record.id });
      record.directionId = plan.directionId; record.phase = 'completed'; record.state = 'succeeded'; await this.#save(record);
    } catch (error) {
      record.errorCode = error instanceof Error ? error.message : String(error);
      let clean = record.ownedResources.length === 0;
      if (!record.child && !['create-session', 'attach-workspace', 'commit-direction'].includes(record.phase) && record.ownedResources.includes(`worktree:${plan.worktreePath}`)) {
        try { await this.#effects.removeWorktree(plan.repoId, plan.worktreePath, plan.branch); record.ownedResources = []; clean = true; }
        catch { clean = false; }
      }
      record.state = clean ? 'failed' : 'recovery-required'; await this.#save(record);
    }
    return this.#result(record);
  }
  run(kind: Exclude<OperationKind, 'fork'>, requestId: string, payload: unknown, repoId: string, effect: () => Promise<void>): Promise<OperationResult> {
    const digest = requestDigest({ kind, payload });
    return this.#reserve(requestId, digest, async () => {
      await this.#ready; const prior = this.getByRequestId(requestId);
      if (prior) { if (prior.requestDigest !== digest) throw new IdempotencyConflictError(requestId); return this.#result(prior); }
      return this.#enqueue(repoId, async () => {
        const record: OperationRecord = { id: newId(), requestId, kind, phase: kind, state: 'running', ownedResources: [],
          errorCode: null, requestDigest: digest, createdAt: this.#now() };
        await this.#save(record);
        try { await effect(); record.state = 'succeeded'; record.phase = 'completed'; }
        catch (error) { record.state = 'recovery-required'; record.errorCode = error instanceof Error ? error.message : String(error); }
        await this.#save(record); return this.#result(record);
      });
    });
  }
  async remove(request: RemoveRequest): Promise<OperationResult> {
    const repoId = await this.#effects.directionRepo?.(request.directionId) ?? `direction:${request.directionId}`;
    return this.run('remove', request.requestId, request, repoId, () => this.#effects.removeDirection(repoId, request.directionId, ''));
  }
}
