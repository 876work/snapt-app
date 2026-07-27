-- Reviews: schema only (closes the §4 data-model gap that Creator Profile
-- Preview and the remote-edit per-category rating screen assume exists).
-- Rating aggregation, trend logic ("Ratings & Growth"), and UI wiring are
-- Phase 3 — nothing here computes anything.

create table reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  client_id uuid not null references profiles (id),
  creator_id uuid not null references profiles (id),
  rating numeric not null check (rating >= 1 and rating <= 5),
  -- Per-category breakdown, e.g. {"quality": 5, "communication": 4,
  -- "timeliness": 5} — categories stay flexible until the rating UX is
  -- finalized in Phase 3.
  categories jsonb not null default '{}',
  comment text,
  created_at timestamptz not null default now(),
  -- One review per booking per reviewing client.
  unique (booking_id, client_id)
);
create index reviews_creator_idx on reviews (creator_id, created_at desc);

alter table reviews enable row level security;

-- Parties to the booking read their review; clients file reviews for their
-- own completed bookings only.
create policy "parties read reviews" on reviews
  for select using (auth.uid() = client_id or auth.uid() = creator_id);
create policy "reviews of approved creators are public" on reviews
  for select using (exists (
    select 1 from creator_profiles cp
    where cp.user_id = reviews.creator_id and cp.vetting_status = 'approved'
  ));
create policy "clients review own completed bookings" on reviews
  for insert with check (
    auth.uid() = client_id and exists (
      select 1 from bookings b
      where b.id = reviews.booking_id
        and b.client_id = auth.uid()
        and b.creator_id = reviews.creator_id
        and b.status = 'completed'
    )
  );
