import assert from 'node:assert/strict';
import test from 'node:test';
import { OperationsEngine } from '../../src/host/operations.js';
import type { ForkEffects, ForkRequest, OperationRecord } from '../../src/host/operations.js';

const baseFork = (over: Partial<ForkRequest> = {}): ForkRequest => ({
  requestId: 'req-r',
  sourceSessionId: 'src',
  sourceCwd: 'E:/repo/src',
  displayName: '走向R',
  brief: '',
  codeSource: { kind: 'source-head', carryChanges: true },
  history: 'inherit',
  ...over,
});

// An effect fixture that can be told to fail at ANY phase and records the
// resources it created, so tests can assert per-phase ownership + recovery.
function phaseRecorder(failAt?: string) {
  const created: string[] = [];
  const phases: string[] = [];
  const effects: ForkEffects = {
    identify: async () => {
      phases.push('capture');
      return { repoId: 'repo-1', worktreePath: 'E:/repo', headOid: 'h1', branchRef: 'main' };
    },
    createWorktree: async (_r, branch, wp) => {
      phases.push('create-worktree');
      if (failAt === 'create-worktree') throw new Error('worktree add failed');
      created.push(`wt:${wp}`);
      created.push(`br:${branch}`);
    },
    carryChanges: async () => {
      phases.push('carry');
      if (failAt === 'carry') throw new Error('carry failed');
      return { carried: [], failed: [] };
    },
    createChildSession: async () => {
      phases.push('create-session');
      if (failAt === 'create-session') throw new Error('child failed');
      created.push('session:child-1');
      return { sessionId: 'child-1', seeded: true, inherited: 0 };
    },
    attachWorkspace: async () => {
      phases.push('attach-workspace');
      if (failAt === 'attach-workspace') throw new Error('workspace failed');
      return {};
    },
    persistDirection: async () => {
      phases.push('commit-direction');
      if (failAt === 'commit-direction') throw new Error('persist failed');
      created.push('direction:1');
    },
    removeWorktree: async (_r, wp, br) => {
      phases.push('compensate');
      created.push(`removed:${wp}`);
    },
    removeDirection: async () => { phases.push('remove-direction'); },
  };
  return { effects, created, phases };
}

test('failure at each phase is reported with that phase in the result', async () => {
  for (const phase of ['create-worktree', 'carry', 'create-session', 'attach-workspace', 'commit-direction']) {
    const rec = phaseRecorder(phase);
    const engine = new OperationsEngine(rec.effects);
    const result = await engine.fork(baseFork({ requestId: `req-${phase}` }));
    assert.equal(result.state === 'failed' || result.state === 'recovery-required', true, `${phase} should fail`);
    // The phase field reflects where it stopped (the last phase it entered).
    assert.ok(rec.phases.includes(phase), `${phase} should have run`);
  }
});

test('a create-worktree failure owns nothing to compensate', async () => {
  const rec = phaseRecorder('create-worktree');
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork());
  assert.equal(result.state, 'failed');
  assert.equal(rec.created.some(c => c.startsWith('wt:')), false, 'no worktree should have been created');
});

test('a late failure preserves the child worktree and requires reconciliation', async () => {
  const rec = phaseRecorder('commit-direction');
  const engine = new OperationsEngine(rec.effects);
  const result = await engine.fork(baseFork());
  assert.equal(result.state, 'recovery-required');
  assert.equal(rec.created.some(c => c.startsWith('removed:')), false, 'a child session still needs its worktree');
  assert.equal(rec.created.some(c => c.startsWith('direction:')), false, 'no direction persisted');
});

test('an incomplete host side effect exposes resources requiring reconciliation', async () => {
  const rec = phaseRecorder('create-session');
  const engine = new OperationsEngine(rec.effects);
  const failed = await engine.fork(baseFork());

  const op = engine.getOperation(failed.operationId);
  assert.ok(op);
  assert.equal(op.state, 'recovery-required');
  assert.equal(op.phase, 'create-session');
  const record: OperationRecord = engine.getByRequestId('req-r')!;
  assert.equal(record.requestId, 'req-r');
  assert.equal(record.kind, 'fork');
  assert.ok(record.ownedResources.some(r => r.startsWith('worktree:')));
});
