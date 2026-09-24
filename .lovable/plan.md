# Saved backend for every project, Grok in charge, no Forge badge, 1-tap fixes

## What you'll get
1. **Every new project uses your saved backend** — signup, login, admin and saved data in built apps all go through the backend you saved on the Backend page. Nothing falls back to Forge's own storage when a backend is saved.
2. **Grok 4.6 (OpenRouter) leads builds** — whenever a request touches signup/login/admin/data, Grok 4.6 is used first; the other models are only backups if it is down. The agent is told the backend is already connected, so it never asks you to paste those details again.
3. **No "Made with Forge" badge** on published sites — removed from both the public link and custom-domain pages, for old and new projects.
4. **"Fix it" button** — when the preview shows an error or a build fails, a red card appears in the chat with one **Fix it** button that sends the error to the agent automatically.
5. **Agent remembers where it stopped** — after each job, a short "progress note" (what was done, what's left, last error) is saved with the project. Every new message starts by reading it, and a **Continue where you left off** button appears when work was unfinished.
6. **Backend badge on every project** — each project card and the editor top bar shows **Backend connected** (green) or **No backend** (grey). Tapping it opens a small window: paste address + public key (+ optional private key), **Test**, **Connect**. Works for already built and published projects too, and can override the saved default per project.

## Technical details
- Per-project backend: reuse `project_secrets` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`). New server fns `getProjectBackend`, `testProjectBackend`, `saveProjectBackend` (owner-checked, reuse `probe`). New `BackendBadge` component + dialog used in dashboard cards and editor header.
- Published sites (`s.$slug.tsx`, `render-site.server.ts`): inject `window.FORGE_SUPABASE = {url, anonKey}` and load supabase-js when the project has a backend; `Forge.auth`/`Forge.db` SDK routes to it. Remove the badge string.
- Chat (`api/public/chat.ts`, `chat-agent.server.ts`): if project has backend secrets, add system context ("use the connected backend via VITE_SUPABASE_URL/ANON_KEY, create tables/auth there, never ask for keys") and put the admin-selected OpenRouter Grok 4.6 model first in the chain for auth/data/admin intents (read from model settings, not hardcoded).
- Progress note: new column `projects.agent_progress jsonb` (migration), written on job finish/failure, injected into `buildProjectContext()`.
- Fix-it: capture preview `error` postMessages + failed tool/build results in the editor; render `FixErrorCard` that sends "Fix this error: …".
