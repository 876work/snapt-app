-- Phase 5 scheduler: one reminder per dispute before the 72h evidence
-- deadline closes (§10 automatic reminders).
alter table disputes add column evidence_reminder_sent_at timestamptz;
