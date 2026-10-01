import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationsEngine, IdempotencyConflictError, requestDigest } from '../../src/host/operations.js';
import type { ForkEffects, ForkRequest } from '../../src/host/operations.js';

const baseFork = (over: Partial<ForkRequest> = {}): ForkRequest => ({
  requestId: 'req-1',
  sourceSessionId: 'src-session',
  sourceCwd: 'E:/repo/src',
  displayName: '走向A',
  brief: '用户给的一句意图',
  codeSource: { kind: 'source-head', carryChanges: true },
  history: 'inherit',
  ...over,
});

type EffectsRecorder = {
  phases: string[];
  worktreesCreated: string[];
  sessionsCreated: string[];
  directionsPersisted: string[];
  failAt?: string;
  removeWorktreeFails?: boolean;
  removed: string[];
  effects: ForkEffects;
};

function recorder(over: Partial<Omit<EffectsRecorder, 'effects'>> = {}): EffectsRecorder {
  const rec: EffectsRecorder = {
    phases: [],
    worktreesCreated: [],
    sessionsCreated: [],
    directionsPersisted: [],
    removed: [],
    ...over,
  } as EffectsRecorder;
  rec.effects = {
    identify: async sourceCwd => {
      rec.phases.push('capture');
      return { repoId: 'repo-1', worktreePath: 'E:/repo', headOid: 'abc123', branchRef: 'main' };
    },
    createWorktree: async (_repoId, branch, worktreePath) => {
      rec.phases.push('create-worktree');
      rec.worktreesCreated.push(`${branch}@${worktreePath}`);
      if (rec.failAt === 'create-worktree') throw new Error('git worktree add failed');
    },
    carryChanges: async (_repoId, _worktreePath) => {
      rec.phases.push('carry');
      return { carried: ['a.txt'], failed: [] };
    },
    createChildSession: async () => {
      rec.phases.push('create-session');
      rec.sessionsCreated.push('session-1');
      if (rec.failAt === 'create-session') throw new Error('agents.create failed');
      return { sessionId: 'session-1', seeded: true, inherited: 5 };
    },
    attachWorkspace: async () => {
      rec.phases.push('attach-workspace');
      return {};
    },
    persistDirection: async input => {
      rec.phases.push('commit-direction');
      rec.directionsPersisted.push(input.directionId);
    },
    removeWorktree: async (_repoId, worktreePath, branch) => {
      rec.phases.push('compensate');
      rec.removed.push(`${branch}@${worktreePath}`);
      if (rec.removeWorktreeFails) throw new Error('rollback failed');
    },
    removeDirection: async () => {},
  };
  return rec;
}

test('a successful fork runs all phases in order and returns succeeded', async () => {
  const rec = recorder();
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork());
  assert.equal(result.state, 'succeeded');
  assert.equal(result.phase, 'completed');
  assert.deepEqual(rec.phases, ['capture', 'create-worktree', 'carry', 'create-session', 'attach-workspace', 'commit-direction']);
  assert.equal(rec.worktreesCreated.length, 1);
  assert.equal(rec.sessionsCreated.length, 1);
  assert.equal(rec.directionsPersisted.length, 1);
  assert.ok(result.directionId);
});

test('same requestId returns the same operation without re-running side effects', async () => {
  const rec = recorder();
  const engine = new OperationsEngine(rec.effects);
  const first = await engine.fork(baseFork());
  const second = await engine.fork(baseFork());
  assert.equal(first.operationId, second.operationId);
  // side effects ran exactly once
  assert.equal(rec.worktreesCreated.length, 1);
  assert.equal(rec.sessionsCreated.length, 1);
});

test('same requestId with a different body throws a conflict', async () => {
  const engine = new OperationsEngine(recorder().effects);
  await engine.fork(baseFork());
  await assert.rejects(() => engine.fork(baseFork({ brief: 'different' })), IdempotencyConflictError);
});

test('a failure at create-session compensates the worktree and returns failed', async () => {
  const rec = recorder({ failAt: 'create-session' });
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork());
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'agents.create failed');
  assert.equal(result.retryable, true);
  // the worktree/branch it created was rolled back
  assert.equal(rec.removed.length, 1);
  assert.equal(rec.directionsPersisted.length, 0, 'no direction persisted on failure');
});

test('a failed rollback marks the operation recovery-required', async () => {
  const rec = recorder({ failAt: 'create-session', removeWorktreeFails: true });
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork());
  assert.equal(result.state, 'recovery-required');
});

test('explicit-commit base skips carry and uses the commit oid as base', async () => {
  const rec = recorder();
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork({ codeSource: { kind: 'explicit-commit', oid: 'deadbeef', carryChanges: false } }));
  assert.equal(result.state, 'succeeded');
  // carry phase is skipped
  assert.equal(rec.phases.includes('carry'), false);
});

test('recover re-runs a failed operation from its stored request', async () => {
  const rec = recorder({ failAt: 'create-session' });
  const engine = new OperationsEngine(rec.effects);
  const failed = await engine.fork(baseFork());

  // now the effect succeeds
  rec.failAt = undefined;
  const recovered = await engine.recover(failed.operationId);
  assert.equal(recovered.state, 'succeeded');
  assert.equal(recovered.operationId, failed.operationId);
});

test('recover on an unknown id throws', async () => {
  const engine = new OperationsEngine(recorder().effects);
  await assert.rejects(() => engine.recover('nope'), /unknown operation/);
});

test('remove is idempotent by requestId', async () => {
  const engine = new OperationsEngine(recorder().effects);
  const a = await engine.remove({ requestId: 'rm-1', directionId: 'd1' });
  const b = await engine.remove({ requestId: 'rm-1', directionId: 'd1' });
  assert.equal(a.operationId, b.operationId);
});

test('requestDigest is deterministic per body', () => {
  assert.equal(requestDigest({ a: 1 }), requestDigest({ a: 1 }));
  assert.notEqual(requestDigest({ a: 1 }), requestDigest({ a: 2 }));
});
