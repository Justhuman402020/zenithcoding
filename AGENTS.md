<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Base44 Dev Environment

### Stack
- **Runtime**: Bun (`oven/bun:1` image) + Vite 8 + TanStack Start (SSR via Nitro)
- **Package manager**: Bun (uses `bun.lock` and `bunfig.toml`)
- **Dev command**: `bunx vite dev --host 0.0.0.0 --port 3000`
- **Backend**: Remote Supabase (hosted at `ylqwyhifwhksntnmodzc.supabase.co`) — no local DB needed
- **Preview port**: 3000

### How it runs
- `docker-compose.base44.yml` bind-mounts the repo at `/app`, installs deps with `bun install`, and starts the Vite dev server with live reload.
- `node_modules` is a named volume (not bind-mounted) to avoid host/container conflicts.
- The `.env` file in the repo root has public Supabase credentials (publishable key) — sufficient for the app to boot and render.
- Vite `allowedHosts: true` is set in `vite.config.ts` so the preview proxy hostname works.

### Secrets (optional — app boots without them)
The app lazily loads these only when specific features are used:
- `SUPABASE_SERVICE_ROLE_KEY` — admin/server-side Supabase operations
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — billing
- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` — GitHub push integration
- `FORGE_ADMIN_SESSION_SECRET`, `FORGE_ADMIN_KEY` — admin panel
- `FORGE_SECRETS_ENCRYPTION_KEY` — AES-GCM encryption for project secrets (64-char hex)
- AI provider keys: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `GOOGLE_AI_STUDIO_API_KEY`, `CEREBRAS_API_KEY`, `DEEPINFRA_API_KEY`

### Verify it works
```sh
docker compose -f docker-compose.base44.yml up -d
curl -sf -H "Host: external-preview.example.com" http://localhost:3000/  # should return SSR HTML
docker compose -f docker-compose.base44.yml ps  # should show healthy
```

### Vite config note
`vite.config.ts` uses `@lovable.dev/vite-tanstack-config`'s `defineConfig`, which bundles all Vite plugins (tanstackStart, viteReact, tailwindcss, etc.). Do NOT add those plugins manually. Additional Vite config goes under the `vite:` key.

- Route image attachments through a dedicated vision-planner pass, persist its brief per project, then let the selected coding model edit files from that brief; this keeps image interpretation separate from code execution.
- Store the global Cloudflare coding model in the database so every pool key follows one admin-selected working free-tier model.
- Global agent rules and admin credentials live in service-role-only tables; the agent sees vault names only and copies values into project secrets via a tool, so raw keys never enter prompts.
- Cloudflare pool rules (order, quota vs rate-limit, 9k handoff, 9.5k preflight, run cap, counting, file validation) live as pure functions in src/lib/cf-pool-policy.ts; chat.ts only calls them — keeps every rule unit-testable without provider calls.
- Site themes are pure data in src/lib/themes.ts (SVG doodles + CSS vars applied on <html>); the saved choice lives in user_settings so it follows the owner across devices.
- Chat-approved Cloudflare edits are started by the database (pg_net via public.start_build_job) with the resume token, so the build is held open server-side and never depends on the phone staying online.
- Owner access is revalidated in app function middleware and restrictive session policies; never gate public published sites or signed provider callbacks with workspace access.
- The protected layout owns session admission; the root owner/device check redirects only on authoritative denial, never on transport errors, and public auth offers sign-in only to prevent accidental registration.
- An app-owned auth lifecycle trigger rejects non-owner registration before account creation, keeping the restriction enforceable beyond the sign-in page.
- Workspace planning/build configuration lives separately from manual model selection; approved jobs snapshot their engine/model and use the database starter so retries cannot change engines.
- All Workers AI inference steps use the normalized Neuron call ledger; aggregate key counters serve budget checks, not a second event history. Routing must never probe Workers AI with inference pings.
- OpenRouter capability and pricing labels come from authenticated catalog metadata, not name guesses; preserve API order and full details for build-key browsing.
- Image questions send the actual attachment to the declared vision model; file edits retain the dedicated vision brief pass and running jobs preserve their reader snapshot.
- Explicit editor Image build keeps original image parts alongside captions after the visual brief pass and locks the build-key image selection; editor mode headers survive server resumes.
- Before build inference, await durable recovery payload/timer registration and persist the actual model snapshot with all media; restart claims refresh the heartbeat and never reclaim finished or paused runs.
- Editor builds dispatch persisted input through a service-role-only database starter before returning to the viewer; the independent connection and existing recovery timer survive a phone disconnect.
- Auth event invalidation compares user identities so repeated same-user SIGNED_IN events on wake do not rerun the generated admission guard.
- Runtime Scrolltide MCP connections use server-only encrypted owner-scoped OAuth storage and SDK clients, separate from the app-hosted MCP server and saved key vaults; approved project drafts are persisted into job recovery before dispatch so template use survives disconnects without exposing credentials.
- Scrolltide OAuth uses exact project-owned return hosts and origin-bound client registrations; renew registration when the origin changes, preserve account tokens, and provide a sign-in link when popups are blocked.
- Scrolltide browsing reads public shelf summaries when MCP has no pagination; authenticated MCP handles search/retrieval, keeping full-library scrolling separate from paid prompts and approved builds.
- Scrolltide preview media loads when cards approach the visible library area and pauses offscreen; keep media rendering separate from template instruction retrieval to avoid blank video frames and unnecessary downloads.
