-- profiles.avatar_url was never written by anything.
--
-- Its own migration comment flagged it on the day the headshot columns were
-- added: "profiles.avatar_url written by nothing". Six read sites fell back
-- to it and every one of them received null, on every account, always. The
-- only write in the entire server was the account-purge routine nulling a
-- column that was already null.
--
-- It survived this long because it looked like the obvious home for a client
-- profile photo. That question is now settled (Don, 2026-08-09): pure clients
-- get initials, client photos are post-launch, and a half-built one is worse
-- than none. creator_profiles.headshot_path is the only photo in the system,
-- and it earns that by being reviewed.
--
-- Every reference is removed from the server first — selects, the fallbacks
-- in the creator listing and the message thread roster, and the purge write —
-- so nothing can 42703 on this. The API still returns a field NAMED
-- avatar_url: that is the signed approved headshot, and the app's contract.
--
-- Safe to re-run.

alter table profiles
  drop column if exists avatar_url;
