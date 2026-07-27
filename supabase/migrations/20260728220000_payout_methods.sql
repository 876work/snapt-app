-- Structured per-method payout details (Don, 2026-07-28), replacing the
-- free-text column: {"selected": "cibc", "methods": {"cibc": {...}, ...}}.
-- Methods: cash (pickup — mechanics TBD), penny_pinch, cibc, republic_ec,
-- bank_slu, paypal.
alter table creator_profiles drop column payout_details;
alter table creator_profiles add column payout_methods jsonb not null default '{}';
