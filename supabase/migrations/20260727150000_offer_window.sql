-- Accept/decline window (confirmed 2026-07-27): after auto-assignment the
-- creator has 15 minutes to accept. Decline or timeout reassigns to the next
-- eligible creator (decliner excluded for this booking) — NO strike; strikes
-- only apply to bookings the creator already accepted. A booking is only
-- 'confirmed' once a creator actually accepts.

alter table bookings
  add column offer_expires_at timestamptz,
  add column declined_creator_ids uuid[] not null default '{}';
