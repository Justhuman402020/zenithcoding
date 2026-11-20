# Reopenable work logs for Code Haven

## What will change

### 1. A compact work card inside chat
- While the agent works, show one small card beneath the request: task title, current action, running/completed status, elapsed time and recorded step/file counts.
- Tap the card or **Details** to inspect the work. Do not automatically open a large log, expand every tool result, cover the chat or hide earlier messages.
- Keep the message box and normal chat navigation available. Keep existing approval and Stop controls unchanged.

### 2. A separate details view like your screenshots
- Open a dedicated work-details page with a Back arrow and **Timeline** / **Changes** tabs. Keep existing **Checks** access where a saved check is available.
- **Timeline:** a vertical list of recorded actions, with icons, timestamps and expandable available inputs/results, errors and concise action explanations.
- Show elapsed work time near the top. Show individual step durations only when the recorded data supports them.
- **Changes:** show files added, edited or deleted and expandable before/after differences when both versions were captured.
- Show genuine waiting/retry/error states rather than leaving the card at “Build started.”
- Back returns to the same chat and scroll position. Opening or closing details never stops the agent.
- Use Code Haven’s current Pure Black theme, clear writing and a layout that fits your phone without clipped tabs or text.

### 3. Keep finished logs available
- Each run retains its own card and saved details attached to its original chat entry; later work never replaces earlier logs.
- The same Details action works during a run, after completion, after reopening the project and after a page reload.
- The details view has a stable link identifying the project/chat and run, not just temporary open/closed state.
- Reuse older saved text logs. They remain readable, but cannot show tool outputs or historical file differences that were never saved.

## Accuracy and scope
- Record actions and useful outcomes, not private internal reasoning. An expandable concise explanation can occupy the place shown as “Thought for…” in your examples; do not invent thinking text or timings.
- Do not invent credit charges. Only show usage if it is actually recorded for that run.
- Preserve model choices, Plan/Build routing, approvals, project navigation and screen-off build recovery.
- This is a work-log change, not a redesign of the rest of Code Haven.

## Technical approach
- Refactor the current `WorkLogCard` into a shared compact summary and details surface, reused for live and saved work in project and assistant chat.
- Replace the current local-state full-screen overlay with a TanStack details route and real links; give the new page its own Code Haven metadata.
- Bind details to a stable run/job identity. Reuse existing jobs, traces and saved messages; inspect their complete fields before deciding whether a narrowly scoped migration is necessary for missing run details.
- Save sanitized structured action events and file-change evidence incrementally so completed logs do not depend on the browser staying connected. Keep existing legacy `<!-- worklog -->` parsing as a fallback.
- Capture before/after file versions at edit time for new runs where the current history does not provide them. A file list must not be presented as a real diff.
- Keep all reads scoped to the owner and the correct project/chat. Never save or display credential values in logs.

## Verification before completion
- Open a running card, inspect recorded steps, return to chat, and confirm the run continues without covering the chat automatically.
- Reopen a completed run after reload; verify two different runs restore their own actions and changes without mixing them.
- Verify expandable steps, genuine captured differences, legacy logs and empty/error states.
- Check the phone-sized layout from your screenshots and a desktop layout.
- Run focused tests and inspect automatic code checks. Use recorded or mocked runs without spending model credits; any live model test needs your explicit permission.

**Approval covers this plan only. No application changes will be made until you approve.**