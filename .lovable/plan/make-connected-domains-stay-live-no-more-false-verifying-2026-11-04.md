# Make connected domains stay "Live" (no more false "Verifying")

## The problem today
Every time a domain is checked (automatic re-check or tapping "Check again"), Code Haven starts from zero:
- If the ownership TXT lookup hiccups once, a live domain drops back to "Waiting for records".
- If Cloudflare is slow or answers with an error, the domain drops back to "Verifying".
- "Live" requires the ownership TXT record forever, even though it is only needed once.

So a domain that is working and serving your site can still show "Verifying".

## What changes (simple version)
1. **Once live, stays live.** After a domain goes live, a single bad check never moves it back. It only changes if it fails several checks in a row over a period of time (like Lovable's "Offline" status).
2. **Real "is my site there?" check.** Code Haven opens the domain itself (https) and confirms your published site answers. If it does, the domain is shown as Live — even if Cloudflare or the TXT lookup is temporarily slow.
3. **Ownership proof is needed only once.** After the TXT record is confirmed one time, it is remembered. Deleting it later won't break a live domain.
4. **Clear statuses, like Lovable:** Waiting for records → Verifying → Setting up SSL → Live, plus **Offline** (was live, stopped answering for a while) and **Failed** (needs action). Hiccups show as a small "Last check had a problem, retrying" note instead of changing the status.
5. **Calmer auto-checking.** Live domains are re-checked quietly in the background less often; pending ones keep checking every few seconds as now.

Nothing else changes: same DNS records, same Cloudflare setup, same publish flow, same permissions screen.

## Technical details
- `domain-policy.ts`: new pure `nextDomainStatus(prev, signals)` with inputs `{ prevStatus, everVerified, txtOk, cfOk, cfStatus, sslStatus, siteServes, consecutiveFailures }`. Rules: `siteServes` or (cf active + ssl active + everVerified) → live; prev live + transient failure → stays live, increments failure counter; ≥3 consecutive failures spanning ≥30 min → `offline`; blocked/moved/timed-out → failed. Add `offline` to `DomainStatus` and labels.
- `domains.functions.ts` `verifyDomain`: read prev status/verified/fail count; treat `verified` as sticky (never reset to false once true); run an https HEAD/GET to the hostname with a short timeout and match the signed published-site response marker header; compute status via the new function; store `consecutive_failures` and `last_check_error` separately from status.
- Migration: add `consecutive_failures int default 0` and `first_failure_at timestamptz` to `project_domains`.
- Published-site serving adds a harmless `x-code-haven-site: <projectId>` response header so the probe can confirm the right project answered.
- `DomainsPanel.tsx`: show Offline state, show last-check note as a soft warning on live domains, poll live domains every 5 min instead of with pending ones.
- Tests: one per rule in `tests/domain-policy.test.ts` (live survives a single TXT miss, live survives Cloudflare error, site-serves → live, 3 failures over 30 min → offline, verified stays true).
- No live Cloudflare calls in tests.
