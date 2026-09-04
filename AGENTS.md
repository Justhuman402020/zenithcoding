<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in the
> editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Base44 Dev Environment

## Stack
- **Runtime**: Bun (`oven/bun:1.2` in Docker) — do NOT use npm/node directly; `bun.lock` is the lockfile.
- **Framework**: TanStack Start (SSR via nitro) + Vite 8 + React 19.
- **Vite config**: wrapped by `@lovable.dev/vite-tanstack-config` — do NOT add `tanstackStart`, `viteReact`, `tailwindcss`, `tsConfigPaths`, or `nitro` plugins manually (they're already included). Pass extra Vite config via the `vite` key in `defineConfig()`.
- **Backend**: Supabase (hosted at `ylqwyhifwhksntnmodzc.supabase.co`). No local DB — all data is in the remote Supabase project.

## Running
```sh
docker compose -f docker-compose.base44.yml up -d
```
- Dev server: `bun run dev --host 0.0.0.0 --port 3000` (Vite live-reload, bind-mounted source).
- Health check: `curl -sf http://localhost:3000/`
- Logs: `docker compose -f docker-compose.base44.yml logs -f web`

## Environment
- `.env` (in repo) holds the **publishable** Supabase keys — enough to boot and render the auth page.
- `/run/base44/app.env` (platform-managed, outside repo) holds server-side secrets. See `.base44/environment.json` for the full list.
- `SUPABASE_SERVICE_ROLE_KEY` is the most important secret — without it the app boots but all authenticated server-side operations (credits, billing, projects, admin) fail.

## Key files
- `src/server.ts` — SSR entry (wraps TanStack Start's server-entry with error handling).
- `src/start.ts` — TanStack Start config (registers Supabase auth middleware).
- `src/integrations/supabase/client.ts` — client-side Supabase (publishable key, lazy proxy).
- `src/integrations/supabase/client.server.ts` — server-side Supabase (service role key, lazy proxy).
- `src/routes/_authenticated/route.tsx` — auth guard; `ssr: false`, redirects to `/auth` if not logged in.
- `vite.config.ts` — `allowedHosts: true` added for the Base44 preview proxy hostname.

## Quirks
- `bunfig.toml` enforces a 24h release-age guard (`minimumReleaseAge = 86400`) with excludes for `@lovable.dev/*` packages.
- The `_authenticated` route group has `ssr: false` — pages render client-side only.
- Supabase clients are lazy Proxies: they throw only on first access, so the app boots even with missing server-side keys.
