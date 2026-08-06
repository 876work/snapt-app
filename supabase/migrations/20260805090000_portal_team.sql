-- Portal team management + internal notes + invite tokens (admin portal
-- phase 2). Portal accounts become manageable from inside the portal —
-- soft deactivation only, so admin_actions keeps attributing history.

alter table admin_users
  add column active boolean not null default true,
  add column added_by uuid references profiles (id);

-- Internal notes on user/booking/creator records. Timestamped, attributed,
-- NEVER exposed through any client-facing endpoint.
create table admin_notes (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('user', 'booking', 'creator')),
  subject_id uuid not null,
  admin_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index admin_notes_subject_idx on admin_notes (subject_type, subject_id, created_at desc);

-- Single-use, expiring set-password invites. The portal NEVER sets a
-- password directly: the invitee follows the emailed link and sets their
-- own. kind 'portal' = admin-portal account; 'app' = manually created app
-- user (sets password on the web page, then signs into the app).
create table admin_invites (
  token text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  kind text not null check (kind in ('portal', 'app')),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index admin_invites_user_idx on admin_invites (user_id);

alter table admin_notes enable row level security;
alter table admin_invites enable row level security;
-- No policies: service-role only, like admin_actions.
