# Code Haven Chat — an Ollama helper that talks, and sends edits to Cloudflare only after you approve

## What you'll get
1. **Chat icon on the home menu.** Tapping it opens a **Chats** page like your screenshot: a list of saved chats (title, "5 hours ago", project chip, files chip), a search button, a "..." menu per chat (rename, delete chat), and a **New chat** button.
2. **Chat box.** You type like you do here. Answers come from your **Ollama** keys only — never Cloudflare while you're just talking.
3. **Ollama keys and models.** A small settings sheet in the chat: add as many Ollama keys as you want (saved in a separate place, not the Brain and not AI Models), tap **Load models** to list what each key offers (nemotron etc.), pick one, tap **Initialize**. If a key fails, the chat shows the error and you can pick another key.
4. **Plus (+) menu** in the chat box, same as your screenshot but without Connectors:
   - **Projects** — pick a project from your history. The chat reads its files, saved notes and recent builds, then says "Ready — I know this project."
   - **Chats** — jump to another saved chat.
   - **Your files** — pick files already in the selected project to talk about.
   - **Attach files** — attach images/files from your phone.
   - A search box at the top filters the menu.
5. **Read-only knowledge.** The chat knows how Code Haven works (Brain rules, skills, saved key names in the Admin vault, your projects). It can **read** everything but can **never** write, change or delete anything in Admin or the vault, and never edits a project by itself.
6. **Edit with approval.** When you ask for a change, the chat replies with a card: "This edit will use your Cloudflare balance. Proceed?" with **Yes** / **No** icons.
   - **No** → nothing runs.
   - **Yes** → the edit is sent to the project's normal Cloudflare build (same key pool, 9k handoffs, ledger). The chat shows live progress: "Editing files now with Cloudflare… I'll tell you when the files are done", then "Typechecking…".
7. **Report back.** When Cloudflare finishes, the chat receives the build's call log and changed files, and Ollama sends you a plain summary: what was edited, which files, Neurons used, and whether the typecheck passed. The full work log stays expandable under that message.
8. **Chats stay forever.** Every chat, message, approval and report is saved in your database, synced across your devices, and kept until you delete it. Single-user (you only).

## What won't change
- No home menu labels are renamed.
- Cloudflare pool rules, Admin, Brain, and existing project editor stay as they are.

## Technical details
- New tables (owner-only RLS): `assistant_chats` (title, project_id, ollama key/model, updated_at), `assistant_messages` (role, content, parts jsonb, created_at), `assistant_edit_requests` (chat_id, project_id, prompt, status pending/approved/declined/running/done/failed, chat_job_id, report jsonb), `ollama_keys` (label, base_url default `https://ollama.com/api`, key_encrypted via existing secrets-crypto).
- Routes: `src/routes/_authenticated/chats.index.tsx` (list), `chats.$chatId.tsx` (thread page; threads + database).
- Server: `src/lib/assistant.functions.ts` (CRUD, list Ollama models, init context) and a streaming route `src/routes/api/public/assistant.ts` (verifies the user session) calling Ollama's OpenAI-compatible `/v1/chat/completions` with the stored key. A hard guard rejects any Cloudflare base URL on this path.
- Read-only context tools for Ollama: list_projects, read_project_files, read_file, read_brain, list_vault_names (names only), read_recent_jobs, propose_edit. `propose_edit` only creates a pending edit request; it never starts a build.
- On Yes: server creates the build through the existing chat job pipeline for that project, links `chat_job_id`, and the chat page polls `chat_jobs` progress. On finish, the job's trace + changed files are handed to Ollama to write the summary message.
- Home menu: add a Chat icon to the existing bottom/home nav in `src/routes/_authenticated/index.tsx`.
- Tests (mocked, no live calls): Cloudflare URL is refused on the chat path; propose_edit never starts a build without approval; read-only tools have no write/delete; declined requests never create a job.
- No live Ollama or Cloudflare calls during build or tests.
