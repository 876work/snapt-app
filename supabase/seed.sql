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
  ('reschedule_disabled_under_hours', '6', 'Reschedule disabled entirely under this many hours', true),
  ('no_show_grace_minutes', '15', 'Grace period past scheduled start, both directions', true),
  ('strike_window_days', '60', 'Rolling window for creator strikes', true),
  ('late_cancel_strike_weight', '2', 'Late (<24h) cancellation counts as 2 strikes', true),
  ('strike_tiers', '["warning", "deprioritization_2w", "suspension_1w", "admin_review"]',
    'Consequence at cumulative strike count 1..4+ within window', true),
  ('dispute_filing_window_days', '7', 'From session/delivery', true),
  ('dispute_evidence_window_hours', '72', 'From notification', true),
  ('dispute_appeal_window_days', '14', 'From decision', true),

  -- §6 — UNCONFIRMED working defaults. Do not build charge/refund/payout
  -- logic against these until Don confirms.
  ('raw_footage_retention_days', '90', 'UNCONFIRMED (§6) — also sets the re-edit ordering window', false),
  ('delivered_content_availability_months', '12', 'UNCONFIRMED (§6)', false),
  ('creator_non_circumvention_months', '12', 'UNCONFIRMED (§6) — Creator Agreement §7', false),
  ('payout_hold_hours', '72', 'UNCONFIRMED (§6) — conflicts with 7-day dispute window; needs Don''s decision before Phase 2', false),
  ('background_check_recheck_months', '24', 'UNCONFIRMED (§6)', false),
  ('occasion_default_duration_hours',
    '{"Events": 3, "Portraits": 1, "Social": 1, "Family": 2, "Wedding": 6}',
    'UNCONFIRMED (§6) — only Portraits and Wedding were illustrative examples; other three need real values', false);

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
