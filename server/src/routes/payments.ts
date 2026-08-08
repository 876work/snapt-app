import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { requireStripe } from '../stripe.js';
import { supabaseAdmin } from '../supabase.js';
import { env } from '../env.js';
import { notify } from '../notify.js';

/**
 * Stripe payments — PaymentSheet integration (test mode).
 *
 * Flow: the app creates the booking (server-priced), asks here for a
 * PaymentIntent + customer + ephemeral key, and presents PaymentSheet.
 * CARD DATA NEVER TOUCHES THIS SERVER: the sheet tokenises on device
 * straight to Stripe; we only ever see intent/customer ids.
 *
 * The ledger truth comes from the WEBHOOK, not the client: a client that
 * dies right after paying still gets its charge recorded when Stripe calls
 * us. The app polls /v1/payments/status until the webhook lands.
 */
export function registerPaymentRoutes(app: FastifyInstance) {
  // Client checkout: PaymentIntent + customer + ephemeral key for the sheet.
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

    // One Stripe customer per user — PaymentSheet's saved cards live there.
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id, full_name, email')
      .eq('id', user.id)
      .maybeSingle();
    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: profile?.full_name || undefined,
        email: profile?.email || undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }
    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2025-08-27.basil' }, // = the SDK's pinned version
    );

    // Amount comes from the server-side pricing snapshot, never the client.
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(Number(booking.price_usd) * 100),
      currency: 'usd',
      customer: customerId,
      metadata: { booking_id: booking.id, client_id: user.id },
      automatic_payment_methods: { enabled: true },
    });
    return {
      client_secret: intent.client_secret,
      customer_id: customerId,
      ephemeral_key: ephemeralKey.secret,
      amount_usd: Number(booking.price_usd),
    };
  });

  // The app polls this after PaymentSheet reports success — "paid" flips
  // when the webhook has ledgered the charge (the source of truth).
  app.get<{ Querystring: { booking_id?: string } }>('/v1/payments/status', async (request, reply) => {
    const user = requireUser(request);
    const { booking_id } = request.query;
    if (!booking_id) return reply.code(400).send({ error: 'booking_id is required' });
    const { data } = await supabaseAdmin
      .from('transactions')
      .select('id, status')
      .eq('booking_id', booking_id)
      .eq('user_id', user.id)
      .eq('type', 'charge')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return { paid: data?.status === 'succeeded', failed: data?.status === 'failed' };
  });

  // PaymentSheet cancelled/failed before any charge: withdraw the unpaid
  // booking so nothing is left half-alive (no offer keeps running for a
  // booking that was never paid). Refuses if a charge already exists.
  app.post<{ Body: { booking_id: string } }>('/v1/payments/abandon', async (request, reply) => {
    const user = requireUser(request);
    const { booking_id } = request.body ?? {};
    if (!booking_id) return reply.code(400).send({ error: 'booking_id is required' });
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, status')
      .eq('id', booking_id)
      .maybeSingle();
    if (!booking) return reply.code(404).send({ error: 'Booking not found' });
    if (booking.client_id !== user.id) return reply.code(403).send({ error: 'Not your booking' });
    if (booking.status !== 'pending') {
      return reply.code(409).send({ error: `Booking is ${booking.status}, not pending` });
    }
    const { data: charge } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('booking_id', booking_id)
      .eq('type', 'charge')
      .eq('status', 'succeeded')
      .limit(1)
      .maybeSingle();
    if (charge) return reply.code(409).send({ error: 'Booking is already paid' });
    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        creator_id: null,
        offer_expires_at: null,
      })
      .eq('id', booking_id);
    return { abandoned: true };
  });

  // NOTE: Stripe Connect is NOT used (Don, 2026-07-28) — creator payouts
  // are fulfilled manually by admins from the payout-request queue.

  // Stripe webhook — the authority on payment outcomes. Signature verified
  // against the raw body; every write is idempotent because Stripe retries.
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
      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const bookingId = intent.metadata?.booking_id;
        const clientId = intent.metadata?.client_id;
        if (!bookingId || !clientId) break; // not one of ours

        // Social selection extras: a separate purpose so this charge is
        // never mistaken for the booking's main payment. Payment truth
        // arrives HERE (webhook), which is what locks the selection.
        if (intent.metadata?.purpose === 'social_extras') {
          const { data: b } = await supabaseAdmin
            .from('bookings')
            .select('id, client_id, creator_id, pricing_snapshot, selections_locked_at')
            .eq('id', bookingId)
            .maybeSingle();
          if (!b) break;
          const extrasBase = Number(intent.metadata?.extras_base_usd ?? 0) || 0;
          const { error: exErr } = await supabaseAdmin.from('transactions').insert({
            booking_id: bookingId,
            user_id: clientId,
            type: 'charge',
            status: 'succeeded',
            amount_usd: intent.amount_received / 100,
            stripe_payment_intent_id: intent.id,
            fees: {
              kind: 'social_extras',
              base_usd: extrasBase,
              extra_photos: Number(intent.metadata?.extra_photos ?? 0) || 0,
              extra_videos: Number(intent.metadata?.extra_videos ?? 0) || 0,
            },
          });
          // The unique index makes webhook retries no-ops; only the first
          // delivery updates the snapshot and locks.
          if (!exErr && !b.selections_locked_at) {
            const snap = (b.pricing_snapshot ?? {}) as Record<string, unknown>;
            await supabaseAdmin
              .from('bookings')
              .update({
                pricing_snapshot: {
                  ...snap,
                  social_extras_usd: Number(snap['social_extras_usd'] ?? 0) + extrasBase,
                  social_extra_photos: Number(intent.metadata?.extra_photos ?? 0) || 0,
                  social_extra_videos: Number(intent.metadata?.extra_videos ?? 0) || 0,
                },
              })
              .eq('id', bookingId);
            // The chosen rows were stamped at submit time; the webhook
            // locks exactly that set.
            const { data: chosen } = await supabaseAdmin
              .from('booking_media')
              .select('id')
              .eq('booking_id', bookingId)
              .eq('kind', 'proof')
              .not('selected_at', 'is', null);
            const { lockSelection } = await import('./social.js');
            await lockSelection(b, (chosen ?? []).map((m) => m.id), 'client');
            await notify(
              clientId,
              'payment_charged',
              'Extra picks added',
              `Your payment of $${(intent.amount_received / 100).toFixed(2)} went through — your full selection is locked and off to editing.`,
              { booking_id: bookingId },
            );
          }
          break;
        }
        const { data: booking } = await supabaseAdmin
          .from('bookings')
          .select('id, price_usd, pricing_snapshot')
          .eq('id', bookingId)
          .maybeSingle();
        if (!booking) break;
        // Unique partial index on (stripe_payment_intent_id, type='charge')
        // makes retries a no-op.
        // .select() so the receipt notification can point at THIS row
        // rather than the payments list.
        const { data: txn, error: insErr } = await supabaseAdmin.from('transactions').insert({
          booking_id: bookingId,
          user_id: clientId,
          type: 'charge',
          status: 'succeeded',
          amount_usd: intent.amount_received / 100,
          stripe_payment_intent_id: intent.id,
          fees: booking.pricing_snapshot,
        }).select('id').maybeSingle();
        if (!insErr) {
          await notify(
            clientId,
            'payment_charged',
            'Payment received',
            `Your payment of $${(intent.amount_received / 100).toFixed(2)} went through — receipt under Profile → Payments & receipts.`,
            { booking_id: bookingId, transaction_id: txn?.id },
          );
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const intent = event.data.object;
        request.log.warn(
          { booking_id: intent.metadata?.booking_id, code: intent.last_payment_error?.code },
          'payment failed',
        );
        break;
      }
      case 'charge.refunded': {
        // Refunds we initiate are ledgered by refundClient at initiation
        // time (with their stripe_refund_id) — the unique index means a
        // webhook replay of the same refund is a no-op. Refunds made
        // directly in the Stripe dashboard get ledgered here.
        const charge = event.data.object;
        const intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        if (!intentId) break;
        const { data: original } = await supabaseAdmin
          .from('transactions')
          .select('booking_id, user_id')
          .eq('stripe_payment_intent_id', intentId)
          .eq('type', 'charge')
          .maybeSingle();
        if (!original) break;
        for (const refund of charge.refunds?.data ?? []) {
          await supabaseAdmin.from('transactions').insert({
            booking_id: original.booking_id,
            user_id: original.user_id,
            type: 'refund',
            status: 'succeeded',
            amount_usd: refund.amount / 100,
            stripe_refund_id: refund.id,
            fees: { source: 'stripe_webhook' },
          });
        }
        break;
      }
      default:
        break;
    }
    return { received: true };
  });
}
