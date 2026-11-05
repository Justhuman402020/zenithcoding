# Automatic screenshots and reliable Cloudflare project chats

## What is wrong now
- Screenshot capture exists, but its permission is tied to a narrowly classified approved edit. That can produce the “unverified / approved capture build” message in your screenshot even when inspection would help.
- Project-site Cloudflare chat currently moves straight to another key on temporary failures, treats every 429 as daily exhaustion, and updates usage without a safe shared reservation. It also records usage through two paths that can double-count or race. This is not the four-retry, cross-project workflow you requested.

## 1. Screenshots when they are needed—without asking again
- Automatically inspect the actual preview for new visible pages, layout/theme changes, image or navigation changes, imported ZIP previews, and blank/broken previews. Also allow read-only preview diagnosis without needing an edit approval first.
- Skip screenshots for ordinary conversation, model selection, and changes that do not affect what the site displays.
- Capture the existing page before relevant repairs, and capture the rebuilt page after edits. For new pages, start with the first runnable preview. The image reader receives the actual screenshots, not just a description or source code.
- Put a compact screenshot thumbnail in the original chat work card. Tapping it opens the saved screenshots and findings in the existing Timeline/Details view; old checks remain available after reload. Do not cover the whole screen automatically.
- Feed visible problems back to the coding agent and recheck within the existing three-round limit. A stale screenshot, failed capture, or missing image-reader result cannot count as a verified pass.
- Save and show the real blocker if capture fails—such as an unreachable preview, browser permission, service rate limit, or unavailable image reader. If capture succeeds but inspection fails, still show the screenshot.
- Approval of this plan authorizes necessary automatic screenshot captures and image inspection during the owner's requested work, within that limit. These checks may consume Cloudflare browser allowance and OpenRouter image-reader credit. Keep your selected image reader; do not silently switch models.
- Keep approval for file-changing builds and publishing unchanged. Permission to look is not permission to edit or publish.

## 2. One shared Cloudflare key line across enabled projects
**Scope: only site AI requests from projects with “Use Cloudflare for this project” turned on.** This does not change Code Haven's main Plan/Build engines, Ollama, NVIDIA, OpenRouter, Brain keys, or domain connections.

- Keep key order **1 → 2 → 3 … → 60** and your selected Cloudflare model.
- Remember shared daily usage and temporary availability in Lovable Cloud, not separately in each project's browser.
- Example: Project 1 uses up keys 1 and 2. Project 2's next request sees that saved state and starts with key 3—not key 1 again.
- Preserve the **9,000-Neuron handoff** and **9,500 safety guard**. Reserve estimated request usage atomically before starting so two projects cannot both spend the same remaining allowance. Reconcile actual reported usage when available, and clearly label estimates rather than claiming an exact provider guarantee.
- Daily exhaustion clears at **00:00 UTC / 01:00 Lagos**. Temporary cooldowns expire separately; a temporary failure is not labelled “used up for the day.”

### Retries and automatic handoff
- Interpret “retry 4×” as **the first attempt plus four retries**, then move to the next eligible key automatically for recoverable failures.
- Respect the provider's waiting time and use increasing delays; never hammer a throttled key. Save attempt count and next retry time so screen-off or refresh does not restart the retry counter.
- Confirmed daily quota exhaustion skips directly to the next eligible key. Temporary rate limits and recoverable failures follow the retry policy.
- Invalid credentials, permission denials, payment restrictions, invalid requests, and model/content refusals show their real error rather than cycling through keys to bypass the rejection.
- Never delete or replace a saved key. Show safe key numbers, reasons and retry status, never credential values.

### Recovery without duplicate work
- Persist each request's identity, selected model, progress and a single active execution lease. Interrupted eligible work resumes automatically from its saved state, without asking for another key approval.
- Bound retries per key and each recovery pass. When every key is exhausted or cooling down, save a waiting state with the next eligible time rather than running an endless loop.
- Continue healthy streams. Keep partial replies on interrupted streams and do not blindly replay an inference with an unknown outcome; reconnect to saved progress first. Do not duplicate completed answers or restart a still-running request.
- Turning off the project's switch or the global Cloudflare pool prevents further provider attempts, including queued retries.
- Preserve the existing project daily request cap; retries belong to the same request, while each actual provider attempt retains its own usage record.

## Technical implementation
- Replace keyword-only screenshot approval with a persisted task-scoped visual verification decision. Separate capture authorization from write authorization in the chat runner and `inspect_preview` tool.
- Use the existing browser capture, selected image-reader, private screenshot storage and work-log pages. Add real pre/post/recheck phase metadata, separate capture/inspection outcomes, and thumbnail links. Ensure post-edit findings enter the repair loop before the job is marked finished.
- Isolate project-site retries in project AI policy/server modules and the `/api/public/sites/ai/chat` surface. Avoid changing shared workspace retry behavior.
- Settle each provider attempt once through the existing ledger; remove the site's duplicate direct usage increment. Apply the same atomic switch/cap admission to the owner's test button. Validate provider addresses before sending credentials and bound request input before parsing.
- Add narrowly scoped shared cooldown/reservation and durable request records with explicit grants, RLS and privileged atomic operations. Keep the normalized Neuron ledger as the only inference event history.
- Use server-owned delayed recovery, request leases and idempotent completion—not browser timers or in-memory worker state. Authenticate recovery callbacks with server-only credentials; preserve project token checks and switch/cap enforcement.

## Verification before calling it finished
- Automated tests: necessary versus unnecessary screenshots; no separate capture approval; real before/after phase handling; failures never marked passed; three-round bound.
- Mocked pool tests: project 1 exhausts keys 1/2 and project 2 starts at 3; first attempt plus exactly four retries; quota versus temporary 429; cooldown expiry; UTC reset; simultaneous usage reservations; switch-off stops retries; denials do not waterfall.
- Recovery tests: screen-off reconnect, saved retry count, no duplicate worker, reply or usage entry, interrupted/unknown stream outcomes, all-keys-unavailable waiting state. Verify the deployed accounting trigger before relying on its totals.
- Signed-in phone and PC checks: screenshot thumbnail opens saved evidence without disrupting work.
- Run one owner-authorized real preview capture → image inspection → approved repair → fresh recheck. Confirm actual screenshots and findings read back through the chat/work log. Report service blockers honestly if that cannot complete; do not claim live verification from tests alone.

## Not included
No new NVIDIA mode, unrelated design changes, domain cleanup, automatic publishing, model replacements, or changes to projects whose Cloudflare switch is off.