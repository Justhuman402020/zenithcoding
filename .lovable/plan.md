# Add a Scrolltide icon to the home menu

## What you asked
A Scrolltide entry in the home slide-out menu, so you can open your Scrolltide template library straight from the home screen — without opening a project first.

## What I'll build

### 1. New menu item
- In the home slide-out menu (the panel that opens from the top-left button), add a **Scrolltide** row with its own icon, placed right under **Templates**.
- Tapping it takes you to a new Scrolltide library page.
- If Scrolltide isn't connected yet, the page shows a short "Connect Scrolltide" message with a button that takes you to **Admin → Integrations** to sign in and approve.

### 2. New Scrolltide library page (`/scrolltide`)
- Shows the **full Scrolltide library** you can scroll through, plus the search bar — same as the library you already have inside a project.
- Each template card keeps its video preview, **Details**, and **Use template** — nothing removed.
- **Use template** from here asks you to **pick which project** to apply it to (a simple list of your projects), then saves the draft and opens that project so you can tap **Approve** — same approval flow as today. Nothing builds without your Approve.

### 3. Nothing else changes
- The library icon inside project chat stays exactly as it is.
- The existing **Templates** menu row (GitHub gallery) stays unchanged.
- No changes to connection, keys, or build routing.

## Technical notes (for reference)
- Add a `SidebarItem` in `src/routes/_authenticated/index.tsx` linking to `/scrolltide`.
- New route `src/routes/_authenticated/scrolltide.tsx` reusing the existing `ScrolltideTemplates` browsing UI and `findScrolltideTemplates` / `readScrolltideTemplate` server functions; project picker lists projects and calls `saveScrolltideDraft` with the chosen project, then navigates to `/p/$projectId`.
- Connection check reuses the existing `scrolltideStatus` server function.

## Checks before I say it's done
- Menu shows the Scrolltide row and opens the library page.
- Library loads and scrolls; search works.
- Use template → pick project → lands in that project with the approval card.
- Not-connected state shows the Connect prompt.
- Build passes.
