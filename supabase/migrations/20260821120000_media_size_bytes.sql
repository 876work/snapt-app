-- Stored byte size for uploaded order files (2026-08-21).
--
-- Additive, nullable, no default, no constraint, and safe to run BEFORE the
-- server deploy (standing rule since the FK/embed outage: a migration must
-- never break code that is already live). A server that predates this column
-- keeps inserting without mentioning it and the rows simply read null.
--
-- Deliberately NOT a foreign key. Adding an FK is what breaks bare PostgREST
-- embeds at migration time; a plain column addition cannot, so none of the
-- existing `booking_media` embeds need touching.
--
-- WHY IT EXISTS
--
-- Nothing anywhere recorded how large a stored file is. `size_bytes` arrives
-- from the client at PRESIGN and is used for one thing — the per-file cap
-- check (media.ts, upload-drafts.ts) — and then thrown away. So R2 was the
-- only system that knew the byte count, and "is on-device video compression
-- actually shrinking anything?" could not be answered from the dashboard or
-- from SQL at all, only by fetching objects out of the bucket one at a time.
--
-- FILLED FROM STORAGE, NOT FROM THE CLIENT
--
-- The server reads it back off the object (HEAD) at register time, after the
-- bytes have landed. The presign figure describes what a phone INTENDED to
-- send, which is precisely the wrong number for a column whose whole purpose
-- is settling what actually arrived — and it is the compressor's output size
-- that is in question here, so a self-reported value would beg the question.
--
-- NULL MEANS "NOT RECORDED", NEVER ZERO
--
-- Rows predating this migration stay null forever: the information was never
-- captured and R2 is the only place it survives, so there is nothing to
-- backfill from. A failed size probe also lands null rather than 0, because
-- registration must not fail over a metadata read. Every reader has to keep
-- null and zero apart — summing null as 0 silently under-reports a total.
--
-- bigint rather than integer: the video ceiling is 750MB today
-- (media.ts MAX_VIDEO_BYTES), comfortably inside int4, but a cap is a product
-- decision and 4 more bytes per row is cheaper than a second migration.

alter table booking_media
  add column if not exists size_bytes bigint;

comment on column booking_media.size_bytes is
  'Bytes of the stored object, read back from storage at register time. NULL = not recorded (row predates 2026-08-21, or the size probe failed) and never means zero.';
