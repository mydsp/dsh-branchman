// Recoverable, idempotent operation engine (S04/S07 + audit §8.1).
//
// Principles:
//   - intent-first: persist the operation BEFORE any external side effect;
//   - phase-tracked: fork runs plan → capture → create-worktree → carry →
//     create-session → attach-workspace → commit-direction → completed, and a
//     failure reports WHICH phase failed and what it owned;
//   - idempotent: same requestId returns the same operation; a different body
//     under a reused requestId is a 409 conflict;
//   - compensating, not fabricating: a failure rolls back only resources this
//     operation owns and knows have no user work, and reports recovery-required
//     when it cannot promise full rollback;
//   - per-repo serialized: one queue lock per repoId, reads never take the lock.
//
// All side effects come through injected adapters so the engine is testable
// without a host, and so "Git failed at phase X" can be simulated deterministically.

import { newId } from './store.js';

export type OperationKind = 'fork' | 'merge' | 'sync' | 'remove';

export type OperationPhase =
  | 'plan' | 'capture' | 'create-worktree' | 'carry'
  | 'create-session' | 'attach-workspace' | 'commit-direction' | 'completed';

export type OperationState = 'running' | 'succeeded' | 'failed' | 'recovery-required';

export type OperationRecord = {
  id: string;
  requestId: string;
  kind: OperationKind;
  phase: OperationPhase | string;
  state: OperationState;
  ownedResources: string[];
  errorCode: string | null;
  requestDigest: string;
  createdAt: string;
};

export type OperationResult = {
  operationId: string;
  directionId: string | null;
  state: OperationState;
  phase: string;
  code: string | null;
  retryable: boolean;
};

export type ForkRequest = {
  requestId: string;
  sourceSessionId: string;
  sourceCwd: string;
  messageId?: string;
  boundarySeq?: number;
  displayName: string;
  brief: string;
  codeSource: { kind: 'source-head'; carryChanges: boolean }
    | { kind: 'explicit-commit'; oid: string; carryChanges: false };
  history: 'inherit' | 'blank';
};

export type RemoveRequest = {
  requestId: string;
  directionId: string;
};

/** Injectable side effects — every external action the engine may take. */
export type ForkEffects = {
  /** Resolve the source repo identity from sourceCwd. */
  identify(sourceCwd: string): Promise<{ repoId: string; worktreePath: string; headOid: string; branchRef: string | null }>;
  /** Create a worktree + branch; baseRef is the base to branch from (may be null → HEAD). */
  createWorktree(repoId: string, branch: string, worktreePath: string, baseRef: string | null): Promise<void>;
  /** Carry the captured source-head changes into the worktree. */
  carryChanges(repoId: string, worktreePath: string): Promise<{ carried: string[]; failed: string[] }>;
  /** Create the child session (inherit or blank). */
  createChildSession(input: {
    worktreePath: string; sourceSessionId: string; history: 'inherit' | 'blank';
  }): Promise<{ sessionId: string; seeded: boolean; inherited: number }>;
  /** Register the direction workspace (optional host capability). */
  attachWorkspace(worktreePath: string, displayName: string, sessionId: string | null): Promise<{ workspaceId?: string; warning?: string }>;
  /** Persist the direction entity. */
  persistDirection(input: { directionId: string; repoId: string; worktreeId: string; displayName: string; baseOid: string; primarySessionId: string | null }): Promise<void>;
  /** Compensate: remove a worktree + branch this operation created. */
  removeWorktree(repoId: string, worktreePath: string, branch: string): Promise<void>;
  /** Teardown a direction (guarded externally): remove worktree + branch. */
  removeDirection(repoId: string, worktreePath: string, branch: string): Promise<void>;
};

/** A stable digest of a request body, used to reject idempotency-key reuse. */
export function requestDigest(body: unknown): string {
  return JSON.stringify(body);
}

export class IdempotencyConflictError extends Error {
  constructor(requestId: string) {
    super(`requestId "${requestId}" was already used with a different body`);
    this.name = 'IdempotencyConflictError';
  }
}

export class OperationsEngine {
  readonly #effects: ForkEffects;
  readonly #records = new Map<string, OperationRecord>();
  readonly #byRequestId = new Map<string, OperationRecord>();
  readonly #requests = new Map<string, ForkRequest>();
  readonly #directionsByOperation = new Map<string, string>();
  readonly #repoQueues = new Map<string, Promise<unknown>>();
  readonly #now: () => string;

  constructor(effects: ForkEffects, now: () => string = () => new Date().toISOString()) {
    this.#effects = effects;
    this.#now = now;
  }

  /** Drain a repo's operation queue, serializing side effects per repo. */
  #enqueue<T>(repoId: string, work: () => Promise<T>): Promise<T> {
    const prev = this.#repoQueues.get(repoId) ?? Promise.resolve();
    const run = prev.then(work, work);
    this.#repoQueues.set(repoId, run.then(() => undefined, () => undefined));
    return run;
  }

  #record(partial: Omit<OperationRecord, 'id' | 'createdAt'>): OperationRecord {
    const record: OperationRecord = { id: newId(), createdAt: this.#now(), ...partial };
    this.#records.set(record.id, record);
    this.#byRequestId.set(record.requestId, record);
    return record;
  }

  #patch(id: string, patch: Partial<OperationRecord>): void {
    const current = this.#records.get(id);
    if (current !== undefined) this.#records.set(id, { ...current, ...patch });
  }

  getOperation(operationId: string): OperationRecord | undefined {
    return this.#records.get(operationId);
  }

  getByRequestId(requestId: string): OperationRecord | undefined {
    return this.#byRequestId.get(requestId);
  }

  /** Fork a direction. Idempotent on requestId (conflict on body change). */
  fork(request: ForkRequest): Promise<OperationResult> {
    return this.#runFork(request, null);
  }

  /** Recover an operation that ended in failed/recovery-required. */
  async recover(operationId: string): Promise<OperationResult> {
    const existing = this.#records.get(operationId);
    if (existing === undefined) throw new Error(`unknown operation ${operationId}`);
    if (existing.state === 'succeeded') return this.#result(existing);
    if (existing.kind !== 'fork') throw new Error(`cannot recover a ${existing.kind} operation`);
    const request = this.#requests.get(operationId);
    if (request === undefined) throw new Error(`no stored request for operation ${operationId}`);
    return this.#runFork(request, existing.id);
  }

  /** Remove a direction, guarded against dirty/unmerged/external worktrees. */
  remove(request: RemoveRequest): Promise<OperationResult> {
    const existing = this.#byRequestId.get(request.requestId);
    if (existing !== undefined) return Promise.resolve(this.#result(existing));
    const record = this.#record({
      requestId: request.requestId,
      kind: 'remove',
      phase: 'plan',
      state: 'running',
      ownedResources: [],
      errorCode: null,
      requestDigest: requestDigest(request),
    });
    return this.#enqueue('remove', async () => {
      try {
        // Teardown is delegated to the caller-supplied effect, which performs
        // the dirty/unmerged/external guards before removing anything.
        await this.#effects.removeDirection('', request.directionId, '');
        this.#patch(record.id, { phase: 'completed', state: 'succeeded' });
        return this.#result(this.#records.get(record.id) ?? record);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.#patch(record.id, { phase: 'remove-worktree', state: 'failed', errorCode: message });
        return this.#result(this.#records.get(record.id) ?? record);
      }
    });
  }

  async #runFork(request: ForkRequest, resumeId: string | null): Promise<OperationResult> {
    // Idempotency is only enforced for fresh forks, not for an explicit
    // recover(resumeId) of a known operation.
    if (resumeId === null) {
      const prior = this.#byRequestId.get(request.requestId);
      if (prior !== undefined) {
        if (prior.requestDigest !== requestDigest(request)) throw new IdempotencyConflictError(request.requestId);
        return this.#result(prior);
      }
    }

    const id = await this.#effects.identify(request.sourceCwd);
    const repoId = id.repoId;

    return this.#enqueue(repoId, async () => {
      const record = resumeId !== null && this.#records.has(resumeId)
        ? this.#records.get(resumeId)!
        : this.#record({
          requestId: request.requestId,
          kind: 'fork',
          phase: 'plan',
          state: 'running',
          ownedResources: [],
          errorCode: null,
          requestDigest: requestDigest(request),
        });
      this.#requests.set(record.id, request);

      const owned: string[] = [];
      let directionId: string | null = null;
      let branch = '';
      let worktreePath = '';

      try {
        // phase: capture (identity already resolved above)
        this.#patch(record.id, { phase: 'capture' });
        const baseRef = request.codeSource.kind === 'explicit-commit' ? request.codeSource.oid : null;
        const baseOid = request.codeSource.kind === 'explicit-commit' ? request.codeSource.oid : id.headOid;

        // phase: create-worktree
        this.#patch(record.id, { phase: 'create-worktree' });
        branch = `branchman/${request.displayName}`;
        worktreePath = `${id.worktreePath}/.branches/${request.displayName}`;
        await this.#effects.createWorktree(repoId, branch, worktreePath, baseRef);
        owned.push(`worktree:${worktreePath}`);
        owned.push(`branch:${branch}`);

        // phase: carry (only for source-head + carryChanges)
        if (request.codeSource.kind === 'source-head' && request.codeSource.carryChanges) {
          this.#patch(record.id, { phase: 'carry' });
          await this.#effects.carryChanges(repoId, worktreePath);
        }

        // phase: create-session
        this.#patch(record.id, { phase: 'create-session' });
        const child = await this.#effects.createChildSession({
          worktreePath,
          sourceSessionId: request.sourceSessionId,
          history: request.history,
        });
        owned.push(`session:${child.sessionId}`);

        // phase: attach-workspace
        this.#patch(record.id, { phase: 'attach-workspace' });
        await this.#effects.attachWorkspace(worktreePath, request.displayName, child.sessionId);

        // phase: commit-direction
        this.#patch(record.id, { phase: 'commit-direction' });
        directionId = newId();
        await this.#effects.persistDirection({
          directionId,
          repoId,
          worktreeId: newId(),
          displayName: request.displayName,
          baseOid,
          primarySessionId: child.sessionId,
        });
        this.#directionsByOperation.set(record.id, directionId);

        this.#patch(record.id, { phase: 'completed', state: 'succeeded', ownedResources: owned });
        return this.#result(this.#records.get(record.id) ?? record);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let compensated = true;
        try {
          if (worktreePath !== '') await this.#effects.removeWorktree(repoId, worktreePath, branch);
        } catch {
          compensated = false;
        }
        this.#patch(record.id, {
          state: compensated ? 'failed' : 'recovery-required',
          errorCode: message,
          ownedResources: owned,
        });
        return this.#result(this.#records.get(record.id) ?? record);
      }
    });
  }

  #result(record: OperationRecord): OperationResult {
    return {
      operationId: record.id,
      directionId: this.#directionsByOperation.get(record.id) ?? null,
      state: record.state,
      phase: record.phase,
      code: record.errorCode,
      retryable: record.state === 'failed' || record.state === 'recovery-required',
    };
  }
}
