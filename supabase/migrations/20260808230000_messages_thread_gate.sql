-- Messages: RLS now enforces the SAME gate as the threads list.
--
-- loadThreads says a conversation exists once a creator is attached AND the
-- booking has moved off a bare, unaccepted offer (status <> 'pending').
-- The policies didn't say that: any participant could INSERT and SELECT
-- messages on a still-pending booking. Observed live on 2026-08-08: a
-- client wrote a message onto a pending booking and /notify pinged the
-- creator about a thread neither side's inbox would show.
--
-- Three doors, one lock. The threads/unread endpoints already had it; the
-- /v1/messages/:id/notify endpoint gets it in the same commit as this file;
-- these policies are the third door — direct writes, direct reads, and the
-- realtime stream (postgres_changes authorizes delivery via the SELECT
-- policy, so this also stops pending-booking events from streaming).
--
-- Messages sent before acceptance are impossible from now on; rows that
-- already exist stay readable once the booking leaves pending, so no
-- history is lost when an offer is accepted.

drop policy "participants read messages" on messages;
create policy "participants read messages" on messages
  for select using (exists (
    select 1 from bookings b
    where b.id = messages.booking_id
      and b.creator_id is not null
      and b.status <> 'pending'
      and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
  ));

drop policy "participants send messages" on messages;
create policy "participants send messages" on messages
  for insert with check (
    auth.uid() = sender_id and exists (
      select 1 from bookings b
      where b.id = messages.booking_id
        and b.creator_id is not null
        and b.status <> 'pending'
        and (auth.uid() = b.client_id or auth.uid() = b.creator_id)
    )
  );
