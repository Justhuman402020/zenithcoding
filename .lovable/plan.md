# Code Haven model controls, project entry modes, and branding

## What will change

### 1. Two lightning model controls above project chat
- Add two compact lightning buttons beside the existing chat status controls, without shifting the mobile layout.
- **Vision lightning:** list only currently working image-capable models, grouped by saved key name/number. Include refresh, selected-for-next-image state, and a 3-second visible failover countdown.
- **Coding lightning:** list saved Cloudflare keys and the working coding model assigned to the pool; allow a manual coding choice while preserving the existing Auto-off rule.
- Refresh will re-test availability, immediately hide failed models from the active list, and mark them unavailable without deleting the saved key.

### 2. Vision planner → Brain → Cloudflare boss flow
- Split image work into two stages: the selected vision model first produces a compact, structured visual brief; Cloudflare Qwen then receives that brief and performs the actual file edits.
- The brief will cover layout, spacing, colors, typography, visible text, components, and responsive structure.
- Save visual briefs separately from the user’s own Brain notes, and show the latest briefs in the Brain tab.
- Keep exact `@asset` URL enforcement so requests such as “replace this with @logo” write the saved asset URL into the project files.
- If a vision model cannot interpret the image, complete a visible 3-second handoff to the next working vision model and continue without charging the failed model as a successful result.

### 3. Admin Cloudflare model management
- Add a Cloudflare pool model section in **Admin → AI Models**.
- Discover models per saved Cloudflare key and probe them before showing them.
- Offer only working free-tier coding models suitable for the current pool, including supported Qwen and GLM-4 choices; exclude known-bad or inaccessible models such as GLM 5.2.
- A single admin selection changes the coding model across every Cloudflare key while retaining ordered key failover, 9k handoffs, Neuron accounting, and Auto-off manual locking.
- Store global coding and vision preferences in the backend and expose authenticated read-only picker data to the editor.

### 4. New-project Plan, Build, and ZIP entry icons
- Add the three entry icons to the **home new-project prompt**, as chosen.
- **Plan:** create/open the project in chat Plan mode, generate a complete numbered plan with an estimated Neuron range, and show Read/Approve controls. Approval switches that project to Build mode automatically.
- **Build:** create/open directly in Build mode with the existing timer, live Neuron meter, pause/stop/send behavior, cross-device progress, and a final time/credit/Neuron summary.
- **ZIP:** open a project-import surface with code files, image gallery, upload/download actions, and an editable short “what this site is about” explanation saved as the project description/Brain context.

### 5. Twenty starter options on the home prompt
- Replace the small current starter set with 20 concise, useful project ideas beneath the new-project prompt, matching the screenshot’s pill treatment.
- Organize them into clean, horizontally scrollable/mobile-safe groups such as Business, Store, Portfolio, Community, and Tools.
- Tapping one fills the prompt; it does not submit until the user chooses Plan or Build.

### 6. Code Haven identity and purple F icon
- Replace visible Forge/old site branding in headers, sign-in, project dashboard, editor labels, manifest, and route metadata with **Code Haven**.
- Use a clear description: “Code Haven is an AI coding workspace for planning, building, importing, editing, previewing, and publishing web projects.”
- Create a simple purple **F** brand mark and derive favicon, app icons, and the visible header mark from it.
- Keep legacy internal names that published projects rely on (`forge-sdk.js`, storage keys, environment variable names, and injected globals) unchanged for compatibility.
- Add unique Code Haven title, description, Open Graph title/description, type, and Twitter card metadata to every content route that needs it; remove the unrelated root share image rather than advertising a mismatched image.

## Technical details
- Add focused server functions for editor-safe model lists, model refresh/probing, and saved Cloudflare pool preferences; admin mutations remain server-authorized.
- Extend Cloudflare discovery to classify coding versus vision-capable models per key and bypass the five-minute cache on explicit refresh.
- Preserve these routing invariants: Auto off uses only the manually selected model; client disconnects never trigger failover; Cloudflare pool failover remains server-side; 9k handoffs finish the current step first.
- Add backend storage for pool model settings and visual briefs with grants and row-level access in the same migration.
- Extract the new picker and home-entry UI into small components rather than expanding the large editor route further.

## Verification
- Test model refresh, manual selection, failed-vision 3-second handoff, visual brief persistence, and exact `@handle` insertion.
- Test Plan approval → Build transition, ZIP entry/import/export, 20 starter pills, and final job summary.
- Verify desktop and narrow mobile layouts with no overlap or layout shift.
- Run relevant tests, inspect the preview, and confirm the latest build/runtime logs are clean.
