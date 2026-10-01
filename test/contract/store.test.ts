import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { StateStore, emptyStateV2, newId, validateStateV2, StateSchemaError, RevisionConflictError } from '../../src/host/store.js';
import type { StateV2 } from '../../src/host/store.js';

function directionState(): StateV2 {
  return {
    version: 2,
    revision: 0,
    repositories: [{ id: 'r1', canonicalCommonDir: 'e:/repo', primaryWorktreeId: 'w1' }],
    worktrees: [{ id: 'w1', repoId: 'r1', canonicalPath: 'e:/repo', branchRef: null, managedBy: 'branchman' }],
    sessions: [],
    directions: [],
    forkEdges: [],
  };
}

test('a fresh store writes an empty v2 document', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const file = join(dir, 'state.json');
  try {
    const store = new StateStore(file);
    await store.ready();
    const state = store.read();
    assert.equal(state.version, 2);
    assert.equal(state.revision, 0);
    assert.equal(state.directions.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('commit bumps revision and persists; reload reads the same state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const file = join(dir, 'state.json');
  try {
    const store = new StateStore(file);
    await store.ready();
    const next = directionState();
    next.directions.push({
      id: 'd1', repoId: 'r1', worktreeId: 'w1', displayName: '走向A',
      primarySessionId: null, baseOid: 'abc', upstreamRef: null,
      integrationTargetWorktreeId: 'w1', state: 'ready',
    });
    const rev = await store.commit(0, next);
    assert.equal(rev, 1);
    assert.equal(store.read().directions.length, 1);

    const reloaded = new StateStore(file);
    await reloaded.ready();
    assert.equal(reloaded.read().revision, 1);
    assert.equal(reloaded.read().directions[0]?.displayName, '走向A');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('commit with a stale expectedRevision throws a conflict', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const file = join(dir, 'state.json');
  try {
    const store = new StateStore(file);
    await store.ready();
    await store.commit(0, directionState());
    await assert.rejects(() => store.commit(0, directionState()), RevisionConflictError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failed write keeps the old in-memory snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-store-'));
  const file = join(dir, 'state.json');
  try {
    const store = new StateStore(file);
    await store.ready();
    await store.commit(0, directionState());

    // Replace the data file with a directory so rename() fails.
    await rm(file);
    await mkdir(file, { recursive: true });

    const bad = directionState();
    bad.directions.push({ id: 'd2', repoId: 'r1', worktreeId: 'w1', displayName: 'bad', primarySessionId: null, baseOid: 'x', upstreamRef: null, integrationTargetWorktreeId: 'w1', state: 'ready' });
    await assert.rejects(() => store.commit(1, bad));
    // in-memory snapshot is unchanged (still revision 1, no 'bad' direction)
    assert.equal(store.read().revision, 1);
    assert.equal(store.read().directions.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('validateStateV2 rejects a wrong-schema document loudly', () => {
  assert.throws(() => validateStateV2({ version: 1, revision: 0, nodes: [] }), StateSchemaError);
  assert.throws(() => validateStateV2({ version: 2, revision: -1, repositories: [], worktrees: [], sessions: [], directions: [], forkEdges: [] }), StateSchemaError);
  assert.throws(() => validateStateV2({ version: 2, revision: 0, repositories: 'x', worktrees: [], sessions: [], directions: [], forkEdges: [] }), StateSchemaError);
});

test('duplicate entity ids are rejected', () => {
  const s = directionState();
  s.worktrees.push({ ...s.worktrees[0]! }); // duplicate w1 id
  assert.throws(() => validateStateV2(s), StateSchemaError);
});

test('newId produces unique stable ids', () => {
  assert.notEqual(newId(), newId());
});
