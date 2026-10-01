import assert from 'node:assert/strict';
import test from 'node:test';
import { parseForkRequest, ok, errorEnvelope, ApiValidationError, PROTOCOL_VERSION, SCHEMA_VERSION } from '../../src/host/api.js';

const validBody = {
  requestId: 'req-1',
  sourceSessionId: 'src',
  sourceCwd: 'E:/repo',
  displayName: '走向A',
  brief: '一句意图',
  codeSource: { kind: 'source-head', carryChanges: true },
  history: 'inherit',
};

test('parseForkRequest accepts a full body and preserves brief (B08)', () => {
  const req = parseForkRequest(validBody);
  assert.equal(req.brief, '一句意图');
  assert.equal(req.requestId, 'req-1');
  assert.equal(req.sourceSessionId, 'src');
  assert.equal(req.sourceCwd, 'E:/repo');
  assert.equal(req.displayName, '走向A');
  assert.deepEqual(req.codeSource, { kind: 'source-head', carryChanges: true });
  assert.equal(req.history, 'inherit');
});

test('parseForkRequest rejects missing required fields', () => {
  assert.throws(() => parseForkRequest({}), ApiValidationError);
  assert.throws(() => parseForkRequest({ ...validBody, requestId: '' }), ApiValidationError);
  assert.throws(() => parseForkRequest({ ...validBody, sourceCwd: undefined }), ApiValidationError);
});

test('parseForkRequest normalizes explicit-commit and forces carryChanges false', () => {
  const req = parseForkRequest({ ...validBody, codeSource: { kind: 'explicit-commit', oid: 'deadbeef' } });
  assert.deepEqual(req.codeSource, { kind: 'explicit-commit', oid: 'deadbeef', carryChanges: false });
});

test('parseForkRequest rejects a bad codeSource kind', () => {
  assert.throws(() => parseForkRequest({ ...validBody, codeSource: { kind: 'nonsense' } }), ApiValidationError);
});

test('parseForkRequest accepts optional messageId and boundarySeq', () => {
  const req = parseForkRequest({ ...validBody, messageId: 'm1', boundarySeq: 3 });
  assert.equal(req.messageId, 'm1');
  assert.equal(req.boundarySeq, 3);
});

test('ok() wraps a payload in the versioned envelope', () => {
  const env = ok({ name: 'x' }, 7);
  assert.deepEqual(env, {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, buildId: 'dev',
    revision: 7, ok: true, data: { name: 'x' },
  });
});

test('errorEnvelope maps validation errors and generic errors uniformly', () => {
  const val = errorEnvelope(new ApiValidationError('invalid-argument', 'bad'));
  assert.equal(val.ok, false);
  assert.equal(val.code, 'invalid-argument');
  assert.equal(val.retryable, false);

  const generic = errorEnvelope(new Error('boom'), 'op-1', true);
  assert.equal(generic.ok, false);
  assert.equal(generic.code, 'internal');
  assert.equal(generic.operationId, 'op-1');
  assert.equal(generic.retryable, true);
});
