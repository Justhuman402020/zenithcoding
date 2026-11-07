# Clean, immediate domain disconnect

## What happens today (confirmed in code)
- The Remove button only deletes the domain row. Nothing in Cloudflare is cleaned up: the custom hostname and the Worker route stay.
- When a request for a removed domain arrives, the server finds no match and falls through to the Code Haven app, so the app (or another site) shows.
- The lookup also checks the "pair" (www / no-www). If you remove `www.site.com` but `site.com` remains, `www` can still serve that site.

## New disconnect flow
1. Tap Remove on a domain. A centered Code Haven card opens (same style as the build approval card) listing:
   - The domain being disconnected.
   - What Code Haven will remove in Cloudflare: the custom hostname and the site route.
   - The DNS records you should delete at your DNS provider (type, name, value), with copy buttons.
2. Buttons: Deny / Approve. Nothing is deleted before Approve.
3. On Approve:
   - The domain is marked "disconnected" first, so it stops serving instantly.
   - Code Haven removes the Cloudflare custom hostname and the Worker route for that exact hostname.
   - Then the domain row is deleted. If a Cloudflare step fails, the domain stays disconnected (never serving) and shows "Cleanup incomplete — Retry", naming the missing permission when relevant.

## Serving rules (no other site, no app)
- A request that arrives through the Code Haven forwarder for a hostname not connected and live returns a plain "This domain is not connected" page (404). It never falls through to the Code Haven app.
- Only an exact hostname match serves a site; www/no-www redirect only when both are connected to the same project.
- Responses for custom domains are sent with no-cache, so browsers and Cloudflare don't keep showing the old site after disconnect.

## Technical details
- `DomainsPanel.tsx`: replace direct row delete with a confirm dialog + `disconnectDomain` server function (owner-checked).
- `domains.functions.ts`: `disconnectDomain` sets status `disconnected`, calls new `removeCustomHostname` / `removeWorkerRoute` in `cloudflare-saas.server.ts`, then deletes the row; returns DNS records to show.
- `server.ts` `serveCustomDomain`: exact-match only, require status not `disconnected`; signed-forward unknown host returns 404 page instead of `null`; add `cache-control: no-store`.
- `domain-policy.ts`: pure `shouldServeDomain` + `disconnectPlan` helpers with unit tests (removed host gets 404, sibling not served, cleanup order).
- No live Cloudflare calls in tests.
