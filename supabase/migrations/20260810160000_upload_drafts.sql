-- UPLOAD DRAFTS: footage that exists before the order does.
--
-- Remote clients now upload the moment they pick files, so the bytes land
-- while they are still choosing a package. But the booking does not exist
-- until Stripe says the money moved (checkout.ts), and booking_media.
-- booking_id was `not null references bookings` — there was nowhere to put
-- a file before payment.
--
-- A draft is not a table. It is a uuid minted per checkout attempt and
-- stamped on the media rows; ownership is `uploaded_by`, which is already
-- there and already trustworthy (the API sets it from the JWT). Deliberately
-- NO foreign key on draft_id: there is nothing to reference, and adding one
-- would break the bare PostgREST embeds that read this table.
--
-- The claim happens in createBookingFromPaidIntent: it sets booking_id and
-- clears draft_id inside the webhook handler, before that handler returns
-- 2xx, and Stripe retries until it does. The abandoned-draft sweep only ever
-- deletes rows where booking_id is null, so a claimed file is out of its
-- reach by construction — not by timing.

alter table booking_media
  alter column booking_id drop not null,
  add column draft_id uuid;

-- Exactly one owner, always. A row belongs to a booking or to a draft, and
-- can never belong to both or to neither — which is what makes "booking_id
-- is null" a safe delete predicate for the sweep.
alter table booking_media
  add constraint booking_media_owner_ck
  check ((booking_id is not null) <> (draft_id is not null));

-- The sweep and the claim both look rows up by draft.
create index booking_media_draft_idx on booking_media (draft_id)
  where draft_id is not null;

-- RLS is deliberately untouched. Both existing policies join through
-- bookings, so a draft row (booking_id null) matches neither and is
-- invisible to every client of the anon key. Drafts are served only by the
-- API, which reads them with the service role and filters on uploaded_by.
