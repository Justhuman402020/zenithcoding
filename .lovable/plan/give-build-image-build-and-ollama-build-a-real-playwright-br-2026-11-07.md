# Give Build, Image build and Ollama build a real Playwright browser

## What you'll get
Your build agents get their own real browser they can use whenever they want during a task, the same way I test your app:
- Open the project's **latest unsaved version** (not just the published site) or any public https page.
- Click buttons, type into forms, press keys, scroll, switch between phone and PC size, go to other pages.
- Read what's on the screen (text, buttons, links), console errors, crashes and failed requests.
- Take screenshots at any step. You'll see them in the work log like the ScreenshotOne ones.
- Fix what they find, then open the browser again to confirm.

Works the same for **Build**, **Image build** and **Build with 🦙 Ollama on**. Plan and the side chat are not changed.

## How it will work
1. **New agent tool "browser"**. The agent sends a short list of steps, for example:
   open page, then click "Sign in", then type an email, then take a screenshot, then read the errors.
   It gets back each step's result, the page text, the errors and the screenshots.
2. **Fast after the first use.** Today the browser installs itself again on every call, which takes 1–2 minutes. The new browser stays open for the whole task: the first use takes about a minute, every next use takes a few seconds. It shuts down when the task ends or after 10 quiet minutes.
3. **Tests your newest edits.** If the agent changed files that aren't published yet, the browser opens a private one-time preview link of the current files (the same private link the screenshot camera uses). Otherwise it opens the published site.
4. **Who looks at the screenshots:**
   - 🦙 Ollama on: the pictures go straight to your Ollama model on your PC.
   - OpenRouter: the pictures go to the build model if it can see images, otherwise to your selected OpenRouter image reader, which writes back what it sees.
5. **Never cut off.** Long browser runs keep the work alive, so the task isn't restarted halfway.
6. **No looping.** The existing "same failure twice, change approach" rule also covers the browser.

## What stays the same
- Plan = Cloudflare only. Build and Image build = OpenRouter, or Ollama when 🦙 is on.
- The official "visual check" before saying "done" still uses your ScreenshotOne key that's turned on in Admin → Brain. The new browser's screenshots are for the agent's own testing in between.
- The agent still can't delete saved keys, and it never sees key values.

## Cost and limits
- The browser runs on your E2B account (the key already saved in Admin → Integrations). Each task uses one browser for a few minutes of E2B time.
- Each browser call is limited to about 3 minutes and 40 steps, so one bad step can't hang a task. There's no limit on how many times the agent uses it in one task.
- Only public https addresses and the project's own private preview can be opened. Nothing inside Code Haven's own servers.

## Technical details
- `src/lib/integration-keys.server.ts`: split `e2bRunCode` into `e2bCreateSandbox` / `e2bExecute` / `e2bKill` so one sandbox can be reused; keep `e2bRunCode` unchanged for existing callers.
- New `src/lib/browser-session.server.ts`: per-job sandbox cache (job id → sandbox id + access token, stored on the job row so resumed jobs reuse it), lazy Playwright install once, idle kill after 10 min, killed at job finish.
- New pure `src/lib/browser-steps.ts`: zod schema for steps (`goto`, `click`, `fill`, `press`, `select`, `scroll`, `wait_for`, `viewport`, `screenshot`, `read_text`, `read_logs`), URL safety (reuse `isBlockedUrl`), step/size caps, and the Python step-runner generator. Unit tests for schema, caps, URL blocking and the generator.
- `src/lib/agent-tools.server.ts`: add `browser` tool (Build/Image build/Ollama only; excluded from `readOnly`), using `withKeepAlive`. Screenshots uploaded to the private `browser-checks` bucket and logged as trace phases with thumbnails.
- Preview target: mint a hashed short-lived preview token from current project files (existing `preview_tokens` flow) when files changed since last publish.
- `src/routes/api/public/chat.ts`: pass job id to the tools; feed screenshot images back as image parts to vision-capable models (Ollama in 🦙 mode), otherwise through the existing OpenRouter vision reader.
- `src/lib/chat-agent.server.ts`: prompt tells the agent when to use `browser` (reproduce a bug, test a flow after edits) and to fix what it finds.
- `read_site_logs` becomes a thin wrapper over the same session so it's fast too.
- AGENTS.md: one rule for the reusable per-job browser sandbox.
