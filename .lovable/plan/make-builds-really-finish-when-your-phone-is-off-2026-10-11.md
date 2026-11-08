# Make builds really finish when your phone is off

## What is actually wrong
The server is told to "keep going" after your phone disconnects, but the hosting only allows about 30 extra seconds once the connection is gone. After that the build is cut off. Nothing starts it again until you come back and tap Continue. So the earlier claim was wrong for any build longer than ~30 seconds after disconnect.

## The fix: the server restarts its own unfinished builds
1. When a build starts, save everything needed to restart it (the conversation, the chosen model, Auto-switch, Plan/Build mode) with the job.
2. A timer in the backend runs every minute. It looks for builds that are still marked "working" but have gone silent for over 90 seconds.
3. For each one, it starts the build again on the server, telling the agent "continue exactly where you stopped, don't redo finished work", using the saved progress note and the same key-switching rules.
4. That restart is held open by the backend itself (not your phone), for up to 10 minutes at a time, so it is not cut off. If it still isn't done, the next minute's check picks it up again.
5. Limits so it can't loop forever: up to 6 automatic restarts per build, no extra credit charged for restarts, and it stops if every AI key is used up.
6. When you come back, the last-build card shows "Finished" with real step/file counts, or "Restarted N times by the server", or the real reason it stopped.

## What I will not be able to test
I won't run a real build (that spends credits). I'll check the code and run the existing tests, plus a new test for the restart rules (90-second silence, 6-restart limit, no credit charge).

## Technical details
- Migration: add `resume_payload jsonb`, `auto_resumes int default 0`, `resumed_at timestamptz` to `chat_jobs`; enable `pg_cron` + `pg_net`; schedule a per-minute `net.http_post` to `/api/public/jobs/resume` with `timeout_milliseconds = 600000` and a secret header.
- New secret `JOB_RESUME_SECRET` (generated, stored in the cron job and app secrets).
- `src/routes/api/public/jobs/resume.ts`: verify secret, claim stale jobs atomically (`update ... where updated_at < now()-90s and auto_resumes < 6 returning`), then run the agent for each.
- Refactor the job runner in `chat.ts` into a shared server module callable both from the chat request and from resume with a trusted `userId` (resume skips the user-token and credit-debit steps only).
- Keep existing heartbeat (every 15s) so live builds are never double-started.
