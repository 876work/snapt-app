@AGENTS.md

# Snapt — permanent project context

Read this cold: it is the source of truth for every session. The LOCKED sections are
settled decisions — do not relitigate them, do not "improve" them, and treat any code
or comment that contradicts them as the thing that's wrong.

## Verified stack & layout (from the codebase)

- **App**: Expo SDK 57 / React Native, TypeScript, `expo-router` file-based routing,
  zustand state, Hermes. All text renders through `lib/text.tsx` wrappers (Inter font,
  mapped from `fontWeight`) — never import `Text`/`TextInput` from `react-native` in
  screens.
- **Server**: `server/` — Fastify + TypeScript (run with `tsx`), Supabase JS admin
  client. Deployed on Render at `https://snapt-api.onrender.com`; auto-deploys on push
  to `main` of `876work/snapt-app`. Admin Portal is a single HTML page served at
  `/admin` from `server/src/routes/admin.ts` (careful: it's a TS template literal —
  browser-bound `\'` escapes must be written `\\'` or the served JS breaks).
- **Database**: Supabase Postgres. Migrations in `supabase/migrations/` (apply local:
  `supabase migration up`; prod: `supabase db push`). `supabase/seed.sql` is LOCAL ONLY
  (demo accounts, password1234); `supabase/prod_seed.sql` is the production-safe seed
  (config + policies only).
- **Key folders**: `app/` screens — `(auth)` sign-in/up flow, `(app)` client tabs,
  `booking/` in-person flow, `upload/` remote-edit flow, `order/` + `session/`
  post-booking, `creator/` creator app (status-gated shell). `components/` UI pieces.
  `lib/` — `api.ts` (all HTTP + mock fallback + unreachable overlay), `auth.ts`
  (GoTrue + creator-status revalidation), `store/` (zustand), `push.ts`,
  `theme.ts` (+ safe-area `insetTop`/`insetBottom` used inside StyleSheets).
  `server/src/routes/` one file per domain; `server/src/notify.ts` is the ONLY
  notification dispatch path. `docs/` = the 15 reference PDFs (trigger mapping etc.).
- **Run locally**: `supabase start`, then `cd server && npm run dev` (needs
  `server/.env`, see `.env.example`), then `npx expo start` (no root env vars = mock
  mode; local values in `.env.example`). Native dev build: `npx expo run:ios`.
  npm needs `legacy-peer-deps` (already in `.npmrc`).
- **Environments**: root `.env.production` is committed on purpose (public client
  values: Render URL, Supabase URL + anon key, Stripe publishable). Secrets live only
  in `server/.env` (gitignored), Render env, and EAS credentials.
- **Auth**: Supabase GoTrue. Email confirmation + password reset use 6-digit OTP codes
  — the hosted email templates must contain `{{ .Token }}`. No SMS.
- **Unverified/nuances**: Cloudflare R2 driver exists in `server/src/storage.ts` but
  falls back to Supabase Storage until `R2_*` env vars are set (currently unset).
  Push is delivered via Expo Push Service (which uses FCM/APNs underneath; credentials
  live in EAS, none server-side). Google Maps is in the intended stack but no map SDK
  is integrated in the app yet.

## LOCKED — Product

- Snapt is a two-sided marketplace connecting clients with vetted photographers and
  videographers, for in-person sessions or remote editing of footage the client
  already has. Launch market is Saint Lucia, not named in app. Caribbean expansion
  after.
- One app with a client/creator mode toggle in Profile. Everyone signs up as a client.

## LOCKED — Money

- **Standardized pricing. Creators never set or negotiate rates.** This has regressed
  before — watch for it in any creator-facing UI or schema change.
- Client service fee 8%. Creator platform fee 32% (20% promo rate exists as config).
- In-person pricing by duration 1/1.5/2/3/4 hrs:
  Photos 60/90/120/180/240 · Video 90/135/180/270/360 · Both 130/195/260/390/520
- Remote pricing by tier: Photos 25/45/65 · Video 70/120/180 · Both 85/150/220
- Add-ons: rush $25 in person and $20 remote, extra photos $18, extra revision $15
  (one revision round is included free).
- USD is the base and stored currency. XCD is display-only at a fixed peg of 2.70.
  Always store USD, convert for display.
- Pricing lives in `app_config` (`pricing_table`, `remote_pricing_table`, add-ons) and
  is mirrored in `lib/mock/data.ts`; the server prices every booking from config.

## LOCKED — Infrastructure, do not violate

- **Stripe Connect is removed from the architecture.** Stripe (non-Connect) handles
  client charges and refunds only. All creator payouts are manual and admin-fulfilled
  outside the app (portal payout queue). Currently on test keys.
- **No SMS and no Twilio anywhere.** All email/messaging delivery goes through Resend.
  Any code or comment referencing SMS flows is outdated.
- Stack: React Native + Expo, Node + TypeScript, PostgreSQL via Supabase, Cloudflare
  R2 for storage, Firebase Cloud Messaging for push, Google Maps API, Resend for email.

## LOCKED — Rules

- Slide-to-confirm is for actions that cost money, cancel, delete, or cannot be undone.
  Never for routine navigation.
- **Exception that matters**: "End session" on Session Day has NO slider, no fee
  screen, no friction — it is a safety exit. Do not add confirmation to it. Same for
  SOS and any safety action.
- **Creator status is authoritative server-side** (`/v1/creator/me`, six states:
  not_applied / in_progress / pending_review / approved / rejected / suspended). The
  client renders it and never decides, infers, or caches its way into creator mode.
- Cancellation tiers: full refund over 48 hrs, 50% charge at 24–48 hrs, full charge
  under 24 hrs. Reschedule is blocked entirely under 24 hrs. The 8% service fee is
  non-refundable at every tier — EXCEPT when no creator ever accepted, in which case
  everything including the fee is refunded.
- Booking offer window is 15 minutes. After three failed assignments the booking
  auto-cancels with a full refund including the fee, plus an admin alert.
- No-show grace period is 15 minutes in both directions. Client no-show = full charge
  with standard creator payout.
- Payout hold is 7 days, matched exactly to the dispute filing window (disputes can
  only open while the payout is held; clawback is structurally impossible).
- Remote orders cap at 15 files. Hard ceiling, no extra-files add-on (it was removed —
  do not reintroduce it).
- Background-check consent applies only to in-person/both creators, never remote.
- All legal policies are working drafts pending attorney review. Do not treat them as
  final.

## Recurring bugs to watch for

- Creator avatars disappearing from screens.
- A "Brand Event" category reappearing after being explicitly removed (valid occasions
  are exactly: Events, Portraits, Social, Family, Wedding).
- Screens rendering outside the device frame (use `insetTop`/`insetBottom` from
  `lib/theme.ts`; never hardcode status-bar/home-indicator offsets).
- Placeholder or raw prompt text leaking into live creator cards.

## Deployment

- **JS-only changes ship OTA**: `eas update --channel preview --environment preview`
  (device iteration) and `--channel production --environment production` (TestFlight).
  Devices apply an update on the second launch after publish.
- **Native changes** (new native packages, app.json plugins/icon/splash, SDK upgrades)
  require a full `eas build` and, for iOS, resubmit. Check the runtime fingerprint
  before publishing to production: compare `npx @expo/fingerprint . --platform ios`
  against the live build's `runtimeVersion` (`eas build:list`) — if they differ, a
  rebuild is required and the OTA will silently not be delivered.
- `preview` channel = fast iteration; `production` channel = TestFlight releases.
  Treat production publishes as releases.
- Server deploys automatically when `main` is pushed (Render). If a change adds DB
  columns, run `supabase db push` to production BEFORE or immediately with the push —
  Render deploys code that references new columns regardless.
- Verifying what's baked in a bundle: `strings` on Hermes `.hbc` is unreliable — use
  `NODE_ENV=production npx expo export --no-bytecode` and grep the plain JS.

## Current state (as of 2026-08-02)

**Built and real (server-backed, E2E-verified):** full booking lifecycle (availability
engine → offer window → session day with safety code/SOS/chat → delivery → revisions),
remote-edit orders, cancel/reschedule fee engine, payments (Stripe test mode), manual
payout queue with six payout methods (encrypted bank details), strikes/suspension,
disputes with payout freezing, moderation with tiered consequences + false-report
tracking, 13 published legal docs with versioned consent + forced re-consent, per-admin
portal with audit trail, push notifications both platforms with per-category muting +
master toggle, email via Resend, the complete six-state creator journey (drafts,
branched application, reject-with-reason, schedule editor, availability matching gate,
two-way ratings), production Supabase + Render live, TestFlight internal testing
running, OTA pipeline on both channels.

**Stubbed / mocked (known, intentional):** OAuth buttons (Google/Apple/Facebook) are
visual only — Apple Sign-In is mandatory before App Store review; in-app card entry is
visual (charges run server-side with a Stripe test payment method — real payment sheet
is a pending Phase 7 item); creator avatars render initials (no avatar upload
pipeline); distances show as area names (no geocoding); Inbox and Help→Contact screens
are placeholders; client booking list is session-local (not rehydrated after app
restart); reviews exist but aren't yet surfaced on public creator cards ("New" badge);
the application form's portfolio-link field is not persisted; session-reminder
(24h/2h), creator-on-the-way, and chat push triggers are unbuilt; "Snapt Credit" on
Wallet is a placeholder.

**In progress:** Don's 13-group device-testing pass with a fix loop per group (groups
1–4 done, Session Day and cancel/reschedule/duration redesigned to the CD design);
remaining §6 policy decisions (retention windows, background-check cadence/provider,
tax handling, occasion duration defaults beyond Events). Migration
`20260802090000_creator_flow_completion.sql` must be confirmed pushed to production.
