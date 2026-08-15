-- Voice notes in chat (2026-08-15).
--
-- Additive and defaulted on purpose: build-16 clients insert only
-- {booking_id, sender_id, body} and must keep working, and this file must be
-- safe to run BEFORE the server deploy (standing rule since the FK/embed
-- outage: a migration must never break code that is already live).
--
-- kind: 'text' (default) or 'voice'. Voice rows still carry a body — the
-- literal '🎤 Voice note' — so every reader that previews body (thread list,
-- push preview, build-16 bubbles that predate the player) degrades
-- gracefully instead of rendering blank.
--
-- audio_path: storage path WITHOUT the bucket prefix (repo convention —
-- storage.ts prepends 'voice/'). CHECK-pinned under the message's own
-- booking id so a hand-rolled insert cannot point a bubble at another
-- booking's object; the playback endpoint re-checks the same prefix before
-- signing a GET.
--
-- RLS is deliberately untouched: the live policies (INSERT in
-- 20260812070000, SELECT in 20260809120000) gate by participant, attached
-- creator, non-pending status and active accounts — none of which reference
-- columns, so voice rows inherit every text-message restriction identically.

alter table messages add column if not exists kind text not null default 'text';
alter table messages add column if not exists audio_path text;
alter table messages add column if not exists duration_seconds integer;

alter table messages add constraint messages_kind_check
  check (kind in ('text', 'voice'));

-- Shape rule: text rows carry no audio fields; voice rows must have a path
-- under their own booking and a sane duration (hard cap is 120s in the app;
-- 130 leaves headroom for clock skew, not for longer recordings).
-- The explicit `is not null` matters: CHECK constraints PASS on NULL, so
-- without it a voice row with NULL duration_seconds would satisfy the
-- BETWEEN via three-valued logic and slip through.
alter table messages add constraint messages_voice_shape_check
  check (
    (kind = 'text' and audio_path is null and duration_seconds is null)
    or (
      kind = 'voice'
      and audio_path is not null
      and audio_path like booking_id::text || '/%'
      and duration_seconds is not null
      and duration_seconds between 1 and 130
    )
  );

-- Local stack only: the Supabase-storage fallback driver needs a real
-- bucket ('voice' is a key prefix on R2 in production). Same precedent as
-- raw-footage/deliverables (phase3) and portfolio (20260729120000);
-- without it every local voice upload 500s as "Bucket not found".
insert into storage.buckets (id, name, public)
  values ('voice', 'voice', false)
  on conflict (id) do nothing;
