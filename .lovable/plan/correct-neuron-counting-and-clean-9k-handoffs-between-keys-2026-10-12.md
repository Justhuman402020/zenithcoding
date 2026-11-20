## Correct Neuron counting and clean 9k handoffs between keys

### Goal
Every Cloudflare key stops at about 9,000 Neurons (never reaching 10,000), saves finished work so the preview shows it, writes a clear "done / left to do" note, and passes the job to the next key. The next key reads the note, checks its own Neurons, and continues. The job never stops mid-work. Each step's Neuron cost shows in the chat.

### What is wrong today
1. **Handoffs are switched off for you.** The server only hands off at 9k when the hidden admin Auto-switch setting is also On. Yours is saved Off, so keys run until Cloudflare cuts them off at 10k and the job stops.
2. **Neurons are under-counted.** At the end of a run, only the last step's cost is saved, not all of them. Each key's starting count also comes from our own guess, not the real number Cloudflare shows.
3. **The check happens too late.** The app only checks after a step ends. One big step can jump from 8,500 straight past 10,000.
4. **The handoff note is too thin.** It lists files but not which plan items are done, which are left, or what to do next.

### What will change
1. **Editor Auto-switch decides.** When it's On, keys always hand off at 9k. The admin setting only sets the default for new devices.
2. **Real starting count.** Before a key starts, the app reads its real usage from Cloudflare (the same number shown in the Workers AI section). It only falls back to our own count if Cloudflare doesn't answer. Every step's cost is added up and saved, not just the last one.
3. **Look ahead before each step.** Before each step, the key estimates what the next step will cost (based on its recent steps, plus a margin). If that would go past 9,000, it stops now. It always stays under about 9,200, keeping the 1,000 reserve.
4. **Wrap-up step.** When a key is close to the limit, it gets one short final turn to save any half-written file in a working state, then fill in a progress list.
5. **Shared progress list (the "baton").** Each job keeps a saved list that all keys see:
   - The approved plan items (for example your 10 items: signup, sidebar, favicon, left side, home menu, login code, user history, email section, phone number section…), each marked done, in progress or left.
   - Files saved so far, and that the preview is showing them.
   - The exact next action (for example "finish item 8, then typecheck").
   - Neurons each key used, and which key number is next.
   The next key reads this first, checks its own Neurons, plans how many items fit under 9k, and starts. The list is saved on the server, so it survives the phone going off and the server restarting a job.
6. **Typecheck and build count as items too.** If a key runs low during the final check, it passes "finish typecheck" to the next key instead of going over.
7. **Neuron cost in chat.** Each step shows a line like "Key #4 · step cost 640 · 7,350 / 9,000 · 1,650 left". Each handoff shows a card like "Key #4 finished items 1–7 (8,950 Neurons) → Key #5 taking over items 8–10". The agent's own instructions show the same numbers so it knows its budget.
8. **No mid-work stops.** A handoff never counts as a failure or uses up a continuation round. The job only ends when the work is done, all keys are used up for the day, or you press stop.

### Not doing
No real build will run during this change, so no credits are spent. I'll check it with code checks and new tests.

### Technical details
- `chat.ts`: drop the `autoFallback &&` gate on handoff (header `x-forge-auto` decides; `autoFallback` is only the default when the header is missing). Get `baseNeurons` from `fetchRealNeurons` (decrypt the key, account id from baseURL), falling back to `cloudflare_neuron_usage`. Change `onFinish` to use `totalUsage` / the summed `attemptNeurons` (fixes the undercount). Don't count handoff attempts toward `MAX_ATTEMPTS` / `MAX_ROUNDS`.
- Predictive stop in `prepareStep`: `projected = total + max(lastStepCost, avgStepCost) * 1.25`. If `projected > 9000`, set handoff and run a single wrap-up step that offers only `write_file` and the new `update_handoff` tool. Hard ceiling of 9,200.
- New agent tool `update_handoff` (in `chat-tools.server.ts`) writes `{items:[{title,status}], files, next, keyLog:[{key,neurons,items}]}` into a new `handoff` jsonb column on `chat_jobs` (migration). Plan-mode approval seeds `items` from the approved plan. Each new key's first message is built from this record. `jobs.resume.ts` also reads it.
- `estimateNeurons`: keep the token-based formula but adjust it against the real Cloudflare reading after each attempt (store a per-model ratio) so estimates match the dashboard.
- UI (`p.$projectId.tsx`): show per-step neuron lines from message metadata, a handoff card, and the progress list on the Last build card.
- Tests in `tests/chat-tool-flow.test.ts`: handoff still happens when the admin setting is Off and the editor's Auto-switch is On; the look-ahead stops at 8,500 when a step costs 700; the total is the sum of all steps; the progress list carries over from one key to the next.
