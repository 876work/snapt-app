import Stripe from 'stripe';
import { env, stripeConfigured } from './env.js';

// Stripe + Stripe Connect scaffolding (handoff §2). Real keys arrive at
// Phase 7 cutover; until then the payment routes return 503 rather than
// pretending to charge.
export const stripe: Stripe | null = stripeConfigured
  ? new Stripe(env.stripeSecretKey as string)
  : null;

export function requireStripe(): Stripe {
  if (!stripe) {
    const err = new Error(
      'Stripe is not configured (set STRIPE_SECRET_KEY). Payments are disabled in this environment.',
    ) as Error & { statusCode: number };
    err.statusCode = 503;
    throw err;
  }
  return stripe;
}
