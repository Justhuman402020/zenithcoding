## Pure Gold — premium Lovable-style rebuild

A two-part job: a new design foundation everywhere, then four Lovable-feature passes inside the editor.

### Part 1 — Design foundation (touches every screen)

Reset the visual system to Noir & Gold + Instrument Serif / Work Sans, then re-skin each surface against it. Nothing functional changes here — just the look.

**Design tokens (`src/styles.css`)**
- Background `#0a0a0a`, surfaces `#171717`/`#1f1f1f`, foreground `#f5efe1`, muted `#8a8275`.
- Primary `#c9a84c` (pure gold), primary-glow `#f0d78c`, accent `#e6b948`.
- Border `rgba(201,168,76,0.18)`, ring `#c9a84c`.
- Gold gradient + soft "candlelight" shadow tokens reused across cards, buttons, badges.
- Fonts: Instrument Serif (display) + Work Sans (body), loaded via `<link>` in `__root.tsx` head.

**Re-skin pass (no logic changes)**
- `src/routes/__root.tsx` — fonts, favicon meta, OG image tag.
- `src/routes/auth.tsx` — split-screen: gold serif headline + Google + email; remove generic Sparkles.
- `src/routes/_authenticated/index.tsx` — premium hero composer, gold project cards, sidebar in noir.
- `src/routes/_authenticated/p.$projectId.tsx` — gold-trimmed chat rail, dark editor chrome, status pills.
- `src/routes/s.$slug.tsx` — published shell: subtle gold "Made with Forge" badge.
- Replace `Sparkles` brand icon with a generated gold "Forge" mark in `src/assets/`.

### Part 2 — Lovable-grade feature polish (editor only)

**A. Chat polish (thinking + tool calls + diffs)**
- Install AI Elements: `conversation`, `message`, `prompt-input`, `shimmer`, `tool`, `reasoning`.
- Replace the hand-built transcript and composer with AI Elements primitives.
- Render `reasoning` parts using `Reasoning` component (collapsible "Thought for Xs" — server already streams `sendReasoning: true`).
- Render file-edit tool calls (a new `editFile` tool exposed to the model) as `<Tool>` cards with a compact unified diff preview (added/removed line counts + first 6 lines, expandable).

**B. Live preview + device switcher + console**
- Add a top bar above the iframe: Mobile (390) / Tablet (768) / Desktop (full) toggle, refresh, open-in-new-tab.
- Capture iframe `console.*` + `window.onerror` via a tiny preload script injected into the served HTML; pipe to a collapsible Console drawer with level filters and clear.

**C. Versions / history + restore**
- Auto-snapshot to `project_snapshots` on every successful AI edit (label = first user prompt of the turn).
- New "History" panel: timeline of snapshots, file-count diff vs current, "Restore" (replaces files transactionally) and "Preview" (read-only diff).

**D. Publish + custom domains + share**
- Finish `DomainsPanel`: live DNS verify polling already exists — add status pill colors, copy-to-clipboard for A/TXT records, plain-English newbie helper text per step.
- Publish dialog: visibility toggle (public/private placeholder), gold "Live" pill, share-card preview, copy link button, QR code.

### Out of scope (call out, don't build)
- GitHub two-way sync (token storage exists; push-on-edit deferred).
- Remix/fork another user's project.
- Project secrets UI.

### Technical notes
- TanStack Start + Tailwind v4 + shadcn already in place — no framework swap.
- All color tokens go through `@theme inline` in `src/styles.css` so existing shadcn classes (`bg-primary`, `border-border`) re-skin automatically.
- AI Elements installed via `bun x ai-elements@latest add conversation message prompt-input shimmer tool reasoning`.
- New `editFile` server tool will use the existing `files` table + RLS — no schema change needed.
- One new migration: add `snapshot_after_message_id` column to `project_snapshots` so the History panel can map snapshots back to chat turns.
- No new secrets. Existing GitHub OAuth + Lovable AI Gateway keys cover everything.

### Approximate file footprint
- ~3 new components (DeviceSwitcher, ConsoleDrawer, HistoryPanel).
- ~2 new server functions (snapshot create/list/restore, editFile tool).
- Edits to 6 existing routes + `styles.css` + `__root.tsx` + chat API route.

### Order of execution
1. Tokens, fonts, gold logo, root head.
2. Auth + landing/dashboard re-skin (so the user sees the new identity immediately).
3. Editor re-skin + AI Elements swap + reasoning/tool UI.
4. Device switcher + console drawer.
5. History panel + auto-snapshots.
6. Publish/domains polish.
