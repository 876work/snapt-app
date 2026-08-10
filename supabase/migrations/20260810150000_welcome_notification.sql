-- Welcome notification, 5 minutes after registration.
--
-- The delay is NOT a setTimeout. The scheduler is in-process
-- (setInterval every 5 minutes, started at boot), so a timer would be lost
-- on every Render restart and deploy — silently, with no way to tell which
-- users never got one. Instead the due state lives in the database and the
-- existing tick sweeps for it, which survives restarts by construction.
--
-- welcome_sent_at null  = owed a welcome once they are 5 minutes old
-- welcome_sent_at set   = already sent, or deliberately never owed one
--
-- EXISTING ACCOUNTS ARE MARKED SENT so this cannot fire retroactively for
-- everyone who registered before it shipped.

alter table profiles
  add column if not exists welcome_sent_at timestamptz;

update profiles
   set welcome_sent_at = now()
 where welcome_sent_at is null;

comment on column profiles.welcome_sent_at is
  'When the 5-minute welcome was sent. Pre-existing rows were stamped at deploy so it never fires retroactively.';
