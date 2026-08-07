-- "Who did it" foreign keys must not pin an account in place forever.
--
-- admin_actions.admin_id and creator_profiles.vetting_decided_by both pointed
-- at profiles with NO ACTION, so deleting any admin who had ever acted failed
-- with an FK violation. It first surfaced blocking the removal of a temporary
-- backfill account, and it would have blocked account erasure outright.
--
-- ON DELETE SET NULL keeps the audit row and the vetting decision — the fact
-- that a review happened is the record; the actor's account is not. Deleting
-- an admin must never silently delete the trail of what they did.

alter table admin_actions
  alter column admin_id drop not null;

alter table admin_actions
  drop constraint admin_actions_admin_id_fkey,
  add constraint admin_actions_admin_id_fkey
    foreign key (admin_id) references profiles (id) on delete set null;

alter table creator_profiles
  drop constraint creator_profiles_vetting_decided_by_fkey,
  add constraint creator_profiles_vetting_decided_by_fkey
    foreign key (vetting_decided_by) references profiles (id) on delete set null;
