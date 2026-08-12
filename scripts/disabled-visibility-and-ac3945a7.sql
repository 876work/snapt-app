-- Run in the Supabase SQL editor against PRODUCTION (euvwnpjwlekegtyghcoy).
--
-- PART A is the RLS migration (also committed as
-- supabase/migrations/20260812070000_disabled_user_visibility.sql).
-- PART B returns booking ac3945a7 to dispatch, doing by hand exactly what the
-- new disable flow now does automatically.
--
-- Validated against a throwaway Postgres 16 with a stand-in schema: the
-- disabled creator disappears from profiles and creator_profiles for another
-- user, the active creator stays, the disabled user can still read their OWN
-- row, and a message insert to a disabled counterparty is refused by RLS.

-- ===========================================================  PART A — RLS

create or replace function is_active_owner(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from profiles where id = uid), false);
$$;

drop policy if exists "read approved creator profiles" on profiles;
create policy "read approved creator profiles" on profiles
  for select using (
    status = 'active'
    and exists (
      select 1 from creator_profiles cp
      where cp.user_id = profiles.id and cp.vetting_status = 'approved'
    )
  );

drop policy if exists "read approved creator profiles public" on creator_profiles;
create policy "read approved creator profiles public" on creator_profiles
  for select using (
    vetting_status = 'approved'
    and is_active_owner(creator_profiles.user_id)
  );

drop policy if exists "participants send messages" on messages;
create policy "participants send messages" on messages
  for insert with check (
    is_active_user() and auth.uid() = sender_id and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.creator_id is not null
        and b.status <> 'pending'
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
        and is_active_owner(case when auth.uid() = b.client_id then b.creator_id else b.client_id end)
    )
  );

create index if not exists profiles_active_idx on profiles (id) where status = 'active';

-- ================================================  PART B — booking ac3945a7
--
-- Remote, $48.60, paid, status pending, assigned to a creator who is switched
-- off. Returned to dispatch rather than reassigned: its client is Anastasia
-- herself and her account is disabled, so handing the job to a working creator
-- would have them edit footage for an account that cannot receive it.

-- B1. Look before writing.
select id, status, type, price_usd, creator_id, client_id, scheduled_at
  from bookings
 where id = 'ac3945a7-47ea-4887-a291-0cfd7457b1da';

-- B2. Back to the dispatch queue — the same write the disable flow now makes.
update bookings
   set creator_id = null,
       status = 'pending',
       offer_expires_at = null
 where id = 'ac3945a7-47ea-4887-a291-0cfd7457b1da'
   and creator_id = '90404ec8-455e-46c9-82be-48659fd7dae4';

-- B3. The alert the flow would have raised, so this is not a silent edit.
insert into admin_alerts (alert_type, booking_id, detail)
values (
  'assigned_work_returned_to_dispatch',
  'ac3945a7-47ea-4887-a291-0cfd7457b1da',
  jsonb_build_object(
    'reason', 'creator_disabled',
    'creator_id', '90404ec8-455e-46c9-82be-48659fd7dae4',
    'creator_name', 'Anastasia Vitte',
    -- matches what commitmentsFor classifies it as: offer_expires_at is set
    'kind', 'offer_pending',
    'price_usd', 48.6,
    'applied_by', 'manual_backfill'
  )
);

-- B4. Confirm: creator_id null, status pending, one new alert.
select id, status, creator_id from bookings
 where id = 'ac3945a7-47ea-4887-a291-0cfd7457b1da';
select alert_type, booking_id, created_at from admin_alerts
 where booking_id = 'ac3945a7-47ea-4887-a291-0cfd7457b1da'
 order by created_at desc limit 3;
