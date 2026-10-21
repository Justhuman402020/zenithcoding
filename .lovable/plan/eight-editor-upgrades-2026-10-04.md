# Eight editor upgrades

## What you will get
1. **Brain tab** (new tab next to History): shows the rules the agent always follows (action-first, free APIs need no key, 9k handoff, never reset the project, asset rules) and your saved presets (models, Auto-switch, backend). A notes box lets you add your own rules; the agent reads them on every message.
2. **Never cut off when offline**: jobs already run on the server. Add a "reconnect check" when the screen wakes or Wi-Fi returns: shows "Reconnected · Step N · X files changed" or "Finished while you were away", and refreshes chat, files and preview.
3. **Readable reply + activity log**: each agent reply shows the clean message first, then a collapsed "Activity (N steps)" list underneath with every read/write/search call and its result.
4. **Live typing across devices**: what you type in the message box on one device appears in the box on your other device within about a second (only for the same account and project).
5. **Job timer + Neuron meter**: after Send, a live mm:ss timer and "Neurons: start 1.2k · used 3.4k · left 5.6k of 9k". The agent is told the same numbers each step so it can wrap up cleanly before 9k, and the handoff note keeps the same "Forge" persona and voice.
6. **Safe fixes with rollback**: before any "Fix this error" run, Forge saves a copy of all files. If the fix fails or the preview still breaks/goes blank, a "Undo this fix" button restores the copy in one tap (auto-offered).
7. **Export and clear code**: next to "Import .zip", a download icon saves every file as a .zip to your device, and a trash icon (with a confirm) clears all files so a fresh zip can go in. The preview refreshes after each.
8. **Assets really used**: when a message mentions @handle (e.g. @919101001), Forge looks up its address and gives it to the agent as a must-use item; after the reply it checks the files actually contain that address and, if not, sends one automatic follow-up to insert it, then tells you honestly.

## Technical details
- New table `project_brain_notes` (project_id, user_id, content) with GRANTs + owner RLS; notes injected in `buildProjectContext`.
- Draft sync: `project_drafts` row (project_id, user_id, text, device_id, updated_at), upsert debounced 400ms, realtime subscription; ignore own device_id.
- Reconnect: `visibilitychange` + `online` listeners trigger existing chat_jobs poll immediately.
- Activity log: render tool parts in a collapsible list below the text parts in the message view.
- Timer: client-side from send time; Neuron numbers streamed as `data-neurons` parts from chat.ts per step and appended to the step system context.
- Snapshot: reuse `project_snapshots` (insert before fix, restore on failure / blank preview).
- Export: `jszip` in browser; Clear: delete all `project_files` for the project after confirm.
- Assets: parse `@handle` in chat.ts, resolve via project assets, add required-URL block to the prompt, post-check written files and auto-continue once if missing.
