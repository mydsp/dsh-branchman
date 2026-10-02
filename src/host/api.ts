// Versioned API contract — request schema validation, protocol metadata and a
// unified error envelope (S13: parameters, HTTP errors and success data had no
// shared schema; GET threw without a uniform response).
import type { ForkRequest } from './operations.js';

export const PROTOCOL_VERSION = 2;
export const SCHEMA_VERSION = 2;
// buildId is stamped at release time; a stable placeholder until T7 wires the
// real release id through the build.
export const BUILD_ID = '0.3.0';

export type ApiEnvelope<T = unknown> = {
  protocolVersion: number;
  schemaVersion: number;
  buildId: string;
  revision: number;
  ok: true;
  data: T;
};

export type ApiErrorEnvelope = {
  protocolVersion: number;
  schemaVersion: number;
  buildId: string;
  ok: false;
  code: string;
  message: string;
  operationId: string | null;
  retryable: boolean;
};

export class ApiValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiValidationError';
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new ApiValidationError('invalid-argument', `${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ApiValidationError('invalid-argument', `${field} must be a string`);
  return value;
}

/**
 * Validate and normalize a raw fork body into a ForkRequest. The UI, agent
 * tools and HTTP handler all funnel through this one validator so no caller
 * assembles forkArgs by hand (B08: the HTTP route dropped `brief`).
 */
export function parseForkRequest(body: unknown): ForkRequest {
  if (!isRecord(body)) throw new ApiValidationError('invalid-argument', 'body must be an object');
  const requestId = requireString(body.requestId, 'requestId');
  const sourceSessionId = requireString(body.sourceSessionId, 'sourceSessionId');
  const sourceCwd = requireString(body.sourceCwd, 'sourceCwd');
  const displayName = requireString(body.displayName, 'displayName');
  if (displayName.length > 120 || /[\u0000-\u001f]/.test(displayName)) throw new ApiValidationError('invalid-argument', 'displayName exceeds 120 characters or contains control characters');
  if (body.brief !== undefined && typeof body.brief !== 'string') throw new ApiValidationError('invalid-argument', 'brief must be a string');
  const brief = typeof body.brief === 'string' ? body.brief : '';
  if (brief.length > 8000) throw new ApiValidationError('invalid-argument', 'brief exceeds 8000 characters');
  const messageId = optionalString(body.messageId, 'messageId');
  const boundarySeq = typeof body.boundarySeq === 'number' && Number.isSafeInteger(body.boundarySeq) ? body.boundarySeq : undefined;
  if (body.boundarySeq !== undefined && (boundarySeq === undefined || boundarySeq < 0)) throw new ApiValidationError('invalid-argument', 'boundarySeq must be a non-negative safe integer');
  if (body.history !== undefined && body.history !== 'blank' && body.history !== 'inherit') throw new ApiValidationError('invalid-argument', 'history must be inherit or blank');
  const history = body.history === 'blank' ? 'blank' : 'inherit';

  const codeSourceRaw = body.codeSource;
  if (!isRecord(codeSourceRaw)) throw new ApiValidationError('invalid-argument', 'codeSource must be an object');
  let codeSource: ForkRequest['codeSource'];
  if (codeSourceRaw.kind === 'source-head') {
    if (codeSourceRaw.carryChanges !== undefined && typeof codeSourceRaw.carryChanges !== 'boolean') throw new ApiValidationError('invalid-argument', 'carryChanges must be boolean');
    codeSource = { kind: 'source-head', carryChanges: codeSourceRaw.carryChanges !== false };
  } else if (codeSourceRaw.kind === 'explicit-commit') {
    const oid = requireString(codeSourceRaw.oid, 'codeSource.oid');
    codeSource = { kind: 'explicit-commit', oid, carryChanges: false };
  } else {
    throw new ApiValidationError('invalid-argument', 'codeSource.kind must be source-head | explicit-commit');
  }

  return {
    requestId,
    sourceSessionId,
    sourceCwd,
    ...(messageId === undefined ? {} : { messageId }),
    ...(boundarySeq === undefined ? {} : { boundarySeq }),
    displayName,
    brief,
    codeSource,
    history,
  };
}

/** Wrap a success payload in the versioned envelope. */
export function ok<T>(data: T, revision: number): ApiEnvelope<T> {
  return { protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, buildId: BUILD_ID, revision, ok: true, data };
}

/** Map an error to the unified error envelope. */
export function errorEnvelope(error: unknown, operationId: string | null = null, retryable = false): ApiErrorEnvelope {
  if (error instanceof ApiValidationError) {
    return {
      protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, buildId: BUILD_ID,
      ok: false, code: error.code, message: error.message, operationId, retryable: false,
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, buildId: BUILD_ID,
    ok: false, code: 'internal', message, operationId, retryable,
  };
}
