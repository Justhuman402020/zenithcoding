# Build check for the agent + Mobula's Cloudflare chat in every browser

## What I found
- Mobula's broken link is already repaired. Your agent added `cloudflareHost` back to the Cloudflare file at 09:53 Lagos time. Publishing should get past that error now.
- Code Haven's chat address for project sites already accepts requests from other websites, including the browser's pre-check request. So the address isn't what blocks other browsers.
- What's missing: your agent can't run the same build that Publish runs. It can't catch errors like this before you see them, and it can't confirm the site works in browsers other than Chrome.

## What I'll build

### 1. "Check build" tool for your agent
- It bundles the project on the server, the same way Build & publish does: same entry file, same automatic Vite/React setup.
- It returns exact errors, each with file, line and message (for example "No matching export … cloudflareHost").
- Rule: after editing a React/Vite project, your agent must run the check. If the check fails, it fixes the errors and checks again, up to 3 rounds. It can't say "done" while the build fails; it reports the remaining error instead.
- The work log shows "Build check passed" or the exact errors.

### 2. Cloudflare chat in every browser (Chrome, Safari, Firefox, Edge, Android, iPhone)
- The build targets older Safari/iPhone versions too, not only the newest Chrome.
- Mobula's Cloudflare file gets a backup for browsers that can't read a streamed reply (older Safari, some in-app browsers). They get the whole answer at once instead of a blank result.
- Clear messages when a browser blocks the request (an http address on a secure site, or private mode blocking it), instead of failing without explanation.
- Mobula's Health check button shows which browser was tested and whether streaming or the backup was used.

### 3. Screenshot note
- Your Microlink key has hit its allowance. Screenshot checks restart when it resets, or right away if you add a second key in Admin → Brain. No code change is needed.

## What stays the same
Plan stays on Cloudflare. Build and Image build stay on OpenRouter. Brain keys, domains, chat helper keys and saved keys are unchanged, and nothing deletes saved keys.

## Technical details
- New server tool `check_build` in the chat agent. It reuses the existing in-browser bundler logic (entry detection and `.code-haven-build/scaffold`) through esbuild-wasm running in the Worker. The build target is `es2019` / `safari13`.
- Runner policy: React/Vite edits without a passing `check_build` cannot end as "done". Bounded to 3 repair rounds. Tests cover pass, fail and the missing-export case.
- Mobula's `src/lib/cloudflare.ts`: if `response.body.getReader` is missing or fails, it falls back to `stream:false`. Errors are classified as `TypeError: Failed to fetch` vs. an http:// address on an https:// site.
