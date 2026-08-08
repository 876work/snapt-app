-- Let a charge be recorded BEFORE its booking exists.
--
-- Checkout was moved behind payment: the booking is now created by the
-- payment_intent.succeeded webhook, not at slide time. To stay idempotent
-- against Stripe's retries, the handler claims the intent by inserting the
-- transaction FIRST and relying on the unique index over
-- (stripe_payment_intent_id, type='charge') to reject a duplicate delivery.
--
-- That claim happens seconds before the booking row exists, so booking_id is
-- necessarily NULL at insert time. The column was NOT NULL, so the claim
-- failed with 23502 every single time. The handler treated any claim error as
-- "already processed", returned success, and the webhook answered 2xx — so
-- Stripe saw perfect deliveries while 16 paid checkouts produced no booking.
--
-- booking_id is populated moments later by the same handler, and remains
-- required in practice for every row we write; it simply cannot be enforced
-- at the instant of the claim.
ALTER TABLE transactions ALTER COLUMN booking_id DROP NOT NULL;

COMMENT ON COLUMN transactions.booking_id IS
  'Nullable only for the brief window between claiming a Stripe intent and '
  'creating its booking. A charge row left with booking_id NULL after that '
  'means booking creation failed and the payment needs reconciling.';
