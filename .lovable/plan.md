# Your Personal Lovable-Style Workspace

A single-user AI coding studio: manage multiple projects, browse files, chat with AI to generate/edit code, see it run live in a preview pane. Dark theme with purple/violet accents.

## What you'll get

A web app with three main views:

1. **Projects dashboard** — list of all your projects, "new project" button, last-edited timestamps, delete/rename.
2. **Editor view** (per project) — three panels:
   - Left: file tree (create/rename/delete files & folders)
   - Center: AI chat + code editor (Monaco, same engine as VS Code)
   - Right: live preview iframe that runs your HTML/CSS/JS
3. **Settings** — pick AI model, manage projects.

## How it works under the hood (plain English)

- **Storage**: Lovable Cloud database stores your projects, files, and chat history. Survives refreshes and works from any device when you log in.
- **AI**: Lovable AI Gateway (no API key setup needed). You'll get Google Gemini models by default.
- **Live preview**: Your project files are stitched together in the browser and rendered in a sandboxed iframe — so a project is essentially `index.html` + JS/CSS files that the AI writes for you. Good for static sites, vanilla JS apps, and React via CDN.
- **Auth**: Since this is just for you, I'll add a simple login (email + password) so nobody else can access your projects from the public URL.

## Realistic scope — what's IN vs OUT

**In the MVP:**
- Multi-project CRUD
- File tree with create/rename/delete
- Monaco code editor with syntax highlighting
- AI chat that reads your file tree, writes/edits files, and explains code
- Live iframe preview for HTML/CSS/JS projects
- Dark Lovable-style theme (purple/violet)
- Single-user auth

**NOT in MVP (would need follow-up work):**
- Running full Node.js/npm projects in-browser (needs WebContainers — separate license)
- Real git integration / GitHub sync
- Database/backend per generated project
- Deploying your generated projects to the web
- Realtime collaboration

We can add any of these later.

## Cost to run (monthly, just you)

- **Hosting** (this app on Lovable): free on the Free plan if usage is light
- **Lovable Cloud** (database + auth + storage): ~$0–5/month at single-user usage — well within the free monthly allowance for most personal use
- **Lovable AI** (the AI that writes code inside your app): pay-as-you-go from your Lovable credits. Heavy daily use ≈ a few dollars/month; light use is essentially free thanks to the monthly allowance. Exact spend depends on how chatty you are.

**Realistic total: $0–10/month for solo, moderate use.** No external accounts, no separate OpenAI/Anthropic bill.

## Build order

1. Enable Lovable Cloud (database + auth + AI gateway)
2. Auth (email/password, just for you)
3. Database schema: `projects`, `files`, `chat_messages`
4. Projects dashboard route
5. Editor route with 3-pane layout (file tree / editor+chat / preview)
6. Monaco editor integration
7. AI chat wired to Lovable AI with tools for read_file / write_file / list_files
8. Live preview iframe (blob URLs from project files)
9. Polish: dark purple theme, animations, empty states

## Technical notes (skip if you like)

- TanStack Start + React 19 + Tailwind v4 (already set up)
- Monaco Editor for the code editor
- Lovable Cloud (Supabase) for DB/auth/storage
- AI SDK + Lovable AI Gateway, server functions for tool-calling
- Iframe sandbox with `srcdoc` built from in-memory file map for the preview

---

Approve this and I'll start building. Heads-up: this is a big build — I'll ship it in passes (auth + DB first, then editor shell, then AI wiring, then preview). You'll see something usable after each pass.
