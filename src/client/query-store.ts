// Query store — single-flight reads with cancellation and revision guard (S02).
//
// The old client re-ran `load()` on a 4-second interval with no cancellation
// and no ordering guarantee: a slow response could overwrite a newer one. This
// module provides a versioned reader where the newest request wins, the
// superseded request is aborted, and a stale response is discarded by revision.

export type LoadOutcome<T> =
  | { kind: 'ok'; data: T; revision: number }
  | { kind: 'superseded' }
  | { kind: 'aborted' };

/** A monotonic revision counter. */
export class RevisionClock {
  #value = 0;

  next(): number {
    this.#value += 1;
    return this.#value;
  }

  get value(): number {
    return this.#value;
  }
}

/**
 * A versioned, cancelling loader. Every `load()` cancels the previous request
 * (so there is at most one in flight — the "single flight" — and the newest
 * wins), bumps the revision, and returns the outcome. A superseded call's
 * promise resolves to `{ kind: 'superseded' }` instead of throwing, so callers
 * can safely `Promise.all` without an unhandled rejection.
 */
export function makeSingleFlight<T>(fetch: (signal: AbortSignal) => Promise<T>) {
  let controller: AbortController | null = null;
  let revision = 0;

  const load = async (): Promise<LoadOutcome<T>> => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const myRevision = ++revision;
    try {
      const data = await fetch(current.signal);
      if (current.signal.aborted || myRevision !== revision) return { kind: 'superseded' };
      return { kind: 'ok', data, revision: myRevision };
    } catch (error) {
      if (current.signal.aborted) return { kind: 'superseded' };
      // Re-throw a genuine fetch error only if we are still the newest; a newer
      // call may have aborted us (caught above).
      if (myRevision !== revision) return { kind: 'superseded' };
      throw error;
    }
  };

  const abort = (): void => {
    controller?.abort();
  };

  return { load, abort, get revision() { return revision; } };
}

/** Track a response's freshness: whether it is stale vs a target revision. */
export function isStale(resultRevision: number, targetRevision: number): boolean {
  return resultRevision < targetRevision;
}
