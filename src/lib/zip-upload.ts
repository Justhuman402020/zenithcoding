// Saves imported ZIP files in small, size-limited pieces so slow phone
// networks never sit on one huge request with no feedback.
export type UploadRow = { project_id: string; user_id: string; path: string; content: string };

export const MAX_BATCH_BYTES = 600_000;
export const MAX_BATCH_ROWS = 25;
export const REQUEST_TIMEOUT_MS = 60_000;
export const MAX_TRIES = 3;

/** Groups rows so each request stays under a byte budget (a single big file goes alone). */
export function batchRows<T extends { content: string }>(rows: T[], maxBytes = MAX_BATCH_BYTES, maxRows = MAX_BATCH_ROWS): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const row of rows) {
    const bytes = row.content.length;
    if (current.length && (size + bytes > maxBytes || current.length >= maxRows)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(row);
    size += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

type Insert = (rows: UploadRow[], signal: AbortSignal) => PromiseLike<{ error: { message: string } | null }>;

/** Uploads with a per-request timeout and retries; reports progress after every piece. */
export async function uploadRows(
  rows: UploadRow[],
  insert: Insert,
  onProgress: (done: number, total: number) => void,
  opts: { timeoutMs?: number; tries?: number; wait?: (ms: number) => Promise<void> } = {},
) {
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const tries = opts.tries ?? MAX_TRIES;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let done = 0;
  onProgress(0, rows.length);
  for (const batch of batchRows(rows)) {
    let lastError = "";
    for (let attempt = 1; attempt <= tries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const { error } = await insert(batch, controller.signal);
        if (!error) { lastError = ""; break; }
        lastError = error.message;
      } catch (e) {
        lastError = controller.signal.aborted ? "The network was too slow" : e instanceof Error ? e.message : String(e);
      } finally {
        clearTimeout(timer);
      }
      if (attempt < tries) await wait(1500 * attempt);
    }
    if (lastError) throw new Error(`Upload stopped at ${done} of ${rows.length} files: ${lastError}. Check your connection and try again.`);
    done += batch.length;
    onProgress(done, rows.length);
  }
}
