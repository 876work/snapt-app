import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { getConfig } from '../config.js';
import { cancelQuote, hoursUntil, rescheduleQuote } from '../fees.js';
import { createPayoutForBooking, recordBookingCharge, recordFee, refundClient } from '../payments.js';
import { recordStrike } from '../strikes.js';
import { dayAvailability } from '../availability.js';
import { offerWindowMs } from '../offers.js';
import { notify } from '../notify.js';

// Phase 2 booking actions (handoff §8): cancellation, reschedule, no-show,
// rematch. Every fee here is computed server-side at time of action from
// app_config — the app's displayed numbers are advisory.

interface BookingRow {
  id: string;
  client_id: string;
  creator_id: string | null;
  type: 'in_person' | 'remote';
  occasion: string;
  media_kind: string;
  duration_hours: number | null;
  area: string | null;
  meeting_point: string | null;
  scheduled_at: string | null;
  status: string;
  reschedule_count: number;
  price_usd: number;
  pricing_snapshot: Record<string, unknown>;
  no_show_reported_by: string | null;
  cancelled_by: string | null;
}

async function loadBooking(id: string, reply: FastifyReply): Promise<BookingRow | null> {
  const { data, error } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();
  if (error || !data) {
    reply.code(404).send({ error: 'Booking not found' });
    return null;
  }
  return data as BookingRow;
}

export function registerBookingActionRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/v1/bookings/:id', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.client_id && user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Not your booking' });
    }
    const { data: transactions } = await supabaseAdmin
      .from('transactions')
      .select('type, status, amount_usd, created_at, fees')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true });
    // Client-facing rematch banner applies when the creator was at fault:
    // creator-initiated cancellation, or a client-reported creator no-show.
    const creatorAtFault =
      (booking.status === 'cancelled' && booking.cancelled_by === booking.creator_id && booking.creator_id != null) ||
      (booking.status === 'no_show' && booking.no_show_reported_by === booking.client_id);
    return { booking, transactions: transactions ?? [], rematch_available: creatorAtFault };
  });

  // Cancellation — client-initiated uses the notice tiers; creator-initiated
  // always fully refunds the client and writes a strike (double for <24h).
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/cancel', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return reply.code(409).send({ error: `Booking is ${booking.status}` });
    }
    const role =
      user.id === booking.client_id ? 'client' : user.id === booking.creator_id ? 'creator' : null;
    if (!role) return reply.code(403).send({ error: 'Not your booking' });

    if (role === 'client') {
      // Refund base includes add-ons (subtotal): they're charged with the
      // session and refund at the same tier; only the service fee is the
      // non-refundable line.
      const sessionPrice =
        (booking.pricing_snapshot['subtotal_usd'] as number) ??
        (booking.pricing_snapshot['session_price_usd'] as number) ??
        booking.price_usd;
      const serviceFee =
        (booking.pricing_snapshot['client_service_fee_usd'] as number) ??
        Math.max(0, booking.price_usd - sessionPrice);

      let quote;
      if (booking.type === 'remote') {
        // Remote-edit orders (01_Cancellation_and_Refund_Policy §6):
        // cancellable only before an editor has been assigned and begun
        // work — after that, revisions, not cancellation. Assigned editor
        // proxies "work begun" until editing state is modeled.
        if (booking.creator_id != null) {
          return reply.code(409).send({
            error:
              'Editing has already begun on this order — it can no longer be cancelled. Use the revision process instead.',
            action: 'use_revisions',
          });
        }
        // No editor ever took it: full refund including the service fee
        // (never-accepted rule, Don 2026-07-27).
        quote = {
          tier: 'pre_editing' as const,
          chargeRate: 0,
          chargeUsd: 0,
          serviceFeeUsd: 0,
          refundUsd: booking.price_usd,
        };
      } else if (booking.status === 'pending') {
        // Never accepted (still in the offer window): FULL refund including
        // the service fee — nothing was fulfilled or held (Don, 2026-07-27).
        // Accepted (confirmed) bookings keep the normal tier rules.
        quote = {
          tier: 'never_accepted' as const,
          chargeRate: 0,
          chargeUsd: 0,
          serviceFeeUsd: 0,
          refundUsd: booking.price_usd,
        };
      } else if (booking.scheduled_at) {
        quote = await cancelQuote(booking.scheduled_at, sessionPrice, serviceFee);
      } else {
        return reply.code(422).send({ error: 'Booking has no scheduled time' });
      }

      // Service fee is non-refundable at every tier (Don, 2026-07-27):
      // refund covers the session cost minus the late charge only.
      await refundClient(booking, quote.refundUsd, `client_cancel_${quote.tier}`);
      await recordFee(booking, 'cancellation_fee', booking.price_usd - quote.refundUsd, {
        tier: quote.tier,
        charge_rate: quote.chargeRate,
        session_charge_usd: quote.chargeUsd,
        service_fee_kept_usd: quote.serviceFeeUsd,
      });
      await supabaseAdmin
        .from('bookings')
        .update({ status: 'cancelled', cancelled_by: user.id, cancelled_at: new Date().toISOString() })
        .eq('id', booking.id);
      await notify(
        user.id,
        'refund_processed',
        'Cancellation confirmed',
        `Your booking is cancelled. Refund on its way: $${quote.refundUsd.toFixed(2)} to your original payment method within 3–5 business days.`,
      );
      return { cancelled_by: 'client', ...quote };
    }

    // Creator cancel: no client penalty ever (§8) — full refund + strike.
    const late = booking.scheduled_at != null && hoursUntil(booking.scheduled_at) < 24;
    await refundClient(booking, booking.price_usd, 'creator_cancel');
    await recordStrike(booking.creator_id as string, booking.id, late ? 'late_cancellation' : 'cancellation');
    await supabaseAdmin
      .from('bookings')
      .update({ status: 'cancelled', cancelled_by: user.id, cancelled_at: new Date().toISOString() })
      .eq('id', booking.id);
    await notify(
      booking.client_id,
      'booking_cancelled_by_creator',
      'Your creator had to cancel',
      'Full refund issued automatically. Want us to rematch you with another great creator for the same slot? Open the booking to choose.',
    );
    return {
      cancelled_by: 'creator',
      refundUsd: booking.price_usd,
      strike: late ? 'late_cancellation (weight 2)' : 'cancellation',
      client_options: ['rematch', 'new_booking'],
    };
  });

  // Reschedule — free 1x >48h; 24–48h same 50% charge as cancelling;
  // disabled entirely under 24h (Don, 2026-07-27 — inside that, cancel or
  // contact support).
  app.post<{ Params: { id: string }; Body: { date?: string; time?: string } }>(
    '/v1/bookings/:id/reschedule',
    async (request, reply) => {
      const user = requireUser(request);
      const booking = await loadBooking(request.params.id, reply);
      if (!booking) return;
      if (user.id !== booking.client_id) return reply.code(403).send({ error: 'Not your booking' });
      if (!['pending', 'confirmed'].includes(booking.status)) {
        return reply.code(409).send({ error: `Booking is ${booking.status}` });
      }
      if (booking.type !== 'in_person' || !booking.scheduled_at) {
        return reply.code(422).send({ error: 'Only in-person sessions can be rescheduled' });
      }
      const { date, time } = request.body ?? {};
      if (!date || !time) return reply.code(400).send({ error: 'date and time are required' });

      const sessionPrice =
        (booking.pricing_snapshot['session_price_usd'] as number) ?? booking.price_usd;
      const quote = await rescheduleQuote(
        booking.scheduled_at,
        sessionPrice,
        booking.reschedule_count,
      );
      if (!quote.allowed) {
        if (quote.reason === 'disabled_under_cutoff') {
          const cutoff = ((await getConfig())['reschedule_disabled_under_hours'] as number) ?? 24;
          return reply.code(422).send({
            error: `Rescheduling is disabled within ${cutoff} hours of the session — cancel (normal fee tiers apply) or contact support`,
          });
        }
        return reply.code(422).send({
          error:
            'Free reschedule already used — additional changes are a cancellation and re-booking',
          action: 'cancel_and_rebook',
        });
      }

      // New slot must still work for the SAME creator (reschedule keeps the
      // assignment; changing creators is cancel+rebook).
      const scheduled = new Date(`${date}T${time}:00`);
      if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
        return reply.code(400).send({ error: 'New time must be in the future' });
      }
      const config = await getConfig();
      const windowDays = (config['advance_booking_window_days'] as number) ?? 14;
      if (scheduled.getTime() > Date.now() + windowDays * 86400_000) {
        return reply.code(400).send({ error: `Bookings open up to ${windowDays} days ahead` });
      }
      const slots = await dayAvailability(
        booking.occasion,
        date,
        booking.duration_hours ?? 1,
        booking.area ?? undefined,
      );
      const slot = slots.find((s) => s.time === time);
      if (!slot || (booking.creator_id != null && !slot.creator_ids.includes(booking.creator_id))) {
        return reply.code(409).send({
          error: 'Your creator is not available at that time',
          available_creator_ids: slot?.creator_ids ?? [],
        });
      }

      await recordFee(booking, 'reschedule_fee', quote.feeUsd, { fee_rate: quote.feeRate });
      await supabaseAdmin
        .from('bookings')
        .update({
          scheduled_at: scheduled.toISOString(),
          reschedule_count: booking.reschedule_count + 1,
        })
        .eq('id', booking.id);
      await notify(
        user.id,
        'reschedule_confirmed',
        'Booking rescheduled',
        quote.free ? 'Your new time is locked in — no charge.' : `Your new time is locked in. A $${quote.feeUsd.toFixed(2)} reschedule charge applied.`,
      );
      return { rescheduled: true, scheduled_at: scheduled.toISOString(), ...quote };
    },
  );

  // No-show reporting, both directions. 15-minute grace period enforced
  // server-side; creator-side reports require attempted-contact confirmation.
  app.post<{ Params: { id: string }; Body: { attempted_contact?: boolean } }>(
    '/v1/bookings/:id/no-show',
    async (request, reply) => {
      const user = requireUser(request);
      const booking = await loadBooking(request.params.id, reply);
      if (!booking) return;
      if (booking.status !== 'confirmed') {
        return reply.code(409).send({ error: `Booking is ${booking.status}` });
      }
      if (booking.type !== 'in_person' || !booking.scheduled_at) {
        return reply.code(422).send({ error: 'No-show reports apply to in-person sessions' });
      }
      const role =
        user.id === booking.client_id ? 'client' : user.id === booking.creator_id ? 'creator' : null;
      if (!role) return reply.code(403).send({ error: 'Not your booking' });

      const config = await getConfig();
      const graceMin = (config['no_show_grace_minutes'] as number) ?? 15;
      const graceEndsAt = new Date(booking.scheduled_at).getTime() + graceMin * 60_000;
      if (Date.now() < graceEndsAt) {
        return reply.code(422).send({
          error: `The ${graceMin}-minute grace period has not elapsed`,
          grace_ends_at: new Date(graceEndsAt).toISOString(),
        });
      }

      if (role === 'client') {
        // Creator no-show: full refund; strike (higher severity — standing
        // can jump straight to suspension); rematch or free cancel offered.
        await refundClient(booking, booking.price_usd, 'creator_no_show');
        if (booking.creator_id) await recordStrike(booking.creator_id, booking.id, 'no_show');
        await supabaseAdmin
          .from('bookings')
          .update({ status: 'no_show', no_show_reported_by: user.id })
          .eq('id', booking.id);
        await notify(user.id, 'refund_processed', 'Full refund on its way', 'Sorry about the no-show. Your full refund is processing, and we can rematch you — open the booking to choose.');
        return {
          reported: 'creator_no_show',
          refundUsd: booking.price_usd,
          client_options: ['rematch', 'new_booking'],
        };
      }

      // Client no-show: attempted contact is mandatory before filing — and
      // it must be REAL: at least one chat message from the creator on this
      // booking (the checkbox alone proves nothing).
      if (request.body?.attempted_contact !== true) {
        return reply.code(400).send({
          error: 'Confirm you attempted to contact the client before filing (§8)',
        });
      }
      const { count: contactCount } = await supabaseAdmin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', booking.id)
        .eq('sender_id', user.id);
      if (!contactCount) {
        return reply.code(400).send({
          error: 'Message the client in chat first — attempted contact requires a real message, not just the checkbox',
          action: 'open_chat',
        });
      }
      // Client stays fully charged (charge already ledgered at booking);
      // creator receives the standard payout on the normal 7-day hold.
      await createPayoutForBooking(booking);
      await supabaseAdmin
        .from('bookings')
        .update({
          status: 'no_show',
          no_show_reported_by: user.id,
          no_show_attempted_contact: true,
        })
        .eq('id', booking.id);
      await notify(booking.client_id, 'no_show_reported', 'No-show reported on your session', 'Your creator reported a no-show after the grace period. Per policy the booking is charged in full. Reply via Help & Support to dispute.');
      return { reported: 'client_no_show', client_refund: 0, creator_payout: 'standard' };
    },
  );

  // Rematch after a creator-fault cancellation/no-show: new booking, same
  // parameters, excluding the original creator; the refunded client is
  // charged for the new booking.
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/rematch', async (request, reply) => {
    const user = requireUser(request);
    const original = await loadBooking(request.params.id, reply);
    if (!original) return;
    if (user.id !== original.client_id) return reply.code(403).send({ error: 'Not your booking' });
    const creatorAtFault =
      (original.status === 'cancelled' && original.cancelled_by === original.creator_id) ||
      (original.status === 'no_show' && original.no_show_reported_by === original.client_id);
    if (!creatorAtFault) {
      return reply.code(409).send({ error: 'Rematch is only offered after a creator cancellation or no-show' });
    }
    if (!original.scheduled_at || new Date(original.scheduled_at).getTime() <= Date.now()) {
      return reply.code(409).send({ error: 'That time has passed — book a new session instead' });
    }

    const date = original.scheduled_at.slice(0, 10);
    const time = new Date(original.scheduled_at).toTimeString().slice(0, 5);
    const slots = await dayAvailability(
      original.occasion,
      date,
      original.duration_hours ?? 1,
      original.area ?? undefined,
    );
    const slot = slots.find((s) => s.time === time);
    const candidates = (slot?.creator_ids ?? []).filter((id) => id !== original.creator_id);
    if (candidates.length === 0) {
      return reply.code(409).send({ error: 'No other creator is available for this slot' });
    }

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .insert({
        client_id: original.client_id,
        creator_id: candidates[0],
        type: original.type,
        occasion: original.occasion,
        media_kind: original.media_kind,
        duration_hours: original.duration_hours,
        area: original.area,
        meeting_point: original.meeting_point,
        scheduled_at: original.scheduled_at,
        // Goes through the same accept window — confirmed only once the
        // replacement creator actually accepts.
        status: 'pending',
        offer_expires_at: new Date(Date.now() + (await offerWindowMs())).toISOString(),
        price_usd: original.price_usd,
        pricing_snapshot: original.pricing_snapshot,
        rematch_of: original.id,
      })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });
    await recordBookingCharge(booking as BookingRow);
    return reply.code(201).send({ booking });
  });
}
