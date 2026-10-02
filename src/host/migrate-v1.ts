// v1 → v2 migration. Reads only known legacy fields, never guesses unknown
// data, and reports what it could not resolve instead of dropping it silently.
//
// Migration only touches Branchman's own state — it does not rewrite host
// sessions/workspace data (audit §9.2).
import { createHash } from 'node:crypto';
import { newId, validateStateV2, type StateV2 } from './store.js';
import type { Direction, ForkEdge, SessionLink, Worktree } from '../domain/model.js';
import { normalizePath } from '../domain/paths.js';

/** A legacy v1 tree node — only the fields the old code actually persisted. */
type LegacyNode = {
  name: string;
  parentName?: string | null;
  root?: string | null;
  cwd?: string | null;
  branch?: string | null;
  parentSessionId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  droppedAt?: string | null;
  mergedAt?: string | null;
  brief?: string;
  inheritedEvents?: number;
  preview?: string;
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Unresolved = {
  legacyName: string;
  repoKey?: string | null;
  reason: string;
};

export type MigrationReport = {
  sourceHash: string;
  inputNodeCount: number;
  outputDirectionCount: number;
  unresolved: Unresolved[];
  state: StateV2;
};

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Best-effort extraction of the canonical repo path a legacy node belongs to. */
function legacyRepoKey(node: LegacyNode): string | null {
  const explicit = String(node.root ?? '').replace(/[\\/]+$/, '');
  if (explicit !== '') return normalizePath(explicit);
  const cwd = String(node.cwd ?? '');
  const at = cwd.search(/[\\/]\.branches(?:[\\/]|$)/);
  const root = at > 0 ? cwd.slice(0, at) : cwd;
  const key = normalizePath(root);
  return key === '' ? null : key;
}

/**
 * Migrate a raw v1 tree document to v2. Rejects corrupt or unknown-schema input
 * (never silently empties). A dropped node keeps its identity but is not
 * re-created as a live worktree; a node whose parentName cannot be resolved is
 * reported as `unresolved` rather than invented.
 */
export function migrateV1(raw: unknown): MigrationReport {
  if (!isRecord(raw)) throw new MigrationError('v1 tree must be an object');
  if (raw.version !== 1) throw new MigrationError(`unsupported tree version: ${String(raw.version)}`);
  if (!Array.isArray(raw.nodes)) throw new MigrationError('v1 tree.nodes must be an array');

  const nodes: LegacyNode[] = raw.nodes.map((value, i) => {
    if (!isRecord(value)) throw new MigrationError(`v1 tree.nodes[${i}] must be an object`);
    const name = String(value.name ?? '').trim();
    if (name === '') throw new MigrationError(`v1 tree.nodes[${i}].name must be non-empty`);
    return {
      name,
      parentName: typeof value.parentName === 'string' ? value.parentName : null,
      root: typeof value.root === 'string' ? value.root : null,
      cwd: typeof value.cwd === 'string' ? value.cwd : null,
      branch: typeof value.branch === 'string' ? value.branch : null,
      parentSessionId: typeof value.parentSessionId === 'string' ? value.parentSessionId : null,
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
      status: typeof value.status === 'string' ? value.status : null,
      droppedAt: typeof value.droppedAt === 'string' ? value.droppedAt : null,
      mergedAt: typeof value.mergedAt === 'string' ? value.mergedAt : null,
      brief: typeof value.brief === 'string' ? value.brief : '',
      inheritedEvents: Number.isSafeInteger(value.inheritedEvents) && (value.inheritedEvents as number) >= 0 ? value.inheritedEvents as number : 0,
      preview: typeof value.preview === 'string' ? value.preview : '',
      workspaceId: typeof value.workspaceId === 'string' ? value.workspaceId : undefined,
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    };
  });

  const sourceHash = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
  const unresolved: Unresolved[] = [];

  // Repos, keyed by canonical common-dir proxy (root path). v1 has no real
  // common-dir, so we merge by canonical root and note that git reconciliation
  // happens in operations, not here.
  const primaryTrees: Worktree[] = [];
  const repoByKey = new Map<string, { id: string; canonicalCommonDir: string; primaryWorktreeId: string; identityVerified: boolean }>();
  const repoIdOf = (key: string): string => {
    let repo = repoByKey.get(key);
    if (repo === undefined) {
      repo = { id: newId(), canonicalCommonDir: key, primaryWorktreeId: newId(), identityVerified: false };
      repoByKey.set(key, repo);
      primaryTrees.push({ id: repo.primaryWorktreeId, repoId: repo.id, canonicalPath: key, branchRef: null, managedBy: 'external' });
    }
    return repo.id;
  };

  const directions: Direction[] = [];
  const sessions: SessionLink[] = [];
  const forkEdges: ForkEdge[] = [];
  const worktrees: Worktree[] = [];

  // Assign stable direction ids per legacy node, keyed by name WITHIN its repo.
  // Using name alone would collapse same-name nodes across repos (B01).
  const nodeId = new Map<string, string>();
  const idKeyOf = (node: LegacyNode): string => {
    const repoKey = legacyRepoKey(node) ?? '(no-repo)';
    return `${repoKey}\u0000${node.name}`;
  };
  for (const node of nodes) {
    if (!nodeId.has(idKeyOf(node))) nodeId.set(idKeyOf(node), newId());
  }

  for (const node of nodes) {
    const repoKey = legacyRepoKey(node);
    if (repoKey === null) {
      unresolved.push({ legacyName: node.name, repoKey, reason: 'no root/cwd to derive a repository' });
      continue;
    }
    const repoId = repoIdOf(repoKey);
    const isDropped = node.status === 'dropped' || node.droppedAt != null;
    const worktreeId = newId();
    const primarySessionId = typeof node.sessionId === 'string' && node.sessionId !== '' ? node.sessionId : null;
    const directionId = nodeId.get(idKeyOf(node)) ?? newId();

    {
      // Metadata preserves historical references; migration never creates directories.
      worktrees.push({
        id: worktreeId,
        repoId,
        canonicalPath: normalizePath(String(node.cwd ?? node.root ?? '')),
        branchRef: typeof node.branch === 'string' ? node.branch : null,
        managedBy: 'branchman',
        present: !isDropped,
      });
    }

    directions.push({
      id: directionId,
      repoId,
      worktreeId,
      displayName: node.name,
      primarySessionId,
      // baseOid is unknown from v1 (the old file never stored it); the
      // direction is created in a recovery state until operations re-resolve it.
      baseOid: '',
      upstreamRef: null,
      integrationTargetWorktreeId: repoByKey.get(repoKey)?.primaryWorktreeId ?? '',
      state: isDropped ? 'removed' : 'recovery-required',
      brief: node.brief ?? '',
      summary: node.preview ?? '',
      ...(node.workspaceId ? { workspaceId: node.workspaceId } : {}),
      ...(node.createdAt ? { createdAt: node.createdAt } : {}),
      ...(node.updatedAt ? { updatedAt: node.updatedAt } : {}),
      mergedAt: node.mergedAt ?? null,
    });

    if (primarySessionId !== null) {
      sessions.push({
        sessionId: primarySessionId,
        worktreeId,
        presence: 'unknown',
        archived: false,
      });
    }
  }

  // Fork edges from parentSessionId (session lineage), independent of repo.
  for (const node of nodes) {
    if (node.parentSessionId != null && node.parentSessionId !== '' && node.sessionId != null && node.sessionId !== '') {
      if (!sessions.some(s => s.sessionId === node.parentSessionId)) sessions.push({ sessionId: node.parentSessionId, worktreeId: null, presence: 'unknown', archived: false });
      if (!sessions.some(s => s.sessionId === node.sessionId)) continue;
      forkEdges.push({
        id: newId(),
        sourceSessionId: node.parentSessionId,
        targetSessionId: node.sessionId,
        boundarySeq: null,
        boundaryMessageId: null,
        inheritedEventCount: node.inheritedEvents ?? 0,
        operationId: null,
      });
    }
  }

  const state: StateV2 = {
    version: 2,
    revision: 0,
    repositories: [...repoByKey.values()].map(r => ({ ...r })),
    worktrees: [...primaryTrees, ...worktrees],
    sessions,
    directions,
    forkEdges,
  };

  // parentName cycles / dangling parents must surface, not vanish (B03).
  // parentName resolves within the SAME repo (name is only unique per repo).
  const directionIdByNameRepo = new Map<string, string>();
  for (const node of nodes) {
    const dirId = nodeId.get(idKeyOf(node));
    if (dirId !== undefined) directionIdByNameRepo.set(idKeyOf(node), dirId);
  }
  for (const node of nodes) {
    if (node.parentName == null || node.parentName === '') continue;
    const parentKey = `${legacyRepoKey(node) ?? '(no-repo)'}\u0000${node.parentName}`;
    const target = directionIdByNameRepo.get(parentKey);
    if (target === undefined || target === '') {
      unresolved.push({ legacyName: node.name, repoKey:legacyRepoKey(node), reason: `parentName "${node.parentName}" not found in its repo` });
    }
    const visited = new Set<string>([idKeyOf(node)]);
    let parent: string | null | undefined = node.parentName;
    while (parent) {
      const key: string = `${legacyRepoKey(node) ?? '(no-repo)'}\u0000${parent}`;
      if (visited.has(key)) { unresolved.push({ legacyName: node.name, repoKey:legacyRepoKey(node), reason: 'parentName cycle' }); break; }
      visited.add(key);
      parent = nodes.find(n => idKeyOf(n) === key)?.parentName;
    }
  }

  // The final document must pass the v2 schema; if it does not, that is a bug.
  for (const node of nodes) {
    const direction = directions.find(d => d.id === nodeId.get(idKeyOf(node)));
    if (!direction) continue;
    const issues = unresolved.filter(i => i.legacyName === node.name && i.repoKey === legacyRepoKey(node));
    direction.recoveryReasons = issues.map(i => i.reason);
    if (node.parentName && issues.length === 0) {
      const parentId = directionIdByNameRepo.get(`${legacyRepoKey(node)}\u0000${node.parentName}`);
      const parent = directions.find(d => d.id === parentId);
      if (parent) direction.integrationTargetWorktreeId = parent.worktreeId;
    }
  }
  validateStateV2(state);

  return {
    sourceHash,
    inputNodeCount: nodes.length,
    outputDirectionCount: directions.length,
    unresolved,
    state,
  };
}
