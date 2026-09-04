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

## Base44 dev environment

- Run with `docker compose -f docker-compose.base44.yml up -d` (bun + vite dev,
  live reload via bind mount). The Lovable vite config **forces the dev server
  to container port 8080** — compose maps host 3000 → 8080 (the preview needs 3000).
- `vite.config.ts` sets `server.allowedHosts: true`: Vite 8 blocks unknown Host
  headers, and the preview proxy rewrites Host to a sandbox hostname. Don't
  remove it or the preview iframe 403s.
- Supabase public vars (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) come from the
  committed `.env` (loaded via compose `env_file`). Server-only secrets
  (`SUPABASE_SERVICE_ROLE_KEY`, `FORGE_*`, `GITHUB_OAUTH_*`, `STRIPE_*`) are
  platform secrets — all are **lazily** read, so the app boots without them, but
  template remix and admin features need the service-role key.
- Published sites serve from `/s/<slug>` (anon RLS on `published = true`),
  rendered by `src/lib/serve-published-site.server.ts`. The same module routes
  verified custom domains: `src/server.ts` checks the Host header against
  `project_domains` (verified) and serves the project from `/` — DNS must point
  at whatever machine runs this app (the IP shown in the domains panel is
  `185.158.133.1`).
- Publishing a non-buildable project (plain HTML, no package.json) must pass
  `null` artifacts to `finalizePublish` — the `files` table has
  `UNIQUE (project_id, path)`, so re-inserting source paths as `kind='build'`
  rows fails with a duplicate-key error.
