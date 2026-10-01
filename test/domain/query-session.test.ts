import assert from 'node:assert/strict';
import test from 'node:test';
import { makeSingleFlight, isStale, RevisionClock } from '../../src/client/query-store.js';
import { selectLabel, isBoilerplateTitle } from '../../src/client/session-store.js';

test('the newest load wins and the superseded request is aborted', async () => {
  const aborted: string[] = [];
  let n = 0;
  const { load } = makeSingleFlight(async signal => {
    const id = `req-${++n}`;
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => { aborted.push(id); reject(new Error('aborted')); });
      setTimeout(resolve, 50);
    });
    return id;
  });
  const first = load();
  const second = load();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.kind, 'superseded', 'the first request must be superseded');
  assert.equal(b.kind, 'ok');
  assert.equal(aborted.length, 1, 'the superseded request must be aborted');
});

test('a superseded call resolves to superseded, not a thrown rejection', async () => {
  const { load } = makeSingleFlight(async () => 'x');
  const first = load();
  const second = load();
  const results = await Promise.all([first, second]);
  assert.equal(results[0].kind, 'superseded');
  assert.equal(results[1].kind, 'ok');
});

test('revision is monotonic across loads', async () => {
  const store = makeSingleFlight(async () => 'x');
  await store.load();
  assert.equal(store.revision, 1);
  await store.load();
  assert.equal(store.revision, 2);
});

test('isStale compares revisions', () => {
  assert.equal(isStale(3, 5), true);
  assert.equal(isStale(5, 5), false);
  assert.equal(isStale(6, 5), false);
});

test('RevisionClock is monotonic', () => {
  const clock = new RevisionClock();
  assert.equal(clock.value, 0);
  assert.equal(clock.next(), 1);
  assert.equal(clock.next(), 2);
  assert.equal(clock.value, 2);
});

// ── label selection (S08) ──

test('label priority: user title beats everything', () => {
  const label = selectLabel({ userTitle: '我的手写标题', hostTitle: '宿主标题', brief: 'brief', summary: 'summary', sessionId: 's1' });
  assert.deepEqual(label, { text: '我的手写标题', source: 'user' });
});

test('host title beats brief, but boilerplate is skipped', () => {
  assert.deepEqual(selectLabel({ hostTitle: 'real title', brief: 'b' }), { text: 'real title', source: 'host' });
  // boilerplate host title falls through to brief
  assert.deepEqual(selectLabel({ hostTitle: 'reference attachments for goal objective.', brief: 'b' }), { text: 'b', source: 'brief' });
});

test('brief beats summary beats id', () => {
  assert.deepEqual(selectLabel({ summary: 'sum', sessionId: 's1' }), { text: 'sum', source: 'summary' });
  assert.deepEqual(selectLabel({ sessionId: 's1' }), { text: 's1', source: 'id' });
});

test('no usable input returns null', () => {
  assert.equal(selectLabel({}), null);
  assert.equal(selectLabel({ userTitle: '   ' }), null);
});

test('isBoilerplateTitle matches the canonical form', () => {
  assert.equal(isBoilerplateTitle('reference attachments for goal objective.'), true);
  assert.equal(isBoilerplateTitle('reference attachments for goal objective. (3)'), true);
  assert.equal(isBoilerplateTitle('real title'), false);
});
