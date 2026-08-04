-- Become-a-Creator completion (Don's six-state spec, 2026-08-02).
-- Status model: no row = not_applied; vetting_status not_started = draft
-- (in_progress); in_review = pending_review; approved/rejected/suspended as
-- named. The enum already contains every value — this adds the supporting
-- columns and relaxes the specialties check for drafts only.

alter table creator_profiles
  add column service_type text not null default 'both'
    check (service_type in ('remote', 'in_person', 'both')),
  add column is_available boolean not null default true,
  add column applied_at timestamptz,
  add column rejection_reason text;

-- Drafts may exist before any specialty is picked; every other status keeps
-- the §12 minimum-one guarantee.
alter table creator_profiles drop constraint creator_profiles_specialties_check;
alter table creator_profiles add constraint creator_profiles_specialties_check
  check (vetting_status = 'not_started' or cardinality(specialties) >= 1);

-- Two-way ratings: one review per booking per direction.
alter table reviews add column direction text not null default 'client_to_creator'
  check (direction in ('client_to_creator', 'creator_to_client'));
alter table reviews drop constraint reviews_booking_id_client_id_key;
alter table reviews add constraint reviews_booking_direction_key unique (booking_id, direction);
