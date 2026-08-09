-- Let the creator application be filled in ANY order.
--
-- creator_profiles.specialties was `not null check (cardinality >= 1)`, which
-- put a submit-time business rule on the table. The effect was an ordering
-- nobody could predict: uploading a headshot before picking a specialty had
-- to create the row, the row could not exist without a specialty, so the
-- photo step failed with "Pick at least one thing you shoot first" while the
-- creator was looking at five specialties they had already selected. (Those
-- selections were still client-side — the draft save is debounced.)
--
-- "At least one specialty" is still enforced, at the only moment it means
-- anything: POST /v1/creator/apply refuses a submission without one. A
-- half-finished draft legitimately has none yet.
--
-- Safe to re-run. Existing rows are untouched: every one of them already has
-- at least one specialty, since the old constraint would not have let them in.

alter table creator_profiles
  alter column specialties set default '{}';

do $mig$
declare
  con text;
begin
  -- The check was created inline, so its name is generated. Find it by the
  -- column it constrains rather than guessing.
  select conname into con
    from pg_constraint
   where conrelid = 'public.creator_profiles'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%cardinality%specialties%';
  if con is not null then
    execute format('alter table creator_profiles drop constraint %I', con);
    raise notice 'dropped specialties cardinality check: %', con;
  else
    raise notice 'no specialties cardinality check present — nothing to drop';
  end if;
end $mig$;
