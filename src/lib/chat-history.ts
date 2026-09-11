export type ChatRow = { id: string; role: string; content: string; created_at?: string };

/**
 * Remove back-to-back rows with the same role and identical text. These came
 * from an older double-save bug and only add noise to the model context.
 */
export function dedupeChatRows<T extends ChatRow>(rows: T[]): T[] {
  return rows.filter(
    (row, index, all) =>
      index === 0 ||
      row.role !== all[index - 1]!.role ||
      row.content.trim() !== all[index - 1]!.content.trim(),
  );
}

/**
 * Drop questions that never got an answer. An unanswered question is any user
 * row with no assistant row after it. Keeping them made every later build
 * resend a growing pile of dead text, which pushed real work out of the
 * model's context window and cut replies short.
 */
export function dropUnansweredUserRows<T extends ChatRow>(rows: T[]): T[] {
  const kept: T[] = [];
  for (let index = rows.length - 1, seenAssistant = false; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (row.role === "assistant") {
      seenAssistant = true;
      kept.push(row);
      continue;
    }
    if (row.role === "user" && !seenAssistant) continue;
    if (row.role === "user") seenAssistant = false;
    kept.push(row);
  }
  return kept.reverse();
}

export function cleanChatRows<T extends ChatRow>(rows: T[]): T[] {
  return dropUnansweredUserRows(dedupeChatRows(rows));
}
