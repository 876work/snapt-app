-- Real card entry via PaymentSheet (test mode).
--
-- Stripe customer per user: lets PaymentSheet offer saved cards ("Book
-- again" flows). Created lazily by the payment-intent endpoint.
alter table profiles add column stripe_customer_id text;

-- Webhook idempotency: Stripe retries webhooks, and the ledger must never
-- double-record a charge or refund for the same Stripe object.
create unique index transactions_intent_charge_uniq
  on transactions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null and type = 'charge';
create unique index transactions_refund_uniq
  on transactions (stripe_refund_id)
  where stripe_refund_id is not null;
