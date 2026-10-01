// Session label selection — one priority order, one place (S08).
//
// The old client read a bare `title` off the snapshot, ignoring the server's
// `direction.sessionTitle`; cold sessions and the sidebar could show different
// text. This module centralises the label priority:
//   user title → host displayTitle → user brief → goal/human summary → short id
// and stores the SOURCE alongside the text so the UI can show which won.

export type LabelSource = 'user' | 'host' | 'brief' | 'summary' | 'id';

export type SessionLabel = { text: string; source: LabelSource };

export type LabelInputs = {
  /** The user's manually-set title (must always win). */
  userTitle?: string | null;
  /** The host's display title / title snapshot. */
  hostTitle?: string | null;
  /** The direction's brief (user's own words at fork time). */
  brief?: string | null;
  /** Derived summary (goal objective / first human message). */
  summary?: string | null;
  /** Short session id as the last resort. */
  sessionId?: string | null;
};

const BOILERPLATE_TITLE_RE = /^\s*reference attachments for (?:the )?goal objective\.?(?:\s*\(\d+\))?\s*$/i;

const clean = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
};

/** True when a title is just the goal boilerplate and thus not a usable label. */
export function isBoilerplateTitle(title: string): boolean {
  return BOILERPLATE_TITLE_RE.test(title);
}

/**
 * Pick the best label from the available inputs, in priority order, returning
 * the source that produced it. Returns null when nothing usable is present.
 */
export function selectLabel(inputs: LabelInputs): SessionLabel | null {
  const userTitle = clean(inputs.userTitle);
  if (userTitle !== null) return { text: userTitle.slice(0, 120), source: 'user' };

  const hostTitle = clean(inputs.hostTitle);
  if (hostTitle !== null && !isBoilerplateTitle(hostTitle)) {
    return { text: hostTitle.slice(0, 120), source: 'host' };
  }

  const brief = clean(inputs.brief);
  if (brief !== null) return { text: brief.slice(0, 120), source: 'brief' };

  const summary = clean(inputs.summary);
  if (summary !== null) return { text: summary.slice(0, 120), source: 'summary' };

  const sessionId = clean(inputs.sessionId);
  if (sessionId !== null) return { text: sessionId, source: 'id' };

  return null;
}
