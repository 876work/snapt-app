-- Social bundles: deliverable-count product replacing duration-priced Social.
--
-- 1. Proof galleries: a third media kind. 'proof' is a CURATED, watermarked/
--    low-res set the creator exports for client selection. It is deliberately
--    distinct from 'raw' (camera originals, never client-visible) — the raw
--    rule is untouched.
-- 2. Selection state: which proofs the client picked, and the deadline after
--    which the creator's top picks apply.
-- 3. Seed config rows (confirmed=false: working defaults until Don sets
--    final prices from the admin portal).

alter type booking_media_kind add value if not exists 'proof';

alter table booking_media
  -- Upload order = the creator's preference ranking; auto-pick uses it.
  add column if not exists position integer,
  add column if not exists selected_at timestamptz,
  -- 'client' = chosen by the client; 'auto' = deadline top-pick fill.
  add column if not exists selection_source text
    check (selection_source in ('client', 'auto'));

alter table bookings
  add column if not exists selection_deadline_at timestamptz,
  add column if not exists selections_locked_at timestamptz;

-- Sweep target: social bookings past deadline and not yet locked.
create index if not exists bookings_selection_sweep_idx
  on bookings (selection_deadline_at)
  where selections_locked_at is null and selection_deadline_at is not null;

insert into app_config (key, value, description, confirmed) values
  (
    'social_pricing_table',
    '[
      {"id": "lite",     "label": "Lite",     "duration_hours": 1,   "photos": 5,  "videos": 0, "price_usd": 75},
      {"id": "standard", "label": "Standard", "duration_hours": 1.5, "photos": 10, "videos": 1, "price_usd": 140},
      {"id": "full",     "label": "Full",     "duration_hours": 2,   "photos": 15, "videos": 2, "price_usd": 200}
    ]'::jsonb,
    'Social bundle tiers: duration, included edited photo/video counts, price. Videos are 30-sec edits.',
    false
  ),
  (
    'social_addons',
    '{"extra_photo_usd": 12, "extra_video_usd": 35}'::jsonb,
    'Per-unit price when a client selects beyond their Social tier''s included counts.',
    false
  ),
  (
    'social_selection_window_hours',
    '72'::jsonb,
    'Hours the client has to choose proofs before the creator''s top picks apply automatically.',
    false
  ),
  (
    'payout_methods_enabled',
    '{"cash": true, "penny_pinch": true, "cibc": true, "republic_ec": true, "bank_slu": true, "paypal": true}'::jsonb,
    'Which creator payout methods can be newly selected. Disabling one never blocks creators who already have it on file.',
    true
  )
on conflict (key) do nothing;
