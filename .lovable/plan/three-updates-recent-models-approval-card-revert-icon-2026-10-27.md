# Three updates: Recent models, approval card, revert icon

## 1. Recent models list (Settings & privacy)
A new **Recent models** section, newest first. Each row shows:
- Provider icon: OpenRouter icon for OpenRouter models; Cloudflare, Ollama, Google, Groq, etc. get their own icon; a plain icon if unknown
- Model name (exact ID, e.g. `nvidia/nemotron-3.5-super-vl`)
- What it did: **Plan**, **Build**, **Image build**, **Chat**, **Assistant chat**, **Skill**
- Reply time: time to first word and total time (e.g. "1.2s / 14s")
- When it ran ("3 min ago"), worked or failed (short reason), and the key number for Cloudflare rows

Filter chips at the top (All, Plan, Build, Image build, Chat, Skill) plus a small per-model summary: last used and average reply time. Read-only, only you can see it, keeps 30 days. It never calls a model, so it costs nothing.

## 2. Modern approval card (replaces "boostallsocial.org says")
A centered Code Haven card instead of the phone's built-in popup:
- **Code Haven** title with logo
- Same wording as today:
  - "Send this build to your selected OpenRouter model?"
  - "Send the image and text to your selected OpenRouter image model?"
  - "Use Cloudflare for this request? Yes approves Neuron usage."
- Small badge showing where it goes (OpenRouter, OpenRouter image, Cloudflare) with its icon
- Buttons: **Deny** (outlined) and **Approve** (filled)
- Rounded card, soft shadow, blurred background, smooth fade-in, uses your current theme, fits phones
- Approve sends the build exactly as now; Deny, tapping outside, or Back stops it. Other popups stay unchanged.

## 3. Revert icon
- A small revert icon (curved arrow) beside each successful build message in the project chat, plus one in the editor top bar for the latest build.
- Tapping it opens the same style of card: "Revert this project to the version saved before this build?" with **Deny** / **Approve**.
- Approve restores the files saved before that build, using the existing History copies. The revert gets logged in the chat. Nothing is deleted from History, so you can undo a revert.

## Technical details
- New table `model_call_log` (user_id, project_id, chat_id, provider, model, section, key_index, started_at, first_token_ms, total_ms, status, error_short), with grants, RLS select-own, service-role insert, and 30-day cleanup.
- One `recordModelCall()` helper called from `api/public/chat.ts`, assistant chat, and the skill runner. It's awaited but failure-tolerant, so it never blocks a build. `listRecentModelCalls` server function behind owner middleware. `RecentModels.tsx` and a pure `provider-icons.ts`.
- `BuildApprovalDialog.tsx` built on the existing alert-dialog, with a promise-based `requestApproval()`. It replaces the single `window.confirm` in `p.$projectId.tsx` (build approval), and the revert card reuses it.
- Revert uses the existing pre-build snapshot restore, keyed per build message.
- Tests: section classification, provider-icon mapping, and approve/deny resolution.
- No changes to models, engines, Cloudflare pool rules, or keys.
