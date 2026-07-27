-- Emergency contact sharing is EMAIL-based (Resend) — Snapt uses no SMS
-- anywhere (Don, 2026-07-28). Email becomes the primary contact field;
-- phone stays as optional display/contact info, never OTP-verified.
alter table emergency_contacts add column email text;
alter table emergency_contacts alter column phone drop not null;
