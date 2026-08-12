-- Disabled accounts must disappear from OTHER people's view.
--
-- 20260809120000_user_disable_switch.sql added is_active_user(), which asks
-- "is the CALLER active" and closed chat for the disabled user themselves.
-- There was never a counterpart asking "is the ROW'S OWNER active", so both
-- public-read policies below kept serving a disabled creator's profile to any
-- authenticated client straight through PostgREST — regardless of what the
-- API did. This is that missing half.
--
-- Reversible and non-destructive, like the original: restoring an account
-- flips status back to 'active' and every row becomes visible again with no
-- repair step. Nothing is deleted or rewritten here.

create or replace function is_active_owner(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'active' from profiles where id = uid), false);
$$;

-- ---------------------------------------------------------------------------
-- profiles: a disabled creator's basic info stops being publicly readable.
-- "read own profile" is deliberately untouched — a disabled user can still
-- read their OWN row, which is what lets the app show them an
-- account-disabled state rather than an empty screen.
-- ---------------------------------------------------------------------------
drop policy if exists "read approved creator profiles" on profiles;
create policy "read approved creator profiles" on profiles
  for select using (
    status = 'active'
    and exists (
      select 1 from creator_profiles cp
      where cp.user_id = profiles.id and cp.vetting_status = 'approved'
    )
  );

-- ---------------------------------------------------------------------------
-- creator_profiles: same door, other table.
-- "read own creator profile" is likewise untouched.
-- ---------------------------------------------------------------------------
drop policy if exists "read approved creator profiles public" on creator_profiles;
create policy "read approved creator profiles public" on creator_profiles
  for select using (
    vetting_status = 'approved'
    and is_active_owner(creator_profiles.user_id)
  );

-- ---------------------------------------------------------------------------
-- Messages: a disabled account must not RECEIVE new messages either.
--
-- is_active_user() already stops a disabled person sending. This stops the
-- other direction: an active creator messaging a client whose account has
-- been switched off, where the message would arrive nowhere (push tokens are
-- deleted at disable time) and read as delivered to the sender. Reads are
-- left alone on purpose — existing history stays visible to both sides, so
-- nobody loses the record of a conversation.
-- ---------------------------------------------------------------------------
drop policy if exists "participants send messages" on messages;
create policy "participants send messages" on messages
  for insert with check (
    is_active_user() and auth.uid() = sender_id and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.creator_id is not null
        and b.status <> 'pending'
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
        -- the OTHER party must be active too
        and is_active_owner(case when auth.uid() = b.client_id then b.creator_id else b.client_id end)
    )
  );

-- Enforcement lookup runs per row on read paths; keep it cheap.
create index if not exists profiles_active_idx on profiles (id) where status = 'active';
