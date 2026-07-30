-- Expo push tokens, one row per device. Written only via the API (service
-- role); a token follows whichever account last signed in on that device.
create table push_tokens (
  token text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user_idx on push_tokens (user_id);
alter table push_tokens enable row level security;
-- No client policies on purpose: reads/writes go through the server.
