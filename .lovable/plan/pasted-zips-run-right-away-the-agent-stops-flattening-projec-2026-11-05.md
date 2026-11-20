# Pasted ZIPs run right away, the agent stops flattening projects, and the agent can check the preview with screenshots

## What is going wrong now
- The agent's instructions still say "there is no npm install/build runner inside this editor, so keep changes self-contained". That's why it says there is no build runner and rewrites React/Vite projects into one big `index.html`.
- Code Haven already builds projects inside the browser. The last fix loosened the check that decides whether a ZIP is "buildable". But there is still no single place that adds the missing Vite/React setup when a ZIP is imported.
- The screenshot checker (phone + PC screenshots, read by your selected image model) only switches on when you approve a separate visual check. During a normal build, the agent can't look at its own result.

## What we'll fix

### 1. Build runner for pasted ZIPs
- When a ZIP is imported, Code Haven looks at its files. If it's a React/Vite-style project that's missing a build script, a Vite setup or `index.html`, Code Haven adds standard ones in the hidden build folder (`.code-haven-build/`). Your own files are never overwritten.
- It finds the starting file automatically (`src/main.tsx`, `main.jsx`, `index.tsx`, etc., or the script in `index.html`). This also works when everything sits inside one top folder.
- Preview, Publish and the after-import check all use the same runner, so a ZIP that previews also publishes.
- Plain HTML sites keep opening as they are, with no build.

### 2. The agent keeps your project's real setup
- Replace the outdated "no build runner" rule. The new rule: "Code Haven builds React/Vite/TypeScript projects in the browser. Keep the project's stack and files. Never turn a framework project into one self-contained index.html."
- If the agent tries to replace a React/Vite project with a single big `index.html`, the "is it really done?" check sends the work back to be redone properly.

### 3. The agent can screenshot, see and fix the preview
- After a build that changed files, the agent can use the screenshot tool. It takes real phone and PC screenshots of the preview, sends the actual pictures plus any page errors to your selected image model, and gets back a list of problems.
- If there are problems, the agent fixes them and checks again, up to 3 times. The screenshots and findings are saved in the work log Timeline.
- Your model choices stay as they are: Plan = Cloudflare, Build and image reading = your selected OpenRouter models. The screenshot check only runs as part of a build you've already approved, so nothing runs or uses credit on its own.
- If screenshots can't be taken (for example, the Cloudflare key doesn't have Browser Rendering permission), the agent says so plainly and doesn't pretend it checked.

## Technical details
- New `src/lib/zip-scaffold.ts` (pure): `scaffoldBuild(files)` returns extra files under `.code-haven-build/` (`index.html`, `vite.config.ts`, `package.json` scripts) plus the detected root and entry. It's used by `zip-import.ts`, `browser-build.ts` (`buildInBrowser` reads scaffold files when the project's own are missing), `zip-check.ts` and the publish path.
- `src/lib/chat-agent.server.ts` line ~253: rewrite the stack rule. Add a framework-flattening guard to `completionGate` (it flags when a project with `src/main.*` gets a large new inline `index.html` and has its source deleted or emptied).
- `src/routes/api/public/chat.ts`: register the `inspect_preview` tool for every approved file-changing Build job, not only visual-only jobs. Keep the 3-round cap and save results to `browser_checks` / trace.
- Tests: scaffold (nested root, entry detection, no overwrite), prompt has no "no build runner" wording, flattening guard, and the visual tool is offered on build jobs. No live Cloudflare or image-model calls in tests.
