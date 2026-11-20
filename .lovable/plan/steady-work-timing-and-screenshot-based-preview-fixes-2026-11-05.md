# Steady work timing and screenshot-based preview fixes

## What is wrong today
- The Timeline timer calculates the current time only when the page renders; it has no one-second clock of its own. It can appear frozen until a refresh or new result arrives.
- The editor timer starts when that device notices work, rather than consistently using the saved run start. Returning to a running job can therefore show the wrong elapsed time.
- Code Haven already captures preview screenshots, but the coding agent is mainly sent text errors. The screenshots are displayed to you, not reliably interpreted by the agent. A page with no broken images can still have an ugly or overlapping layout.

## 1. One accurate, steady working timer
- Use one shared timing rule for the editor, sidebar-chat work cards, and Timeline.
- While the screen is visible, update the timer every second without refreshing or making a server request every second.
- Calculate elapsed time from the saved run start; after reloading, changing devices, or waking the phone, immediately catch up to the correct duration instead of restarting at zero.
- Distinguish **Waiting** from **Working**: queued time is not presented as active work. Show **Paused** when the run is genuinely paused, and freeze the final duration when it finishes, fails, or stops.
- Persist any missing run-start/end/pause information. Older logs without reliable timestamps will keep their recorded estimate rather than inventing exact durations.
- Keep completed steps, recorded actions, and changed files clearly separate. The ticking clock must never increase the step/file counts; use saved job values for those counts.

## 2. Let the agent see the actual preview
- Add an agent preview-check capability using the existing real-browser screenshot system, rather than another unrelated testing service.
- Capture the current project preview on phone and PC, including a scrolled view. Keep page errors, missing pictures, and failed loads alongside those images.
- Send the **actual screenshots** to the currently selected OpenRouter vision reader in a dedicated inspection pass.
- Save a short visual report: what is visibly wrong, which screenshot shows it, and what needs correcting. Check crowding, clipped text, overlapping controls, missing content, and obvious layout problems—not just console errors.
- Feed that report into the selected OpenRouter coding model. Preserve your manually selected models; do not silently switch them or send image interpretation to Cloudflare planning.
- If capture or vision inspection fails, show the real limitation; never report a visual pass merely because the code compiled.

## 3. Approved check → fix → check again
1. You request a preview check, or approve a build that explicitly includes visual verification.
2. The agent captures screenshots and inspects the rendered site.
3. For a separate repair request, show the existing **Deny / Approve** confirmation before editing. Repairs already covered by an approved build remain within that approved scope.
4. Rebuild the preview after the edit and capture fresh screenshots of the new version.
5. Compare the results and report **Passed**, **Problems remain**, or **Could not verify**.
- Keep the existing maximum of **three repair rounds** for one approved workflow, saved with the run so refreshes cannot reset the limit.
- Stop for persistent failures, missing permission, model access, or billing problems instead of endlessly retrying or spending credits.
- Do not automatically publish, modify unrelated features, or perform destructive website actions during a visual check.

## 4. Keep the evidence in chat
- Save each capture, visual report, approved repair, and recheck against its project and run.
- Show compact progress in chat, with reopenable Timeline details and before/after screenshot thumbnails. Do not cover the whole screen automatically.
- Support both the main project chat and a sidebar chat with an attached project. Preview checks stay inside that chat; replacing/removing the project cannot display or repair the old project's preview.
- Successful updates continue appearing in the main project chat.
- Run the approved check/repair workflow through the existing durable job system so closing the page does not cancel it. The display timer is never responsible for running the work.

## Permissions, privacy, and costs
- Real-browser capture needs **Account → Browser Rendering → Edit** for the selected Cloudflare account. Existing token access has not been verified for this plan; show a permission-specific error if it is missing.
- Browser capture and OpenRouter image/code calls can use provider allowance or paid credit. No live calls are made while preparing this plan; show that verification is included before starting an approved workflow.
- Keep screenshots private and project-scoped. Never put keys, session cookies, or passwords into screenshots, model prompts, or logs. Avoid capturing credential settings.
- This phase inspects rendered pages and screenshots. It does not add general-purpose login automation or unrestricted browser control.

## Technical implementation
- Add a shared run-duration helper and ticking hook; connect them to the editor, `WorkLogCard`, sidebar chat, and work-details page.
- Use authoritative job lifecycle timestamps and existing owner-scoped work-detail reads. Extend lifecycle storage only where needed to distinguish actual work, waiting, pauses, and completion.
- Extend `browser-check.server.ts`, its authenticated entry points, and the agent tool registration; reuse preview-token protections and the browser build/asset pipeline.
- Add a screenshot inspection pass alongside the existing vision planner, preserving the selected vision reader and coding model. Persist screenshot references and the visual brief before resuming code work.
- Link saved checks to jobs/traces and expose fresh private screenshot links in Timeline. Deduplicate capture/inspection stages on resume and reject outdated project/run results.

## Verification before completion
- Automated timer tests: seconds advance, queued time is separate, reload/wake catches up, paused/final durations freeze, and job counts remain concrete saved values.
- Browser checks on phone and PC: watch the timer advance without refresh, return to the same run, and reopen completed details.
- Test preview switching/removal and private project isolation.
- Exercise a controlled page with a visible overlap that generates no console error: capture it, confirm the vision report identifies it, approve the repair, then verify fresh screenshots show the correction.
- Run regression tests and inspect automatic build results. Use live browser/vision calls only within the explicitly approved verification workflow, and report any permission or credit blocker honestly.

**No application changes until this plan is approved.**