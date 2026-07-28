-- Repeat false-reporter signal (Don, 2026-07-29 — visibility only, no
-- automated consequence): when an admin unsuspends a user who was suspended
-- by a critical/high content report, each reporting account's counter
-- increments so admins reviewing future reports from that person see the
-- pattern. Service-role writes only.
alter table profiles add column false_report_count integer not null default 0;

-- Per-report marker so repeated suspend/unsuspend cycles on the same target
-- never count the same report twice.
alter table content_reports add column false_counted_at timestamptz;
