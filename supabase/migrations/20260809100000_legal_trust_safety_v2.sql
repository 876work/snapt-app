-- Trust & Safety v2 — consolidation step 1 of 4, and a factual correction.
--
-- THE CORRECTION. v1 states, in section 1:
--
--   "Every creator offering in-person sessions completes identity
--    verification and a background check before approval."
--
-- The second half is false. Identity verification through Didit (document +
-- live face match + 18+ from the document) is live; police certificate of
-- character checks are NOT yet in the vetting flow. The Home "How we vet"
-- sheet already describes this accurately and links here — so today the
-- app's own explainer contradicts the policy it points at. v2 makes the
-- policy match reality.
--
-- Also absorbs the Accessibility Statement as a closing section (section 10),
-- carried over from its own v1 text without new positions.
--
-- v1 is ARCHIVED, not deleted: status flips to 'archived' so the version
-- history stays intact and /v1/policies/:slug serves the newest published row.
--
-- Runs standalone. The remaining three consolidations (Terms, Privacy,
-- Creator Agreement) land separately; this one is independent because it
-- corrects a live factual error rather than merging pending text.

-- Guarded so a re-run is a NO-OP. Without this, running the file twice
-- archived the v2 row and then aborted on the duplicate insert, leaving
-- EVERY version archived and nothing published — /v1/policies/trust-safety
-- would serve nothing and the app would claim the document doesn't exist.
-- Caught by running it twice against the local stack.
do $mig$
begin
  if exists (select 1 from policy_documents where doc_type = 'trust-safety' and version = 2) then
    raise notice 'trust-safety v2 already present — nothing to do';
    return;
  end if;

  update policy_documents
     set status = 'archived'
   where doc_type = 'trust-safety'
     and status = 'published';

  insert into policy_documents (doc_type, version, title, content, status, published_at)
  values (
  'trust-safety',
  2,
  'Trust & Safety Policy',
  $doc$Snapt — Trust & Safety Policy (Community Guidelines)
Effective date: [Insert date] Contact: hello@snaptcarib.app

DRAFT — this document is a working draft pending attorney review.

Snapt connects real people for in-person photo and video sessions. That only works if
everyone — clients and creators — can trust that the person they're meeting is who they say
they are and will treat them with respect. This policy sets the standards of behavior on
Snapt and explains what happens when they're broken. It applies to everyone who uses the
platform, in the app and during sessions.

1. Our safety foundations
Creator vetting. Every creator offering in-person sessions completes identity
verification before approval: a government-issued identity document is verified
through our identity partner, Didit, with a live face match against that document, and
age (18+) is confirmed from the document itself rather than a self-reported date. A
member of our team also reviews every creator's portfolio and profile before they can
accept bookings. Police certificate of character checks are not yet part of creator
vetting — we are working to add them, and we will say so here when they are live. We
do not claim to run criminal background checks today.
Session check-in. Every in-person session begins with a safety code exchange: your
creator must verify the code shown in your app before the session starts. Never
proceed with a session if the code exchange doesn't happen — it means the person in
front of you may not be your assigned creator.
In-app communication. All pre-session communication happens through in-app
chat. Keep it there — it protects both sides and gives us a record if something goes
wrong.
Payments stay on-platform. Never pay, or accept payment, outside the app. Off-
platform payment removes every protection this policy provides.

2. Standards for everyone
All users must:
Treat others with respect and courtesy, in chat and in person.
Be truthful in profiles, bookings, and communications.
Show up on time to confirmed sessions, or cancel/reschedule properly through the
app.
Respect others' privacy. Do not share another user's personal information, images, or
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
Fraud, misrepresentation, or use of another person's identity or account.
Any activity involving the exploitation or endangerment of minors. This results in
immediate permanent removal and, where appropriate, referral to law enforcement.
See the minor safety section of the Snapt Terms of Service.

3. Additional standards for creators
Creators are professionals working with members of the public and are held to a higher
standard:
Complete the safety check-in for every session, every time.
Photograph or film only what the booking covers and only people who have
consented to be photographed.
No physical contact with clients beyond what is strictly necessary and consented to
(e.g., adjusting a pose only with explicit permission).
Never solicit clients off-platform, request extra payment, or ask for tips.
Follow the minor safety section of the Snapt Terms of Service without exception for
any session involving anyone under 18.

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
in the Snapt Terms of Service and the Snapt Creator Agreement.

8. Appeals
If you believe an enforcement action against you was made in error, you may appeal by
emailing hello@snaptcarib.app within 14 days of the action. Appeals are handled under
the dispute resolution section of the Snapt Terms of Service. Actions taken for the safety of
other users may remain in effect while an appeal is reviewed.

9. Changes
We may update this policy as the platform grows. Material changes will be communicated
in the app.

10. Accessibility
Snapt is for everyone, and we want the app to be usable by everyone — including people
who rely on assistive technologies like screen readers, or who need larger text, higher
contrast, or reduced motion.

Our commitment. We aim for the Snapt mobile app to conform to the Web Content
Accessibility Guidelines (WCAG) 2.1 Level AA as applied to mobile applications, and to work
well with the accessibility features built into iOS and Android, including screen readers
(VoiceOver on iOS, TalkBack on Android); dynamic type / system font scaling; sufficient
color contrast, with meaning never conveyed by color alone; touch targets sized for
comfortable use; and reduced motion preferences.

Where we are today. Snapt is a new product, and we are honest about being early in this
work. We are actively testing the app with assistive technologies and addressing issues as
we find them. Known limitations at this time include: [list current known gaps once an
accessibility pass has been done].

Alternatives while we improve. If any part of the app is not accessible to you — including
booking a session, managing a booking, or contacting support — email us at
hello@snaptcarib.app and we will complete the task with you directly, at no disadvantage
in pricing or priority.

Feedback. If you encounter an accessibility barrier in Snapt, please tell us at
hello@snaptcarib.app. Include the screen or task, your device and OS version, and the
assistive technology you use, if any. Accessibility reports go to our product team and
genuinely shape what we fix next.

Review. We review this statement, and our accessibility progress, at least [annually].

Questions or reports: hello@snaptcarib.app$doc$,
    'published',
    now()
  );
end
$mig$;
