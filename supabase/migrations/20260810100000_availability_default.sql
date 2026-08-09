-- An approved creator must never start life unbookable.
--
-- creator_profiles.availability defaulted to '{}', and the matching engine
-- requires at least one window on the requested weekday. So any row that
-- reached `approved` without passing through a complete application was
-- invisible to booking forever — no offers, no error, and nothing in the
-- admin portal saying so. That is exactly how one approved creator sat
-- unbookable until it surfaced by accident.
--
-- The application endpoint already wrote a full week, but the DRAFT endpoint
-- creates the row with no availability at all, so the column default was the
-- real backstop and it was empty.
--
-- 06:00-22:00, all seven days, matching the server's new-creator default.
-- Deliberately not 24h: a 3am offer against hours nobody chose reads as a
-- broken app. Overnight is available to any creator who sets it themselves.
--
-- EXISTING ROWS ARE UNTOUCHED. A column default only applies to inserts, so
-- every creator who has saved their own hours keeps them. Safe to re-run.

alter table creator_profiles
  alter column availability set default '{
    "mon": [{"start": "06:00", "end": "22:00"}],
    "tue": [{"start": "06:00", "end": "22:00"}],
    "wed": [{"start": "06:00", "end": "22:00"}],
    "thu": [{"start": "06:00", "end": "22:00"}],
    "fri": [{"start": "06:00", "end": "22:00"}],
    "sat": [{"start": "06:00", "end": "22:00"}],
    "sun": [{"start": "06:00", "end": "22:00"}]
  }'::jsonb;
