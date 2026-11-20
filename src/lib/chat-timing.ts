// How long the side-chat model took to answer one message.
type Msg = { role: string; created_at: string; parts?: { reply_ms?: unknown } | null };

/** Saved reply time; for older replies, the gap since the user's message right before it. */
export function replyTimeMs(message: Msg, previous: Msg | null): number | null {
  if (message.role !== "assistant") return null;
  const saved = message.parts?.reply_ms;
  if (typeof saved === "number" && Number.isFinite(saved) && saved >= 0) return saved;
  if (!previous || previous.role !== "user") return null;
  const gap = Date.parse(message.created_at) - Date.parse(previous.created_at);
  return Number.isFinite(gap) && gap >= 0 ? gap : null;
}
