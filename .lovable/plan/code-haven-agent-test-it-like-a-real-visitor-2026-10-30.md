# Code Haven agent: "Test it like a real visitor"

## What you get
After a build, Code Haven's agent opens your site in a real browser, the way I just did for Selene. It then:
- takes phone and desktop screenshots, then scrolls down and screenshots again
- lists broken pictures, page errors and failed file loads
- if it finds problems, fixes them and checks again (at most 3 rounds, then it tells you why it stopped)
- shows the screenshots and findings in the work log card, under a new **Checks** tab

You can also type "test my site" or tap a new **Test** button by the preview to run it any time.

## Which address it opens
- **Preview**: a new private address for each test (good for 15 minutes) that shows your project exactly as the Preview tab does. No need to publish first.
- **Published site** (`/s/your-site`): opened as it is.
- Your own projects' sign-in pages: the agent only signs in with a test login you save in that project's Secrets. It never uses your Code Haven password.

## Where the browser runs
Cloudflare Browser Rendering, using your existing Cloudflare accounts (free daily browser time on each). It is a different allowance from Neurons, so your Plan/Build key rules stay the same. Each test is recorded in the usage log under "Browser test", with the time it took.

## Rules kept
- Plan = Cloudflare, Build/Image build = OpenRouter. Unchanged.
- Fixes found by a test follow the usual approval rules: no build without your Yes.
- No passwords or keys appear in chat, screenshots or logs.
- Nothing is removed.

## Technical details
- `src/lib/browser-check.server.ts`: calls the Cloudflare Browser Rendering REST API (`/browser-rendering/screenshot`, `/content`, plus a script step that collects `pageerror`, failed requests, and `img.naturalWidth===0`) with the pool's account ID and token. Results are stored in new table `browser_checks` (owner-only RLS); screenshots go in a private storage bucket.
- Preview address: `/api/public/preview/$token` renders the same document as `previewDoc` (built files + `injectPreviewAssets`). The single-use, 15-minute token is hashed in `preview_tokens`.
- A `run_browser_check` agent tool is added to the build loop's post-build checklist; its findings feed the existing repair cycles in `build-recovery.ts`.
- `WorkLogCard.tsx` gets a Checks tab. Tests cover token expiry, the 3-round limit and secret redaction, with no live calls.

## Needs from you
The Cloudflare tokens must have the **Browser Rendering – Edit** permission. If they don't, I'll show which accounts are missing it and give you simple steps to add it.
