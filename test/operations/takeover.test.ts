import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperationsEngine } from '../../src/host/operations.js';
import type { ForkEffects, ForkRequest } from '../../src/host/operations.js';

const request: ForkRequest = { requestId: 'same', sourceSessionId: 'parent', sourceCwd: 'E:/fixture',
  displayName: 'example', brief: 'intent', messageId: 'message-10', boundarySeq: 10,
  codeSource: { kind: 'source-head', carryChanges: true }, history: 'inherit' };
function fixture(options: { createFails?: boolean; carryFails?: boolean; unseeded?: boolean; childFails?: boolean } = {}) {
  const calls = { created: 0, removed: 0, base: '', child: {} as Record<string, unknown>, persisted: {} as Record<string, unknown> };
  const effects: ForkEffects = {
    identify: async () => ({ repoId: 'repo', worktreePath: 'E:/fixture', headOid: 'captured', branchRef: 'feature' }),
    createWorktree: async (_r, _b, _p, base) => { calls.base = base ?? ''; if (options.createFails) throw new Error('already exists'); calls.created++; },
    carryChanges: async () => ({ carried: [], failed: options.carryFails ? ['important.txt'] : [] }),
    createChildSession: async input => { calls.child = input; if (options.childFails) throw new Error('child failed'); return { sessionId: 'child', seeded: !options.unseeded, inherited: 11 }; },
    attachWorkspace: async () => ({}), persistDirection: async input => { calls.persisted = input; },
    removeWorktree: async () => { calls.removed++; }, removeDirection: async () => {},
  };
  return { calls, effects };
}
test('parallel identical requests share one operation and latest terminal result', async () => {
  const f = fixture(), engine = new OperationsEngine(f.effects);
  const [a, b] = await Promise.all([engine.fork(request), engine.fork(request)]);
  assert.equal(a.operationId, b.operationId); assert.equal(f.calls.created, 1);
  assert.equal((await engine.fork(request)).state, 'succeeded');
  assert.equal(f.calls.base, 'captured');
  assert.equal(f.calls.child.boundarySeq, 10); assert.equal(f.calls.child.messageId, 'message-10');
  assert.equal(f.calls.persisted.brief, 'intent');
});
test('failed creation does not remove a resource owned by someone else', async () => {
  const f = fixture({ createFails: true });
  const result = await new OperationsEngine(f.effects).fork(request);
  assert.equal(result.state, 'failed'); assert.equal(f.calls.removed, 0);
});
test('carry and inheritance failures never become success', async () => {
  for (const options of [{ carryFails: true }, { unseeded: true }]) {
    const f = fixture(options), result = await new OperationsEngine(f.effects).fork(request);
    assert.notEqual(result.state, 'succeeded');
  }
});
test('a fresh process reads a durable journal and recovers a clean failed operation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-journal-'));
  try {
    const f = fixture({ carryFails: true });
    const first = new OperationsEngine(f.effects, undefined, { journalDirectory: dir });
    const result = await first.fork(request); assert.equal(result.state, 'failed');
    const g = fixture(); const restarted = new OperationsEngine(g.effects, undefined, { journalDirectory: dir });
    await restarted.ready(); assert.equal(restarted.getOperation(result.operationId)?.state, 'failed');
    const recovered = await restarted.recover(result.operationId);
    assert.equal(recovered.operationId, result.operationId); assert.equal(recovered.state, 'succeeded');
    const final = new OperationsEngine(g.effects, undefined, { journalDirectory: dir }); await final.ready();
    assert.equal((await final.fork(request)).state, 'succeeded'); assert.equal(g.calls.created, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
