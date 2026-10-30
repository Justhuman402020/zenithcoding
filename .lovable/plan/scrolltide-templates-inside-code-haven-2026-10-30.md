# Scrolltide templates inside Code Haven

## Goal
Connect your Scrolltide yearly account once, then find and use its templates inside Code Haven without copying rebuild prompts. This plan adds access to Scrolltide; it does not change your saved models, build engines, owner-only sign-in, existing menus, or other integrations.

## 1. Connect once
- Add a **Scrolltide** section in **Admin → Integrations & API keys**, separate from Brain credentials and AI Models keys.
- Tap **Connect Scrolltide**, sign in on Scrolltide, and approve access. No API key to paste.
- Show Connecting, Connected, or a clear failure with Retry. Provide Reconnect when authorization genuinely needs renewal, and an owner-controlled Disconnect confirmation.
- Save the connection securely so it follows your account across devices. A temporary network failure must not erase it or sign you out of Code Haven.

## 2. Find templates without leaving your project
- Add a **Scrolltide templates** icon beside the project chat controls, without restoring or renaming any existing plus-menu items.
- Open a searchable template panel that works on your phone and desktop, with loading, empty, and error states.
- Search by what you want: for example, “animated portfolio,” “pricing section,” or “product hero.”
- Show the names, descriptions, categories, and previews that Scrolltide actually supplies. Load more results when its tools support pagination. Do not invent screenshots or promise a complete downloadable catalog.
- Each result has **Details**, **Open on Scrolltide**, and **Use template**. Details loads the entitled rebuild instructions on demand rather than fetching the entire library upfront.
- Also support requests in project chat such as “Find Scrolltide portfolio templates.” Searching and reading return results; they never start a build.

## 3. Use a template with approval
- **Use template** fetches its real rebuild instructions and saves a project-linked draft containing the template identity, source, and instructions.
- Let you add your own requirements, such as your brand name, colors, or sections to keep.
- Show what will be applied before the existing **Deny / Approve** build card. Deny leaves project files unchanged; Approve sends the saved draft and your requirements through the existing approved build workflow.
- Planning stays on Cloudflare under your existing pool/approval rules. Builds retain your selected OpenRouter model; no silent model change or fallback to another engine.
- Choosing a template does not automatically invoke image generation or a vision model. Any actual image work keeps the existing Image build safeguards.

## 4. Keep the template and work history
- Record the selected template, source, draft, approval, and build result in persistent project/chat history.
- Show template lookup and retrieval in the work timeline; show actual file edits and checks in the existing saved build log.
- Save the approved template brief in the durable job payload before dispatch. Screen-off builds and retries must reuse the same brief rather than lose it, fetch it again unnecessarily, or create duplicate builds.
- Report partial work and failures honestly. A template fetch is not a completed build.

## 5. Respect your subscription
- Scrolltide’s official guide currently states **up to 40 different items in any 24 hours**, shared with copies on its website; reopening an already opened item does not count again.
- Browse search summaries first and fetch full instructions only when requested. Do not bulk-fetch the library to bypass the allowance.
- Show authoritative allowance information if the service supplies it; otherwise show its published policy, not a guessed remaining counter.
- Surface expired-plan, permission, allowance, and connection errors clearly. Never replace an inaccessible template with invented content.

## Technical implementation
- Use the AI SDK runtime MCP client (`@ai-sdk/mcp`), not Lovable chat connectors or Code Haven’s own hosted MCP server. Connect to the official remote HTTP endpoint: `https://www.scrolltide.co/api/mcp`.
- First authenticate and inspect the server’s advertised tool schemas. Use the actual search/detail tools and returned fields; preview availability, filters, pagination, and exact tool names remain to be verified after your consent.
- Add focused modules under `src/lib/runtime-mcp/` for the Worker-safe fetch adapter, OAuth provider, encrypted connection storage, and bounded Scrolltide operations. Keep server-only helpers in `*.server.ts`; add authenticated operations in `src/lib/scrolltide.functions.ts`.
- Use the SDK’s OAuth flow with PKCE and dynamic client registration/client metadata as supported. Add `/api/public/mcp/scrolltide/callback` and `/.well-known/oauth-client` server routes. Validate single-use, expiring OAuth state bound to the initiating owner and exact allowed return origin; reject invalid/replayed callbacks. Callback handling must not depend on an open popup or expose tokens.
- Preserve existing owner admission and bearer middleware in `src/start.ts`. Authenticated server functions use the current session. Raw `/api/public/chat` calls separately verify the owner and project access; trusted resume calls retain their existing validation.
- Store connection metadata scoped to the owner and OAuth secrets encrypted in server-only storage using the existing Web Crypto helper. Keep connection states, timestamps, token expiry, and registration data durable. New tables include explicit grants, RLS, and restrictive access; browsers receive safe status only.
- Add project-scoped template drafts with source, fetched brief, user requirements, approval state, and an idempotent build reference. Enforce ownership and approval on the server before dispatch/resume.
- Add `ScrolltideConnection` and `ScrolltideTemplates` UI components; integrate them with `admin.integrations.tsx`, `p.$projectId.tsx`, and the existing build-approval/work-log components. Extend `chat.ts` and recovery payload handling only where template tools or persisted approved context are needed.
- Expose only the entitled, read-only Scrolltide search/retrieval capabilities to the agent. Load tools on explicit Scrolltide use, namespace them, and close MCP clients after operations/streams and on failure or cancellation. Use tool deferral if the actual catalog is large.
- Treat remote rebuild prompts as design input, not permission to override security, reveal credentials, change Admin, or execute unrelated instructions.
- Add the Worker-compatible `pkce-challenge` browser-build alias to the existing Vite configuration while preserving all plugins. Leave Code Haven’s own `/mcp` server unchanged.

## Checks before calling it finished
- Automated checks: owner-only connection access; invalid/expired/replayed OAuth state; encrypted storage and safe returned fields; Deny causes no build; Approve launches once; saved template context survives retries; lookup questions do not dispatch builds; terminal access errors do not loop.
- Verify the real signed-in flow: connect → approve on Scrolltide → search → inspect one entitled template → reload and confirm connection/draft remain → approve a build → confirm files and saved log through the UI.
- Verify phone and desktop layouts, disconnected/error states, and a build continuing after the browser closes.
- Your Scrolltide sign-in/consent is required for real account verification. Any real Cloudflare or image-model test needs your separate explicit spending approval; plan approval alone does not authorize those calls.
- If a live check cannot run, name exactly what remains unverified. Republish after implementation for the updated hosted connection/callback and background workflow; this plan does not publish or build anything.

## Expected experience
**Connect once → search in Code Haven → choose a template → add your requirements → Approve → see the finished changes and saved work log.**