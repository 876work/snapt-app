-- Creator flags a revision request as out of scope (2026-08-22).
--
-- A creator had two options facing a request beyond what was booked: do it,
-- or ignore it. This adds a third — tell an admin — WITHOUT blocking
-- anything: the round stays open and deliverable, and the client is never
-- notified and sees nothing. A client learning their request was flagged
-- would start the argument the feature exists to avoid.
--
-- It rides the existing moderation queue rather than inventing a surface:
-- same content_reports table, same open/actioned/dismissed review, same
-- admin screen. Disputes was rejected as the home — opening one sets the
-- booking to 'disputed' and freezes creator payouts, which is a stop button,
-- and this is a signal.
--
-- ---------------------------------------------------------------------------
-- 1. revision_id, and the FK IS NAMED.
--
-- Standing rule since the embed outage: an unnamed foreign key is what makes
-- a bare PostgREST embed ambiguous the moment a second path to the same
-- table exists. Checked before writing this: the codebase has exactly four
-- embed selects (retention.ts sessions!inner, admin.ts dispute_evidence,
-- admin.ts profiles!creator_profiles_user_id_fkey!inner, admin-portal.ts
-- bookings!inner) and NONE of them touch content_reports or
-- revision_requests, so nothing can be made ambiguous by this. The name is
-- given anyway so a future embed can disambiguate explicitly.
--
-- ON DELETE SET NULL, not cascade, following 20260807160000_actor_fk_set_null:
-- a moderation record is an audit row and must outlive the thing it points
-- at. Revision requests are never deleted anywhere in the codebase, so this
-- is a guarantee rather than a behaviour.
alter table content_reports
  add column if not exists revision_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_reports_revision_id_fkey') then
    alter table content_reports
      add constraint content_reports_revision_id_fkey
      foreign key (revision_id) references revision_requests (id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The category list. NOT additive — a CHECK has to be dropped and re-added,
-- which is why the ordering below is not optional.
--
-- 'support' IS ALREADY BEING INSERTED and appears in no migration: the server
-- maps Contact Support submissions to category 'support' (moderation.ts
-- SEVERITY) but the only migration that ever defined this constraint
-- (20260729090000) lists four categories and not that one. Either production
-- was patched by hand or every Contact Support submission is failing. It is
-- included here because the constraint has to be written correctly, not as a
-- fix of that separate question — which is reported, not resolved.
alter table content_reports drop constraint if exists content_reports_category_check;
alter table content_reports add constraint content_reports_category_check
  check (category in (
    'child_safety',
    'sexual_violent_hate',
    'content_policy',
    'general',
    'support',
    'revision_scope'
  ));

-- ---------------------------------------------------------------------------
-- 3. One flag per request, enforced where it cannot be raced.
--
-- The endpoint checks for an existing flag first so the creator gets a
-- sentence rather than a constraint error, but two taps in flight would both
-- pass that check. Partial, so the column stays null for every other kind of
-- report and those rows never collide with each other.
create unique index if not exists content_reports_revision_scope_uq
  on content_reports (revision_id)
  where category = 'revision_scope' and revision_id is not null;

comment on column content_reports.revision_id is
  'Set only on category=revision_scope rows: the revision_requests row a creator flagged as beyond what was booked. Never shown to the client.';
