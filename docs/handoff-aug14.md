# Snapt — Project Handoff

**Written 2026-08-14. Repo state at commit `24bff73`, branch `main`, everything pushed.**

You are picking up an app that is **live in production and being used**, not a
prototype. Nothing here is hypothetical: the API is serving, the database has real
rows, and there are real files in the storage bucket. Read §1 and §2 and you can be
useful; the rest is reference.

---

## 1. What Snapt is, in sixty seconds

Snapt is a mobile app for booking photographers and videographers ("creators") in
**northern St. Lucia**, plus a remote photo/video **editing** service. One app, two
sides, three products:

1. **In-person booking.** A client picks an occasion, date/time, and duration; the
   server finds an eligible creator, offers them the job on a 15-minute timer, and
   the client pays. There's a session-day flow with a safety code, a grace
   countdown, an SOS sheet, and chat.
2. **Remote editing.** A client uploads raw footage from their phone, picks a
   package and an edit style, and pays. An editor delivers finished files back
   in-app. No one meets.
3. **Social bundles.** A shoot priced by *deliverable count* rather than duration
   (e.g. "10 photos + 1 video"), with a proof-selection step.

There is also a **creator-side app** (apply, accept jobs, upload deliverables, see
earnings, cash out) and a **web admin portal** for the operator.

**Money:** charged in **USD**. St. Lucia uses XCD, so prices are *displayed* in XCD
at a pegged rate but always charged in USD, with copy saying so.

**Geography matters.** Service coverage is one polygon over the island's northern
region. Anything southern (Soufrière, Vieux Fort, Marigot Bay) is deliberately
outside. See §4.

---

## 2. How we work together

- **Don (the owner) is non-technical.** He makes every product, pricing, policy and
  business decision. He does not read code. Explain in plain language, lead with the
  outcome, and never hand him a diff as an answer.
- **You (Claude) do all the engineering.** Diagnosis, code, migrations, deploys,
  verification. You are expected to *prove* things rather than assert them.
- **An advisor writes the prompts.** Don relays. So instructions arrive precise and
  technical, while the person who must act on your answer is not. Write for Don;
  satisfy the advisor with the evidence.

Three standing rules that show up in nearly every prompt:

1. **`./scripts/db-target.sh --require production` before any claim of "observed in
   production."** This exists because a whole diagnosis was once reported off the
   *local* database and presented as production. Everything in it was true of the
   wrong machine. Run the gate; it costs a second.
2. **Do not touch anything outside the stated scope.** Each prompt lists what is
   verified working and explicitly says leave it alone. Respect this literally.
3. **If you spot something else broken, say so — do not fix it.** Report it and let
   Don decide. This is not a suggestion; unrequested "improvements" are how verified
   things break.

Don ships fast and expects verification, not reassurance. "Should be fine" is not an
answer. If you cannot verify something, say exactly what you'd need.

---

## 3. Stack and where things live

| Layer | What |
|---|---|
| App | Expo SDK **57**, React Native **0.86**, React **19.2.3**, TypeScript, expo-router, zustand |
| API | Fastify + TypeScript, deployed on **Render** → `https://snapt-api.onrender.com` |
| Database | **Supabase** Postgres (project `euvwnpjwlekegtyghcoy`), RLS on, auth via Supabase JWT |
| File storage | **Cloudflare R2**, S3-presigned PUT/GET. Device uploads go *straight* to R2 — bytes never pass through the API |
| Payments | **Stripe** — still **test mode** (see §7) |
| Email | Resend | Push: Expo Push Service | Crashes: Sentry |
| Admin portal | React SPA (Vite) in `server/admin-ui`, served by Fastify at `/admin` |

Repo layout (root `/Users/donvado/Documents/Snapt-app`):

```
app/          screens (expo-router). app/(app) client, app/creator creator side
lib/          client logic: api.ts, auth.ts, store/, theme, text wrappers
components/   shared UI
server/src/   Fastify API: routes/, retention.ts, scheduler.ts, storage.ts, config.ts
supabase/     48 migrations + seeds
scripts/      operational tooling — read these before writing new ones
docs/         this file, briefs
```

**Beware:** there is a nearly-empty folder `Snapt -  App - REAL/` next to the real
repo. It contains one PDF. The actual project root is one level up. Sessions have
started in the wrong directory before.

---

## 4. Locked business rules

These are **confirmed by Don** and live in the `app_config` table, read at runtime.
Values below were fetched from production on 2026-08-14 (gate run). The server is
always the pricing authority; the app only renders.

**Fees**
- Client service fee: **8%** (`client_service_fee_rate` 0.08). **Non-refundable at
  every client-cancel tier** — refund rates apply to the session cost only. Full
  refunds including the fee happen only on creator-fault and never-accepted orders.
- Creator platform fee: **32%**, promo rate **20%**. *(Not publicly readable — see §6.)*

**Cancellation** (`cancel_tiers`, fraction *charged*)
- More than 48h: **0** (free) · 24–48h: **0.5** · under 24h: **1** (full charge)
- Reschedule: **1 free**, disabled entirely **under 24h**.

**Timings**
- Creator offer window: **15 minutes**, then auto-reassign (no strike for declining).
- Payout hold: **7 days** — deliberately equal to the dispute filing window, so no
  clawback path is ever needed.
- Delivery: **24h standard**, **6h rush**; "approaching" warning at **75%** elapsed.
- Minimum lead: **120 min** in-person, **30 min** remote. Booking window **14 days** ahead.
- No-show grace: **15 min**. Dispute evidence: **72h**. Appeals: **14 days**.

**Pricing — in-person** (`pricing_table`, USD, service type × duration hours)

| | 1h | 1.5h | 2h | 3h | 4h |
|---|---|---|---|---|---|
| photo | 60 | 90 | 120 | 180 | 240 |
| video | 90 | 135 | 180 | 270 | 360 |
| both | 130 | 195 | 260 | 390 | 520 |

**Pricing — remote editing** (`remote_pricing_table`)
- photo: 1–5 **$25** · 6–10 **$45** · 11–15 **$65**
- video: short **$70** · standard **$120** · extended **$180**
- both: small **$85** · medium **$150** · large **$220**

**Pricing — social bundles** (`social_pricing_table`)
- Lite 1h, 5 photos, 0 video — **$75**
- Standard 1.5h, 10 photos, 1 video — **$140**
- Full 2h, 15 photos, 2 videos — **$200**
- Extras: **$12**/photo, **$35**/video. Proof selection window **72h**.

**Add-ons** — in-person: rush **$25**, extra photos **$18**, extra revision **$15**.
Remote: rush **$20** (flat, any tier), extra revision **$15**. **1 free revision**
per order. The in-person and remote revision prices are locked equal *on purpose*.

**Upload caps** — **15 files** per order (hard ceiling; more files = a second order),
**1.5 GB** total, **50 MB** per image, **750 MB** per video.

**Currency** — `xcd_per_usd` = **2.72**, display only.

**Service area** — `service_area_polygon`, a 26-vertex polygon over the northern
region. Point-in-polygon lives in `server/src/geo.ts` (authoritative) and `lib/geo.ts`
(instant client feedback). Separately, `service_areas` holds exactly **19 named
locations** (Cap Estate, Cas en Bas, Gros Islet, Rodney Bay, Monchy, Mongiraud, La
Clery, Vigie, Balata, Babonneau, Garrand, Castries, Ciceron, Grande Riviere, Bisee,
Bonneterre, Beausejour Phase 1&2, Pigeon Island, Cap Marquis). **These are visual
highlights and snap labels only — never validity checks. Do not geocode or add
areas; the list is final.** Any "is this serviceable" logic calls the polygon.

**Strikes** — 60-day rolling window, late cancel counts double, tiers
warning → 2-week deprioritization → 1-week suspension → admin review.

---

## 5. What is verified working **on production**

Verified by direct observation on 2026-08-14, gate run each time.

- **API healthy.** `/v1/health` → `{"ok":true,"stripe_configured":true,"storage_driver":"r2"}`.
- **Remote upload works end to end — 9/9 checks passed.** Draft minted → presigned
  URL issued (driver r2) → bytes PUT to bucket (2xx) → registered → draft restorable
  on return → unsupported type refused *with its reason* → oversize refused *with its
  reason* → draft discarded. Script: `scripts/verify-upload.sh` (booking path) and a
  draft-path equivalent used this session.
- **Config endpoint locked down.** `/v1/config` serves exactly **33** allowlisted
  keys, `unconfirmed_keys` removed, 12 sensitive keys confirmed absent.
- **Retention is live and correctly deleting nothing.** First real run observed:
  `dry_run=false scanned=40 eligible=0 deleted=0 errors=0 held=1 warnings=0`.
- **R2 bucket audited.** 67 objects, 78.5 MB total (raw-footage 48%, deliverables
  39%, portfolio 13%), oldest object 6 days old, 0.8% of the 10 GB free allowance.
- **Both OTA updates delivered** to iOS and Android production channels.
- **4 legal policies published** and served.

## What is verified **in code only**

Correct by construction and typechecked, but not yet observed on a device:

- **The upload total renders as `8.6MB`.** Proven at the value level (`4.3+4.3`
  → `8.6MB`, `4.3×3` → `12.9MB`) but not yet seen on a phone. **Don still owes this
  one check.**
- **Download cache cleanup.** Saving deletes its cache copy immediately; sharing ages
  out on the next download.
- **The full-storage picker message.** Only reproducible on a genuinely full phone.
- **The retention kill-switch hardening** (accepts string spellings of `false`).

## Built but not shipped

**Nothing.** As of `24bff73` every commit is pushed, the server is deployed and
verified, and both OTAs are published. One stale branch exists,
`claude/project-context-doc` (unmerged, based on work from 2026-08-02) — decide
whether to keep or delete it; it is not blocking anything.

---

## 6. Recurring failure patterns we have been killing

These are the four bug *classes* this project keeps producing. When something is
wrong, suspect these first — and never write new code that reintroduces one.

**1. Failure states rendering as normal states.** The worst class, because nobody
reports it. Examples that actually shipped: an abandoned upload draft silently
attached to what looked like a fresh order; the API sleeping on Render's free tier
made the app fall back to *mock data*, so users saw invented bookings instead of an
error; a tab silently vanished because the route didn't exist. **Rule:** a failure
must look like a failure. An empty state and a broken state must never render the
same. Mock fallback in API mode is now blocked by a full-screen error overlay.

**2. Fabricated data.** A demo pool of three fake files used to seed the upload
store, so someone who picked nothing saw "3 files ready", could pay, and the order
arrived with no footage. Seed creators, placeholder avatars and stock rows have all
caused real confusion. **Rule:** never invent rows, counts, or sizes. If there's no
data, say so. This applies to *your reports* too — do not state a cause you inferred
from reading code and present it as observed.

**3. Silent catches.** `catch {}` with no logging destroyed the evidence for a
download bug that then survived being reported twice — the real error existed
nowhere: not on screen, not in a log, not in Sentry. **Rule:** every catch either
handles the error meaningfully or reports it (`captureHandledError`). A user-facing
message must not replace the underlying cause; capture both.

**4. Config keys that look live and aren't.** `retention_dry_run` sat `true` for the
project's entire life while the code, the docs and the policy all described files
being deleted on a schedule. Nothing was ever deleted. Related: `app_config.value` is
**jsonb**, and supabase-js JSON-encodes whatever you hand it — so
`JSON.stringify(x)` before a write double-encodes and the value reads back as a
quoted string that no comparison matches. That exact bug made the retention job run
every 5 minutes instead of daily. **Rule:** never `JSON.stringify` into `app_config`;
verify a flag's *type*, not just its value; and make a flag's log line say what it
actually read.

---

## 7. Outstanding work, in priority order

### Launch blockers

1. **Stripe is still in test mode.** `.env.production` carries a `pk_test_…` key and
   the server a test secret. **Real money cannot be taken until live keys are
   installed** and the payment sheet is re-verified end to end. Highest-value item on
   this list.
2. **Render free tier sleeps.** The instance idles out; first request takes 20–60s and
   the 5-minute scheduler *stops while asleep* — which means payout release, offer
   timeouts, retention and draft sweeps all pause. A paid instance (or keep-alive) is
   required before real users depend on timing.
3. **App Store / Play submission.** iOS ASC app id `6796223883` is configured in
   `eas.json`. Legal documents are a prerequisite (see §10).
4. **Confirm the `8.6MB` fix on a device** — the last unverified piece of this
   session's work. Two files of 4.3 MB should read `8.6MB of 1.5GB`.

### Should fix before real volume

5. **`service_area_polygon` is still a draft** (`confirmed=false`) awaiting Don's
   boundary correction. It is the authoritative serviceability check, so a wrong
   boundary means wrongly accepted or rejected bookings.
6. **Occasion → duration defaults are missing** for Portraits, Social, Family and
   Wedding. Only `Events = 2h` is confirmed. **Do not infer the others.**
7. **One booking is under legal hold** (`held=1` in the retention run) — either an
   explicit hold or one auto-raised by an open dispute/report/revision. Worth closing;
   its files stay outside retention for 90 days after any hold is lifted.
8. **Content moderation queue — blocked on design.** Don's call; deliberately not
   built. Do not start it.

### Known gaps, not urgent

9. Unwired notification triggers: session reminders (24h/2h), creator "on the way",
   application-declined, background-check queue. Each needs scheduler work.
10. Reviews exist and aggregate but are not surfaced on public creator cards.
11. Creator `bio` / `portfolio_link` are collected in the form but not persisted.
12. Tax handling, background-check provider/cadence, and per-package deliverables copy
    are still unresolved §6 questions.
13. Verify the R2 bucket still reads ~67 objects after retention has run daily for a
    week (`./scripts/r2-usage.sh`).

---

## 8. Operational traps

Each of these has already cost real time. They are not theoretical.

- **`.gitignore` is a fingerprint input.** The runtime version uses a fingerprint
  policy, so editing `.gitignore` (or `eas.json`, or `package.json`) changes the
  runtime and **orphans existing builds** — they stop receiving OTAs, silently. A
  2-line `eas.json` edit once orphaned a freshly-made build. `.fingerprintignore`
  now excludes `eas.json`.
- **Publish OTAs only via `./scripts/publish-ota.sh "message"`.** Publishing any other
  way strands builds. `eas-cli` requires an `--environment`, which sets
  `EXPO_NO_DOTENV=1` and skips local `.env` files — a bundle published bare has no
  `EXPO_PUBLIC_*` values and the app silently runs in demo mode. The wrapper runs
  inside `eas env:exec production` so build-time and publish-time fingerprints match,
  and it uploads Sentry source maps.
- **Secret-visibility EAS env vars cannot be read locally.** Vars marked sensitive
  (the Google Maps keys) are visible to EAS builds but not to a local config
  evaluation. This is precisely why publish and build once disagreed.
- **Signing out of a CLI kills your tokens.** Verification tokens
  (`~/.snapt-client-token`, `-creator-`, `-admin-`) are bare Supabase JWTs that expire
  in **about an hour** and hold no refresh token. Only Don can mint them
  (`./scripts/app-token.sh client|creator|admin` — it needs his password). **Decode
  the `exp` claim before blaming roles:** a 403 that looks like a permissions problem
  is usually just expiry.
- **Anon reads returning `*/0` mean invisible, not empty.** A PostgREST
  `count=exact` query returning `content-range: */0` under the anon key means "no rows
  visible to this role". `bookings`, `creator_payouts` and `push_tokens` all do this;
  `push_tokens` has RLS with no client policies at all, so even the owning user reads
  zero. Two production "findings" were once RLS artifacts. **Run a positive control
  before claiming a table is empty**, or say "not visible to this role".
- **Adding a foreign key breaks bare PostgREST embeds the moment the migration runs**
  — before any code deploys, so a "DB-only" migration is not safe. This caused a
  4h15m booking outage. Name the constraint
  (`profiles!creator_profiles_user_id_fkey!inner(...)`) and check the ~six embed sites
  in `availability.ts`, `retention.ts`, `routes/admin.ts` (×2), `admin-portal.ts`,
  `creators.ts`.
- **A directory tab without `_layout.tsx` produces no route with that name.** The
  files register individually, `<Tabs.Screen name="messages">` matches nothing, and
  the tab silently disappears while deep links still work. Two days went into OTA
  delivery theories before anyone checked the router tree.
- **`server/.env` points at the LOCAL stack**; `.env.production` is the real one. The
  db-target gate exists for exactly this.
- **Migrations are applied by pasting SQL into the Supabase editor** — nothing records
  that a file ran. `./scripts/schema-drift.sh` compares declared vs actual.

---

## 9. Versions, builds, devices

- **App version 1.0.0**, `runtimeVersion` policy **fingerprint**, bundle id
  `app.snaptcarib.snapt` (iOS and Android).
- **Build 16 is what is installed on Don's devices**, both platforms, from 2026-08-13.
  Runtimes: iOS `aafa0d14dd00…`, Android `f96cecd099e9…`. Android test builds use the
  `production-apk` profile (internal APK, same channel). **Don always wants an Android
  build alongside iOS.**
- **Both devices are current** — the two OTAs published 2026-08-14 target exactly
  these runtimes.
- **Ground truth for "what is my phone running":** Profile → Build & updates shows app
  version, native build number, the stamped commit, the update id, and a check-now
  button that surfaces raw expo-updates errors.
- Key package versions are pinned in `package.json`; npm installs may need
  `--legacy-peer-deps`.

**Useful commands**

```bash
./scripts/db-target.sh --require production .env.production   # the gate
./scripts/publish-ota.sh "message [commit]"                   # the ONLY way to OTA
./scripts/app-token.sh client                                 # mint a token (Don only)
./scripts/verify-upload.sh <booking_id>                       # upload path E2E
./scripts/r2-usage.sh                                         # bucket contents (needs R2_* env)
./scripts/schema-drift.sh                                     # declared vs actual schema
npx eas-cli update:list --branch production --limit 5         # what the phones are served
```

---

## 10. Legal — parked

**Legal documents are parked until app store submission. Do not raise them until Don
asks.** Four policies are published and live (Trust & Safety, Terms of Service,
Privacy Policy, Creator Agreement), consolidated down from thirteen.

Two items are noted here so they are not lost, **to be picked up at submission time,
not before**:

1. The Privacy Policy tells readers to read it "alongside the Data Retention Policy",
   but that document was consolidated *into* it and no longer exists separately.
2. The Privacy Policy states retention as "life of account + 90 days after deletion",
   while `retention_account_deleted_days` is 30. These may describe different data
   classes; it needs a human decision, not a code change.

---

## 11. If you change one thing, change it like this

Work in the smallest scope that fixes the problem. Prove the fix against production
where production can be reached, and say plainly which parts you could not prove.
Write commit messages that explain *why the old behaviour was wrong*, because that is
the only thing the next person cannot reconstruct from the diff. And when you find a
second bug on the way to the first, write it down and leave it alone.
