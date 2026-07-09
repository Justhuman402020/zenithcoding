# Build Plan: Billing, Transfer, Templates

Three independent features. I'll ship them in this order because each depends on the previous less than the reverse.

## 1. Stripe subscriptions + credits ledger

### Schema (migration)
- `plans` — id, name, stripe_price_id, monthly_credits, price_cents.
- `subscriptions` — user_id, stripe_customer_id, stripe_subscription_id, plan_id, status, current_period_end.
- `credit_ledger` — id, user_id, delta (signed int), reason (`grant|debit|topup|refund`), ref (message_id / invoice_id), created_at.
- `credit_balances` view — `SUM(delta) GROUP BY user_id`.
- Grants + RLS: users read own rows; ledger insert only via service role.

### Backend
- `src/routes/api/public/stripe/webhook.ts` — verify signature, handle `checkout.session.completed`, `customer.subscription.updated`, `invoice.paid` (grant monthly credits), `customer.subscription.deleted`.
- `src/lib/billing.functions.ts` (auth'd server fns):
  - `createCheckoutSession({ planId })` → returns Stripe Checkout URL.
  - `createBillingPortalSession()` → returns portal URL.
  - `getMyBalance()` → sum + recent ledger entries + active subscription.
- `src/lib/credits.server.ts` — `debitCredits(userId, amount, ref)` used inside the existing chat route (`api/public/chat.ts`) before streaming; rejects with 402 if balance ≤ 0.

### UI
- `/account/billing` route: current plan, balance, ledger table, "Upgrade" (Checkout) and "Manage" (Portal) buttons.
- Header pill showing remaining credits.
- Chat error toast when credits exhausted with link to billing.

### Secrets
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` via `add_secret` (BYOK — user asked for Stripe).
- Publishable key set client-side via env.

## 2. Project transfer ownership

### Schema
- `workspaces` (id, name, slug, owner_user_id) + `workspace_members` (workspace_id, user_id, role). Minimal — every user gets a personal workspace on first login (trigger).
- Add `projects.workspace_id` (nullable → backfill → not null).
- `project_transfers` — id, project_id, from_user_id, to_email, to_workspace_id nullable, token, status (`pending|accepted|declined|cancelled|expired`), created_at, expires_at.

### Backend `src/lib/transfers.functions.ts`
- `initiateTransfer({ projectId, toEmail })` — owner-only, creates row + token, sends email (Resend if key present, else return acceptance URL directly).
- `getTransferByToken({ token })` — public server fn.
- `acceptTransfer({ token })` — auth'd; verifies invited email matches current user email, moves `projects.user_id` + `projects.workspace_id` to accepter's personal workspace, marks accepted.
- `cancelTransfer`, `declineTransfer`.

### UI
- `/p/$projectId/settings` → "Transfer ownership" card (email input + send).
- `/transfers/$token` public route → "Accept ownership of <project>" button; if not signed in, redirect through `/auth?next=`.
- Toast + list of pending transfers on project settings.

## 3. Templates gallery + Remix

### Schema
- `templates` — id, slug, name, description, category, thumbnail_url, files jsonb, author_user_id nullable, featured bool, created_at.
- Seed migration with 6 starter templates (Vite React landing, SaaS dashboard, Blog, Portfolio, AI chatbot, Kanban) — files stored as `{ path: content }` map.
- Add `projects.template_id` + `projects.remix_of_project_id` (already suggested).

### Backend `src/lib/templates.functions.ts`
- `listTemplates()` — public, returns featured + all.
- `remixTemplate({ templateId, name })` — auth'd; creates new project row, copies `files jsonb` into `files` table rows for the new project, returns projectId.
- `remixProject({ projectId })` — same for public projects.

### UI
- `/templates` public route — grid of cards (thumbnail, name, category, "Remix" button).
- Add "Templates" section on `/` dashboard above recent projects (horizontal scroll).
- Template detail modal → "Remix" → server fn → navigate to `/p/$projectId`.

## Out of scope for this batch
Workspace invites UI, multi-seat billing, Stripe tax, custom template uploads, template versioning, transfer to another workspace (only personal), refunds. Say the word and I'll add any of these next.

## Order of implementation
1. Migrations (all three feature groups in one migration for atomicity).
2. Billing backend + UI.
3. Transfer backend + UI.
4. Templates seed + gallery + Remix.
5. Wire credit debit into chat route.
6. Playwright smoke: view /account/billing, /templates, initiate a transfer.

Approve and I'll build it end to end.
