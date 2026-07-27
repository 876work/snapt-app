import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { requireStripe } from '../stripe.js';
import { supabaseAdmin } from '../supabase.js';
import { env } from '../env.js';

/**
 * Stripe + Stripe Connect scaffolding (Phase 0). These endpoints define the
 * API surface the app will call; the booking-fee math that feeds them is
 * Phase 2 (and must stay server-side per handoff §8).
 */
export function registerPaymentRoutes(app: FastifyInstance) {
  // Client checkout: create a PaymentIntent for a pending booking.
  app.post<{ Body: { booking_id: string } }>('/v1/payments/intent', async (request, reply) => {
    const user = requireUser(request);
    const stripe = requireStripe();
    const { booking_id } = request.body ?? {};
    if (!booking_id) return reply.code(400).send({ error: 'booking_id is required' });

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, price_usd, status')
      .eq('id', booking_id)
      .single();
    if (error || !booking) return reply.code(404).send({ error: 'Booking not found' });
    if (booking.client_id !== user.id) return reply.code(403).send({ error: 'Not your booking' });
    if (booking.status !== 'pending') {
      return reply.code(409).send({ error: `Booking is ${booking.status}, not pending` });
    }

    // Amount comes from the server-side pricing snapshot, never the client.
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(booking.price_usd) * 100),
      currency: 'usd',
      metadata: { booking_id: booking.id, client_id: user.id },
      automatic_payment_methods: { enabled: true },
    });
    return { client_secret: intent.client_secret };
  });

  // Creator payout onboarding: create/reuse a Connect Express account and
  // return an onboarding link.
  app.post('/v1/connect/onboarding-link', async (request, reply) => {
    const user = requireUser(request);
    const stripe = requireStripe();

    const { data: creator } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id, vetting_status')
      .eq('user_id', user.id)
      .single();
    if (!creator) return reply.code(403).send({ error: 'Not a creator' });

    // Connect account id storage lands with the payout engine (Phase 2);
    // for Phase 0 we create a fresh Express account each call in test mode.
    const account = await stripe.accounts.create({
      type: 'express',
      metadata: { user_id: user.id },
    });
    const link = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      refresh_url: 'snapt://creator/onboarding/refresh',
      return_url: 'snapt://creator/onboarding/complete',
    });
    return { url: link.url, account_id: account.id };
  });

  // Stripe webhook skeleton. Signature verification requires the raw body,
  // registered via content-type parser in index.ts.
  app.post('/v1/stripe/webhook', { config: { rawBody: true } }, async (request, reply) => {
    const stripe = requireStripe();
    if (!env.stripeWebhookSecret) {
      return reply.code(503).send({ error: 'Webhook secret not configured' });
    }
    const signature = request.headers['stripe-signature'];
    if (typeof signature !== 'string') return reply.code(400).send({ error: 'Missing signature' });

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        (request.body as Buffer).toString('utf8'),
        signature,
        env.stripeWebhookSecret,
      );
    } catch {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
      case 'charge.refunded':
      case 'account.updated':
        // Phase 2: write Transaction rows / flip booking status / mark
        // Connect onboarding complete. Phase 0 just acknowledges.
        request.log.info({ type: event.type }, 'stripe event received');
        break;
      default:
        break;
    }
    return { received: true };
  });
}
