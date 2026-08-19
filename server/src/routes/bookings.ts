import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import {
  configNumber,
  getConfig,
  inPersonAddonPrices,
  packagePriceUsd,
  remoteAddonPrices,
  remotePriceUsd,
  socialTier,
  socialTiers,
} from '../config.js';
import { stripeConfigured } from '../env.js';
import { expireStaleOffer, offerWindowMs, reassignBooking } from '../offers.js';
import { creatorPayoutAt, feeRateFor, type BookingRow } from '../payments.js';
import { notify } from '../notify.js';
import {
  creatorSlotsForDay,
  dayAvailability,
  eligibleCreators,
  windowAvailability,
} from '../availability.js';

const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'];

interface CreateBookingBody {
  type?: 'in_person' | 'remote';
  occasion?: string;
  media_kind?: 'photo' | 'video' | 'both';
  duration_hours?: number;
  /** Remote-edit orders: tier key in remote_pricing_table (e.g. photos_6_10, standard, large). */
  remote_tier?: string;
  /** Social bundles: tier id in social_pricing_table (lite/standard/full).
   * Required when occasion is Social; duration and price come from the tier
   * config server-side, never from the client. */
  social_tier?: string;
  /** Add-ons (remote: rush/extra_revisions; in-person adds extra_photos). */
  addons?: { rush?: boolean; extra_photos?: boolean; extra_revisions?: number };
  area?: string;
  meeting_point?: string;
  meeting_lat?: number;
  meeting_lng?: number;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  creator_id?: string;
  /** 'sheet' = the client pays via PaymentSheet; the charge is ledgered by
   * the Stripe webhook, not here. Older builds omit this and keep the
   * legacy simulated-charge-at-creation behavior. */
  payment_flow?: 'sheet';
}

export function registerBookingRoutes(app: FastifyInstance) {
  // Availability for the Date & Time screen. Without `date`: per-day flags
  // across the advance window. With `date`: real start times for that day.
  app.get<{
    Querystring: { occasion?: string; duration_hours?: string; date?: string; area?: string };
  }>('/v1/availability', async (request, reply) => {
    const { occasion, date, area } = request.query;
    const durationHours = Number(request.query.duration_hours ?? 1);
    if (!occasion || !OCCASIONS.includes(occasion)) {
      return reply.code(400).send({ error: `occasion must be one of ${OCCASIONS.join(', ')}` });
    }
    if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 12) {
      return reply.code(400).send({ error: 'invalid duration_hours' });
    }
    if (date) {
      return { date, slots: await dayAvailability(occasion, date, durationHours, area) };
    }
    return { days: await windowAvailability(occasion, durationHours, area) };
  });

  /**
   * RETIRED — this endpoint created the booking, assigned a creator, started
   * the 15-minute offer clock and pushed "New job offer" BEFORE any payment
   * existed. Sliding to confirm on Order Summary was enough to put a creator
   * to work on a booking that was never paid for, and closing the Stripe
   * sheet left that offer running.
   *
   * Checkout is now POST /v1/checkout/intent (prices, creates nothing) and
   * the booking is born in the payment_intent.succeeded webhook. The pricing
   * and matching logic moved verbatim to booking-quote.ts.
   *
   * Kept as an explicit 410 so a pre-OTA binary gets a real explanation
   * instead of a silent failure.
   */
  app.post('/v1/bookings', async (_request, reply) =>
    reply.code(410).send({
      error: 'Please update the app to book — checkout moved so nothing is reserved before payment.',
      code: 'checkout_moved',
    }),
  );

  app.get('/v1/bookings', async (request, reply) => {
    const user = requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('*')
      .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`)
      .order('scheduled_at', { ascending: false });
    if (error) return reply.code(500).send({ error: error.message });
    // Lazy offer-timeout sweep on read (no cron infra yet).
    const bookings = await Promise.all((data ?? []).map((b) => expireStaleOffer(b)));
    const mine = bookings.filter((b) => b.client_id === user.id || b.creator_id === user.id);

    /**
     * WHAT THIS JOB PAYS, computed by the same function that writes the
     * payout row — so the offer card, the history row and the money that
     * actually lands can never quote different figures. The app used to
     * derive it from `session_price_usd` and a hardcoded 32%, which both
     * ignored add-ons and ignored a creator's promo rate.
     *
     * Attached ONLY to rows where this user is the creator: a client never
     * sees the creator's take, and the fee rate itself never leaves the
     * server — it stays out of /v1/config, which is public and deliberately
     * does not carry creator_platform_fee_rate or creator_promo_fee_rate.
     *
     * The rate is resolved once per request, not per booking.
     */
    if (!mine.some((b) => b.creator_id === user.id)) return { bookings: mine };
    const { rate } = await feeRateFor(user.id);
    return {
      bookings: mine.map((b) =>
        b.creator_id === user.id
          ? { ...b, creator_payout_usd: creatorPayoutAt(b as BookingRow, rate) }
          : b,
      ),
    };
  });

  // Creator accepts the assignment offer — this is what confirms a booking.
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/accept', async (request, reply) => {
    const user = requireUser(request);
    const { data } = await supabaseAdmin.from('bookings').select('*').eq('id', request.params.id).maybeSingle();
    if (!data) return reply.code(404).send({ error: 'Booking not found' });
    const booking = await expireStaleOffer(data);
    if (booking.creator_id !== user.id || booking.status !== 'pending') {
      return reply.code(409).send({ error: 'This offer is no longer yours to accept' });
    }
    await supabaseAdmin
      .from('bookings')
      .update({ status: 'confirmed', offer_expires_at: null })
      .eq('id', booking.id);
    await notify(
      booking.client_id,
      'booking_confirmed',
      'Your booking is confirmed',
      'Your creator accepted — you\'re locked in. Full details are in your bookings.',
      { booking_id: booking.id },
    );
    await notify(user.id, 'booking_confirmed', 'Booking locked in', 'You accepted this job — it\'s on your schedule. Details in Jobs.', { booking_id: booking.id, audience: 'creator' });
    return { accepted: true, status: 'confirmed' };
  });

  // Creator declines — reassign via the same matching logic, decliner
  // excluded for this booking. NO strike (strikes need an accepted booking).
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/decline', async (request, reply) => {
    const user = requireUser(request);
    const { data } = await supabaseAdmin.from('bookings').select('*').eq('id', request.params.id).maybeSingle();
    if (!data) return reply.code(404).send({ error: 'Booking not found' });
    if (data.creator_id !== user.id || data.status !== 'pending') {
      return reply.code(409).send({ error: 'No open offer on this booking for you' });
    }
    const { creator_id } = await reassignBooking(data, user.id);
    return { declined: true, reassigned_to: creator_id };
  });
}
