import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePreview, countMessages, nextPreview, GOAL_BOILERPLATE_RE } from '../../src/host/projection.js';
import type { PreviewRecord } from '../../src/host/projection.js';

test('derivePreview prefers the goal objective over the first human message', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hello' }] } },
    { type: 'goal/change', data: { operation: 'set', goal: { objective: 'build a tree plugin' } } },
  ];
  assert.equal(derivePreview(events), 'build a tree plugin');
});

test('derivePreview skips goal boilerplate and empty text', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'reference attachments for goal objective.' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'real question' }] } },
  ];
  assert.equal(derivePreview(events), 'real question');
  assert.equal(derivePreview([]), null);
  assert.equal(derivePreview(null), null);
});

test('derivePreview ignores non-user sources and truncates long text', () => {
  const events = [
    { type: 'user/message', data: { source: { kind: 'system' }, content: [{ type: 'text', text: 'sys' }] } },
    { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(200) }] } },
  ];
  const preview = derivePreview(events);
  assert.ok(preview !== null && preview.endsWith('…') && preview.length <= 80);
});

test('countMessages counts only user/assistant messages, dedupes by seq, ignores titles', () => {
  const events = [
    { type: 'session/title', seq: 1, data: { title: 'A' } },
    { type: 'user/message', seq: 2 },
    { type: 'assistant/message', seq: 3 },
    { type: 'user/message', seq: 2 }, // duplicate seq
    { type: 'turn/end', seq: 4 },
  ];
  assert.equal(countMessages(events), 2);
  assert.equal(countMessages([]), 0);
  assert.equal(countMessages(null), 0);
});

test('nextPreview: ready fills text; empty is backoff-gated so polls do not re-observe', () => {
  const now = 1_000_000;
  // ready
  const ready = nextPreview(undefined, 5, 'hello', now);
  assert.deepEqual(ready, { state: 'ready', text: 'hello', sourceCursor: 5, retryAfter: null });

  // empty at a new cursor
  const empty = nextPreview(undefined, 5, null, now);
  assert.equal(empty.state, 'empty');
  assert.equal(empty.retryAfter, now + 60_000);

  // same cursor, within backoff → unchanged (no re-observe)
  const retried = nextPreview(empty, 5, null, now + 1_000);
  assert.equal(retried, empty);

  // after backoff elapses → can retry
  const afterBackoff = nextPreview(empty, 5, null, now + 61_000);
  assert.equal(afterBackoff.state, 'empty');
  assert.notEqual(afterBackoff, empty);
});

test('nextPreview: a newer cursor invalidates a previous empty/failed record', () => {
  const now = 1_000_000;
  const failed: PreviewRecord = { state: 'failed', text: null, sourceCursor: 3, retryAfter: now + 60_000 };
  // newer cursor (4) must invalidate even though backoff has not elapsed
  const invalidated = nextPreview(failed, 4, 'new text', now);
  assert.equal(invalidated.state, 'ready');
  assert.equal(invalidated.sourceCursor, 4);
});

test('GOAL_BOILERPLATE_RE matches the canonical boilerplate', () => {
  assert.ok(GOAL_BOILERPLATE_RE.test('reference attachments for goal objective.'));
  assert.ok(GOAL_BOILERPLATE_RE.test('reference attachments for the goal objective.'));
  assert.equal(GOAL_BOILERPLATE_RE.test('real objective'), false);
});
