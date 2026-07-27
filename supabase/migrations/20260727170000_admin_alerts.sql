-- Internal/admin alert queue (distinct from user notifications — §13: admin
-- alerts never reach end users). First consumer: assignment-failure alerts
-- when a booking auto-cancels after 3 failed reassignments, so repeated
-- failures in one area/occasion get noticed rather than silently absorbed.

create table admin_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  booking_id uuid references bookings (id),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index admin_alerts_open_idx on admin_alerts (alert_type, created_at desc)
  where resolved_at is null;

alter table admin_alerts enable row level security;
-- Service-role/Admin Portal only: no user-facing policies.
