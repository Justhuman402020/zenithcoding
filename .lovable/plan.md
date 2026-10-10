## Fix: builds stuck on key #1 instead of moving to key #2, #3…

### What is actually happening (confirmed)
- The Auto-switch button in the editor shows **On**, but a second, hidden Auto-switch setting in Admin → AI Models is saved as **Off**. The server only switches keys when *both* are on, so it locks to the one model/key and shows "The model you picked… can't answer right now", the error in your screenshot.
- When you pick a Cloudflare model in the first menu, every option points to one key (the menu shows "Key #2 · Cloudflare Workers AI #1" on all of them). Choosing it pins the build to that key, so even with switching on it doesn't spread across the other keys.
- Today's usage record shows key #1 marked as used up, so the job has to move on, but the lock above stops it.

### Changes
1. **One Auto-switch that you can trust:** the editor's Auto-switch button is the deciding control. When it's On, the server always moves through the keys, even if the old admin setting is Off. The admin setting only sets the default for new devices, and its label explains that.
2. **Picking a Cloudflare model means "this model on every key":** choosing e.g. Qwen 3.8 or GLM 4.7 in the menu runs it on key #1, then #2, #3… in order. It no longer pins one key. The menu label changes to "All keys · N available" so it no longer shows the wrong key number.
3. **Move on straight away:** when a key says it's out of quota (429 / daily limit), the server marks it used up and tries the next key with the same model in the same request. You get no error in between, and the 5-second countdown banner shows "Switching to key #N".
4. **Honest error only when truly out:** the "can't answer" message only appears when Auto-switch is really Off. With Auto On and every key used up, you'll see "All N keys are used up for today — resets in HH:MM" instead.
5. **Clear stale stuck banner:** "Forge is still working…" clears when the server returns this error, so the screen doesn't keep spinning.

### Technical details
- `chat.ts`: base the pool decision on `editorAuto` alone (drop the `&& autoFallback` gate on lines 262/266/342/664/771/806). Use `autoFallback` only as the default when the header is missing.
- When `requestedRef.provider` is a Cloudflare pool key, keep `requestedRef.model` and expand it to `poolRefs` with that model, ordered by pool position, so the coding model setting doesn't silently override it.
- `model-controls.functions.ts` / `ChatModelControls.tsx`: remove duplicate Cloudflare options so there is one option per model, labeled with the pool size.
- Add a test in `tests/chat-tool-flow.test.ts`: with the admin auto set to false and the header set to on, the chain contains every non-exhausted pool key in order, and a 429 on key #1 picks key #2.

### Not doing
- No live test that uses neurons/credits; checks will use code and tests only.
