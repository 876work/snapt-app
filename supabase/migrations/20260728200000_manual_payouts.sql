-- Manual payout fulfillment (Don, 2026-07-28): Stripe Connect is NOT used.
-- Cash-out creates a payout REQUEST; an admin marks it paid after sending
-- money externally (bank transfer etc.), audited.
alter type payout_status add value if not exists 'requested';
-- Where to send money. FLAGGED: no collection UI existed before this —
-- creators must be able to save this from the app before launch.
alter table creator_profiles add column payout_details text;
