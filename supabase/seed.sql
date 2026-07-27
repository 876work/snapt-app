-- Snapt Phase 0 seed: business config (handoff §5 confirmed, §6 unconfirmed)
-- and placeholder policy document drafts (§14 — never publish these as-is).

insert into app_config (key, value, description, confirmed) values
  -- §5 — confirmed, safe to build against.
  ('client_service_fee_rate', '0.08', 'Client service fee, shown as line item at checkout', true),
  ('creator_platform_fee_rate', '0.32', 'Standard creator platform fee', true),
  ('creator_promo_fee_rate', '0.20', 'Illustrative promo fee rate, shown with strikethrough; admin-set', true),
  ('xcd_per_usd', '2.70', 'Fixed peg: XCD per 1 USD (USD is base/storage currency)', true),
  ('advance_booking_window_days', '14', 'How far ahead a session can be booked', true),
  ('free_revisions_per_order', '1', 'Free revision rounds per order; additional rounds are paid add-ons', true),
  ('cancel_tiers', '{"over48h": 0, "between24and48h": 0.5, "under24h": 1}',
    'Charge rate by notice window; computed SERVER-SIDE at time of action (§8)', true),
  ('reschedule_free_count', '1', 'Free reschedules (>48h); additional treated as cancel+rebook', true),
  ('reschedule_disabled_under_hours', '24', 'Reschedule disabled entirely under this many hours (widened from 6 to 24 — Don, 2026-07-27; closes the former 6–24h gap)', true),
  ('no_show_grace_minutes', '15', 'Grace period past scheduled start, both directions', true),
  ('offer_window_minutes', '15', 'Creator accept/decline window after assignment; decline/timeout reassigns without a strike (Don, 2026-07-27)', true),
  ('strike_window_days', '60', 'Rolling window for creator strikes', true),
  ('late_cancel_strike_weight', '2', 'Late (<24h) cancellation counts as 2 strikes', true),
  ('strike_tiers', '["warning", "deprioritization_2w", "suspension_1w", "admin_review"]',
    'Consequence at cumulative strike count 1..4+ within window', true),
  ('strike_deprioritize_days', '14', 'Matching deprioritization duration at tier 2 (§5: 2 weeks)', true),
  ('strike_suspension_days', '7', 'Suspension duration at tier 3 (§5: 1 week)', true),
  ('dispute_filing_window_days', '7', 'From session/delivery', true),
  ('payout_hold_days', '7', 'Creator payout hold after session/delivery; matches the dispute filing window exactly so no payout precedes a possible dispute (Don, 2026-07-26)', true),
  ('dispute_evidence_window_hours', '72', 'From notification', true),
  ('dispute_appeal_window_days', '14', 'From decision', true),

  -- §6 — UNCONFIRMED working defaults. Do not build charge/refund/payout
  -- logic against these until Don confirms.
  ('raw_footage_retention_days', '90', 'UNCONFIRMED (§6) — also sets the re-edit ordering window', false),
  ('delivered_content_availability_months', '12', 'UNCONFIRMED (§6)', false),
  ('creator_non_circumvention_months', '12', 'UNCONFIRMED (§6) — Creator Agreement §7', false),
  ('background_check_recheck_months', '24', 'UNCONFIRMED (§6)', false),
  ('occasion_default_duration_hours', '{"Events": 2}',
    'Smart default (§7): Events = 2h is the ONLY confirmed value ("Recommended for Events" on the 2-hour option). Portraits/Social/Family/Wedding are UNDEFINED — do not infer; add here only when Don specifies.', true),
  ('pricing_table',
    '{"photo": {"1": 60, "1.5": 90, "2": 120, "3": 180, "4": 240},
      "video": {"1": 90, "1.5": 135, "2": 180, "3": 270, "4": 360},
      "both":  {"1": 130, "1.5": 195, "2": 260, "3": 390, "4": 520}}',
    'CONFIRMED launch pricing (Don, 2026-07-27): session price USD by service type × duration hours', true),
  ('remote_pricing_table',
    '{"photo": {"photos_1_5": 25, "photos_6_10": 45, "photos_11_15": 65},
      "video": {"short": 70, "standard": 120, "extended": 180},
      "both":  {"small": 85, "medium": 150, "large": 220}}',
    'CONFIRMED remote-edit pricing (Don, 2026-07-27): order price USD by service type × tier. 15 files is a HARD ceiling per order (no extra-files add-on — more files = second order)', true),
  ('remote_addons', '{"rush": 20, "extra_revision": 15}',
    'CONFIRMED remote add-ons (Don, 2026-07-27): rush = flat $20 any type/tier; extra_revision = $15 per round beyond the 1 free', true);

-- Placeholder drafts for the 13 policy docs (slugs match lib/mock/legal.ts).
-- Status stays 'draft': §14 requires explicit publish after attorney review.
insert into policy_documents (doc_type, version, title, content, status, requires_reconsent)
values
  ('terms', 1, 'Terms of Service', '[DRAFT — pending attorney review. Do not publish.]', 'draft', false),
  ('privacy', 1, 'Privacy Policy', '[DRAFT — pending attorney review. Do not publish.]', 'draft', false),
  ('cancellation', 1, 'Cancellation & Refund Policy', '[DRAFT — see 01_Cancellation_and_Refund_Policy.md. Pending attorney review.]', 'draft', false),
  ('creator-agreement', 1, 'Creator Agreement', '[DRAFT — see 02_Creator_Agreement.md. Active consent required at creator application (§14).]', 'draft', true),
  ('trust-safety', 1, 'Trust & Safety Policy', '[DRAFT — see 03_Trust_and_Safety_Policy.md. Pending attorney review.]', 'draft', false),
  ('content-usage', 1, 'Content & Usage Policy', '[DRAFT — see 04_Content_and_Usage_Policy.md. Pending attorney review.]', 'draft', false),
  ('payment-payout', 1, 'Payment & Payout Policy', '[DRAFT — see 05_Payment_and_Payout_Policy.md. Pending attorney review.]', 'draft', false),
  ('data-retention', 1, 'Data Retention Policy', '[DRAFT — see 06_Data_Retention_Policy.md. Pending attorney review.]', 'draft', false),
  ('minor-safety', 1, 'Minor Safety & Age Policy', '[DRAFT — see 07_Minor_Safety_and_Age_Policy.md. Pending attorney review.]', 'draft', false),
  ('dispute-resolution', 1, 'Dispute Resolution Policy', '[DRAFT — see 08_Dispute_Resolution_Policy.md. Pending attorney review.]', 'draft', false),
  ('background-check', 1, 'Background Check & Vetting Disclosure', '[DRAFT — see 09_Background_Check_and_Vetting_Disclosure.md. Active consent required (§14). Provider-dependent placeholders unresolved.]', 'draft', true),
  ('accessibility', 1, 'Accessibility Statement', '[DRAFT — see 10_Accessibility_Statement.md. Pending review.]', 'draft', false),
  ('notifications', 1, 'Notification Policy', '[DRAFT — see 11_Notification_Trigger_Mapping.md (internal source of truth for the dispatcher).]', 'draft', false);

-- ---------------------------------------------------------------------------
-- LOCAL-ONLY demo creators (mirror lib/mock/data.ts). seed.sql never runs in
-- production. Password for all: "password1234". Profiles rows are created by
-- the on_auth_user_created trigger; we then flip them to approved creators.
-- ---------------------------------------------------------------------------

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jordan@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Jordan M."}', now(), now()),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'amara@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Amara J."}', now(), now()),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marcus@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Marcus D."}', now(), now()),
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'nia@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Nia T."}', now(), now()),
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sam@demo.snapt', crypt('password1234', gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', '{"full_name": "Sam R."}', now(), now());

-- GoTrue requires empty strings (not NULLs) in these token columns for
-- manually inserted users, or password logins 500.
update auth.users set
  confirmation_token = '', recovery_token = '', email_change = '',
  email_change_token_new = '', email_change_token_current = '',
  phone_change = '', phone_change_token = '', reauthentication_token = ''
  where id in (
    '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005');

update profiles set mode = 'creator'
  where id in (
    '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000005');

-- Placeholder avatars (external placeholder service) so Creator Assignment
-- cards are visually distinct during local testing. NOT the real avatar
-- pipeline — creator photo upload to Cloudflare R2 is Phase 3.
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=12' where id = '00000000-0000-4000-8000-000000000001';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=47' where id = '00000000-0000-4000-8000-000000000002';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=53' where id = '00000000-0000-4000-8000-000000000003';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=44' where id = '00000000-0000-4000-8000-000000000004';
update profiles set avatar_url = 'https://i.pravatar.cc/300?img=59' where id = '00000000-0000-4000-8000-000000000005';

-- Weekly availability template: {"mon": [{"start": "09:00", "end": "17:00"}], ...}
insert into creator_profiles
  (user_id, vetting_status, background_check_status, background_check_completed_at,
   specialties, service_radius_km, base_area, verified, availability)
values
  ('00000000-0000-4000-8000-000000000001', 'approved', 'passed', now(), '{Portraits,Wedding,Events}', 15, 'Rodney Bay', true,
    '{"mon": [{"start": "09:00", "end": "17:00"}], "tue": [{"start": "09:00", "end": "17:00"}], "wed": [{"start": "09:00", "end": "17:00"}], "thu": [{"start": "09:00", "end": "17:00"}], "fri": [{"start": "09:00", "end": "17:00"}], "sat": [{"start": "08:00", "end": "18:00"}]}'),
  ('00000000-0000-4000-8000-000000000002', 'approved', 'passed', now(), '{Family,Portraits,Social,Wedding}', 20, 'Gros Islet', true,
    '{"tue": [{"start": "10:00", "end": "18:00"}], "wed": [{"start": "10:00", "end": "18:00"}], "thu": [{"start": "10:00", "end": "18:00"}], "fri": [{"start": "10:00", "end": "18:00"}], "sat": [{"start": "08:00", "end": "18:00"}], "sun": [{"start": "08:00", "end": "14:00"}]}'),
  ('00000000-0000-4000-8000-000000000003', 'approved', 'pending', null, '{Events,Social}', 10, 'Castries', false,
    '{"mon": [{"start": "12:00", "end": "20:00"}], "wed": [{"start": "12:00", "end": "20:00"}], "fri": [{"start": "12:00", "end": "20:00"}], "sat": [{"start": "10:00", "end": "20:00"}], "sun": [{"start": "10:00", "end": "16:00"}]}'),
  ('00000000-0000-4000-8000-000000000004', 'approved', 'passed', now(), '{Wedding,Family,Portraits}', 25, 'Marigot Bay', true,
    '{"mon": [{"start": "09:00", "end": "15:00"}], "tue": [{"start": "09:00", "end": "15:00"}], "thu": [{"start": "09:00", "end": "15:00"}], "sat": [{"start": "07:00", "end": "19:00"}], "sun": [{"start": "07:00", "end": "19:00"}]}'),
  ('00000000-0000-4000-8000-000000000005', 'approved', 'pending', null, '{Social,Events}', 12, 'Soufrière', false,
    '{"thu": [{"start": "09:00", "end": "17:00"}], "fri": [{"start": "09:00", "end": "21:00"}], "sat": [{"start": "09:00", "end": "21:00"}]}');
