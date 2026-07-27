-- Phase 1: creator payout account linkage.
-- Stripe Connect account id, stored when the creator completes Express
-- onboarding (server-side only — no RLS policy exposes it to other users,
-- and the API never returns it to clients).

alter table creator_profiles
  add column stripe_connect_account_id text;
