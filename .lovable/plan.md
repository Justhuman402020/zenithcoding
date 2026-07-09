Plan: Import Lovable projects into Forge

I found 26 Lovable projects in your workspace. I can copy them into this Forge app so they appear in your dashboard and you can edit them.

Important limitation
Lovable does not provide a public API that lets Forge automatically list or sync projects at runtime. That means new projects you create in Lovable later will not appear in Forge by themselves. To handle new projects you can either push them to GitHub (Forge already mirrors GitHub repos) or run another import later.

What I will build

1. Database change
   Add a `lovable_project_id` text column to the `projects` table so Forge knows which projects came from Lovable. I will run this through a migration.

2. Server functions
   - `listLovableProjectsForImport`: returns your workspace projects and whether each one has already been imported.
   - `importLovableProject`: takes a Lovable project ID, copies its name/description, and creates a new Forge project with the same source files.

3. Dashboard UI
   - Add an "Import from Lovable" panel on the dashboard.
   - Show the list of Lovable projects with name, description, and publish status.
   - Add an Import button for each project, plus a status badge (Pending / Imported).
   - Show a note that this is a one-way copy: edits in Forge do not sync back to Lovable.

4. Initial import
   After the code is ready, I will import all 26 existing projects into your Forge database using the agent's cross-project access. This is the one-time seed step.

5. Publish check
   I will also verify that Forge's existing publish feature (the `/s/$slug` public site) is working, since you mentioned publishing might not be working.

Outcome
After this, all 26 projects will appear in your Forge dashboard, each ready to open in the editor. You can edit and publish them from Forge. New Lovable projects will need a manual re-import or GitHub mirroring.

