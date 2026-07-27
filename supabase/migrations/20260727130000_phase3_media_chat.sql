-- Phase 3: media pipeline (raw footage / deliverables) + in-app chat.

-- ---------------------------------------------------------------------------
-- Media registry. Files live in private storage buckets (Cloudflare R2 in
-- production, Supabase Storage locally); this table is the metadata registry.
-- ACCESS RULE (handoff §3 Phase 3): raw footage is creator/editor-side only —
-- clients can upload raw (remote-edit orders) but can NEVER read it back;
-- only final deliverables are client-accessible.
-- ---------------------------------------------------------------------------

-- (media_kind already names the photo/video/both enum from Phase 0.)
create type booking_media_kind as enum ('raw', 'deliverable');

create table booking_media (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  kind booking_media_kind not null,
  storage_path text not null,
  content_type text,
  uploaded_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);
create index booking_media_booking_idx on booking_media (booking_id, kind);

alter table booking_media enable row level security;

-- Creator sees everything on their bookings; the client sees ONLY
-- deliverables. All writes go through the API (service role) after upload.
create policy "creator reads own booking media" on booking_media
  for select using (exists (
    select 1 from bookings b
    where b.id = booking_media.booking_id and b.creator_id = auth.uid()
  ));
create policy "client reads deliverables only" on booking_media
  for select using (
    kind = 'deliverable' and exists (
      select 1 from bookings b
      where b.id = booking_media.booking_id and b.client_id = auth.uid()
    )
  );

-- Private buckets for local dev (production uses Cloudflare R2 via the
-- server storage driver; these are the Supabase Storage fallback).
insert into storage.buckets (id, name, public)
values ('raw-footage', 'raw-footage', false), ('deliverables', 'deliverables', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Chat (Supabase Realtime). Participants of a booking message each other;
-- the creator-side no-show report requires a real message (attempted
-- contact), not just a checkbox.
-- ---------------------------------------------------------------------------

create table messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  sender_id uuid not null references profiles (id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_booking_idx on messages (booking_id, created_at);

alter table messages enable row level security;

create policy "participants read messages" on messages
  for select using (exists (
    select 1 from bookings b
    where b.id = messages.booking_id
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));
create policy "participants send messages" on messages
  for insert with check (
    auth.uid() = sender_id and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );

alter publication supabase_realtime add table messages;
