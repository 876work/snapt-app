-- Real admin accounts (§15): per-admin auth via Supabase (membership table)
-- replacing the single shared token, plus an audit trail of who did what.
create table admin_users (
  user_id uuid primary key references profiles (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'oncall')),
  created_at timestamptz not null default now()
);
create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles (id),
  action text not null,
  target text,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index admin_actions_idx on admin_actions (created_at desc);
alter table admin_users enable row level security;
alter table admin_actions enable row level security;
-- Service-role only; the API is the sole reader/writer.
