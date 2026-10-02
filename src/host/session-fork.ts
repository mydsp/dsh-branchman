// Mirrors the installed 0.2.0-rc.2 controller's completed-prefix contract.
export function latestCompletedPrefixBoundary(events: readonly any[]): number | undefined {
  const end = events.findLastIndex(e => e.type === 'turn/end');
  if (end < 0) return undefined;
  let boundary = events[end].seq;
  for (const next of events.slice(end + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append') || next.type === 'agent/inbox/spliced') break;
    boundary = next.seq;
  }
  return boundary;
}
export function resolveMessageBoundary(events: readonly any[], messageId: string): number | undefined {
  const at = events.findIndex(e => e?.data?.message?.id === messageId || e?.data?.id === messageId);
  if (at < 0) return undefined;
  const end = events.findIndex((e, i) => i >= at && e.type === 'turn/end');
  if (end < 0) return undefined;
  let boundary = events[end].seq;
  for (const next of events.slice(end + 1)) {
    if (next.type === 'turn/start' || (next.type === 'user/message' && next.surfaceOp === 'append') || next.type === 'agent/inbox/spliced') break;
    boundary = next.seq;
  }
  return boundary;
}
export function forkBoundary(events: readonly any[], input: { boundarySeq?: number; messageId?: string }): number {
  const cut = input.boundarySeq ?? (input.messageId ? resolveMessageBoundary(events, input.messageId) : latestCompletedPrefixBoundary(events));
  if (!Number.isSafeInteger(cut) || events[cut!]?.seq !== cut) throw new Error(input.messageId ? 'message has no completed fork boundary' : 'source has no valid completed fork boundary');
  return cut!;
}
