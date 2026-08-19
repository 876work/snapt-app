import { supabaseAdmin } from './supabase.js';
import { stripe } from './stripe.js';
import { getConfig } from './config.js';

// Payment ledger operations. When Stripe is configured AND the booking has a
// real payment intent, refunds go through Stripe; otherwise the operation is
// recorded in the transactions ledger as a simulated success so the full
// Phase 2 flow is exercisable before the Phase 7 credentials cutover.
// Every function writes the Transaction/CreatorPayout rows that the real
// Stripe webhooks will reconcile against later.

export interface BookingRow {
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
 * Ledger a charge that ALREADY happened on a rematched booking, carrying the
 * original booking's PaymentIntent forward.
 *
 * There is no server-side card charging any more: clients pay through
 * Stripe PaymentSheet on-device and the webhook ledgers it. A rematch
 * (creator declined → reassigned) must not re-charge the client, so the new
 * booking simply inherits the money already taken.
 */
export async function carryChargeToRematch(
  booking: BookingRow,
  originalBookingId: string,
): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('transactions')
    .select('id')
    .eq('booking_id', booking.id)
    .eq('type', 'charge')
    .limit(1)
    .maybeSingle();
  if (existing) return;
  const intentId = await paymentIntentIdFor(originalBookingId);
  await supabaseAdmin.from('transactions').insert({
    booking_id: booking.id,
    user_id: booking.client_id,
    type: 'charge',
    status: 'succeeded',
    amount_usd: booking.price_usd,
    stripe_payment_intent_id: intentId,
    fees: { ...(booking.pricing_snapshot as object), carried_from: originalBookingId },
  });
}

/**
 * Refund `amountUsd` to the client — via Stripe when possible, always
 * ledgered. Returns whether the ledger write can be trusted: `true` when
 * there was nothing to ledger (amountUsd <= 0) or the insert succeeded,
 * `false` when it failed. Callers must gate any "refund on its way" message
 * on this — otherwise a failed write here is a client told a refund is
 * coming with no record of it anywhere.
 */
export async function refundClient(
  booking: BookingRow,
  amountUsd: number,
  reason: string,
): Promise<boolean> {
  if (amountUsd <= 0) return true;
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
  const { error: ledgerErr } = await supabaseAdmin.from('transactions').insert({
    booking_id: booking.id,
    user_id: booking.client_id,
    type: 'refund',
    status: 'succeeded',
    amount_usd: amountUsd,
    stripe_refund_id: stripeRefundId,
    fees: { reason },
  });
  if (ledgerErr) {
    // The Stripe refund (if one fired above) already succeeded — the money
    // moved. A failed ledger write here means the client is refunded and
    // nothing in the system knows it: a reconciliation gap that was
    // previously invisible everywhere, the same silent-catch class as the
    // unlogged webhook insert failure. Loud AND queued for a human — a log
    // line alone is exactly what let the last one sit unnoticed.
    console.error('[refund] ledger insert FAILED', booking.id, reason, stripeRefundId, ledgerErr.message);
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'refund_ledger_failed',
      booking_id: booking.id,
      detail: {
        user_id: booking.client_id,
        amount_usd: amountUsd,
        reason,
        stripe_refund_id: stripeRefundId,
        error: ledgerErr.message,
      },
    });
    return false;
  }
  return true;
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

/** The creator's fee rate for a booking — promo if they have one, else standard. */
export async function feeRateFor(creatorId: string): Promise<{ rate: number; isPromo: boolean }> {
  const config = await getConfig();
  const standardRate = (config['creator_platform_fee_rate'] as number) ?? 0.32;
  const { data: creator } = await supabaseAdmin
    .from('creator_profiles')
    .select('promo_fee_rate')
    .eq('user_id', creatorId)
    .maybeSingle();
  return {
    rate: creator?.promo_fee_rate ?? standardRate,
    isPromo: creator?.promo_fee_rate != null,
  };
}

/**
 * What a creator would earn from this booking, gross of any reassignment
 * split. Same arithmetic the payout is actually written with — deliberately
 * shared rather than re-derived, because two copies of money maths drift.
 *
 * The admin disable/reassign flow needs this BEFORE a payout row exists, to
 * show what is at stake and to divide it. It previously read
 * `pricing_snapshot.creator_payout_usd`, a key nothing in the codebase has
 * ever written, so every "creator payout" figure an admin saw was $0.00.
 *
 * Social extras are counted only once the client's selection has been priced
 * into the snapshot; before that they are genuinely unknown, not zero-by-bug.
 */
export async function estimateCreatorPayout(
  booking: BookingRow,
  creatorId?: string,
): Promise<number> {
  const who = creatorId ?? booking.creator_id;
  if (!who) return 0;
  const { rate } = await feeRateFor(who);
  return creatorPayoutAt(booking, rate);
}

/**
 * The creator's take at an ALREADY-RESOLVED fee rate.
 *
 * For callers holding one creator and many bookings (the jobs list), so the
 * rate is looked up once instead of per row. `estimateCreatorPayout` is the
 * same thing with the lookup included — both land on `payoutBase`, so there
 * is still exactly one definition of the arithmetic.
 */
export function creatorPayoutAt(booking: BookingRow, rate: number): number {
  return round2(payoutBase(booking.pricing_snapshot, booking.price_usd) * (1 - rate));
}

/**
 * Payout base: the part of the price a creator earns from, pre-fee.
 *
 * THE FULL SUBTOTAL — session price plus every add-on — plus social selection
 * extras. Rush, extra photos and extra revisions are all creator labour, so
 * the platform fee applies to the whole of what the client bought rather than
 * to the session line alone (Don, 2026-08-19). Before this, only rush was in
 * the base: extra photos and extra revisions were kept 100% by the platform,
 * on in-person AND remote orders alike.
 *
 * The client's 8% service fee is NOT in here and never was — it sits outside
 * `subtotal_usd` in the snapshot, so what the client pays is untouched by
 * anything on this path.
 */
function payoutBase(
  snapshot: Record<string, unknown>,
  priceUsd: number,
  /**
   * Social selection extras. Omit to read them from the snapshot; pass them
   * explicitly where the snapshot in hand may be stale (see the deliver path
   * in `createPayoutForBooking`).
   */
  extrasUsd?: number,
): number {
  const sessionPrice = (snapshot['session_price_usd'] as number) ?? priceUsd;
  const addonsUsd = Number(snapshot['addons_usd'] ?? 0) || 0;
  const extras = extrasUsd ?? (Number(snapshot['social_extras_usd'] ?? 0) || 0);
  return sessionPrice + addonsUsd + extras;
}

/**
 * Write the creator payout for a booking: the full subtotal (session price +
 * add-ons + any social extras) minus the platform fee (promo rate if set),
 * held for payout_hold_days (= the 7-day dispute window, so no payout
 * precedes a filable dispute).
 *
 * SPLIT-AWARE. A booking whose session was reassigned mid-flight already has
 * a payout row for the creator who started it, written at reassignment time.
 * The guard is therefore per-creator, not per-booking, and the replacement is
 * paid the REMAINDER — otherwise the old "any row exists → return" guard
 * silently paid the replacement nothing for work they actually did.
 */
export async function createPayoutForBooking(booking: BookingRow): Promise<void> {
  if (!booking.creator_id) return;
  const { data: existing } = await supabaseAdmin
    .from('creator_payouts')
    .select('id, creator_id, amount_usd')
    .eq('booking_id', booking.id);
  // Idempotent for THIS creator (complete + deliver may both fire).
  if ((existing ?? []).some((p) => p.creator_id === booking.creator_id)) return;
  const alreadyIssued = (existing ?? []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
  const config = await getConfig();
  const holdDays = (config['payout_hold_days'] as number) ?? 7;

  const { rate: feeRate, isPromo } = await feeRateFor(booking.creator_id);

  // SOCIAL BUNDLES: the payout waits for DELIVERY, not session end. The
  // work isn't done at session end (editing depends on the client's
  // selection), and selection extras — which the creator edits — must land
  // in the same payout. The in-memory row can be stale here (deliver
  // updates the DB then calls us), so delivered_at is refetched.
  let extrasUsd = 0;
  if (typeof booking.pricing_snapshot['social_tier'] === 'string') {
    const { data: fresh } = await supabaseAdmin
      .from('bookings')
      .select('delivered_at, pricing_snapshot')
      .eq('id', booking.id)
      .maybeSingle();
    if (!fresh?.delivered_at) return;
    const snap = (fresh.pricing_snapshot ?? {}) as Record<string, unknown>;
    extrasUsd = Number(snap['social_extras_usd'] ?? 0) || 0;
  }

  const full = round2(
    payoutBase(booking.pricing_snapshot, booking.price_usd, extrasUsd) * (1 - feeRate),
  );
  // The remainder after any reassignment split. Never negative, and never a
  // zero-dollar row: a replacement brought in after the money was fully
  // allocated gets no payout rather than a $0.00 line in their earnings.
  const amount = round2(full - alreadyIssued);
  if (amount <= 0) return;

  await supabaseAdmin.from('creator_payouts').insert({
    creator_id: booking.creator_id,
    booking_id: booking.id,
    amount_usd: amount,
    fee_rate_applied: feeRate,
    is_promo_rate: isPromo,
    status: 'held',
    hold_until: new Date(Date.now() + holdDays * 86400_000).toISOString(),
  });
}
