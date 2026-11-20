# Make project domains go live (Lovable-style)

## Why it fails today
Code Haven tells you to point your domain at the address `185.158.133.1`. That address belongs to the hosting service Code Haven runs on, not to Code Haven itself. That service only opens domains it knows about, so your project's domain hits a dead end even when the check says "Verified". Neither of your saved domains (zenithvideioai.xyz, www.wizzcoding) is fully connected yet, and "www.wizzcoding" has no ending like .com.

## What you'll get
- **Connect domain** works for every project: type the domain and Code Haven shows the exact records to add.
- **Simple records like Lovable:** one CNAME for `www` (and the root) pointing at a Code Haven address, plus one TXT ownership record. No IP address.
- **Live status steps** on each domain: Waiting for records → Verifying → Setting up SSL → **Live**. The status checks itself every 30 seconds while the screen is open, and you can tap **Check again**.
- **Primary domain + redirect:** www and the root redirect to one main address.
- **Clear help** when something is wrong ("your TXT record is missing", "the old A record is still there, delete it").
- The domain shows the project's latest **published** version. An unpublished project shows a friendly "not published yet" page.
- Domain names without an ending (like `www.wizzcoding`) are rejected with a hint.

## One thing you do once (I'll walk you through it)
Code Haven already has your Cloudflare Domains key and main domain saved. I'll set up a small forwarder on that Cloudflare account automatically, using the saved key. If the key is missing a permission (Workers: Edit), I'll show you exactly which box to tick.

## Technical details
- Customer hostnames use Cloudflare for SaaS custom hostnames (existing `cloudflare-saas.server.ts`) on the admin zone; the fallback origin becomes `origin.<saasDomain>`, served by a Worker route that the app deploys via the API.
- The Worker proxies to the Code Haven app host, keeps the original path, and adds `x-code-haven-host` plus an HMAC signature from a new secret. `src/server.ts` serves a custom domain only when the signature checks out, and now serves all paths and assets, not just `/`.
- Verification uses the TXT record plus the Cloudflare custom-hostname status (`active` + SSL `active`). A cron-free poll on the panel, and status columns on `project_domains` (`status`, `ssl_status`, `is_primary`).
- Hostname validation needs a real TLD. Tests cover hostname validation, status mapping and signature checks.
- Unchanged: Plan/Build routing, keys, and Code Haven's own boostallsocial.org domain.
