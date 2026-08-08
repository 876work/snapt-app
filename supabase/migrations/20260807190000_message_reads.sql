-- Per-user read tracking for booking chat threads.
--
-- `messages` has no per-recipient read state — there was no way to compute
-- an honest unread count for a Messages tab badge. One row per
-- (booking, user) tracking when THAT user last opened the thread; unread is
-- computed at query time as messages after last_read_at from the other party.

create table message_reads (
  booking_id uuid not null references bookings (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);

alter table message_reads enable row level security;

-- Reads/writes go through the API (service role) for the aggregate threads
-- query; this policy exists so a client-side upsert also works if ever used
-- directly, restricted to the row's own owner.
create policy "users manage their own read state" on message_reads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
