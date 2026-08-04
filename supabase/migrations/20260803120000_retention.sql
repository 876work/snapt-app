-- File retention: scheduled-job support (Mechanism 1).
-- Storage does not grow forever: a daily server job deletes files whose
-- retention window has passed, marks them deleted here so the app never
-- links to a missing object, and logs every deletion. ID documents /
-- background-check materials are explicitly out of scope for this job
-- (governed by the Data Retention Policy) — no such files exist in the
-- system today; if a table/bucket for them is ever added it must NOT be
-- wired into the retention job without a separate decision.

-- Final delivery timestamp (windows for raw/source and deliverables key off
-- this; a revision re-delivery moves it, since that is the new final
-- delivery).
alter table bookings
  add column delivered_at timestamptz,
  add column legal_hold boolean not null default false,
  add column legal_hold_lifted_at timestamptz,
  add column expiry_warned_30_at timestamptz,
  add column expiry_warned_7_at timestamptz;

-- Best-effort backfill: a completed booking was delivered when its payout
-- hold was created (payout is created at delivery time).
update bookings b
set delivered_at = p.created_at
from creator_payouts p
where p.booking_id = b.id
  and b.status = 'completed'
  and b.delivered_at is null;

-- Soft-delete markers: the registry row survives so the app can render a
-- clear "no longer available" state instead of a broken link.
alter table booking_media
  add column deleted_at timestamptz,
  add column deletion_reason text;

alter table portfolio_items
  add column deleted_at timestamptz;

-- Account deletion is not implemented server-side yet; when it lands it
-- must set this, and the retention job (already coded against it) will
-- clean portfolio/avatar files 30 days later.
alter table profiles
  add column deleted_at timestamptz;

-- Audit log: what was deleted, which order, when, and why it was eligible.
create table retention_log (
  id uuid primary key default gen_random_uuid(),
  media_id uuid,
  booking_id uuid,
  bucket text not null,
  storage_path text not null,
  reason text not null,
  eligible_since timestamptz,
  dry_run boolean not null default false,
  outcome text not null default 'deleted' check (outcome in ('deleted', 'dry_run', 'error')),
  error text,
  created_at timestamptz not null default now()
);
create index retention_log_created_idx on retention_log (created_at desc);

-- Windows + kill switch are admin-editable config (no code change to tune).
-- retention_dry_run starts TRUE: the job logs what it would delete and
-- touches nothing until the dry-run output has been reviewed and the flag
-- is flipped.
insert into app_config (key, value, description, confirmed) values
  ('retention_dry_run', 'true', 'Retention job: true = log only, never delete. Flip to false after reviewing dry-run output.', true),
  ('retention_raw_days', '30', 'Delete raw footage / client source files N days after final delivery', true),
  ('retention_deliverable_days', '365', 'Delete paid deliverables N days after final delivery (12 months)', true),
  ('retention_cancelled_days', '30', 'Delete all files N days after cancellation', true),
  ('retention_abandoned_days', '7', 'Delete files on never-accepted/abandoned orders after N days', true),
  ('retention_account_deleted_days', '30', 'Delete portfolio/avatar files N days after account deletion', true),
  ('retention_hold_release_days', '90', 'Files become eligible N days after a legal hold is lifted', true)
on conflict (key) do nothing;
