# Give the Code Haven agent a real typecheck and a fuller toolbox

## What you'll get
- Before your agent says "done", it checks the code for type mistakes (wrong names, wrong props, missing values), not just broken links. If it finds any, it fixes them, up to 3 rounds, and tells you honestly if some remain.
- New tools so it stops getting stuck halfway through:
  1. **Search code**: find every place a word or name appears, instead of opening files one by one.
  2. **Read the site's errors**: see the preview's console errors and failed requests.
  3. **Open a web page**: read documentation or an API page, not just search results.
  4. **Run tests**: run the project's own test files when it has them.
  5. **Check the live site**: load the published or preview address and see whether it answers properly (status code, page title).
- A stall guard: if a tool fails twice in a row, the agent tries another way instead of repeating the same thing. If it truly can't continue, it ends with a clear "Not finished — here's why".
- Everything shows up in the work log, so you can watch each step.

## What stays the same
- Plan still runs on Cloudflare only. Build and Image build still use OpenRouter only.
- Screenshots still use only the ScreenshotOne key you turn on.
- The agent still can't delete or change your saved keys, and still can't read their values.
- Edits still need your normal approval.

## Honest limits
- I can't hand your agent my own computer. It gets the same kinds of tools, running inside Code Haven.
- The full typecheck takes a few extra seconds per build and only checks project code. Big outside libraries are checked more loosely, so a few rare mistakes can still get through.
- Running tests only works for tests written in the project's own files, because it can't install new add-ons.

## Technical details
- Typecheck: load the TypeScript compiler in Code Haven's server runtime and check the project's files in memory. Types for outside packages come from a small built-in set (react, react-dom, common libs); anything else is treated as "any". Results are file:line errors fed into the existing `check_build` repair gate (max 3 rounds). If the compiler is too heavy for the server limits, it falls back to the current link check plus the in-browser build when the editor is open, and says which check ran.
- New tools in `chat.ts` / `integration-tools.server.ts`: `search_code` (regex across project files, capped results), `read_preview_logs` (from saved preview-reporter findings), `fetch_url` (https only, size and time capped, blocks private addresses), `run_tests` (vitest-compatible runner using the existing in-memory sandbox `run_code`), `probe_url`.
- Stall guard: count repeated identical failing tool calls and push the model to change approach, reusing the existing look-only budget.
- Unit tests for search capping, URL safety blocking and the stall rule; AGENTS.md rule updated.
