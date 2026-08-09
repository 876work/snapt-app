-- A vetted photo must survive its own replacement.
--
-- creator_profiles carried ONE headshot_path. Registering a new photo
-- overwrote it and set headshot_status='pending', and every client surface
-- only signs an APPROVED headshot — so the moment a creator tapped "change
-- photo" their public face vanished and clients fell back to an initial,
-- mid-booking, until a human reviewed the replacement. That is why the
-- button was left inert rather than wired to this path.
--
-- Two slots instead of one:
--   headshot_path          the APPROVED, client-facing photo. Unchanged in
--                          meaning, so nothing needs backfilling.
--   headshot_pending_path  a replacement awaiting review. Never shown to
--                          clients; visible to its owner and to admin.
--
-- headshot_status now describes the PENDING slot, not the live one. When
-- there is no pending photo it reflects the last review outcome.
--
-- FIRST UPLOAD IS DIFFERENT ON PURPOSE (Don, 2026-08-09): with no approved
-- photo there is nothing to protect, so a creator's first headshot is
-- written straight to headshot_path and the pending slot stays empty.
--
-- Safe to re-run. Additive only — no existing row changes.

alter table creator_profiles
  add column if not exists headshot_pending_path text;

comment on column creator_profiles.headshot_path is
  'The APPROVED headshot clients see. Replaced only when a pending photo is approved.';
comment on column creator_profiles.headshot_pending_path is
  'A replacement headshot awaiting review. Never served to clients; owner and admin only.';
