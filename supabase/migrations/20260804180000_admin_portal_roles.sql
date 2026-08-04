-- Admin portal rebuild — roles + safety-alert acknowledgement.
--
-- Roles (enforced server-side, per route):
--   admin     — everything, including payout release, config, and legal edits
--   support   — day-to-day ops: view, refunds, notes; no money release, no config
--   moderator — content-moderation queue only
-- 'oncall' predates the portal build-out and maps to support.

alter table admin_users drop constraint admin_users_role_check;
update admin_users set role = 'support' where role = 'oncall';
alter table admin_users add constraint admin_users_role_check
  check (role in ('admin', 'support', 'moderator'));

-- Safety alerts: explicit acknowledgement (who + when), distinct from
-- resolution. SOS currently only emails an on-call address and emails get
-- missed — the portal pins unacknowledged alerts until someone owns them.
alter table admin_alerts
  add column acknowledged_at timestamptz,
  add column acknowledged_by uuid references profiles (id);

-- Global search: uuid columns can't be prefix-matched through PostgREST
-- filters, so booking-reference search runs in SQL. Service-role only.
create or replace function admin_booking_id_search(prefix text)
returns setof bookings
language sql stable as $$
  select * from bookings
  where id::text ilike prefix || '%'
  order by created_at desc
  limit 10
$$;

-- Audit-log search: filter by action type without scanning everything.
create index admin_actions_action_idx on admin_actions (action, created_at desc);
