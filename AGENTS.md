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
