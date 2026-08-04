# Snapt API server

## Admin portal (rebuild in progress)

The portal is a React SPA in `admin-ui/`, served by this server at `/admin`.
The pre-rebuild single-page portal remains at `/admin/legacy` while sections
migrate one at a time; if `admin-ui/dist` is missing at boot, `/admin` falls
back to the legacy page so the portal never 404s.

- `npm run build` compiles the server **and** builds the UI (Render's build
  command needs no change).
- Local dev: `npm run dev` here, plus `npm --prefix admin-ui run dev` for a
  hot-reloading UI at the Vite port (proxies `/v1` to :4000) — or just rebuild
  `admin-ui` and use `/admin`.
- Admin roles (`admin_users.role`, enforced per-route in `admin-auth.ts`):
  `admin` = everything; `support` = view/refund/notes, no payout release or
  config; `moderator` = moderation queue only.
- Safety alerts now carry explicit acknowledgement (`acknowledged_by/at`),
  separate from resolution.


Node/TypeScript base API per handoff §3 Phase 0: Supabase-backed, Stripe +
Stripe Connect scaffolding, JWT auth. All financially-consequential logic
(fee tiers, refunds, payouts, strikes) runs here server-side — never in the
app (handoff §8).

## Run locally

```bash
# 1. Start local Supabase (Docker must be running)
supabase start            # from the repo root; prints URL + keys

# 2. Configure
cp .env.example .env      # paste the service_role key from `supabase status`

# 3. Install & run
npm install
npm run dev               # http://127.0.0.1:4000
```

## Endpoints (Phase 0 surface)

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /v1/health` | — | Liveness + integration status |
| `GET /v1/config` | — | Business config from `app_config` (§5/§6 values, with `unconfirmed_keys`) |
| `GET /v1/availability` | — | Slot engine: per-day flags across the advance window, or start times for one `date` |
| `GET /v1/creators/eligible` | — | Approved creators with the occasion as a specialty (§12 hard filter) |
| `POST /v1/bookings` | Bearer | Create booking; price/fees computed server-side, slot re-validated (§8) |
| `GET /v1/bookings` | Bearer | Caller's bookings (client or creator side) |
| `POST /v1/creator/apply` | Bearer | Creator application; requires ≥1 specialty + dual §14 consents |
| `GET /v1/creator/me` | Bearer | Caller's application/vetting status |
| `POST /v1/admin/creators/:id/approve` | Admin token | Stopgap approval until Admin Portal (Phase 5) |
| `POST /v1/payments/intent` | Bearer | PaymentIntent for a pending booking (503 until Stripe keys exist) |
| `POST /v1/connect/onboarding-link` | Bearer | Stripe Connect Express onboarding link for creators |
| `POST /v1/stripe/webhook` | Stripe sig | Webhook skeleton (payment/refund/account events) |

Payout hold: 7 days, matching the dispute filing window exactly (confirmed
2026-07-26) — a payout never becomes available while a dispute could still
be filed, so no clawback path is needed.

## Phase 5 named line items (do not lose between phases)

1. **Scheduler/job runner** — two Phase 4 gaps depend on it:
   - `payout_available` notification: release is lazy-on-read today, so
     nobody is notified at the moment funds clear.
   - Dispute evidence-deadline reminders (§10 requires automatic reminders
     to both parties before the 72h window closes).
2. **Dispute evidence-upload screen** — intake + RLS submission path exist;
   the client/creator UI is Phase 5-adjacent design work.
3. **Content moderation queue** — BLOCKED ON DESIGN, deliberately not
   built: what user actions flag content, what severities exist, and what
   a flag triggers all need a policy design pass from Don first
   (04_Content_and_Usage_Policy covers rules, not tooling). Do not guess.
4. **notify.ts trigger table reconciliation** — the channel map is a
   reconstruction; diff against `11_Notification_Trigger_Mapping.md` the
   moment that document is actually delivered (not yet received as of
   2026-07-28), especially its Section 7 internal/admin routing.
