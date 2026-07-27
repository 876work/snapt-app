-- Snapt Phase 0 seed: business config (handoff §5 confirmed, §6 unconfirmed)
-- and placeholder policy document drafts (§14 — never publish these as-is).

insert into app_config (key, value, description, confirmed) values
  -- §5 — confirmed, safe to build against.
  ('client_service_fee_rate', '0.08', 'Client service fee, shown as line item at checkout', true),
  ('creator_platform_fee_rate', '0.32', 'Standard creator platform fee', true),
  ('creator_promo_fee_rate', '0.20', 'Illustrative promo fee rate, shown with strikethrough; admin-set', true),
  ('xcd_per_usd', '2.70', 'Fixed peg: XCD per 1 USD (USD is base/storage currency)', true),
  ('advance_booking_window_days', '14', 'How far ahead a session can be booked', true),
  ('free_revisions_per_order', '1', 'Free revision rounds per order; additional rounds are paid add-ons', true),
  ('cancel_tiers', '{"over48h": 0, "between24and48h": 0.5, "under24h": 1}',
    'Charge rate by notice window; computed SERVER-SIDE at time of action (§8)', true),
  ('reschedule_free_count', '1', 'Free reschedules (>48h); additional treated as cancel+rebook', true),
  ('reschedule_disabled_under_hours', '24', 'Reschedule disabled entirely under this many hours (widened from 6 to 24 — Don, 2026-07-27; closes the former 6–24h gap)', true),
  ('no_show_grace_minutes', '15', 'Grace period past scheduled start, both directions', true),
  ('offer_window_minutes', '15', 'Creator accept/decline window after assignment; decline/timeout reassigns without a strike (Don, 2026-07-27)', true),
  ('strike_window_days', '60', 'Rolling window for creator strikes', true),
  ('late_cancel_strike_weight', '2', 'Late (<24h) cancellation counts as 2 strikes', true),
  ('strike_tiers', '["warning", "deprioritization_2w", "suspension_1w", "admin_review"]',
    'Consequence at cumulative strike count 1..4+ within window', true),
  ('strike_deprioritize_days', '14', 'Matching deprioritization duration at tier 2 (§5: 2 weeks)', true),
  ('strike_suspension_days', '7', 'Suspension duration at tier 3 (§5: 1 week)', true),
  ('dispute_filing_window_days', '7', 'From session/delivery', true),
  ('payout_hold_days', '7', 'Creator payout hold after session/delivery; matches the dispute filing window exactly so no payout precedes a possible dispute (Don, 2026-07-26)', true),
  ('dispute_evidence_window_hours', '72', 'From notification', true),
  ('dispute_appeal_window_days', '14', 'From decision', true),

  -- §6 — UNCONFIRMED working defaults. Do not build charge/refund/payout
  -- logic against these until Don confirms.
  ('raw_footage_retention_days', '90', 'UNCONFIRMED (§6) — also sets the re-edit ordering window', false),
  ('delivered_content_availability_months', '12', 'UNCONFIRMED (§6)', false),
  ('creator_non_circumvention_months', '12', 'UNCONFIRMED (§6) — Creator Agreement §7', false),
  ('background_check_recheck_months', '24', 'UNCONFIRMED (§6)', false),
  ('occasion_default_duration_hours', '{"Events": 2}',
    'Smart default (§7): Events = 2h is the ONLY confirmed value ("Recommended for Events" on the 2-hour option). Portraits/Social/Family/Wedding are UNDEFINED — do not infer; add here only when Don specifies.', true),
  ('pricing_table',
    '{"photo": {"1": 60, "1.5": 90, "2": 120, "3": 180, "4": 240},
      "video": {"1": 90, "1.5": 135, "2": 180, "3": 270, "4": 360},
      "both":  {"1": 130, "1.5": 195, "2": 260, "3": 390, "4": 520}}',
    'CONFIRMED launch pricing (Don, 2026-07-27): session price USD by service type × duration hours', true),
  ('remote_pricing_table',
    '{"photo": {"photos_1_5": 25, "photos_6_10": 45, "photos_11_15": 65},
      "video": {"short": 70, "standard": 120, "extended": 180},
      "both":  {"small": 85, "medium": 150, "large": 220}}',
    'CONFIRMED remote-edit pricing (Don, 2026-07-27): order price USD by service type × tier. 15 files is a HARD ceiling per order (no extra-files add-on — more files = second order)', true),
  ('remote_addons', '{"rush": 20, "extra_revision": 15}',
    'CONFIRMED remote add-ons (Don, 2026-07-27): rush = flat $20 any type/tier; extra_revision = $15 per round beyond the 1 free', true),
  ('in_person_addons', '{"rush": 25, "extra_photos": 18, "extra_revision": 15}',
    'CONFIRMED in-person add-ons (Don, 2026-07-28): rush delivery $25, extra edited photos $18, extra_revision $15 — LOCKED to the same value as remote_addons.extra_revision intentionally, not coincidence', true);

-- Policy documents seeded from the real docs/ pack (v1). The 11 policy
-- docs are PUBLISHED (working drafts pending attorney review — Phase 7
-- swaps in reviewed text as new versions). Terms + Privacy source docs
-- were NOT in the delivered pack — they stay draft placeholders (flagged).
insert into policy_documents (doc_type, version, title, content, status, requires_reconsent)
values
  ('cancellation', 1, 'Cancellation & Refund Policy', 'Snapt — Cancellation & Refund Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

This policy explains what happens when a booking on Snapt is cancelled, rescheduled, or
not fulfilled. It applies to all in-person creator sessions booked through the Snapt app.
Remote editing orders are covered separately in Section 6. By placing a booking, you agree
to this policy.
All times below are measured against the scheduled start time of your session, in local time.

1. Client cancellations
You may cancel an upcoming booking at any time from the Booking Detail screen in the
app. The charge that applies depends on how much notice you give:
When you cancel

What you pay

What you get back

More than 48 hours before the session

Nothing

Full refund

Between 24 and 48 hours before the session

50% of the session cost

50% refund

Less than 24 hours before the session

100% of the session cost

No refund

The refund percentages above apply to the session cost only. The 8% client service fee is
non-refundable at every cancellation tier, including a full-refund (>48hr) cancellation.
Refunds are issued to the original payment method. Processing times depend on your bank
or card issuer and typically take 5–10 business days.

2. Rescheduling
Rescheduling moves your session to a new available date and time with the same booking.
It is subject to the following rules:
More than 48 hours before the session: One free reschedule per booking. Additional
reschedules are treated as a cancellation and rebooking.
Less than 24 hours before the session: Rescheduling is not available. If you cannot
attend, you may cancel, subject to the cancellation fee tiers in Section 1, or contact us
at hello@snaptcarib.app.

Rescheduled sessions are subject to creator availability. If your assigned creator is not
available at your new time, you will be offered a different available creator or the option to
cancel under the terms above based on your original cancellation notice.

3. Creator cancellations
If your assigned creator cancels a confirmed booking at any time:
You receive a full automatic refund, including all fees, regardless of notice period; or

You may choose to keep your booking and be matched with another available creator
for the same date and time, where availability allows.
You will never be charged a fee because a creator cancelled. Creators who repeatedly cancel
confirmed bookings are subject to consequences under the Snapt Creator Agreement, up to
and including removal from the platform.

4. No-shows
If your creator does not arrive

If your creator has not arrived and checked in within 15 minutes of the scheduled start
time, you can report a creator no-show directly from the Session Day screen. A confirmed
creator no-show results in:
A full automatic refund to you, including all fees; and
The option to rebook with another available creator.
If you do not arrive

If you are not present at the confirmed meeting point and cannot be reached within 15
minutes of the scheduled start time, your creator may report a client no-show. A confirmed
client no-show is treated as a cancellation with less than 24 hours'' notice: the full session
cost is charged and no refund is issued. The creator is compensated for holding the time
and attending.
If you are running late, contact your creator through in-app chat as early as possible. Short
delays communicated in advance are handled between you and your creator in good faith
and are not automatically treated as no-shows.
Disputed no-shows

If the parties disagree about what happened (for example, each reports the other as absent,
or there was a genuine misunderstanding about the meeting point), the booking is placed
on hold and reviewed under the Snapt Dispute Resolution Policy. No final charge or payout
is completed until the review concludes.

5. Revisions and delivered work
Every order includes one free revision round on the delivered edited content. Additional
revision rounds are available as paid add-ons. Dissatisfaction with delivered content is
handled through the revision process and, where necessary, the Dispute Resolution Policy
— it is not grounds for an automatic refund once a session has been completed and content
delivered.

6. Remote editing orders
Remote editing orders (where you upload existing footage for editing) may be cancelled
with the session cost refunded (the service fee remains non-refundable, per Section 1)
before an editor has been assigned and begun work. Once editing has begun, the order
can no longer be cancelled, and the revision process above applies to the delivered result.

7. Exceptional circumstances
Severe weather, natural disasters, medical emergencies, and similar events beyond either
party''s control are handled case by case. If your session is affected by an event of this kind,
contact us at hello@snaptcarib.app and we will work with you and your creator on a fair
outcome, which may include a fee-free reschedule or full refund outside the standard tiers.

8. Changes to this policy
We may update this policy from time to time. Material changes will be communicated in the
app. The version in effect at the time you placed your booking is the version that applies to
that booking.

9. Contact
Questions about a cancellation, reschedule, or refund: hello@snaptcarib.app', 'published', false),
  ('creator-agreement', 1, 'Creator Agreement', 'Snapt — Creator Agreement (Independent Contractor)
Effective date: [Insert date] Between: [Snapt legal entity name] ("Snapt", "we", "us") and
the individual accepting this Agreement ("Creator", "you") Contact: hello@snaptcarib.app
DRAFT — REQUIRES LEGAL REVIEW. This document has material legal
consequences, including contractor classification under Saint Lucian law. It must be
reviewed by a qualified attorney before use.

This Agreement governs your participation as a content creator on the Snapt platform,
whether providing in-person photo/video sessions, remote editing services, or both. You
must accept this Agreement to be approved as a Creator. It applies in addition to the Snapt
Terms of Service, Trust & Safety Policy, and other platform policies, all of which are
incorporated by reference.

1. Independent contractor status
1.1. You provide services as an independent contractor. Nothing in this Agreement creates
an employment, agency, partnership, or joint venture relationship between you and Snapt.
1.2. You are responsible for your own taxes, social security contributions, insurance, and
equipment. Snapt does not withhold taxes from your payouts.
1.3. You control the manner in which you perform your services, subject to the quality and
conduct standards in this Agreement. You choose your own working hours, availability, and
service radius through the app.
1.4. You are free to provide photography, videography, or editing services outside the Snapt
platform, subject to Section 7 (non-circumvention).

2. Eligibility and vetting
2.1. To become a Creator you must: be at least 18 years of age; complete the Snapt
application process; provide accurate identity information; and, for in-person services, pass
a background check as described in the Snapt Background Check & Vetting Disclosure.
2.2. Approval is at Snapt''s discretion. We may decline an application or revoke Creator
status where vetting results, conduct, or reliability standards are not met.
2.3. You must keep your identity, contact, and payout information accurate and current.

3. Services, pricing, and standards
3.1. Standardized pricing. All services on Snapt are offered at platform-set prices. You may
not set your own rates, negotiate prices with clients, request additional payment from
clients, or accept tips or off-platform payment for Snapt bookings.
3.2. Service standards. You agree to: arrive on time to confirmed sessions; complete the inapp check-in process, including the safety code verification; deliver work that meets the
package specifications (including stated photo/video counts and delivery timelines);

communicate with clients professionally through in-app chat; and complete the included
revision round in good faith where requested.
3.3. Deliverables. Raw footage must be submitted through the Creator submission flow.
Finished edits must be uploaded through the Editing Workspace. Raw footage is never
made available to clients; only final edited deliverables are.

4. Fees, payouts, and holding period
4.1. Platform fee. Snapt deducts a platform fee of 32% from the gross session or order price.
The remaining 68% is your payout. Snapt may offer promotional (reduced) fee rates from
time to time; where a promotional rate applies, it will be clearly shown in your Earnings
screen.
4.2. Snapt may change the standard platform fee with at least 30 days'' notice to Creators.
The fee in effect at the time a booking is placed applies to that booking.
4.3. Holding period. Earnings from completed orders are held for 48–72 hours after
completion before becoming available for payout, to allow for revision requests and dispute
checks.
4.4. Payout method. Payouts are made via Stripe Connect to your connected account, in
USD. You are responsible for maintaining a valid payout account.
4.5. Amounts subject to an open dispute, chargeback, or investigation may be withheld
until resolution.

5. Cancellations, reliability, and consequences
5.1. Clients rely on confirmed bookings. Cancelling a confirmed booking, or failing to attend
one, harms clients and the platform.
5.2. Strike system. Creator cancellations are tracked on a rolling 60-day window:
First cancellation: logged warning.
Second cancellation: reduced priority in client matching for two weeks.
Third cancellation: suspension from receiving bookings for one week, applied
platform-side.
Fourth cancellation or a continued pattern: referral to manual review, which may
result in permanent removal.

5.3. Late cancellations (less than 24 hours before the session) count as two strikes.
5.4. No-shows — failing to attend a confirmed session without cancelling — are treated as a
higher-severity event than a cancellation and may result in immediate suspension pending
review, including on a first occurrence.
5.5. Strikes expire out of the rolling window over time. You may contest a strike you believe
was applied in error by contacting hello@snaptcarib.app; contested strikes are reviewed by
Snapt, whose determination is final subject to the Dispute Resolution Policy.

5.6. If you cancel a confirmed booking, the client receives a full refund and you receive no
payout for that booking.

6. Conduct and safety
6.1. You must comply with the Snapt Trust & Safety Policy at all times, including during
sessions.
6.2. Prohibited conduct includes, without limitation: harassment or discrimination; arriving
impaired; inappropriate physical contact or comments; photographing individuals without
appropriate consent; sessions involving minors except in compliance with the Snapt Minor
Safety & Age Policy; and any unlawful activity.
6.3. You must complete safety check-in procedures for every in-person session and must
not begin a session without verifying the client''s safety code.
6.4. Snapt may suspend or remove you immediately, without prior warning and
notwithstanding the strike system, for conduct that endangers safety or violates law.

7. Non-circumvention
7.1. You may not solicit, encourage, or accept bookings or payment outside the platform
from clients you met through Snapt, for a period of 12 months after your last Snapt booking
with that client. This includes sharing personal contact details for the purpose of offplatform booking.
7.2. This restriction protects the platform economics that fund vetting, matching, payments,
and dispute protection. Breach is grounds for immediate removal and forfeiture of pending
payouts related to the circumvented booking.

8. Content and intellectual property
8.1. Client deliverables. Upon completion and payment, the client receives ownership of
(or, at minimum, a full, perpetual, worldwide licence to use) the final edited deliverables, as
set out in the Snapt Content & Usage Policy.
8.2. Raw footage. Raw footage is retained within the platform per the Data Retention Policy.
You may not distribute, publish, or reuse client raw footage or deliverables outside the
platform without the client''s written consent.
8.3. Portfolio and marketing. You may request client consent through the app to feature
delivered work in your Snapt profile portfolio. Snapt may feature delivered work in
platform marketing only where both you and the client have consented.
8.4. You warrant that work you deliver does not infringe any third party''s rights and that
any music, assets, or materials used in edits are properly licensed.

9. Insurance and liability
9.1. You are responsible for insuring your own equipment. Snapt is not liable for loss, theft,
or damage to your equipment during sessions.

9.2. You are responsible for your own conduct and for exercising reasonable care during
sessions. To the maximum extent permitted by law, you indemnify Snapt against claims
arising from your negligence, misconduct, or breach of this Agreement.

10. Suspension, termination, and appeal
10.1. You may stop accepting bookings at any time using the availability toggle, and may
terminate this Agreement at any time by written notice to hello@snaptcarib.app, subject to
completing or lawfully cancelling any confirmed bookings.
10.2. Snapt may suspend or terminate this Agreement: (a) per the strike system in Section 5;
(b) immediately for safety, legal, or fraud reasons; or (c) with 30 days'' notice for any other
reason.
10.3. On termination, pending payouts for properly completed work are paid out after the
standard holding period, less any amounts withheld under Section 4.5.
10.4. Appeals of suspensions or removals may be submitted to hello@snaptcarib.app and
are handled under the Dispute Resolution Policy.

11. General
11.1. This Agreement is governed by the laws of Saint Lucia. [Attorney to confirm dispute
forum/arbitration clause.]
11.2. Snapt may update this Agreement with at least 30 days'' notice. Continued use of the
platform as a Creator after the effective date of changes constitutes acceptance.
11.3. If any provision is held unenforceable, the remainder continues in effect.
Accepted by the Creator electronically through the Snapt application flow. Date and
identity of acceptance are recorded by the platform.', 'published', true),
  ('trust-safety', 1, 'Trust & Safety Policy', 'Snapt — Trust & Safety Policy (Community Guidelines)
Effective date: [Insert date] Contact: hello@snaptcarib.app

Snapt connects real people for in-person photo and video sessions. That only works if
everyone — clients and creators — can trust that the person they''re meeting is who they say
they are and will treat them with respect. This policy sets the standards of behavior on
Snapt and explains what happens when they''re broken. It applies to everyone who uses the
platform, in the app and during sessions.

1. Our safety foundations
Creator vetting. Every creator offering in-person sessions completes identity
verification and a background check before approval.
Session check-in. Every in-person session begins with a safety code exchange: your
creator must verify the code shown in your app before the session starts. Never
proceed with a session if the code exchange doesn''t happen — it means the person in
front of you may not be your assigned creator.
In-app communication. All pre-session communication happens through in-app
chat. Keep it there — it protects both sides and gives us a record if something goes
wrong.
Payments stay on-platform. Never pay, or accept payment, outside the app. Offplatform payment removes every protection this policy provides.

2. Standards for everyone
All users must:
Treat others with respect and courtesy, in chat and in person.
Be truthful in profiles, bookings, and communications.
Show up on time to confirmed sessions, or cancel/reschedule properly through the
app.
Respect others'' privacy. Do not share another user''s personal information, images, or
location.
Comply with all applicable laws.
The following are prohibited for all users, without exception:
Harassment, intimidation, threats, or stalking.
Discrimination or hate speech based on race, colour, religion, sex, gender identity,
sexual orientation, disability, nationality, or any similar characteristic.
Sexual advances, sexual comments, or requests for sexual content or contact in
connection with any booking.
Violence or threats of violence.
Attending a session impaired by alcohol or drugs.

Bringing unannounced third parties to a session in a way that makes the other party
feel unsafe.
Fraud, misrepresentation, or use of another person''s identity or account.
Any activity involving the exploitation or endangerment of minors. This results in
immediate permanent removal and, where appropriate, referral to law enforcement.
See the Snapt Minor Safety & Age Policy.

3. Additional standards for creators
Creators are professionals working with members of the public and are held to a higher
standard:
Complete the safety check-in for every session, every time.
Photograph or film only what the booking covers and only people who have
consented to be photographed.
No physical contact with clients beyond what is strictly necessary and consented to
(e.g., adjusting a pose only with explicit permission).
Never solicit clients off-platform, request extra payment, or ask for tips.
Follow the Snapt Minor Safety & Age Policy without exception for any session
involving anyone under 18.

4. Additional standards for clients
The meeting point you set must be a genuine, safe, publicly appropriate location for
the session booked.
The people present at your session must be as described in your booking.
Requests to the creator must stay within the scope of the booked service. Creators
have the right to decline requests outside that scope, or that make them
uncomfortable, without penalty.

5. During a session: if something feels wrong
Either party may end a session at any time if they feel unsafe. Safety always comes before
completing a booking.
If you feel unsafe, leave the situation first, then report through the app or to
hello@snaptcarib.app.
If you are in immediate danger, contact local emergency services (911 in Saint Lucia)
before anything else.
A session ended for genuine safety reasons will not automatically penalize the person
who ended it. Each case is reviewed individually.

6. Reporting
You can report a user, session, or piece of content:
From the relevant booking or profile screen in the app ("Report a Problem"); or
By email to hello@snaptcarib.app.

Reports are reviewed by our team. We may contact you for more information. We do not
disclose the identity of reporters to the person reported, except where required by law.
We do not tolerate retaliation. Penalizing, threatening, or harassing someone for making a
good-faith report is itself a violation of this policy.

7. Enforcement
Depending on severity and history, violations may result in:
A warning;
Removal of content;
Temporary suspension of the account;
Permanent removal from the platform;
Withholding of payouts connected to the violation (creators); and/or
Referral to law enforcement.
Safety-related violations — including harassment, sexual misconduct, violence, and any
violation involving a minor — may result in immediate permanent removal without prior
warning, regardless of prior history.
Reliability issues (cancellations, no-shows) are handled under the strike system described
in the Cancellation & Refund Policy and Creator Agreement.

8. Appeals
If you believe an enforcement action against you was made in error, you may appeal by
emailing hello@snaptcarib.app within 14 days of the action. Appeals are handled under
the Snapt Dispute Resolution Policy. Actions taken for the safety of other users may remain
in effect while an appeal is reviewed.

9. Changes
We may update this policy as the platform grows. Material changes will be communicated
in the app.
Questions or reports: hello@snaptcarib.app', 'published', false),
  ('content-usage', 1, 'Content & Usage Policy', 'Snapt — Content & Usage Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

This policy explains what content may and may not be created, uploaded, or delivered
through Snapt, and who owns and can use content once it''s delivered. It applies to clients
(including footage you upload for editing) and creators (including everything you shoot
and deliver through the platform).

1. Ownership of delivered content
1.1. Final deliverables belong to the client. Once a session or editing order is completed
and paid, the client owns the final edited photos and videos delivered through the platform,
and may use them for personal or commercial purposes without further permission or
payment.
1.2. Raw footage stays in the platform. Raw, unedited footage captured by a creator is never
delivered to or accessible by clients. It is retained and deleted according to the Snapt Data
Retention Policy. Clients who want additional edits from a past session''s raw footage can
order them as a new editing order while the footage is retained.
1.3. Client-uploaded footage remains the client''s. Footage a client uploads for remote
editing remains the client''s property. Editors receive access solely to perform the edit.

2. Portfolio and marketing use
2.1. Creators may feature delivered work in their Snapt profile portfolio only with the
client''s consent, requested and recorded through the app.
2.2. Snapt may feature delivered work in platform marketing only where both the client
and the creator have consented.
2.3. Consent can be withdrawn at any time by emailing hello@snaptcarib.app, and the
content will be removed from portfolio/marketing use within a reasonable period.
2.4. Neither creators nor Snapt will use content involving minors for portfolio or marketing
purposes without explicit written consent from the minor''s parent or legal guardian.

3. Prohibited content and uses
The following may not be created, uploaded, requested, edited, or delivered through Snapt:
Content involving the sexual depiction of anyone, and any sexualized content
involving a minor in any form — the latter results in immediate permanent removal
and referral to law enforcement.
Content of people who have not consented to being photographed or filmed, where
consent would reasonably be required (private individuals as the subject of the shoot).
Incidental background passersby in public spaces are not a violation.
Content intended to harass, threaten, defame, or embarrass any person.

Deceptive manipulated content, including edits that place a real person in a
fabricated situation in a way intended to deceive (deepfake-style edits), or
impersonation of any person.
Content that infringes intellectual property — including footage the uploader has no
rights to, and edits incorporating unlicensed music, logos, or third-party material.
Content documenting or facilitating illegal activity.
Hate content, including symbols or messaging promoting hatred or violence against
protected groups.
Graphic violence or gore.

4. Client responsibilities when uploading footage
By uploading footage for editing, you confirm that:
You own the footage or have the right to have it edited;
Everyone identifiable in the footage consented to being filmed (where consent is
reasonably required); and
The footage and your requested edit comply with Section 3.

5. Creator responsibilities
Creators must:
Shoot only within the scope of the booking and with the consent of the people being
photographed;
Decline and report client requests that violate Section 3 — declining a prohibited
request will never count against a creator;
Use only properly licensed music, fonts, stock assets, and other materials in edits; and
Never share, publish, sell, or reuse client footage or deliverables outside the platform
without consent (see the Creator Agreement, Section 8).

6. Moderation
Content uploaded or delivered through Snapt may be reviewed by our moderation team,
including proactively and in response to reports. We may remove content, cancel orders,
suspend accounts, or take other action under the Trust & Safety Policy where this policy is
violated. Where we cancel an order due to a client''s violation of this policy, no refund is
owed. Where a creator''s deliverable violates this policy, the client is refunded and the
creator receives no payout for that order.

7. Reporting content
Report content concerns through "Report a Problem" in the app or at
hello@snaptcarib.app.

8. Changes
We may update this policy from time to time. Material changes will be communicated in the
app.', 'published', false),
  ('payment-payout', 1, 'Payment & Payout Policy', 'Snapt — Payment & Payout Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

This policy explains how money moves on Snapt: what clients pay, when they''re charged,
what creators earn, and when payouts happen. It should be read together with the
Cancellation & Refund Policy and, for creators, the Creator Agreement.

1. Pricing
1.1. All prices on Snapt are standardized platform prices. Creators do not set their own
rates, and prices are not negotiable. The price shown at checkout is the price — no tipping is
expected or supported, and no one may request payment outside the app.
1.2. Prices shown include the package price plus the client service fee (Section 3), each
shown as a separate line item before payment.

2. Currency
2.1. Snapt operates in US Dollars (USD) as its base currency. All amounts are stored and
processed in USD.
2.2. You may choose to display prices in Eastern Caribbean Dollars (XCD) in your app
settings. XCD amounts are display conversions at the fixed peg of 2.70 XCD = 1.00 USD.
Your payment method is charged in USD; your bank or card issuer determines any
conversion applied on their side.

3. Client charges
3.1. Service fee. An 8% client service fee is added to each order, shown as its own line item
at checkout. This fee supports platform operations including creator vetting, matching,
secure payments, and support.
3.2. When you''re charged. Payment is collected in full at the time of booking, via our
payment processor (Stripe). Your booking is not confirmed until payment succeeds.
3.3. Failed payments. If payment fails, the booking is not created. If a post-booking charge
fails (e.g., a late-cancellation fee where a refund adjustment applies), we may retry the
payment method on file and suspend further bookings until resolved.
3.4. Add-ons. Additional paid revision rounds and other add-ons are charged at the time
you order them.

4. Refunds
Refund eligibility is governed by the Cancellation & Refund Policy. Approved refunds are
returned to the original payment method, in USD, typically within 5–10 business days
depending on your bank.

5. Creator earnings
5.1. Platform fee. Snapt deducts a 32% platform fee from the gross order price. The
creator''s payout is the remaining 68%. The fee reflects the full cost of operating the
platform in the Caribbean, including payment processing, vetting, matching, hosting, and
support.
5.2. Promotional rates. Snapt may offer reduced promotional fee rates for limited periods.
Where a promo rate applies, the Earnings screen shows the standard rate struck through
alongside the promo rate applied.
5.3. Earnings states. Earnings appear in the Earnings screen as:
Pending — the order is completed but within the holding window;
Available — cleared for payout;
Paid out — transferred to your connected payout account.

5.4. Holding window. Completed order earnings are held for 48–72 hours before becoming
Available, to accommodate revision requests and dispute checks.
5.5. Payouts are made in USD via Stripe Connect to the creator''s connected account.
Creators are responsible for keeping their payout account valid and for any fees their own
bank applies to incoming transfers.
5.6. Withholding. Earnings connected to an open dispute, chargeback, suspected fraud, or
policy investigation may be withheld until the matter is resolved, per the Creator
Agreement.

6. Chargebacks and payment disputes
If you believe you were charged incorrectly, contact hello@snaptcarib.app before initiating
a chargeback with your bank — most issues are resolved faster this way. Chargebacks filed
on legitimate charges may result in account suspension while the matter is investigated.

7. Taxes
Prices shown [include / exclude — confirm with attorney/accountant] applicable taxes.
Creators are independent contractors responsible for their own tax obligations on earnings,
per the Creator Agreement.

8. Changes
Fee levels and this policy may change over time. Fee changes apply prospectively only: the
fees in effect when a booking is placed are the fees that apply to that booking. Creators
receive at least 30 days'' notice of standard platform fee changes.
Questions about a charge or payout: hello@snaptcarib.app', 'published', false),
  ('data-retention', 1, 'Data Retention Policy', 'Snapt — Data Retention Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

This policy explains how long Snapt keeps different categories of data and what happens
when retention periods end. It supplements the Snapt Privacy Policy. Where this policy and
the Privacy Policy differ, the Privacy Policy controls the what and why of collection; this
policy controls the how long.
DRAFT — retention periods below are proposed defaults and must be confirmed
against Saint Lucian legal requirements (tax, financial record-keeping, and data
protection law) before adoption.

1. Principles
We keep personal data only as long as needed for the purpose it was collected, to meet
legal obligations, or to resolve disputes.
When a retention period ends, data is deleted or irreversibly anonymized.
Backups containing expired data are purged on the backup rotation cycle, within [30–
90] days of primary deletion.

2. Retention schedule
Data category

Retention period

Notes

Account profile (name,
email, phone, settings)

Life of account + 90 days after deletion
request

Grace period allows
accidental-deletion recovery

Identity documents
(creator vetting)

Duration of creator status + [12]
months

Kept only as long as needed to
evidence vetting; encrypted at
rest, restricted access

Background check
results

Pass/fail outcome retained for duration
of creator status + [12] months; full
report retained only as long as
required by the check provider/law

Minimize what is stored;
prefer storing outcome only

Raw session footage

[90] days after order completion,
then permanently deleted

Client is notified of the
deletion window; re-edit
orders must be placed within it

Final delivered content

[12] months after delivery in-platform

Clients should download their
content; in-app availability is a
convenience, not permanent
storage

Client-uploaded footage [90] days after order completion
(remote edit orders)

Same as raw footage

In-app chat logs

[24] months from last message

Needed for dispute resolution
and safety investigations

Booking and
transaction records

[7] years

Financial/tax record-keeping
requirement — confirm exact
period under Saint Lucian law

Location data (meeting
points, live GPS during
sessions)

Meeting points: life of booking record.
Live GPS traces: [30] days after
session

GPS traces kept briefly for
safety/dispute purposes only

Ratings and reviews

Life of the rated account

Anonymized if the authoring
account is deleted

Strike/reliability records Rolling 60-day active window;
(creators)
historical log retained for duration of
creator status

Active consequences use the
rolling window only

Support tickets and
reports

Safety-related reports may be
kept longer where needed to

[24] months after closure

Data category

Retention period

Notes

protect users
Payment card details

Not stored by Snapt

Held by Stripe; we store only
tokens and last-4/brand
metadata

Marketing consents and Until withdrawn + proof of consent for
preferences
[24] months

3. Account deletion
When you delete your account (Profile → Delete Account) or request deletion at
hello@snaptcarib.app:
Profile data is deleted after the 90-day grace period;
Content and footage follow the schedule above rather than being deleted
immediately, where retention is still required (e.g., an open order or dispute);
Transaction records are retained for the legally required financial period even after
account deletion, in minimized form;
Data needed for an open dispute, investigation, or legal obligation is retained until
that matter concludes, then deleted.

4. Legal holds
Where data is subject to a legal claim, law-enforcement request, or regulatory obligation,
the affected data is preserved until the hold is released, notwithstanding the schedule
above.

5. Security during retention
Retained data is protected per our security practices: identity and background check
documents are encrypted at rest with access restricted to authorized vetting personnel; raw
footage is accessible only to the assigned creator/editor and authorized moderation staff,
never to clients or other users.

6. Changes
We may update this schedule as legal requirements and platform features evolve. Material
changes will be reflected in the app and on this page.
Questions or deletion requests: hello@snaptcarib.app', 'published', false),
  ('minor-safety', 1, 'Minor Safety & Age Policy', 'Snapt — Minor Safety & Age Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

Family shoots, birthday parties, christenings, school events — sessions involving children
are a normal and welcome part of what Snapt is for. This policy exists to make sure they
happen safely, with the right adults involved and the right consent in place, every time. It
applies to all users and all bookings.

1. Age requirements for accounts
1.1. You must be at least 18 years old to create a Snapt account, book a session, upload
footage, or apply to be a creator. Accounts found to belong to anyone under 18 are removed.
1.2. Creators must be at least 18 and complete identity verification and (for in-person
services) a background check before approval.

2. Minors as session subjects
Minors (anyone under 18) may be photographed or filmed in a Snapt session only under all
of the following conditions:
2.1. The booking client is a parent or legal guardian of the minor, or has the documented
authorization of the parent/guardian (e.g., booking a shoot for a school or community event
with organizer authority).
2.2. A responsible adult is present for the entire session. A creator must never be alone
with a minor at any point. If the supervising adult leaves, the creator must pause the session
until they return.
2.3. The booking accurately discloses that minors will be involved. [Product note: add a
"session includes children under 18" disclosure to the booking flow so this is captured
structurally, not just by policy.]
2.4. Consent for the shoot comes from the parent/guardian, not the minor. For minors old
enough to express a preference, their comfort matters too — creators must stop
photographing any child who is distressed or unwilling, regardless of guardian instruction.

3. Standards for sessions involving minors
Content must be age-appropriate in every respect: activities, poses, wardrobe, and
setting. Nothing sexualized involving a minor is ever acceptable in any form, context,
or degree — violations result in immediate permanent removal and referral to law
enforcement.
Creators must direct all communication about the session to the supervising adult, not
the child.
Creators must not request or exchange contact information with a minor,
communicate with a minor outside the session, or arrange to meet a minor outside a
booked, supervised session.

No images of a minor may be used for creator portfolios or Snapt marketing without
explicit written parent/guardian consent (see Content & Usage Policy, Section 2.4).

4. Uploaded footage involving minors
Clients uploading footage for remote editing that includes minors confirm they are the
parent/guardian of the minors shown, or have the parent/guardian''s authorization. All
Section 3 content standards apply equally to uploaded and edited footage.

5. Reporting
Anyone with a concern about a minor''s safety in connection with Snapt — a session,
content, or behavior — should report it immediately via "Report a Problem" in the app or
hello@snaptcarib.app. Reports involving minors are treated at the highest priority.
If a child is in immediate danger, contact local emergency services (911 in Saint Lucia) first.

6. Enforcement
Violations of this policy result in immediate suspension pending review at minimum. Any
sexual, exploitative, or grooming behavior involving a minor results in immediate
permanent removal from the platform and referral to law enforcement, and Snapt will
cooperate fully with any resulting investigation.

7. Changes
We may update this policy from time to time. Material changes will be communicated in the
app.', 'published', false),
  ('dispute-resolution', 1, 'Dispute Resolution Policy', 'Snapt — Dispute Resolution Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app

Most issues on Snapt are resolved directly: a revision request fixes an editing concern, a
reschedule fixes a timing conflict. This policy covers what happens when they aren''t —
when a client and creator disagree about what happened or what''s owed, or when someone
appeals an enforcement action. It should be read with the Cancellation & Refund Policy,
Trust & Safety Policy, and Creator Agreement.

1. What counts as a dispute
Quality disputes — delivered content allegedly does not meet the package
specification (e.g., far fewer photos than the stated range, unusable footage), after the
included revision round has not resolved it.
Fulfillment disputes — disagreement over whether a session happened as booked,
including contested no-shows, sessions cut short, or sessions that materially deviated
from the booking.
Conduct disputes — reports of behavior during a session, handled primarily under
the Trust & Safety Policy, with any financial outcome resolved under this policy.
Enforcement appeals — appeals of strikes, suspensions, removals, or withheld
payouts.

Simple refund eligibility under the published cancellation tiers is not a dispute — it''s
applied automatically per the Cancellation & Refund Policy.

2. Step one: the revision round (quality issues)
For concerns about delivered content, the included free revision round is the required first
step. Describe specifically what needs to change; the creator completes the revision in good
faith. Most quality concerns end here. A quality dispute may be opened only if the revised
delivery still allegedly fails to meet the package specification.

3. Opening a dispute
3.1. Open a dispute from the relevant booking in the app ("Report a Problem") or by
emailing hello@snaptcarib.app with the booking reference.
3.2. Time limit: disputes must be opened within 7 days of the session date or content
delivery (whichever is later). This aligns with the payout schedule — creator earnings clear
shortly after the holding window, and late disputes limit what remedies remain available.
3.3. When a dispute is opened before payout clears, the affected amount is held until
resolution. Neither refund nor payout is finalized while the dispute is open.

4. How disputes are reviewed
4.1. Both parties are notified and may submit their account of events and supporting
evidence within 72 hours of being notified.

4.2. Evidence Snapt considers includes: in-app chat logs; booking details, check-in records,
and safety code verification status; timestamps and session GPS records where available;
the delivered content measured against the package specification; and both parties''
statements and history on the platform.
4.3. Snapt''s review team assesses the evidence and issues a decision, normally within 5
business days of the evidence deadline. Complex cases may take longer; both parties are
informed if so.

5. Possible outcomes
Depending on findings, outcomes may include one or more of:
Full or partial refund to the client;
Full, partial, or no payout to the creator;
A required additional revision at no charge;
A fee-free rebooking;
Removal or adjustment of a strike;
Enforcement action under the Trust & Safety Policy; or
No change, where the evidence supports the original outcome.
Where evidence is genuinely inconclusive in a fulfillment dispute, Snapt may resolve in
favor of the client on refund while still compensating the creator in whole or part, at Snapt''s
discretion — the cost of genuine ambiguity should not fall entirely on either party.

6. Appeals
6.1. Either party may appeal a dispute decision, or an enforcement action, within 14 days by
emailing hello@snaptcarib.app with the case reference and the specific grounds (new
evidence or a material error in the review).
6.2. Appeals are reviewed by someone other than the original decision-maker where team
size allows. The appeal decision is Snapt''s final internal determination.

7. Chargebacks
Filing a card chargeback while a Snapt dispute is open, or after accepting a dispute
resolution, may result in account suspension while the chargeback is contested. We
strongly encourage using this process first — it is faster and preserves your account
standing.

8. Legal rights
Nothing in this policy limits any non-waivable rights you have under applicable law,
including consumer protection law in Saint Lucia. This policy is Snapt''s internal resolution
process, not a substitute for legal remedies. [Attorney to confirm interaction with
governing-law and forum clauses in the Terms of Service.]

9. Changes
We may update this policy from time to time. The version in effect when a dispute is opened
governs that dispute.
Open or ask about a dispute: hello@snaptcarib.app', 'published', false),
  ('background-check', 1, 'Background Check & Vetting Disclosure', 'Snapt — Background Check & Vetting Disclosure and Consent
Effective date: [Insert date] Contact: hello@snaptcarib.app
DRAFT — REQUIRES LEGAL REVIEW. Background check disclosure and consent
requirements are jurisdiction-specific. This document must be reviewed against Saint
Lucian law (and the laws of any territory Snapt expands into) and against the chosen
background check provider''s requirements before use. The provider is not yet selected;
bracketed sections depend on that selection.

This disclosure explains what Snapt checks when you apply to become a creator, how the
results are used, and what rights you have in the process. You will be asked to consent to
this disclosure as part of your creator application. In-person service applicants only —
applicants offering remote editing services only are subject to identity verification but not a
background check.

1. What we verify
All creator applicants (identity verification):

That your government-issued ID is authentic and matches the identity on your
application;
Your name, date of birth, and that you are at least 18.
In-person service applicants (background check), conducted through [background
check provider name]:

Criminal record check in Saint Lucia [and/or your country of residence — providerdependent];
[Sex offender / child protection registry check, where such a registry exists and is
lawfully searchable — provider and jurisdiction dependent];
[Any additional checks the selected provider performs — enumerate exactly once
provider is chosen. Do not list checks that are not actually performed.]
We do not check: your credit history, your social media, or your medical information.

2. Your consent
By accepting this disclosure in the application flow, you authorize Snapt and its
background check provider to perform the checks listed above, and to obtain records from
relevant authorities and registries for that purpose. You may decline — in which case your
application for in-person services cannot proceed, though you may still apply for remote
editing services.

3. How results are used
3.1. Results are used solely to decide whether you can be approved for in-person creator
services, and for periodic re-verification (Section 6).

3.2. Results are reviewed by authorized Snapt vetting personnel only. Results are never
shown to clients — clients see only that a creator has been vetted, never any underlying
detail.
3.3. Not every record results in a decline. Findings are assessed for relevance to the safety of
in-person sessions with members of the public, considering the nature of any offence, its
recency, and its seriousness. Offences involving violence, sexual misconduct, or crimes
against children are disqualifying.

4. If your application is declined based on check results
4.1. You will be notified that vetting results affected the decision.
4.2. You may request the substance of the finding relied upon by emailing
hello@snaptcarib.app, subject to what the provider and law permit us to share.
4.3. If you believe the record is inaccurate or belongs to someone else, tell us within 14
days. We will pause the final decision, ask the provider to re-verify, and correct the outcome
if the record was wrong. [Confirm provider''s dispute mechanism and integrate exact steps
here.]

5. Data handling
ID documents and check outcomes are stored encrypted, with access restricted to
authorized vetting personnel, and retained per the Snapt Data Retention Policy.
Wherever possible, Snapt stores only the outcome of a check (approved / not
approved and category of concern), not full report contents. [Confirm what the
provider requires/permits.]
Your check data is never sold, never used for marketing, and never shared with clients
or other creators.

6. Re-verification
Approval is not permanent. Snapt may re-run checks periodically [e.g., every 24 months]
and following a credible safety report. Continued creator status is conditioned on passing
re-verification, and you will be asked to renew consent at that time.

7. Questions
Questions about the vetting process, your data, or a decision: hello@snaptcarib.app
Consent record: acceptance of this disclosure is captured electronically in the creator
application flow, with the date, time, and version of this document recorded.', 'published', true),
  ('accessibility', 1, 'Accessibility Statement', 'Snapt — Accessibility Statement
Effective date: [Insert date] Contact: hello@snaptcarib.app

Snapt is for everyone, and we want the app to be usable by everyone — including people
who rely on assistive technologies like screen readers, or who need larger text, higher
contrast, or reduced motion.

Our commitment
We aim for the Snapt mobile app to conform to the Web Content Accessibility Guidelines
(WCAG) 2.1 Level AA as applied to mobile applications, and to work well with the
accessibility features built into iOS and Android, including:
Screen readers (VoiceOver on iOS, TalkBack on Android);
Dynamic type / system font scaling;
Sufficient color contrast, with meaning never conveyed by color alone;
Touch targets sized for comfortable use;
Reduced motion preferences.

Where we are today
Snapt is a new product, and we are honest about being early in this work. We are actively
testing the app with assistive technologies and addressing issues as we find them. Known
limitations at this time include: [list current known gaps once an accessibility pass has been
done — e.g., specific screens not yet fully labeled for screen readers].

Alternatives while we improve
If any part of the app is not accessible to you — including booking a session, managing a
booking, or contacting support — email us at hello@snaptcarib.app and we will complete
the task with you directly, at no disadvantage in pricing or priority.

Feedback
If you encounter an accessibility barrier in Snapt, please tell us at hello@snaptcarib.app.
Include the screen or task, your device and OS version, and the assistive technology you
use, if any. Accessibility reports go to our product team and genuinely shape what we fix
next.

Review
We review this statement, and our accessibility progress, at least [annually].', 'published', false),
  ('notifications', 1, 'Notification Policy', 'Snapt — Notification Trigger Mapping
Drafted: July 26, 2026 Status: Working reference document. Not yet implemented — this is
the source of truth for building Firebase Cloud Messaging (push) and the in-app
Notifications inbox logic.

How to read this
Push = device-level notification via Firebase Cloud Messaging, delivered even when
the app is closed.
In-app = appears in the Notifications inbox inside the app, no device push.
Default rule applied throughout: push is used when the event is time-sensitive,
requires action, or involves money/safety. In-app only is used when the event is
informational and can wait until the user next opens the app. Internal events never
push to end users at all — they route to the Admin Portal instead (see Section 7).
Rows marked [JUDGMENT CALL] are places I made a reasonable default without an
explicit decision from you — check these specifically.

1. Booking lifecycle
Trigger

Recipient

Booking confirmed

Client +
Creator

Creator assigned/matched Client

Push Inapp

✅

✅

✅

✅

✅

✅

✅

❌

Session reminder — 24
hours out

Client +
Creator

Session reminder — 2
hours out [JUDGMENT
CALL]

Client +
Creator

Creator cancelled
booking

Client

✅

✅

Client cancelled booking

Creator

❌

✅

Booking rescheduled
(new time confirmed)

Client +
Creator

✅

✅

Notes

Immediate confirmation both sides need

If matching is instant at booking time,
this may merge with "Booking
confirmed" — confirm once matching
latency is known

Not in your original list — added as best
practice; a same-day reminder
meaningfully reduces no-shows and is
worth the extra push
Time-sensitive, ties directly into
refund/rematch flow
[JUDGMENT CALL] No action required
from creator, just frees their slot — in-app
is sufficient

2. Session day
Trigger

Recipient

Push Inapp

Creator "on the
way"

Client

✅

❌

Creator checked
in / session started

Client

✅

✅

Session ended

Client +
Creator

❌

✅

Notes

[JUDGMENT CALL] Purely live/timesensitive, no lasting value in the inbox
afterward

[JUDGMENT CALL] Informational, sets nextstep state (editing/processing) but not urgent

3. Delivery & revisions
Trigger

Recipient

Push Inapp

Notes

Footage submitted by
creator

Internal
only

—

—

Routes to Editing Workspace queue, not
client-facing at all

Edit ready / delivered

Client

Revision requested

Creator

Revision delivered

Client

✅
✅
✅

✅
✅
✅

This is the payoff moment — always push
Actionable, creator needs to respond

4. Money
Trigger

Recipient Push Inapp

Payment charged (booking
confirmation receipt)

Client

❌

✅

Cancellation/reschedule fee
charged

Client

✅

✅

Refund issued

Client

✅

✅

Earnings available for
payout

Creator

❌

✅

Payout sent

Creator

✅

✅

Notes

[JUDGMENT CALL] Routine,
expected, receipt-style — no need to
interrupt
[JUDGMENT CALL] Unlike a routine
charge, this is often unexpected to the
user in the moment — push for
transparency, avoid "surprise charge"
support tickets

People actively wait on refunds — push
reduces anxiety and support volume
[JUDGMENT CALL] Not timesensitive, they''ll see it next time they
check Earnings

Confirms money actually moved —
creators want this pushed

5. Creator application & status
Trigger

Recipient Push Inapp

Application submitted

Creator

Application approved

Creator

❌
✅

✅
✅

Application declined

Creator

✅

✅

Specialty/profile updated
successfully

Creator

❌

✅

Notes

Confirmation only
Meaningful milestone, they can now
receive bookings
Needs to reach them reliably even if
they''ve stopped checking the app
Low-stakes confirmation

6. Trust & safety / disputes
Trigger

Recipient

Report received
(acknowledgment)

Reporting
user

Dispute opened

Both
parties

Dispute resolved

Both
parties

Strike issued

Suspension applied

Push Inapp

❌

✅

✅

✅

✅

✅

Creator

✅

✅

Creator

✅

✅

Notes

[JUDGMENT CALL] Confirms receipt
without implying urgency has passed —
avoid a push that might feel dismissive right
after a safety event

Actionable — evidence window is only 72
hours per the Dispute Resolution Policy,
push is necessary

May carry appeal window, needs to reach
them reliably
Account-impacting, always push, always
with reason stated per policy

7. Internal / Admin-only alerts (not user-facing)
These never generate a push or in-app notification to the client or creator involved. They
route to the Admin Portal instead, and — given the severity spread here — probably need
their own escalation tiering, not just a dashboard list.

Trigger

Routed to

Suggested urgency

SOS / safety report
filed during active
session

Admin Portal,
high-priority
queue

Immediate — recommend this also triggers an
email alert (via Resend) to on-call staff, not just a
dashboard entry, given the real-time safety stakes

General "Report a
Problem" submission

Admin Portal,
standard queue

Standard

Content moderation
flag

Admin Portal,
moderation queue

Standard, escalates if repeated

Creator reaching
3rd/4th cancellation
strike

Admin Portal,
creator review
queue

Standard

Background check
flagged/failed

Admin Portal,
vetting queue

Standard

This is worth flagging on its own: the SOS feature we just designed is only as good as what
happens after it''s filed. A safety report sitting unopened in an admin queue overnight
defeats the purpose. Once the Admin Portal is scoped, on-call alerting for this specific
category should be treated as a requirement, not a nice-to-have.

8. Not yet decided
New booking request to creator — only needed if creator matching isn''t
instant/automatic (e.g., if creators can accept/decline rather than being autoassigned). Current build implies auto-matching, so this may not apply — confirm.
Emergency contact share — this goes to a non-Snapt-user email address, sent via
Resend, not a push/in-app notification at all. Snapt does not use SMS anywhere in the
product — worth noting so this doesn''t get lost in FCM planning specifically.

9. Build implications
The existing Notifications inbox screen (already built) will need to support
categorization/filtering once this many trigger types exist — worth a quick design
pass so it doesn''t become an undifferentiated wall of items.
Add to backend requirements doc: notification trigger service — a central dispatcher
that listens for these state-change events and fires the correct push/in-app/email
(Resend) combination, rather than notification logic being scattered across individual
features as they''re built. No SMS channel exists in this product.', 'published', false),
  ('terms', 1, 'Terms of Service', 'Snapt — Terms of Service
Effective date: [Insert date] Contact: hello@snaptcarib.app
DRAFT — REQUIRES LEGAL REVIEW. This document has not been reviewed by an
attorney. It must be reviewed against Saint Lucian law before any version of it is
published to real users.

Welcome to Snapt. These Terms of Service ("Terms") govern your access to and use of the
Snapt mobile application and related services (together, the "Platform"), operated by
[Snapt legal entity name] ("Snapt," "we," "us"). By creating an account or using the Platform,
you agree to these Terms.
These Terms work alongside, and incorporate by reference, Snapt''s other published
policies: the Privacy Policy, Cancellation & Refund Policy, Trust & Safety Policy, Content &
Usage Policy, Payment & Payout Policy, Data Retention Policy, Minor Safety & Age Policy,
Dispute Resolution Policy, and — for creators — the Creator Agreement and Background
Check & Vetting Disclosure. Where a specific policy addresses a topic in more detail, that
policy controls on that topic.

1. What Snapt is
Snapt is a marketplace that connects clients seeking photography/videography services
with independent creators who provide those services, either in person or remotely (editing
footage the client already has). Snapt is not itself a photography or editing service
provider. Creators are independent contractors, not Snapt employees, as set out in the
Creator Agreement.

2. Eligibility
You must be at least 18 years old to create an account or use the Platform. By using Snapt,
you confirm you meet this requirement and that all information you provide is accurate.

3. Your account
3.1. You''re responsible for keeping your login credentials secure and for all activity under
your account.
3.2. You must provide accurate information and keep it up to date, including your name,
contact details, and payment information.
3.3. One person, one account. You may not create multiple accounts to evade a suspension
or enforcement action.
3.4. Snapt offers a single app with a client mode and a creator mode. Becoming a creator
requires a separate application and vetting process described in the Creator Agreement.

4. Bookings, pricing, and payment
4.1. All prices on Snapt are standardized platform prices, shown in full (including the client
service fee) before you confirm a booking. Full pricing and fee terms are in the Payment &
Payout Policy.
4.2. Payment is collected at the time of booking through our payment processor. By
booking, you authorize this charge.
4.3. Cancellations, rescheduling, and no-shows are governed by the Cancellation & Refund
Policy — read it before booking, since fees may apply depending on timing.

5. Conduct
5.1. You agree to use the Platform lawfully and in line with the Trust & Safety Policy and
Content & Usage Policy, including standards on harassment, safety, and what content may
be created or uploaded through Snapt.
5.2. You agree not to: circumvent the Platform to transact with a creator or client off-app;
misrepresent your identity; upload or request content that violates the Content & Usage
Policy; interfere with the Platform''s operation; or attempt to access another user''s account
or data.
5.3. Sessions involving anyone under 18 are subject to the Minor Safety & Age Policy
without exception.

6. Content and intellectual property
6.1. Ownership of content created or edited through Snapt is governed by the Content &
Usage Policy. In short: delivered final content belongs to the client; raw footage is retained
on the Platform and never delivered to clients.
6.2. The Snapt name, logo, and app design are Snapt''s intellectual property. You may not
use them without permission, except as reasonably necessary to use the Platform as
intended.

7. Disputes between users
Disagreements between a client and a creator about a booking are handled under the
Dispute Resolution Policy. Snapt is not a party to the underlying service arrangement
between client and creator, but provides this process to help resolve disputes fairly.

8. Disclaimers
8.1. Snapt facilitates bookings between independent creators and clients. We do not
guarantee the quality, safety, legality, or outcome of any session or delivered content,
beyond the specific commitments made in our published policies (such as the revision and
dispute processes).
8.2. The Platform is provided "as is." We work to keep it available and accurate but do not
guarantee uninterrupted or error-free service.

8.3. [Attorney to draft appropriate limitation-of-liability language consistent with Saint
Lucian consumer protection law — a blanket disclaimer of all liability is unlikely to be
enforceable or appropriate and is not included here as a placeholder for that reason.]

9. Suspension and termination
9.1. You may stop using the Platform or delete your account at any time (Profile → Delete
Account), subject to completing or properly cancelling any open bookings.
9.2. We may suspend or terminate your account for violating these Terms or any
incorporated policy, particularly the Trust & Safety Policy, Minor Safety & Age Policy, or
Content & Usage Policy. Creator-specific consequences (strikes, suspension) are detailed in
the Creator Agreement.

10. Changes to these Terms
We may update these Terms from time to time. Material changes will be communicated in
the app, and — where legally required or where the change affects an active consent (such
as the Creator Agreement) — may require your re-acceptance before you can continue
certain activity on the Platform.

11. Governing law
These Terms are governed by the laws of Saint Lucia. [Attorney to confirm dispute
forum/arbitration clause and interaction with the Dispute Resolution Policy''s internal
process.]

12. Contact
Questions about these Terms: hello@snaptcarib.app', 'published', false),
  ('privacy', 1, 'Privacy Policy', 'Snapt — Privacy Policy
Effective date: [Insert date] Contact: hello@snaptcarib.app
DRAFT — REQUIRES LEGAL REVIEW. This document has not been reviewed by an
attorney and must be checked against applicable Saint Lucian data protection
requirements before publication.

This Privacy Policy explains what personal data Snapt collects, why, how it''s used and
shared, and the choices you have. It should be read alongside the Data Retention Policy
(how long we keep data) and, for creators, the Background Check & Vetting Disclosure
(vetting-specific data).

1. What we collect
Account information: name, email, phone number, password (stored encrypted),
country/region, currency preference.
Booking information: service details, dates/times, meeting point location, payment
records, messages exchanged through in-app chat, session check-in and safety-code data.
Creator-specific information (creators only): identity documents, background check
results, specialties, availability, service area, banking/payout details.
Content: photos and video you upload or that a creator captures for you, and the delivered
edited content.
Device and usage information: device type, app version, crash logs, general usage
analytics, and — where you enable it — push notification tokens and approximate location
(for service-area matching and live session features).
Emergency contact information (optional): if you choose to add one, the name and email
address of a person you can share session details with.

We do not collect more than we need for the purpose described, and payment card details
are never stored by Snapt directly — see Section 4.

2. How we use your data
To create and manage your account, and to operate the marketplace (matching,
booking, payment, delivery)
To verify creator identity and eligibility (background checks, per the Background
Check & Vetting Disclosure)
To process payments and payouts
To send you notifications about your bookings, account, and — where you''ve opted in
— promotions (see your in-app Notification Settings)
To investigate safety reports, disputes, and policy violations
To improve the Platform (aggregated/anonymized analytics)

To comply with legal obligations, including financial record-keeping
We do not sell your personal data.

3. Who we share it with
The other party to a booking — a client and creator see the information necessary to
complete the session (name, relevant profile details, meeting point, chat messages).
Raw footage is visible only to the assigned creator/editor, never to the client, per the
Content & Usage Policy.
Service providers who help us operate: Supabase (database/auth), Cloudflare (file
storage), Stripe (payments), Firebase (push notifications), Resend (email), and our
background check provider (creator identity/vetting only). These providers process
data on our behalf under their own data protection commitments.
Emergency contacts, only when you actively use "Share my session," and only the
specific session details, not your full account data.
Legal and safety exceptions: we may disclose data where required by law, to protect
someone''s safety, or to investigate a Trust & Safety violation.
We do not share your data with advertisers, and Snapt does not run third-party ad
networks in the app.

4. Payments
We use Stripe to process payments. Snapt does not store your full card number — only a
payment token and limited metadata (card brand, last 4 digits) needed to display your
saved payment methods.

5. Data retention
How long we keep each category of data is set out in the Data Retention Policy. In short: we
keep data only as long as needed for the purpose collected, legal record-keeping
requirements, or active disputes, then delete or anonymize it.

6. Your rights and choices
Access and correction: you can view and update most of your information directly in
Profile → Edit Profile.
Notification preferences: control what you''re notified about in Profile → Notification
Settings (certain account/security/safety notifications cannot be turned off).
Account deletion: Profile → Delete Account. See the Data Retention Policy for what
happens to your data afterward.
Data requests: you may ask what data we hold about you, request a copy, or request
deletion beyond what standard account deletion covers, by emailing
hello@snaptcarib.app. [Attorney to confirm specific rights available under Saint
Lucian law and any applicable regional frameworks as Snapt expands.]

7. Children
Snapt accounts are not available to anyone under 18. Where minors appear as subjects of a
session (e.g., a family shoot), that''s governed by the Minor Safety & Age Policy, not by
minors holding their own account or data relationship with Snapt.

8. International data
Snapt''s infrastructure providers may process data outside Saint Lucia. Where this happens,
we require providers to maintain appropriate safeguards. [Attorney to confirm specific
transfer mechanism language required.]

9. Security
We use reasonable technical and organizational measures to protect your data, including
encryption of sensitive data at rest (such as identity documents) and access controls
restricting who at Snapt can view sensitive records. No system is completely secure, and we
encourage you to use a strong, unique password.

10. Changes to this policy
We may update this Privacy Policy from time to time. Material changes will be
communicated in the app.

11. Contact
Questions or requests about your data: hello@snaptcarib.app', 'published', false);
update policy_documents set published_at = now() where status = 'published';

-- ---------------------------------------------------------------------------
-- LOCAL-ONLY demo creators (mirror lib/mock/data.ts). seed.sql never runs in
-- production. Password for all: "password1234". Profiles rows are created by
-- the on_auth_user_created trigger; we then flip them to approved creators.
-- ---------------------------------------------------------------------------

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jordan@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Jordan M."}', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'amara@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Amara J."}', now(), now()),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marcus@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Marcus D."}', now(), now()),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nia@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Nia T."}', now(), now()),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sam@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Sam R."}', now(), now());

-- GoTrue requires empty strings (not NULLs) in these token columns for
-- manually inserted users, or password logins 500.
update auth.users set
  confirmation_token = '', recovery_token = '', email_change = '',
  email_change_token_new = '', email_change_token_current = '',
  phone_change = '', phone_change_token = '', reauthentication_token = ''
  where id in (
    '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005');

update profiles set mode = 'creator'
  where id in (
    '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005');

-- Placeholder avatars (external placeholder service) so Creator Assignment
-- cards are visually distinct during local testing. NOT the real avatar
-- pipeline — creator photo upload to Cloudflare R2 is Phase 3.
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=12' where id = '00000000-0000-4000-8000-000000000001';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=47' where id = '00000000-0000-4000-8000-000000000002';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=53' where id = '00000000-0000-4000-8000-000000000003';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=44' where id = '00000000-0000-4000-8000-000000000004';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=59' where id = '00000000-0000-4000-8000-000000000005';

-- Weekly availability template: {"mon": [{"start": "09:00", "end": "17:00"}], ...}
insert into creator_profiles
  (user_id, vetting_status, background_check_status, background_check_completed_at,
   specialties, service_radius_km, base_area, verified, availability)
values
  ('00000000-0000-4000-8000-000000000001', 'approved', 'passed', now(), '{Portraits,Wedding,Events}', 15, 'Rodney Bay', true,
    '{"mon": [{"start": "09:00", "end": "17:00"}], "tue": [{"start": "09:00", "end": "17:00"}], "wed": [{"start": "09:00", "end": "17:00"}], "thu": [{"start": "09:00", "end": "17:00"}], "fri": [{"start": "09:00", "end": "17:00"}], "sat": [{"start": "08:00", "end": "18:00"}]}'),
  ('00000000-0000-4000-8000-000000000002', 'approved', 'passed', now(), '{Family,Portraits,Social,Wedding}', 20, 'Gros Islet', true,
    '{"tue": [{"start": "10:00", "end": "18:00"}], "wed": [{"start": "10:00", "end": "18:00"}], "thu": [{"start": "10:00", "end": "18:00"}], "fri": [{"start": "10:00", "end": "18:00"}], "sat": [{"start": "08:00", "end": "18:00"}], "sun": [{"start": "08:00", "end": "14:00"}]}'),
  ('00000000-0000-4000-8000-000000000003', 'approved', 'pending', null, '{Events,Social}', 10, 'Castries', false,
    '{"mon": [{"start": "12:00", "end": "20:00"}], "wed": [{"start": "12:00", "end": "20:00"}], "fri": [{"start": "12:00", "end": "20:00"}], "sat": [{"start": "10:00", "end": "20:00"}], "sun": [{"start": "10:00", "end": "16:00"}]}'),
  ('00000000-0000-4000-8000-000000000004', 'approved', 'passed', now(), '{Wedding,Family,Portraits}', 25, 'Marigot Bay', true,
    '{"mon": [{"start": "09:00", "end": "15:00"}], "tue": [{"start": "09:00", "end": "15:00"}], "thu": [{"start": "09:00", "end": "15:00"}], "sat": [{"start": "07:00", "end": "19:00"}], "sun": [{"start": "07:00", "end": "19:00"}]}'),
  ('00000000-0000-4000-8000-000000000005', 'approved', 'pending', null, '{Social,Events}', 12, 'Soufrière', false,
    '{"thu": [{"start": "09:00", "end": "17:00"}], "fri": [{"start": "09:00", "end": "21:00"}], "sat": [{"start": "09:00", "end": "21:00"}]}');

-- LOCAL-ONLY demo admin (password1234) — real admins are provisioned by
-- inserting into admin_users against a normal Supabase auth user.
insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new,
   email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values
  ('00000000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin@demo.snapt', crypt('password1234', gen_salt('bf')), now(),
   '{"provider": "email", "providers": ["email"]}', '{"full_name": "Don (Admin)"}', now(), now(),
   '', '', '', '', '', '', '', '');
insert into admin_users (user_id, role) values ('00000000-0000-4000-8000-00000000000a', 'admin');

-- Demo creators consent to v1 of the active-consent docs (real applicants
-- do this at application time — without these rows the re-consent matching
-- gate would exclude all local demo creators).
insert into consent_records (user_id, policy_document_id, doc_type, version)
select cp.user_id, pd.id, pd.doc_type, pd.version
from creator_profiles cp
cross join policy_documents pd
where pd.doc_type in ('creator-agreement', 'background-check') and pd.version = 1;
