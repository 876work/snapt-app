-- Why did THIS client get THIS creator?
--
-- Nothing recorded it. A booking stored creator_id and not a word about how
-- it got there — not the candidate set, not the distances, not who was
-- skipped for strikes, not whether the client chose or the server did. So a
-- complaint was unanswerable: re-running the query today gives a different
-- answer, because availability, strikes and existing bookings have all moved.
--
-- One row per assignment attempt, written at match time. Deliberately a
-- separate table rather than columns on bookings: a booking can be reassigned
-- several times and each decision deserves its own record.

create table if not exists match_decisions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references bookings (id) on delete cascade,
  chosen_creator_id uuid references profiles (id),
  -- 'auto' = the server picked; 'manual' = the client named a creator.
  mode text not null check (mode in ('auto', 'manual')),
  occasion text,
  area text,
  scheduled_for timestamptz,
  -- The full ranked candidate set as it stood, with the reason each creator
  -- placed where they did and why anyone was skipped. Kept as jsonb because
  -- the ranking inputs will change and old rows must still read truthfully.
  candidates jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists match_decisions_booking_idx on match_decisions (booking_id);
create index if not exists match_decisions_creator_idx on match_decisions (chosen_creator_id);

alter table match_decisions enable row level security;
-- No client policies: this is an operational record, read via the server.
