-- Revision-request system (Policy 08 §2 prerequisite): request → creator
-- response (re-delivery via the media pipeline) → delivered.
create table revision_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  requested_by uuid not null references profiles (id),
  details text not null,
  -- First request per order is the included free round (§5); additional
  -- rounds must be covered by purchased extra_revisions add-ons.
  is_free boolean not null default true,
  status text not null default 'open' check (status in ('open', 'delivered')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
create index revision_requests_booking_idx on revision_requests (booking_id);
alter table revision_requests enable row level security;
create policy "parties read revisions" on revision_requests
  for select using (exists (
    select 1 from bookings b where b.id = revision_requests.booking_id
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));
