# Make Cloudflare builds truly finish, run from chat, and survive disconnects

## What I found in your real build records
- Builds are marked "Finished · 3 steps, 3 files changed" even when nothing was written. Your last finished build only *read* files and wrote a short note, then stopped. The "files changed" number counts files the agent only looked at.
- "Finished" means only "the model stopped talking". Nobody checks whether the work was actually done, so it never tells you why it stopped.
- In your screenshot the agent spent its Neurons thinking out loud: it had to rewrite a whole 31KB file to change a few lines, because there is no edit/patch tool. Not enough Neurons were left, so it gave up.
- When the chat sends an edit to Cloudflare, your phone starts the build. If you leave the page or lose signal at that moment, the build may never start. The chat also only shows a log at the very end and has no Stop button.
- Builds are still cut off about 30 seconds after your phone disconnects, because automatic restarts are switched off.

## What I will build

### 1. Edit/patch tools for every working model
- **edit_file**: changes only the exact lines that need changing (find this text, replace with that text). A small change costs a few hundred Neurons instead of thousands.
- **patch_file**: several of those small changes in one file at once.
- Both tools save only when the result is complete and valid (same check as today). They give a clear error if the text isn't found, so the model can fix it.
- The agent's instructions will say: use edit_file for small changes, and only use write_file for new files or full rewrites.

### 2. A real "is it done?" check
- Only real writes, edits and deletes count as "files changed". Reads won't count anymore.
- When a build says it's done, the server checks it before calling it Finished:
  - If you asked for a change but no file changed, the build is not finished. The agent is told to do the work and is given one more round.
  - Every changed file gets a code check (syntax, missing pieces, broken links between files). If the check fails, the agent gets up to 3 tries to fix it. These use the same repair limit you have today.
  - A short done-list check: the agent must list each thing you asked for and which file covers it. Anything it can't point to sends it back to work.
- If it still can't finish, the build card says exactly why. For example: "Stopped: no file was changed", "Code check failed in script.js line 40", or "Out of Neurons on key #3". You won't see a false "Finished".

### 3. Shorter, faster replies from every model
- Stricter rules for every working model: no thinking out loud in the reply, one short line between steps, and a summary of 1–3 lines at the end.
- Long "thinking" text is folded away by default in the editor chat, so it no longer fills the screen.
- Where the model allows it, thinking is set to low for build steps. That makes replies start sooner and costs fewer Neurons.
- Old file contents already in the conversation are trimmed, so each step sends less text.

### 4. Chat sends work to Cloudflare from the server
- When you tap **Yes**, the server starts the Cloudflare build itself, not your phone. It still keeps the same Yes-before-Cloudflare rule.
- The chat shows a live **work log** under the edit card: each step, file, key number and Neuron count. It updates even while the build runs in the editor or on another device.
- A **Stop** button on the running edit card stops the build straight away.
- When it ends, you get an alert in the chat (a pop-up message, plus a phone notification if you allow it). Then your chat model sends you the summary: what changed, which files, whether the check passed, and any problem.

### 5. Builds keep going if your internet drops or the phone turns off
- This uses your choice: the server picks up a build by itself **only** if it was cut off by a lost connection or a switched-off device.
- Paused builds (rate limits, Retry / Approve next key) still wait for your tap, as before.
- The server checks every minute. If a running build has gone silent for 90 seconds, it continues from the saved progress, up to 6 times, with no extra credit charged.
- When you come back, the build card shows Finished (with real counts), "Picked up again N times by the server", or the real reason it stopped.

## What I can and can't test
- I'll add tests with fake model replies for: edit/patch tools, the "is it done?" check, the file counter, starting edits from the chat on the server, the chat Stop button, and restart only after a cut-off. No real Cloudflare calls in tests.
- After you approve, I'll run one small real build on your keys to confirm it finishes properly. You've allowed me to use your Neurons. It should cost about 2,000–4,000 Neurons.

## Technical details
- `src/lib/chat-tools.server.ts`: add `edit_file` (`path`, `find`, `replace`, optional `all`) and `patch_file` (array of edits). Exact-match with a whitespace-tolerant fallback, then `validateFile` before `store.write`. Shared repair counter.
- `src/routes/api/public/chat.ts`: separate `touchedFiles` (reads) from `changedFiles` (write/edit/patch/delete results with `ok:true`). Add a completion gate before `outcome = "finished"`: change requested and zero changes, or `validateFile` failing on any changed file, or the self-checklist (a one-line JSON `done` list on the final turn) missing items → push a continuation message within `MAX_ROUNDS`. Save an `incomplete_reason` in `error`/`progress`. Set the `reasoning` effort to low where the provider supports it, and trim old `read_file` outputs in carried steps.
- `src/lib/chat-agent.server.ts`: rewrite the Tools/Behavior sections around edit_file-first and a terse output style.
- Editor chat UI: collapse reasoning parts by default.
- `src/lib/assistant.functions.ts`: `decideEdit` "yes" calls a new server-side starter that POSTs to `/api/public/chat` with the resume token and trusted user (same path the resume route uses) and holds it open with `keepAlive`. Add `stopEdit` (reuses the `stopChatJobs` logic for that job), and `checkEdit` returns live `progress` plus recent trace lines.
- `src/routes/_authenticated/chats.$chatId.tsx`: live log on the edit card (polls every 3s while running), a Stop button, a toast and browser Notification on finish.
- `src/routes/api/public/jobs.resume.ts`: `AUTO_RESUME_ENABLED = true`, but `shouldResume` skips jobs with `outcome = 'paused'` / `paused_at_key` set. Only silent `running` jobs qualify. Update the cloudflare-pool memory rule to "auto-restart only for disconnect cut-offs".
- Tests: `tests/chat-tool-flow.test.ts` (edit/patch), a new `tests/completion-gate.test.ts`, and `tests/job-resume.test.ts` (paused jobs never resume).
