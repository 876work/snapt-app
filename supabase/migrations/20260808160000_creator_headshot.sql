-- Creator headshot: the professional face clients see.
--
-- Spec'd as REQUIRED in the creator application and never built anywhere in
-- the chain: no upload step, profiles.avatar_url written by nothing, no
-- photo in admin review, initial-letter tiles on every client surface.
--
-- Files live in the private 'portfolio' bucket under headshots/{user_id}/;
-- clients only ever receive SIGNED urls, and only once the headshot is
-- approved — pending/rejected headshots are admin-visible only.

alter table creator_profiles
  add column if not exists headshot_path text,
  add column if not exists headshot_status text
    check (headshot_status in ('pending', 'approved', 'rejected'));
