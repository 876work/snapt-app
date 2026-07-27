# Snapt API server (Phase 0)

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
| `POST /v1/payments/intent` | Bearer | PaymentIntent for a pending booking (503 until Stripe keys exist) |
| `POST /v1/connect/onboarding-link` | Bearer | Stripe Connect Express onboarding link for creators |
| `POST /v1/stripe/webhook` | Stripe sig | Webhook skeleton (payment/refund/account events) |

Phase 1 adds: server-side creator approval, slot-availability engine,
booking creation + the re-sequenced flow. Phase 2 adds the fee-tier engine —
blocked on Don confirming the §6 dispute-window vs payout-hold conflict.
