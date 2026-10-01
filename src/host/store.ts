// v2 state store — validated, immutable-commit, atomic-file persistence.
//
// S07: the old TreeStore only checked `version` and `nodes`, silently reset a
// legal-but-wrong schema to empty, and its in-memory mutate/save were not a
// transaction (a failed write still left the memory change in place). This
// store validates every entity against the domain schema before accepting it,
// commits by expected-revision (CAS), and only swaps the in-memory snapshot
// after the file write actually succeeded.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Direction, ForkEdge, Repo, SessionLink, Worktree } from '../domain/model.js';

export type StateV2 = {
  version: 2;
  revision: number;
  repositories: Repo[];
  worktrees: Worktree[];
  sessions: SessionLink[];
  directions: Direction[];
  forkEdges: ForkEdge[];
};

export function emptyStateV2(): StateV2 {
  return { version: 2, revision: 0, repositories: [], worktrees: [], sessions: [], directions: [], forkEdges: [] };
}

/** Generate a stable-id entity UUID (v1 → v2 migration and new directions). */
export function newId(): string {
  return randomUUID();
}

export class StateSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateSchemaError';
  }
}

export class RevisionConflictError extends Error {
  constructor(expected: number, actual: number) {
    super(`revision conflict: expected ${expected}, actual ${actual}`);
    this.name = 'RevisionConflictError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function requireString(value: unknown, field: string): string {
  if (!isString(value)) throw new StateSchemaError(`${field} must be a string`);
  return value;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireString(value, field);
}

function validateRepo(value: unknown, i: number): Repo {
  if (!isRecord(value)) throw new StateSchemaError(`repositories[${i}] must be an object`);
  return {
    id: requireString(value.id, `repositories[${i}].id`),
    canonicalCommonDir: requireString(value.canonicalCommonDir, `repositories[${i}].canonicalCommonDir`),
    primaryWorktreeId: requireString(value.primaryWorktreeId, `repositories[${i}].primaryWorktreeId`),
  };
}

function validateWorktree(value: unknown, i: number): Worktree {
  if (!isRecord(value)) throw new StateSchemaError(`worktrees[${i}] must be an object`);
  const managedBy = value.managedBy;
  if (managedBy !== 'branchman' && managedBy !== 'external') {
    throw new StateSchemaError(`worktrees[${i}].managedBy must be branchman|external`);
  }
  return {
    id: requireString(value.id, `worktrees[${i}].id`),
    repoId: requireString(value.repoId, `worktrees[${i}].repoId`),
    canonicalPath: requireString(value.canonicalPath, `worktrees[${i}].canonicalPath`),
    branchRef: optionalString(value.branchRef, `worktrees[${i}].branchRef`),
    managedBy,
  };
}

function validateSession(value: unknown, i: number): SessionLink {
  if (!isRecord(value)) throw new StateSchemaError(`sessions[${i}] must be an object`);
  const sessionPresence = value.presence;
  if (sessionPresence !== 'live' && sessionPresence !== 'persisted' && sessionPresence !== 'missing' && sessionPresence !== 'unknown') {
    throw new StateSchemaError(`sessions[${i}].presence must be live|persisted|missing|unknown`);
  }
  if (typeof value.archived !== 'boolean') throw new StateSchemaError(`sessions[${i}].archived must be a boolean`);
  return {
    sessionId: requireString(value.sessionId, `sessions[${i}].sessionId`),
    worktreeId: optionalString(value.worktreeId, `sessions[${i}].worktreeId`),
    presence: sessionPresence,
    archived: value.archived,
  };
}

function validateDirection(value: unknown, i: number): Direction {
  if (!isRecord(value)) throw new StateSchemaError(`directions[${i}] must be an object`);
  const state = value.state;
  if (!['creating', 'ready', 'conflicted', 'recovery-required', 'removed'].includes(state as string)) {
    throw new StateSchemaError(`directions[${i}].state must be a known direction state`);
  }
  return {
    id: requireString(value.id, `directions[${i}].id`),
    repoId: requireString(value.repoId, `directions[${i}].repoId`),
    worktreeId: requireString(value.worktreeId, `directions[${i}].worktreeId`),
    displayName: requireString(value.displayName, `directions[${i}].displayName`),
    primarySessionId: optionalString(value.primarySessionId, `directions[${i}].primarySessionId`),
    baseOid: requireString(value.baseOid, `directions[${i}].baseOid`),
    upstreamRef: optionalString(value.upstreamRef, `directions[${i}].upstreamRef`),
    integrationTargetWorktreeId: requireString(value.integrationTargetWorktreeId, `directions[${i}].integrationTargetWorktreeId`),
    state: state as Direction['state'],
  };
}

function validateForkEdge(value: unknown, i: number): ForkEdge {
  if (!isRecord(value)) throw new StateSchemaError(`forkEdges[${i}] must be an object`);
  const boundarySeq = value.boundarySeq;
  const inheritedEventCount = value.inheritedEventCount;
  if (typeof boundarySeq !== 'number' || !Number.isFinite(boundarySeq)) throw new StateSchemaError(`forkEdges[${i}].boundarySeq must be finite`);
  if (typeof inheritedEventCount !== 'number' || !Number.isFinite(inheritedEventCount)) throw new StateSchemaError(`forkEdges[${i}].inheritedEventCount must be finite`);
  return {
    id: requireString(value.id, `forkEdges[${i}].id`),
    sourceSessionId: requireString(value.sourceSessionId, `forkEdges[${i}].sourceSessionId`),
    targetSessionId: requireString(value.targetSessionId, `forkEdges[${i}].targetSessionId`),
    boundarySeq,
    boundaryMessageId: optionalString(value.boundaryMessageId, `forkEdges[${i}].boundaryMessageId`),
    inheritedEventCount,
    operationId: requireString(value.operationId, `forkEdges[${i}].operationId`),
  };
}

/**
 * Validate an unknown value as a StateV2. Rejects (never silently empties)
 * anything that is not a well-formed v2 document. Returns a frozen clone.
 */
export function validateStateV2(raw: unknown): StateV2 {
  if (!isRecord(raw)) throw new StateSchemaError('state must be an object');
  if (raw.version !== 2) throw new StateSchemaError('state.version must be 2');
  if (!Number.isInteger(raw.revision) || (raw.revision as number) < 0) {
    throw new StateSchemaError('state.revision must be a non-negative integer');
  }
  const arr = (field: string): unknown[] => {
    const value = raw[field];
    if (!Array.isArray(value)) throw new StateSchemaError(`state.${field} must be an array`);
    return value;
  };
  const repositories = arr('repositories').map((v, i) => validateRepo(v, i));
  const worktrees = arr('worktrees').map((v, i) => validateWorktree(v, i));
  const sessions = arr('sessions').map((v, i) => validateSession(v, i));
  const directions = arr('directions').map((v, i) => validateDirection(v, i));
  const forkEdges = arr('forkEdges').map((v, i) => validateForkEdge(v, i));

  const uniqueIds = new Set<string>();
  for (const entity of [...repositories, ...worktrees, ...sessions, ...directions, ...forkEdges]) {
    const id = 'id' in entity ? entity.id : undefined;
    if (id !== undefined) {
      if (uniqueIds.has(id)) throw new StateSchemaError(`duplicate entity id "${id}"`);
      uniqueIds.add(id);
    }
  }
  return Object.freeze({
    version: 2 as const,
    revision: raw.revision as number,
    repositories,
    worktrees,
    sessions,
    directions,
    forkEdges,
  });
}

export class StateStore {
  #dataFile: string;
  #state: StateV2 = emptyStateV2();
  #writeSeq = 0;
  #writeChain: Promise<void> = Promise.resolve();
  #ready: Promise<void>;

  constructor(dataFile: string) {
    if (typeof dataFile !== 'string' || dataFile.length === 0) {
      throw new Error('branchman: state.dataFile must be a non-empty path');
    }
    this.#dataFile = dataFile;
    this.#ready = this.#load();
  }

  async #load(): Promise<void> {
    await mkdir(dirname(this.#dataFile), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.#dataFile, 'utf8')) as unknown;
      this.#state = validateStateV2(parsed);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
      await this.#persist(this.#state);
    }
  }

  async ready(): Promise<void> {
    await this.#ready;
  }

  /** Current committed state (a frozen snapshot). */
  read(): Readonly<StateV2> {
    return this.#state;
  }

  /**
   * Commit `next` iff the current revision equals `expectedRevision`. Returns
   * the new revision. On a revision mismatch it throws RevisionConflictError;
   * on a failed write the old file AND old in-memory snapshot are preserved.
   */
  async commit(expectedRevision: number, next: StateV2): Promise<number> {
    await this.#ready;
    const validated = validateStateV2(next);
    if (this.#state.revision !== expectedRevision) {
      throw new RevisionConflictError(expectedRevision, this.#state.revision);
    }
    const committed: StateV2 = Object.freeze({ ...validated, revision: expectedRevision + 1 });
    await this.#persist(committed);
    this.#state = committed;
    return committed.revision;
  }

  async #persist(state: StateV2): Promise<void> {
    const write = async (): Promise<void> => {
      await mkdir(dirname(this.#dataFile), { recursive: true });
      const seq = (this.#writeSeq += 1);
      const tmp = `${this.#dataFile}.${process.pid}.${seq}.tmp`;
      try {
        await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
        await rename(tmp, this.#dataFile);
      } catch (error) {
        try { await rm(tmp, { force: true }); } catch { /* temp may already be gone */ }
        throw error;
      }
    };
    // Serialize writes; a failed write must not wedge later ones.
    const queued = this.#writeChain.then(write, write);
    this.#writeChain = queued.then(() => undefined, () => undefined);
    await queued;
  }
}
