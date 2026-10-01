// Read-only projection — summaries, message counts and presence, decoupled
// from any write path (B05/B07/S06).
//
// The old doTree did three things at once: filled previews (an observation +
// a write), listed main-line sessions, and folded the whole tree — every poll.
// This module is the pure, side-effect-free core: it derives a preview from
// events, counts messages idempotently by seq, and models preview cache state
// with explicit retry/backoff so `empty` is not re-observed every poll.

/** Preview cache state, per session (S06/B05). */
export type PreviewRecord = {
  state: 'pending' | 'ready' | 'empty' | 'failed';
  text: string | null;
  /** Event cursor the preview was derived from — newer cursor invalidates it. */
  sourceCursor: number;
  /** Milliseconds to wait before re-attempting a failed/empty preview. */
  retryAfter: number | null;
};

export const GOAL_BOILERPLATE_RE = /^\s*reference attachments for (?:the )?goal objective\.?\s*$/i;
const PREVIEW_MAX = 80;

type AnyEvent = { type?: unknown; data?: unknown; seq?: unknown };

const flattenText = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

function isTextBlock(block: unknown): block is { type: 'text'; text: string } {
  return typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
    && typeof (block as { text?: unknown }).text === 'string';
}

function isUserMessageEvent(event: AnyEvent): event is AnyEvent & { data: { source?: unknown; content?: unknown } } {
  return event.type === 'user/message' && typeof event.data === 'object' && event.data !== null;
}

/**
 * Derive a preview string from a list of events: the /goal objective, else the
 * first genuine human text message. Boilerplate goal text and empty strings are
 * skipped. Returns null when there is nothing to show.
 */
export function derivePreview(events: readonly unknown[] | null): string | null {
  if (!Array.isArray(events)) return null;
  let objective: string | null = null;
  let firstHuman: string | null = null;
  for (const raw of events) {
    const event = raw as AnyEvent;
    if (event.type === 'goal/change') {
      const data = (event.data ?? {}) as { operation?: unknown; goal?: { objective?: unknown } };
      if (data.operation === 'clear') { objective = null; continue; }
      const text = flattenText(data.goal?.objective);
      if (text !== '') objective = text;
      continue;
    }
    if (firstHuman === null && isUserMessageEvent(event)) {
      if ((event.data as { source?: { kind?: unknown } }).source?.kind !== 'user') continue;
      const blocks = Array.isArray(event.data.content) ? event.data.content : [];
      const text = flattenText(blocks.filter(isTextBlock).map(block => block.text).join(' '));
      if (text === '' || GOAL_BOILERPLATE_RE.test(text)) continue;
      firstHuman = text;
    }
    if (objective !== null && firstHuman !== null) break;
  }
  const text = objective ?? firstHuman;
  if (text === null || text === '') return null;
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

/** The only event types that count as a conversation message (S06). */
const MESSAGE_EVENT_TYPES = new Set(['user/message', 'assistant/message']);

/**
 * Count messages idempotently by sessionId + seq. Title events (and every
 * other non-message event) are NOT counted — the old code also counted
 * `session/title`, inflating the number.
 */
export function countMessages(events: readonly unknown[] | null): number {
  if (!Array.isArray(events)) return 0;
  const seen = new Set<number>();
  let count = 0;
  for (const raw of events) {
    const event = raw as { type?: unknown; seq?: unknown };
    if (!MESSAGE_EVENT_TYPES.has(String(event.type))) continue;
    if (typeof event.seq !== 'number') continue;
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    count += 1;
  }
  return count;
}

/** Pure preview-cache transition: compute the next record for a given cursor. */
export function nextPreview(
  previous: PreviewRecord | undefined,
  cursor: number,
  derived: string | null,
  now: number,
  backoffMs = 60_000,
): PreviewRecord {
  // A failed/empty preview is not retried until its backoff elapses.
  if (previous !== undefined && previous.sourceCursor === cursor) {
    if ((previous.state === 'failed' || previous.state === 'empty')
      && previous.retryAfter !== null && now < previous.retryAfter) {
      return previous;
    }
  }
  if (derived === null) {
    return { state: 'empty', text: null, sourceCursor: cursor, retryAfter: now + backoffMs };
  }
  return { state: 'ready', text: derived, sourceCursor: cursor, retryAfter: null };
}
