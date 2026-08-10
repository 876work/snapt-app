-- A published bio must survive its own edit.
--
-- creator_profiles.bio has existed since the Phase 0 schema and is collected
-- by the application form, but nothing ever rendered it — 12 creator rows on
-- production, 0 with a bio. Now that it becomes public text a client reads
-- before meeting someone alone, it goes through the same review queue as
-- portfolio items, on the same earned-trust rule.
--
-- Which creates the headshot trap again: if review flipped `bio` itself, a
-- creator editing an approved bio would blank their public profile until a
-- human looked. So the pending text lives in its own column and `bio` keeps
-- meaning "the approved bio clients see".
--
-- Additive, safe to re-run, no backfill.

alter table creator_profiles
  add column if not exists bio_pending text;

comment on column creator_profiles.bio is
  'The APPROVED bio clients see. Replaced only when a pending bio is approved.';
comment on column creator_profiles.bio_pending is
  'A bio awaiting review. Never served to clients; owner and admin only.';
