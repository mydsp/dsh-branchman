// Host adapter — isolates every host capability the plugin needs behind a
// small, version-pinned seam.
//
// The plugin currently reaches into `sessionQuery`, `agents`, `sessions`,
// `workspaceRegistry` etc. directly, and stores them in MODULE-LEVEL `optional`
// state (audit S05/B05/B07). This adapter owns those references per instance,
// guarantees observation leases are released, and maps host answers onto the
// domain's presence model ('live' | 'persisted' | 'missing' | 'unknown').

/** Which host capabilities the plugin can actually use right now. */
export type Capabilities = {
  inheritedFork: boolean;
  sessionQuery: boolean;
  workspaceRegistration: boolean;
};

/** A session's presence, from the host's point of view. */
export type Presence = 'live' | 'persisted' | 'missing' | 'unknown';

/** The minimal read of an observation the plugin consumes. */
export type Observation = {
  events: readonly unknown[];
  cursor: number;
};

/**
 * The host's disposable observation lease. It MUST expose `[Symbol.dispose]`
 * (audit §3.2: `observeSession` returns a reference-counted disposable lease;
 * prepared observations increment refs on retain, and only decrement on
 * dispose). The adapter treats it as an opaque resource it must always release.
 */
export type ObservationLease = {
  source: 'live' | 'prepared';
  events: readonly unknown[];
  cursor: number;
  retain?(): ObservationLease;
  [Symbol.dispose](): void;
};

/** The subset of `sessionQuery` the plugin uses, as a versioned seam. */
export type SessionQueryLike = {
  observeSession(sessionId: string): Promise<ObservationLease>;
  listSessions?(): Promise<Array<{ header: { id: string; cwd?: string | null } }>>;
};

/** The subset of `sessions` needed to answer presence questions. */
export type SessionsLike = {
  get(sessionId: string): unknown;
  list?(): Iterable<unknown>;
};

export type HostServices = {
  sessionQuery?: SessionQueryLike | null;
  agents?: unknown;
  agentDefaultModel?: unknown;
  workspaceRegistry?: unknown;
  sessions?: SessionsLike | null;
};

/**
 * One plugin instance's view of the host. A fresh adapter is created per
 * `apply`, so optional services are never shared across plugin instances and a
 * stale disposer cannot clear a replacement service (S05).
 */
export class HostAdapter {
  #services: HostServices;
  #disposed = false;

  constructor(services: HostServices = {}) {
    this.#services = { ...services };
  }

  /** Replace a service binding; returns a disposer that only clears ITS binding. */
  bind<K extends keyof HostServices>(key: K, value: HostServices[K]): () => void {
    this.#services[key] = value;
    const current = value;
    return () => {
      // Only clear the same reference this binding installed — a later bind of
      // the same key (or a disposal) must not be wiped by an older disposer.
      if (this.#services[key] === current) this.#services[key] = null;
    };
  }

  capabilities(): Capabilities {
    return {
      inheritedFork: this.#services.sessionQuery != null && this.#services.agents != null,
      sessionQuery: this.#services.sessionQuery != null,
      workspaceRegistration: this.#services.workspaceRegistry != null,
    };
  }

  /**
   * Run `fn` with a live or prepared observation, releasing the lease exactly
   * once on EVERY exit path — success, thrown error, or cancellation. This is
   * the B05 fix: the old `ensurePreview` observed but never disposed.
   */
  async withObservation<T>(sessionId: string, fn: (observation: Observation) => T | Promise<T>): Promise<T> {
    this.#assertActive();
    const query = this.#services.sessionQuery;
    if (query == null) throw new Error('branchman: sessionQuery is not available');
    const lease = await query.observeSession(sessionId);
    try {
      const observation: Observation = { events: lease.events, cursor: lease.cursor };
      return await fn(observation);
    } finally {
      lease[Symbol.dispose]();
    }
  }

  /**
   * Resolve a session's presence without conflating "detached from live" with
   * "deleted" (B07). Live is checked first; only when the session is not live
   * do we consult the persisted corpus; a corpus read failure is `unknown`,
   * never `missing`.
   */
  async sessionPresence(sessionId: string): Promise<Presence> {
    this.#assertActive();
    const sessions = this.#services.sessions;
    if (sessions != null && typeof sessions.get === 'function') {
      if (sessions.get(sessionId) !== undefined) return 'live';
    }
    const query = this.#services.sessionQuery;
    if (query == null || typeof query.listSessions !== 'function') return 'unknown';
    try {
      const records = await query.listSessions();
      for (const record of records) {
        if (record?.header?.id === sessionId) return 'persisted';
      }
      return 'missing';
    } catch {
      return 'unknown';
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('branchman: host adapter is disposed');
  }
}
