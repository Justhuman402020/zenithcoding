## Reliable AI builds

### Goal
Stop file reads and agent replies from appearing cut off, and let an accepted build finish even if the phone temporarily loses its connection.

### Changes
1. Add durable chat jobs with `queued`, `running`, `completed`, and `failed` states, progress details, and the final assistant reply.
2. Move the model/tool loop into a reusable server worker that persists completion independently of the browser response stream.
3. Change chat submission to acknowledge an accepted job immediately, then let the editor poll/reconnect until the work finishes; a message cannot be submitted while offline.
4. Return complete file contents from `read_file`, but keep oversized context safe by supporting ranged reads and clear continuation metadata instead of silently cutting content.
5. Refresh files and preview from persisted job completion, even after reconnecting or reopening the project.
6. Add regression coverage for large file reads, successful file writes, reconnect recovery, failures, and duplicate-submit protection.

### Safety and behavior
- Existing project files, model selection, saved API keys, credit rules, and trace logs remain in place.
- Every accepted message receives one stable job ID so reconnecting cannot start the same build twice.
- Failed jobs show the actual failure and remain retryable by the user.

### Verification
- Run the focused regression suite and typecheck.
- Test a real editor build, interrupt the browser connection after acceptance, reconnect, and confirm the saved file and preview update.
