import { supabaseAdmin } from './supabase.js';
import { notify } from './notify.js';
import { offerWindowMs } from './offers.js';
import {
  isQuoteFailure,
  quoteBooking,
  unpackBookingParams,
  type CreateBookingBody,
} from './booking-quote.js';

/**
 * CREATE THE BOOKING ONLY ONCE STRIPE SAYS THE MONEY MOVED.
 *
 * Called from the payment_intent.succeeded webhook. Everything that used to
 * happen at slide time — the row, the creator assignment, the 15-minute
 * offer clock, the "New job offer" push — happens here, after payment.
 *
 * Idempotent: the transactions table has a unique partial index on
 * (stripe_payment_intent_id, type='charge'), so a webhook retry loses the
 * insert race and returns without creating a second booking.
 */
export async function createBookingFromPaidIntent(intent: {
  id: string;
  amount_received: number;
  metadata?: Record<string, string> | null;
}): Promise<{ created: boolean; booking_id?: string; reason?: string }> {
  const md = (intent.metadata ?? {}) as Record<string, string>;
  const clientId = md.client_id;
  if (!clientId) return { created: false, reason: 'no_client' };

  // Claim this intent FIRST. Winning the unique index is what makes us the
  // one webhook delivery allowed to create the booking; a retry (or a
  // duplicate delivery) fails here and stops.
  const paidUsd = intent.amount_received / 100;
  const { data: claim, error: claimErr } = await supabaseAdmin
    .from('transactions')
    .insert({
      user_id: clientId,
      type: 'charge',
      status: 'succeeded',
      amount_usd: paidUsd,
      stripe_payment_intent_id: intent.id,
      fees: { kind: 'booking_checkout' },
    })
    .select('id')
    .maybeSingle();
  if (claimErr) return { created: false, reason: 'already_processed' };

  const body: CreateBookingBody = unpackBookingParams(md);
  // Re-price and re-check availability at PAYMENT time, not slide time.
  // postPayment: a slot lost in the meantime no longer throws the booking
  // away — the money is real, so it lands unassigned for manual dispatch.
  const result = await quoteBooking(clientId, body, true);
  if (isQuoteFailure(result)) {
    // Should be unreachable (the same inputs priced fine seconds ago), but
    // money exists and must never vanish into a log line.
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'checkout_quote_failed',
      detail: { intent: intent.id, client_id: clientId, error: result.failure.error, paid_usd: paidUsd },
    });
    return { created: false, reason: 'quote_failed' };
  }
  const q = result.quote;

  // What Stripe actually took wins over what we would price now — an admin
  // price edit mid-checkout must never change what the client was charged.
  const charged = paidUsd;
  const snapshot: Record<string, unknown> = { ...q.snapshot, total_usd: charged, charged_usd: charged };
  if (Math.abs(charged - q.total) > 0.005) {
    snapshot.quote_drift_usd = Math.round((charged - q.total) * 100) / 100;
  }

  const { data: booking, error } = await supabaseAdmin
    .from('bookings')
    .insert({
      client_id: clientId,
      creator_id: q.assignedCreatorId,
      type: q.type,
      occasion: body.occasion ?? null,
      media_kind: q.mediaKind,
      duration_hours: q.durationHours,
      area: body.area ?? null,
      meeting_point: q.type === 'in_person' ? body.meeting_point ?? null : null,
      ...(q.type === 'in_person' && body.meeting_lat != null && body.meeting_lng != null
        ? { meeting_lat: body.meeting_lat, meeting_lng: body.meeting_lng }
        : {}),
      scheduled_at: q.scheduledAtIso,
      status: 'pending',
      price_usd: charged,
      pricing_snapshot: snapshot,
    })
    .select()
    .single();
  if (error || !booking) {
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'checkout_booking_insert_failed',
      detail: { intent: intent.id, client_id: clientId, paid_usd: paidUsd, error: error?.message },
    });
    return { created: false, reason: 'insert_failed' };
  }

  // Attach the charge to its booking now that one exists.
  if (claim?.id) {
    await supabaseAdmin
      .from('transactions')
      .update({ booking_id: booking.id, fees: snapshot })
      .eq('id', claim.id);
  }

  // ---- Only NOW does a creator hear about it -----------------------------
  if (q.assignedCreatorId) {
    // The 15-minute clock starts from PAYMENT CONFIRMATION, not from the
    // slide — a creator's window is no longer burned by a client sitting on
    // the card sheet.
    const expires = new Date(Date.now() + (await offerWindowMs())).toISOString();
    await supabaseAdmin.from('bookings').update({ offer_expires_at: expires }).eq('id', booking.id);
    booking.offer_expires_at = expires;
    // A rushed job is a different job: the creator is agreeing to a
    // few-hours turnaround, and they are paid extra for it. Say so in the
    // one message they are guaranteed to see.
    const rushUsd = Number(((snapshot.addons ?? {}) as Record<string, unknown>).rush_usd ?? 0) || 0;
    await notify(
      q.assignedCreatorId,
      'offer_received',
      rushUsd > 0 ? 'RUSH job offer — fast turnaround' : 'New job offer',
      rushUsd > 0
        ? `A ${body.occasion ?? 'session'} booking near ${body.area ?? 'you'} — the client paid for rush delivery, so edits are due within hours of the session. Pays extra. Accept within the offer window.`
        : `A ${body.occasion ?? 'session'} booking near ${body.area ?? 'you'} is waiting — accept within the offer window.`,
      { booking_id: booking.id },
    );
  } else if (q.type === 'in_person') {
    // Paid, but nobody free by the time the money landed. Manual dispatch
    // owns it; the client is told rather than left watching a silent row.
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'unassigned_paid_booking',
      booking_id: booking.id,
      detail: { client_id: clientId, scheduled_at: q.scheduledAtIso, area: body.area ?? null },
    });
    await notify(
      clientId,
      'booking_confirmed',
      "We're finding your creator",
      "Your payment went through. The creator you picked got booked in the meantime, so we're matching you with another — we'll confirm shortly.",
      { booking_id: booking.id },
    );
  }

  return { created: true, booking_id: booking.id };
}
