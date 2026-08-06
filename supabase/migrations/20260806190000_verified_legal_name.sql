-- Verified legal name, reconciled against the account name after a Didit pass.
--
-- TWO names, never one. The legal name is authoritative and comes from the
-- document; the display name is what clients see and stays the creator's own.
-- An ID prints ALL CAPS, often surname first, with every middle name — that
-- is not a profile name, so the display name is NEVER written automatically.
--
-- COLUMNS ONLY. No foreign keys: adding an FK to creator_profiles (already
-- embedded from availability, featured creators and the applications list)
-- is what broke PostgREST embeds on 2026-08-06. Nothing here can repeat it.

alter table creator_profiles
  -- Authoritative, from the document. Null until a verification sets it.
  add column legal_name text,
  -- 'didit' = applied automatically on match/minor variance.
  -- 'admin' = a human accepted it after a substantial mismatch.
  add column legal_name_source text check (legal_name_source in ('didit', 'admin')),
  add column legal_name_set_at timestamptz,
  -- What the applicant typed as "full legal name, exactly as on your ID".
  -- Compared alongside the signup name; never treated as authoritative.
  add column declared_legal_name text;

alter table verification_sessions
  -- 'match' | 'minor_variance' | 'substantial_mismatch' | 'unknown'
  add column name_verdict text,
  -- Which relaxations were needed, which account name won, token counts.
  -- Kept so an admin sees WHY, and so a later policy change can be replayed.
  add column name_detail jsonb not null default '{}',
  -- Set when a substantial mismatch is parked for a human. Cleared on decision.
  add column name_review_required boolean not null default false;

create index verification_sessions_name_review_idx
  on verification_sessions (name_review_required)
  where name_review_required;
