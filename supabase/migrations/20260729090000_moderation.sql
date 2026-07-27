-- Content moderation (Policy 04 §6 tiered system per Don 2026-07-29 —
-- NOTE: the docs/04 PDF §6 predates this table; needs the updated doc).
create table content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles (id),
  target_user_id uuid references profiles (id),
  booking_id uuid references bookings (id),
  media_id uuid references booking_media (id),
  category text not null check (category in ('child_safety', 'sexual_violent_hate', 'content_policy', 'general')),
  severity text not null check (severity in ('critical', 'high', 'medium', 'low')),
  details text,
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  law_enforcement_referral boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz
);
alter table content_reports enable row level security;
create policy "reporter reads own reports" on content_reports
  for select using (auth.uid() = reporter_id);

-- Client-account suspension (creators use vetting_status='suspended').
alter table profiles add column suspended_at timestamptz;

-- Portfolio/marketing content (NEW — no portfolio system existed; raw
-- footage and private deliverables are unaffected, never public anyway).
create table portfolio_items (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references profiles (id),
  caption text,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'auto')),
  created_at timestamptz not null default now()
);
alter table portfolio_items enable row level security;
create policy "public reads published portfolio" on portfolio_items
  for select using (status in ('approved', 'auto'));
create policy "creator reads own portfolio" on portfolio_items
  for select using (auth.uid() = creator_id);
