// Domain model — stable identities, graph primitives and the v2 entity shapes.
//
// This is the TARGET schema. It is deliberately decoupled from the v1 tree.json
// shape and from any host API. Adapters (host-adapter / git-adapter / migrate-v1)
// translate the real host shapes into these, and the client renders only these.
//
// Rules encoded here (see 2026-10-02-deepseekharness-local-audit.md §6):
//   - Identity is a stable ID, never a display name and never a path hash.
//   - Repo / worktree / session / direction are DISTINCT concepts.
//   - All write operations key on ids, not names.

/** A conversation direction's user-facing identity. */
export type DirectionIdentity = {
  id: string;
  repoId: string;
  displayName: string;
};

/** Node kinds in the overview graph. One node per identity, never conflated. */
export type GraphNode = { id: string; kind: 'repo' | 'session' | 'direction' };

/** A directed edge. sourceId → targetId must resolve to nodes in the same call. */
export type GraphEdge = { id: string; sourceId: string; targetId: string };

/** A diagnosed structural problem, keyed by the offending ids. */
export type GraphIssue = {
  code: 'orphan' | 'cycle' | 'duplicate-id';
  ids: string[];
};

export type GraphResult = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  issues: GraphIssue[];
};

// ── v2 entity shapes (target, not host API) ────────────────────────────────

export type Repo = {
  id: string;
  canonicalCommonDir: string;
  primaryWorktreeId: string;
  identityVerified?: boolean;
};

export type Worktree = {
  id: string;
  repoId: string;
  canonicalPath: string;
  branchRef: string | null;
  managedBy: 'branchman' | 'external';
  present?: boolean;
};

export type SessionLink = {
  sessionId: string;
  worktreeId: string | null;
  presence: 'live' | 'persisted' | 'missing' | 'unknown';
  archived: boolean;
};

export type Direction = {
  id: string;
  repoId: string;
  worktreeId: string;
  displayName: string;
  primarySessionId: string | null;
  baseOid: string;
  upstreamRef: string | null;
  integrationTargetWorktreeId: string;
  state: 'creating' | 'ready' | 'conflicted' | 'recovery-required' | 'removed';
  brief?: string;
  summary?: string;
  recoveryReasons?: string[];
  workspaceId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  mergedAt?: string | null;
};

export type ForkEdge = {
  id: string;
  sourceSessionId: string;
  targetSessionId: string;
  boundarySeq: number | null;
  boundaryMessageId: string | null;
  inheritedEventCount: number;
  operationId: string | null;
};

export type Operation = {
  id: string;
  requestId: string;
  kind: 'fork' | 'merge' | 'sync' | 'remove';
  phase: string;
  state: 'running' | 'succeeded' | 'failed' | 'recovery-required';
  ownedResources: string[];
  errorCode: string | null;
};
