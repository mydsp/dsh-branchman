import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StateStore, emptyStateV2 } from '../../src/host/store.js';
import { HostAdapter } from '../../src/host/host-adapter.js';

test('concurrent CAS permits exactly one revision-zero commit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cas-'));
  try {
    const store = new StateStore(join(dir, 'state.json')); await store.ready();
    const a = emptyStateV2(), b = emptyStateV2();
    a.sessions.push({ sessionId: 'a', worktreeId: null, presence: 'persisted', archived: false });
    b.sessions.push({ sessionId: 'b', worktreeId: null, presence: 'persisted', archived: false });
    const results = await Promise.allSettled([store.commit(0, a), store.commit(0, b)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter(r => r.status === 'rejected').length, 1);
    assert.equal(store.read().revision, 1);
    assert.throws(() => store.read().sessions.push(a.sessions[0]!), TypeError);
    assert.throws(() => { store.read().sessions[0]!.sessionId = 'mutated'; }, TypeError);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('unload while acquiring a lease prevents callback but releases lease', async () => {
  let giveLease!: (lease: { source: 'prepared'; events: unknown[]; cursor: number; [Symbol.dispose](): void }) => void;
  const lease = new Promise<{ source: 'prepared'; events: unknown[]; cursor: number; [Symbol.dispose](): void }>(resolve => { giveLease = resolve; });
  let called = false, released = 0;
  const host = new HostAdapter({ sessionQuery: { observeSession: async () => lease } });
  const pending = host.withObservation('s', () => { called = true; });
  await host.dispose();
  giveLease({ source: 'prepared', events: [], cursor: 0, [Symbol.dispose]() { released++; } });
  await assert.rejects(pending, /disposed/);
  assert.equal(called, false); assert.equal(released, 1);
});
