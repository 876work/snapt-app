-- Phase 2: cancellation / reschedule / no-show / payment-action support.

-- Reschedules in the 24–48h window (and the 6–24h band, pending Don's
-- confirmation) carry a fee — distinct transaction type for the ledger.
alter type transaction_type add value if not exists 'reschedule_fee';

alter table bookings
  -- Link a rematch booking back to the cancelled/no-show original.
  add column rematch_of uuid references bookings (id),
  add column no_show_reported_by uuid references profiles (id),
  -- Creator-side reports require an attempted-contact confirmation (§8).
  add column no_show_attempted_contact boolean;
