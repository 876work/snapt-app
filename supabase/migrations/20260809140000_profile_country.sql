-- profiles.country — the fourth required field, which had no column at all.
--
-- The email signup has always SHOWN a locked "COUNTRY — Saint Lucia" card,
-- but nothing read it and nothing stored it, so country was missing on every
-- account ever created, by every method. Google and Apple were not the only
-- gap; they were just the visible one.
--
-- NOT NULL DEFAULT 'lc' is deliberate, and it is not a guess about anyone.
-- Snapt is live in Saint Lucia only and the signup form locks the field, so
-- every existing account IS Saint Lucia by construction — backfilling it is
-- recording a fact, not inventing one. It also means country can never be
-- the thing that blocks an account: the completion step shows it prefilled
-- and editable, and the fields that actually go missing (phone, and name on
-- a repeat Apple authorization) are what drive the step.
--
-- Lowercase to match Country.iso2 in lib/constants/countries.ts, so a stored
-- value is a direct lookup key into COUNTRIES with no case juggling at the
-- call sites.

alter table profiles
  add column if not exists country text not null default 'lc';

-- Completeness is COMPUTED, never stored. A boolean column would be a second
-- source of truth that drifts the first time someone edits their profile
-- without going through the completion step.
create or replace function profile_is_complete(p profiles) returns boolean
language sql immutable as $$
  select coalesce(nullif(btrim(p.full_name), ''), null) is not null
     and coalesce(nullif(btrim(p.email), ''), null) is not null
     and coalesce(nullif(btrim(p.phone), ''), null) is not null
     and coalesce(nullif(btrim(p.country), ''), null) is not null;
$$;
