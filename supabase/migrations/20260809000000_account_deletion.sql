-- Real account deletion: soft delete with a 30-day grace period.
--
-- App Store Guideline 5.1.1(v) requires functional account deletion; until
-- now the app's Delete Account sheet claimed permanent removal and merely
-- signed out.
--
-- deleted_at: the deletion REQUEST. Sign-in is banned from this moment
-- (GoTrue ban), sessions die, the confirmation email goes out. During the
-- 30 days (app_config retention_account_deleted_days, default 30) support
-- can restore by clearing deleted_at and lifting the ban.
--
-- purged_at: the point of no return, stamped by the scheduler's purge job
-- once the grace period lapses. PII is anonymized in place rather than the
-- rows removed, because bookings.client_id / transactions.user_id reference
-- profiles WITHOUT cascade — financial and booking records legally outlive
-- the person's PII, attributed to "Deleted user".
--
-- NOTE: server/src/retention.ts has referenced profiles.deleted_at since
-- 2026-08-03 for the "portfolio + avatar, deletion + 30 days" file window;
-- without this column that branch silently no-oped (PostgREST fails a
-- select naming a missing column). This migration makes it live.

alter table profiles add column deleted_at timestamptz;
alter table profiles add column purged_at timestamptz;

create index profiles_deleted_pending_purge_idx
  on profiles (deleted_at)
  where deleted_at is not null and purged_at is null;
