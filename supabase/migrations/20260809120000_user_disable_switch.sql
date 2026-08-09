-- Admin hard off switch: profiles.status.
--
-- DELIBERATELY SEPARATE from suspended_at. suspended_at is a MODERATION
-- outcome (set by suspendUser when a safety report is actioned; it blocks new
-- bookings and marketing but leaves the account usable). status is an
-- ADMINISTRATIVE off switch: no login, no API, no notifications, fully
-- reversible. Collapsing them would change moderation behaviour, so both
-- exist and every enforcement point checks both.
--
-- Reversible by design: nothing here is destructive. Disabling writes status
-- and a reason; restoring clears them. Bookings, payouts, creator approval,
-- specialties, schedule, portfolio and Didit verification are NEVER touched
-- by either direction — which is what makes "everything returns exactly as
-- it was" true by construction rather than by careful restoration.

alter table profiles
  add column if not exists status text not null default 'active'
    check (status in ('active', 'disabled')),
  add column if not exists disabled_at timestamptz,
  add column if not exists disabled_reason text;

-- The enforcement lookup runs on the auth failure path; keep it cheap.
create index if not exists profiles_disabled_idx on profiles (id) where status = 'disabled';

-- ---------------------------------------------------------------------------
-- RLS: close the DIRECT-ACCESS door.
--
-- The app talks to PostgREST and Realtime directly for chat (lib/chat.ts),
-- bypassing the API entirely. PostgREST validates the JWT signature LOCALLY —
-- it never asks GoTrue — so a banned user's unexpired token keeps working
-- there for up to its remaining life (<=1h). Without this predicate a
-- disabled user keeps chatting for an hour. RLS re-evaluates per query, so
-- this bites on their very next request.
-- ---------------------------------------------------------------------------

create or replace function is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from profiles where id = auth.uid()), false);
$$;

drop policy if exists "participants read messages" on messages;
create policy "participants read messages" on messages
  for select using (is_active_user() and exists (
    select 1 from bookings b
    where b.id = messages.booking_id
      and b.creator_id is not null
      and b.status <> 'pending'
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));

drop policy if exists "participants send messages" on messages;
create policy "participants send messages" on messages
  for insert with check (
    is_active_user() and auth.uid() = sender_id and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.creator_id is not null
        and b.status <> 'pending'
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );
