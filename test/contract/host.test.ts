import assert from 'node:assert/strict';
import test from 'node:test';
import { HostAdapter } from '../../src/host/host-adapter.js';
import type { ObservationLease, SessionQueryLike, SessionsLike } from '../../src/host/host-adapter.js';

/** A strict-shape fixture: a lease that counts releases, matching the real
 *  contract that observations are disposable and must be released. */
function countingLease(source: 'live' | 'prepared', events: readonly unknown[] = [], releases?: { n: number }): ObservationLease {
  const counter = releases ?? { n: 0 };
  return {
    source,
    events,
    cursor: events.length - 1,
    [Symbol.dispose]() {
      counter.n += 1;
    },
  };
}

function queryFixture(leases: Record<string, ObservationLease>, list?: SessionQueryLike['listSessions']): SessionQueryLike {
  return {
    observeSession: async id => {
      const lease = leases[id];
      if (lease === undefined) throw new Error(`no lease for ${id}`);
      return lease;
    },
    ...(list === undefined ? {} : { listSessions: list }),
  };
}

test('withObservation releases the lease on success, throw, and cancellation', async () => {
  // success
  const ok = { n: 0 };
  const okAdapter = new HostAdapter({ sessionQuery: queryFixture({ s: countingLease('live', [], ok) }) });
  const got = await okAdapter.withObservation('s', async o => o.events.length);
  assert.equal(got, 0);
  assert.equal(ok.n, 1);

  // callback throws — lease must still be released
  const threw = { n: 0 };
  const throwAdapter = new HostAdapter({ sessionQuery: queryFixture({ s: countingLease('prepared', [], threw) }) });
  await assert.rejects(() => throwAdapter.withObservation('s', async () => { throw new Error('boom') }), /boom/);
  assert.equal(threw.n, 1);

  // cancellation — the callback rejects, finally still releases
  const cancelled = { n: 0 };
  const cancelAdapter = new HostAdapter({ sessionQuery: queryFixture({ s: countingLease('prepared', [], cancelled) }) });
  await assert.rejects(() => cancelAdapter.withObservation('s', async () => { throw new DOMException('aborted', 'AbortError') }), /aborted/);
  assert.equal(cancelled.n, 1);
});

test('withObservation works for both live and prepared sources', async () => {
  const live = { n: 0 };
  const prepared = { n: 0 };
  const adapter = new HostAdapter({
    sessionQuery: queryFixture({
      live: countingLease('live', [{ t: 1 }, { t: 2 }], live),
      cold: countingLease('prepared', [{ t: 3 }], prepared),
    }),
  });
  assert.equal(await adapter.withObservation('live', o => o.cursor), 1);
  assert.equal(await adapter.withObservation('cold', o => o.cursor), 0);
  assert.equal(live.n, 1);
  assert.equal(prepared.n, 1);
});

test('service replacement: an old disposer cannot clear a new binding', () => {
  const adapter = new HostAdapter();
  const old = queryFixture({});
  const disposeOld = adapter.bind('sessionQuery', old);
  const fresh = queryFixture({});
  adapter.bind('sessionQuery', fresh);
  disposeOld(); // stale disposer fires after replacement
  assert.equal(adapter.capabilities().sessionQuery, true);
});

test('instances A/B do not share optional services', () => {
  const a = new HostAdapter({ sessionQuery: queryFixture({}) });
  const b = new HostAdapter();
  assert.equal(a.capabilities().sessionQuery, true);
  assert.equal(b.capabilities().sessionQuery, false);
});

test('a late callback after dispose does not write state', async () => {
  const adapter = new HostAdapter({ sessionQuery: queryFixture({ s: countingLease('live') }) });
  await adapter.dispose();
  await assert.rejects(() => adapter.withObservation('s', async () => 1), /disposed/);
});

test('sessionPresence: live → live, detach → persisted, absent → missing, read failure → unknown', async () => {
  // live session wins regardless of corpus
  const liveSessions: SessionsLike = { get: id => (id === 's1' ? { id } : undefined) };
  const liveAdapter = new HostAdapter({ sessions: liveSessions, sessionQuery: queryFixture({}, async () => []) });
  assert.equal(await liveAdapter.sessionPresence('s1'), 'live');

  // detached from live but still in the persisted corpus → persisted (B07)
  const detachedSessions: SessionsLike = { get: () => undefined };
  const persistedAdapter = new HostAdapter({
    sessions: detachedSessions,
    sessionQuery: queryFixture({}, async () => [{ header: { id: 's1' } }]),
  });
  assert.equal(await persistedAdapter.sessionPresence('s1'), 'persisted');

  // not live, corpus lists nothing → missing
  const missingAdapter = new HostAdapter({ sessions: detachedSessions, sessionQuery: queryFixture({}, async () => []) });
  assert.equal(await missingAdapter.sessionPresence('s1'), 'missing');

  // corpus read throws → unknown, never missing
  const unknownAdapter = new HostAdapter({
    sessions: detachedSessions,
    sessionQuery: queryFixture({}, async () => { throw new Error('backend down') }),
  });
  assert.equal(await unknownAdapter.sessionPresence('s1'), 'unknown');
});

test('capabilities reflect bound services', () => {
  const bare = new HostAdapter();
  assert.deepEqual(bare.capabilities(), { inheritedFork: false, sessionQuery: false, workspaceRegistration: false });
  const rich = new HostAdapter({ sessionQuery: queryFixture({}), agents: {}, workspaceRegistry: {} });
  assert.deepEqual(rich.capabilities(), { inheritedFork: true, sessionQuery: true, workspaceRegistration: true });
});
