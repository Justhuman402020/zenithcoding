# Recent models list in Settings & privacy

## What you'll see
A new **Recent models** section in Settings & privacy, showing the latest replies (newest first), each row with:
- Provider icon (OpenRouter icon for OpenRouter models; Cloudflare, Ollama, Google, Groq, etc. get their own icon; a plain icon if unknown)
- Model name (exact ID, e.g. `nvidia/nemotron-3.5-super-vl`)
- What it did: **Plan**, **Build**, **Image build**, **Chat**, **Assistant chat**, **Skill**
- How long it took to reply (time to first word and total time, e.g. "1.2s / 14s")
- When it ran ("3 min ago") and whether it worked or failed (with the short reason)
- Cloudflare rows also show the key number

Above the list: filter chips (All, Plan, Build, Image build, Chat, Skill) and a small summary per model — "last used" and average reply time.

The list is read-only. It only reads what already ran; it never calls a model and spends nothing.

## How it works
- Every model call already goes through one place on the server. Each one will save a small record: model, provider, type of work, start time, first-reply time, finish time, success/failure.
- Keeps the last 30 days; older rows are cleaned up automatically.
- Only you (the owner) can see it.

## Technical details
- New table `model_call_log` (user_id, project_id, chat_id, provider, model, section, key_index, started_at, first_token_ms, total_ms, status, error_short). RLS select own; insert service-role only; grants per rules.
- Write rows from `src/routes/api/public/chat.ts`, assistant chat, and skill runner via one helper `recordModelCall()`; awaited but failure-tolerant (never blocks a build).
- Server fn `listRecentModelCalls` (owner middleware) with section filter, limit 200.
- UI component `RecentModels.tsx` added to the Settings & privacy page next to Security; provider-icon map in a pure `provider-icons.ts`.
- Test: section classification (plan/build/image build/chat) and provider-icon mapping.
- No changes to model selection, engines, Cloudflare pool rules, or keys.
