# Fix repeated agent replies and make pasted ZIPs work immediately

## What is going wrong

**1. The agent repeats the same reply**
When a build gets sent back for another try (the "is it really done?" check, the missing-image check, or a new round after hitting the step limit), the agent writes its summary again. Code Haven saves every one of those summaries and glues them all together into the final message. So you see the same text 2–4 times.

**2. ZIPs without a Vite build don't work**
Right now a ZIP only previews if it has `package.json`, `index.html` and a build script. A ZIP that's just plain HTML/CSS/JS, or a React project missing the Vite setup or build script, gets marked "not buildable", and the preview fails instead of working right away.

## What we'll fix

1. **One clean reply.** Only the agent's last summary is shown. Earlier retry summaries stay in the work log Timeline, not in the chat message. If two summaries are the same, they're never shown twice.
2. **Plain-site ZIPs open right away.** A ZIP with only `index.html` (and no `package.json`) is shown as a normal website, with images, CSS and scripts loaded as they are. There's no build step.
3. **Missing Vite setup gets filled in automatically.** When a React/Vite-style ZIP has no build script, no Vite config, or no `index.html`, Code Haven adds a standard one while it imports. It finds the entry file (`src/main.tsx`, `main.jsx`, etc.) and writes those added files under the hidden build folder, so your files are never overwritten.
4. **Index in a subfolder.** If the site sits inside one top folder (like `my-site/index.html`), that folder is used as the starting point.
5. **Clear fallback.** If a ZIP still can't run, the preview names the exact missing piece. Then the automatic OpenRouter fix (max 3 rounds) starts, the way it does today.

## Technical details
- `src/routes/api/public/chat.ts`: the final message currently uses `replyTexts.join(...)` (lines ~1252, 1283). Change it to keep only the last visible reply for each attempt/round and drop exact duplicates. Add a test.
- `src/lib/browser-build.ts` `isBuildable` + build entry: add a `static` mode (index.html with no package.json, or no framework deps). Add a synthesized default Vite config, build script and index.html for framework sources, scoped under `.code-haven-build/`.
- `src/lib/zip-import.ts` / `zip-check.ts`: detect a single top-level folder as the root, then run the new check before auto-fix.
- Tests for: static ZIP, ZIP with no build script, ZIP in a nested folder, and the reply dedupe.
- Model routing and selected models stay the same (Plan = Cloudflare, Build = OpenRouter).
