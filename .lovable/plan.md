# Scrolltide icon on the home menu — use templates for new AND existing projects

## What you asked
A Scrolltide icon in the home slide-out menu. From it you can browse your Scrolltide library and use a template two ways: apply it to a project you already have, or create a brand-new project from it — so you can test one right away (e.g. with your selene zip as the reference).

## What I'll build

### 1. New menu item
- In the home slide-out menu, add a **Scrolltide** row with its own icon, right under **Templates**.
- Tapping it opens a new Scrolltide library page.
- If Scrolltide isn't connected, the page shows a short message with a button to **Admin → Integrations** to sign in and approve.

### 2. Scrolltide library page (`/scrolltide`)
- Full scrollable library + search bar — same browsing as the in-project library, nothing removed.
- Each card keeps its video preview, **Details**, and **Use template**.

### 3. Use template — two choices
When you tap **Use template**, a small chooser appears:
- **Create new project** — makes a fresh project named after the template, saves the template draft into it, and opens it so you can tap **Approve** to build. This is how you'll test one from scratch.
- **Add to existing project** — shows a simple list of your projects; pick one, the draft is saved there, and it opens so you can **Approve**.
- Same approval flow as today: nothing builds without your Approve.

### 4. Nothing else changes
- The library icon inside project chat stays as it is.
- The existing **Templates** menu row (GitHub gallery) stays unchanged.
- No changes to connection, keys, or build routing.

## Technical notes (for reference)
- Add a `SidebarItem` in `src/routes/_authenticated/index.tsx` linking to `/scrolltide`.
- New route `src/routes/_authenticated/scrolltide.tsx` reusing the existing `ScrolltideTemplates` browsing UI and `findScrolltideTemplates` / `readScrolltideTemplate` server functions.
- "Create new project" inserts a `projects` row (same shape as other project creation), then `saveScrolltideDraft` with the new project id, then navigates to `/p/$projectId`.
- "Add to existing" lists the owner's projects and calls `saveScrolltideDraft` with the chosen id.
- Connection check reuses `scrolltideStatus`.

## Checks before I say it's done
- Menu shows the Scrolltide row and opens the library.
- Library loads and scrolls; search works.
- Use template → Create new project → lands in the new project with the approval card.
- Use template → pick existing project → same approval card there.
- Not-connected state shows the Connect prompt.
- Build passes.
