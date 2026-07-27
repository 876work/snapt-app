import { supabaseAdmin } from './supabase.js';
import { stripe } from './stripe.js';
import { getConfig } from './config.js';

// Payment ledger operations. When Stripe is configured AND the booking has a
// real payment intent, refunds go through Stripe; otherwise the operation is
// recorded in the transactions ledger as a simulated success so the full
// Phase 2 flow is exercisable before the Phase 7 credentials cutover.
// Every function writes the Transaction/CreatorPayout rows that the real
// Stripe webhooks will reconcile against later.

interface BookingRow {
  id: string;
  client_id: string;
  creator_id: string | null;
  price_usd: number;
  pricing_snapshot: Record<string, unknown>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function paymentIntentIdFor(bookingId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('transactions')
    .select('stripe_payment_intent_id')
    .eq('booking_id', bookingId)
    .eq('type', 'charge')
    .eq('status', 'succeeded')
    .not('stripe_payment_intent_id', 'is', null)
    .limit(1)
    .maybeSingle();
  return data?.stripe_payment_intent_id ?? null;
}

/**
 * Charge the booking. With Stripe configured (test keys now, live at
 * Phase 7) this creates+confirms a real PaymentIntent using Stripe's test
 * payment method server-side — real charge/refund objects, no card UI yet
 * (the in-app payment sheet arrives with the publishable key at Phase 7).
 * Without keys, the ledger row is simulated as before.
 */
export async function recordBookingCharge(booking: BookingRow): Promise<void> {
  let intentId: string | null = null;
  if (stripe) {
    const intent = await stripe.paymentIntents.create({
      amount: Math.round(booking.price_usd * 100),
      currency: 'usd',
      payment_method: 'pm_card_visa', // Stripe test method; real cards at Phase 7
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { booking_id: booking.id, client_id: booking.client_id },
    });
    intentId = intent.id;
  }
  await supabaseAdmin.from('transactions').insert({
    booking_id: booking.id,
    user_id: booking.client_id,
    type: 'charge',
    status: 'succeeded',
    amount_usd: booking.price_usd,
    stripe_payment_intent_id: intentId,
    fees: booking.pricing_snapshot,
  });
}

/** Refund `amountUsd` to the client — via Stripe when possible, always ledgered. */
export async function refundClient(
  booking: BookingRow,
  amountUsd: number,
  reason: string,
): Promise<void> {
  if (amountUsd <= 0) return;
  let stripeRefundId: string | null = null;
  if (stripe) {
    const intentId = await paymentIntentIdFor(booking.id);
    if (intentId) {
      const refund = await stripe.refunds.create({
        payment_intent: intentId,
        amount: Math.round(amountUsd * 100),
        metadata: { booking_id: booking.id, reason },
      });
      stripeRefundId = refund.id;
    }
  }
  await supabaseAdmin.from('transactions').insert({
    booking_id: booking.id,
    user_id: booking.client_id,
    type: 'refund',
    status: 'succeeded',
    amount_usd: amountUsd,
    stripe_refund_id: stripeRefundId,
    fees: { reason },
  });
}

/** Ledger a fee kept by the platform (cancellation / reschedule / no-show). */
export async function recordFee(
  booking: BookingRow,
  type: 'cancellation_fee' | 'reschedule_fee' | 'no_show_charge',
  amountUsd: number,
  detail: Record<string, unknown>,
): Promise<void> {
  if (amountUsd <= 0) return;
  await supabaseAdmin.from('transactions').insert({
    booking_id: booking.id,
    user_id: booking.client_id,
    type,
    status: 'succeeded',
    amount_usd: amountUsd,
    fees: detail,
  });
}

/**
 * Write the creator payout for a booking: session price minus the platform
 * fee (promo rate if set), held for payout_hold_days (= the 7-day dispute
 * window, so no payout precedes a filable dispute).
 */
export async function createPayoutForBooking(booking: BookingRow): Promise<void> {
  if (!booking.creator_id) return;
  // Idempotent: one payout per booking (complete + deliver may both fire).
  const { data: existing } = await supabaseAdmin
    .from('creator_payouts')
    .select('id')
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (existing) return;
  const config = await getConfig();
  const standardRate = (config['creator_platform_fee_rate'] as number) ?? 0.32;
  const holdDays = (config['payout_hold_days'] as number) ?? 7;

  const { data: creator } = await supabaseAdmin
    .from('creator_profiles')
    .select('promo_fee_rate')
    .eq('user_id', booking.creator_id)
    .maybeSingle();
  const feeRate = creator?.promo_fee_rate ?? standardRate;

  const sessionPrice =
    (booking.pricing_snapshot['session_price_usd'] as number) ?? booking.price_usd;
  const amount = round2(sessionPrice * (1 - feeRate));

  await supabaseAdmin.from('creator_payouts').insert({
    creator_id: booking.creator_id,
    booking_id: booking.id,
    amount_usd: amount,
    fee_rate_applied: feeRate,
    is_promo_rate: creator?.promo_fee_rate != null,
    status: 'held',
    hold_until: new Date(Date.now() + holdDays * 86400_000).toISOString(),
  });
}
