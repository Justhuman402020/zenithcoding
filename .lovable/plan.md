## In-browser build pipeline for Forge

Add a client-side build step that runs before Publish and before Push-to-GitHub, so imported source repos (Vite/React/Vue/Svelte/TS/Tailwind) actually produce a working `dist/` instead of shipping raw source.

### Approach

Build runs in the user's browser using **`@bhwd/esbuild-wasm`** (esbuild compiled to WASM) as the bundler, plus a lightweight virtual-FS resolver over the project's `files` table. No server compute — fits Cloudflare Workers constraints. For unknown/Node-only packages we surface a clear error and fall back to pushing/publishing the source as-is (current behavior).

### Pieces to build

1. **`src/lib/browser-build.ts`** — new client module:
   - Loads `esbuild-wasm` lazily (dynamic import + `initialize({ wasmURL })` from CDN).
   - Virtual FS built from the project's files (path → content map).
   - Resolver plugin:
     - Relative/absolute paths → look up in virtual FS (with `.ts/.tsx/.jsx/.js/index.*` resolution).
     - Bare imports (`react`, `react-dom`, `@tanstack/*`, etc.) → rewrite to `https://esm.sh/<pkg>@<version>?bundle` using versions from the project's `package.json`.
     - CSS/`@import` handled by esbuild's `css` loader; Tailwind detected via `tailwindcss` in deps → run Tailwind in-browser via `@tailwindcss/browser` CDN script injected into the built `index.html` (pragmatic: avoids running the PostCSS pipeline in-browser).
   - Entry detection: read `index.html`, find `<script type="module" src="...">`, bundle that entry to `dist/assets/index-[hash].js` + `dist/assets/index-[hash].css`, rewrite `index.html` to point at the built assets, copy `public/*` verbatim.
   - Returns `{ ok: true, files: {path, content}[] }` or `{ ok: false, error }`.

2. **`src/components/BuildDialog.tsx`** — new UI:
   - Progress log (reuses same NDJSON-style event shape as `push-stream`).
   - "Build" / "Skip build & publish source" buttons.
   - On failure: show error + option to publish source anyway.

3. **Wire into Publish flow** (`src/routes/_authenticated/p.$projectId.tsx` — the publish button):
   - Detect "buildable" project: presence of `package.json` with a `build` script AND either `vite`, `react`, `vue`, or `svelte` in deps.
   - If buildable → open BuildDialog → on success, upload the produced `dist/*` files to a new `project_build_artifacts` table (or reuse `files` with a `kind: 'build'` column).
   - `/s/$slug` route: prefer built artifacts when present, else current behavior.

4. **Wire into Push-to-GitHub flow** (`GithubPushDialog.tsx` + `push-stream.ts`):
   - Before calling `push-stream`, run the same browser build.
   - If build succeeds, include `dist/` files in the push payload (send as `extraFiles` alongside `priorBlobs`).
   - Server route accepts optional `extraFiles: {path, content}[]` and adds them to the tree.
   - Skippable via checkbox "Push source only (no build)".

5. **DB migration** — add `kind text default 'source'` to `files` table, or add `project_build_artifacts` table with same shape as `files`. Simpler: add `kind` column; `/s/$slug` reads `kind='build'` if any exist, else `kind='source'`.

### Failure handling (per your "one that wouldn't fail" choice)

The build **will** fail on Node-only deps (sharp, fs, native modules). We handle it by:
- Catching the error, showing exactly which import failed.
- Offering a "publish/push source anyway" button that falls back to today's behavior.
- Never silently shipping a broken build.

### What's out of scope

- SSR frameworks (Next.js, Remix, TanStack Start source) — will fail-and-fallback. Detected up front with a warning: "This looks like an SSR app; in-browser build can't handle it. Publish source instead?"
- Custom Vite plugins that need Node APIs.

### Files touched

- **New:** `src/lib/browser-build.ts`, `src/components/BuildDialog.tsx`, migration for `files.kind`.
- **Edited:** `src/routes/_authenticated/p.$projectId.tsx` (publish button), `src/components/GithubPushDialog.tsx`, `src/routes/api/public/push-stream.ts` (accept extraFiles), `src/routes/s.$slug.tsx` (prefer built artifacts).
- **Package:** `bun add esbuild-wasm`.

### Estimated size

Medium-large — ~600 lines across 3 new files + edits to 4 existing files. One migration.

Approve and I'll build it in one pass.