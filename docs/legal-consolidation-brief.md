# Legal consolidation: 13 → 4

Brief for the drafting session. Everything here was verified against
**production** on 2026-08-09 (`./scripts/db-target.sh --require production`).

## What is already done

**Trust & Safety v2 is published** (2026-08-09T06:09Z, 1230 words). It:

- removed a **false claim** — v1 said every creator "completes identity
  verification and a background check". The background check half was untrue
  and contradicted the app's own "How we vet" sheet. v2 describes the real
  Didit flow and states plainly: *we do not claim to run criminal background
  checks today.*
- **absorbed the Accessibility Statement** as its closing section.
- carries `requires_reconsent: true`, which is **inert** for this doc — see
  the re-consent note below.

## The remaining mapping — 9 documents into 3

Word counts are live production values.

| Target | Absorbs | Words in |
|---|---|---|
| **Terms of Service** (905) | cancellation (859), dispute-resolution (741), payment-payout (661), content-usage (908), minor-safety (570) | 3,739 |
| **Privacy Policy** (820) | data-retention v2 (630), notifications (985) | 1,615 |
| **Creator Agreement** (1358) | background-check (650) | 650 |
| Trust & Safety v2 — **published** | accessibility (286) — already absorbed | — |

**Confirm this mapping with Don before drafting.** Two judgement calls in it:

- **minor-safety → Terms.** It applies to everyone (clients booking sessions
  involving minors, creators photographing them), not just creators. The
  alternative is a Trust & Safety v3, which means re-publishing a document
  that just went live.
- **notifications → Privacy.** It is mostly about what we send, to which
  channel, and how to mute it — which reads as a communications-preferences
  section of Privacy rather than a contractual term.

## Re-consent — where it actually fires

`server/src/routes/policies.ts`:

```ts
const CONSENT_DOCS = ['creator-agreement', 'background-check'];
```

The publish handler only notifies when
`doc.requires_reconsent && CONSENT_DOCS.includes(doc.doc_type)`. So:

- `requires_reconsent` on **Terms**, **Privacy** or **Trust & Safety** does
  nothing at all.
- **Set it on the Creator Agreement publish.** That is the one that fires.
- It notifies every creator with `vetting_status = 'approved'`. On production
  that is **2 creators — `876work@gmail.com` and `vadodon@gmail.com`, both
  Don's own accounts.** Zero third-party creators. Doing this now costs
  nothing and would be disruptive after launch.
- Note the Creator Agreement is absorbing background-check, which is *also* a
  CONSENT_DOC. Once background-check is retired, its consent requirement
  lives inside the Creator Agreement — check `/v1/creator/apply` still
  records the right consents for in-person applicants.

## Publishing mechanics

Two calls, admin token required (`./scripts/app-token.sh admin`, 1h expiry):

```
POST /v1/admin/policies/:slug        -> creates a DRAFT at version+1
POST /v1/admin/policies/:id/publish  -> publishes it
```

- Draft/publish are separate on purpose; a draft is never served.
- `/v1/policies` and `/v1/policies/:slug` return the **highest published
  version** per `doc_type`, so publishing vN+1 supersedes without needing to
  archive the old row.
- **Retiring a document is not an API operation.** To take
  `accessibility` (and later the other absorbed slugs) out of the Legal list,
  flip its row to `status = 'archived'` in SQL — `/v1/policies` filters on
  `status = 'published'`, so archiving removes it from the list while keeping
  version history intact.

```sql
update policy_documents set status = 'archived'
 where doc_type = 'accessibility' and status = 'published';
```

Do this **after** the consolidated documents are live, not before — the
content must exist in its new home first.

## Gotchas that cost time

- **The admin config PUT silently no-ops on a missing key.** Returns
  `{updated:true}` having written nothing. Observed on production with
  `delivery_windows`. Not a policies endpoint, but the same portal — do not
  trust a `200` as proof a config write landed. (Outstanding, unfixed.)
- **`[Insert date]` shipped to production** in the Trust & Safety v1 text and
  was only caught on the v2 pass. Grep every draft for placeholder text
  before publishing.
- **A migration that re-runs must be guarded.** An earlier legal migration
  archived the current version and then aborted on a duplicate key, leaving
  *nothing* published — `/v1/policies/:slug` served a 404 and the app claimed
  the document did not exist. If SQL is used at all, wrap it so a second run
  is a no-op.
- **STEP 4 rewiring must not ship before publishing.** App screens link to
  slugs; retiring a slug the app still links to produces dead legal links,
  which is the exact bug a previous session had to sweep.

## Source material

All 13 live documents are readable without auth:

```bash
curl -s https://snapt-api.onrender.com/v1/policies/<slug> | python3 -c "import json,sys;print(json.load(sys.stdin)['policy']['content'])"
```

Slugs: `terms`, `privacy`, `creator-agreement`, `trust-safety`,
`content-usage`, `payment-payout`, `minor-safety`, `cancellation`,
`background-check`, `accessibility`, `notifications`, `data-retention`,
`dispute-resolution`.

Original PDFs are in `docs/` — treat the **published rows as authoritative**,
since v2s exist for `trust-safety` and `data-retention` that the PDFs predate.

## Standing constraint

These documents are unreviewed by a lawyer and the drafts say so nowhere.
Trust & Safety v2 deliberately does **not** carry a "pending attorney review"
banner, because v1 did not and adding one to a live policy is a change Don
did not ask for. Keep that consistent across all four, and raise it with him
rather than deciding it inside a draft.
