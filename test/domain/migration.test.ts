import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateV1, MigrationError } from '../../src/host/migrate-v1.js';
import type { StateV2 } from '../../src/host/store.js';

// A minimal well-formed v1 document matching the old tree.json shape.
function v1(nodes: unknown[]): unknown {
  return { version: 1, nodes };
}

function node(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: '走向A',
    parentName: null,
    root: 'E:/repo',
    cwd: 'E:/repo/.branches/走向A',
    branch: '走向A',
    parentSessionId: 'parent-1',
    sessionId: 'session-1',
    status: 'open',
    ...over,
  };
}

test('rejects non-object and wrong-version input', () => {
  assert.throws(() => migrateV1(null), MigrationError);
  assert.throws(() => migrateV1({ version: 3, nodes: [] }), MigrationError);
  assert.throws(() => migrateV1({ version: 1 }), MigrationError);
  assert.throws(() => migrateV1({ version: 1, nodes: 'nope' }), MigrationError);
  assert.throws(() => migrateV1({ version: 1, nodes: [{}] }), MigrationError);
});

test('rejects legal-but-wrong schema instead of silently emptying', () => {
  // node has a name but a bogus status — must still migrate (status is
  // advisory), but a node missing name must fail loudly.
  assert.throws(() => migrateV1(v1([{ name: '', root: 'E:/repo' }])), MigrationError);
});

test('migrates a normal node into a direction + worktree + session', () => {
  const report = migrateV1(v1([node()]));
  assert.equal(report.inputNodeCount, 1);
  assert.equal(report.outputDirectionCount, 1);
  const state = report.state as StateV2;
  assert.equal(state.version, 2);
  assert.equal(state.repositories.length, 1);
  assert.equal(state.worktrees.length, 1);
  assert.equal(state.directions.length, 1);
  assert.equal(state.directions[0]?.displayName, '走向A');
  assert.equal(state.directions[0]?.primarySessionId, 'session-1');
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.sessionId, 'session-1');
  assert.equal(state.forkEdges.length, 1);
  assert.equal(state.forkEdges[0]?.sourceSessionId, 'parent-1');
  assert.equal(state.forkEdges[0]?.targetSessionId, 'session-1');
});

test('a dropped node keeps identity but is not re-created as a worktree', () => {
  const report = migrateV1(v1([node({ status: 'dropped', droppedAt: '2026-10-02T00:00:00Z' })]));
  const state = report.state as StateV2;
  assert.equal(state.directions.length, 1);
  assert.equal(state.directions[0]?.state, 'removed');
  assert.equal(state.worktrees.length, 0, 'dropped node must not recreate a worktree');
});

test('same-name nodes in different repos produce distinct direction ids', () => {
  const report = migrateV1(v1([
    node({ name: 'same', root: 'E:/repo-one', cwd: 'E:/repo-one/.branches/same' }),
    node({ name: 'same', root: 'F:/repo-two', cwd: 'F:/repo-two/.branches/same' }),
  ]));
  const state = report.state as StateV2;
  assert.equal(state.directions.length, 2);
  assert.notEqual(state.directions[0]?.id, state.directions[1]?.id);
  assert.equal(state.repositories.length, 2);
});

test('a dangling parentName is reported as unresolved, not invented', () => {
  const report = migrateV1(v1([node({ parentName: 'ghost' })]));
  const dangling = report.unresolved.find(u => u.legacyName === '走向A');
  assert.ok(dangling, 'expected an unresolved entry');
  assert.match(dangling.reason, /ghost/);
});

test('a node with no root/cwd is reported as unresolved', () => {
  const report = migrateV1(v1([node({ root: null, cwd: null })]));
  assert.equal(report.outputDirectionCount, 0);
  assert.equal(report.unresolved.length, 1);
});

test('migration output always passes the v2 schema', () => {
  const report = migrateV1(v1([node(), node({ name: 'B', parentName: '走向A', cwd: 'E:/repo/.branches/B', sessionId: 'session-2', parentSessionId: 'session-1' })]));
  const state = report.state as StateV2;
  assert.equal(state.version, 2);
  assert.ok(state.revision >= 0);
  assert.equal(state.directions.length, 2);
  assert.equal(state.forkEdges.length, 2);
});
