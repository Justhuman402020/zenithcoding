# Use Cloudflare for a project's AI chat

## What you'll get
- **Admin → Projects with Cloudflare** (new tab in Admin): a list of every project you own, each with a **Use Cloudflare for this project** switch and a status: Off / Setting up / On / Needs fix.
- The same switch also appears in each project's settings, so you can turn it on while you build.
- When you tap it, Code Haven:
  1. Gives the project its own private, project-only Cloudflare connection. Your actual Cloudflare keys stay inside Code Haven and are never copied into the project's code.
  2. Starts a build approval card like your normal ones ("Switch this project's AI chat to Cloudflare"). You tap **Approve** and the agent finds the chat code and rewires it to go through Cloudflare. If the project has no AI chat yet, it adds a simple one.
  3. Runs a real test message after the build and shows On (with the reply) or Needs fix (with the reason).
- Turning it off stops that project's Cloudflare access right away. The project's code isn't changed, so its chat just shows "AI is off".
- New projects: when you ask for an app with AI chat, the agent first asks "Use Cloudflare for this project?" (Yes / No) instead of guessing.

## Rules kept
- Plan still uses Cloudflare only, and Build and Image build still use OpenRouter only. This switch only affects the AI chat inside the site being built.
- Your existing key pool is reused: same order, 9k handoff, 9.5k guard, and usage is recorded in the same Neuron ledger, labelled per project.
- The pool's "Off by default" setting is respected: if the pool is off, the switch explains that and won't turn on.
- No key is ever shown, copied into prompts, or deletable from chat.
- No live Cloudflare call is made in tests, and the real test message only runs after you tap Approve.

## Technical section
- New table `project_ai_settings(project_id, user_id, cloudflare_enabled, status, last_error, last_checked_at)` with owner-only access rules.
- New public endpoint `/api/public/sites/ai/chat`, called by published and preview sites. It identifies the project by a signed per-project token (stored as a project secret `CODE_HAVEN_AI_TOKEN` plus its URL `CODE_HAVEN_AI_URL`), checks that the switch is on, picks a pool key through the existing cf-pool-policy rules, sends the request to Workers AI with streaming, and records it in the ledger.
- A per-project request size cap (simple counter), since the endpoint is public.
- Pure helper `src/lib/project-ai-policy.ts` for the on/off and pool-off decisions, with unit tests.
- Agent prompt and tool: a `use_code_haven_ai` instruction block that rewrites the chat code to `fetch(CODE_HAVEN_AI_URL)` with the token, without flattening the project.
- Admin UI: a new section in the existing Admin area plus a toggle in project settings; uses the existing BuildApprovalDialog for the approval step.

## Open question
- Which Cloudflare model should project chats use by default? Unless you choose, I'll use the fast default model your Plan already uses, and you can change it per project.
