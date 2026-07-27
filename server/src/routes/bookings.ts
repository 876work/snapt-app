import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { configNumber, getConfig, packagePriceUsd, remotePriceUsd } from '../config.js';
import { recordBookingCharge } from '../payments.js';
import { stripeConfigured } from '../env.js';
import { expireStaleOffer, offerWindowMs, reassignBooking } from '../offers.js';
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
  area?: string;
  meeting_point?: string;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  creator_id?: string;
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

  // Booking creation (§3 Phase 1). Everything financially relevant — price,
  // fees, peg — is computed HERE from app_config's pricing_table, never
  // trusted from the client (§8).
  app.post<{ Body: CreateBookingBody }>('/v1/bookings', async (request, reply) => {
    const user = requireUser(request);
    const body = request.body ?? {};
    const type = body.type ?? 'in_person';

    const mediaKind = body.media_kind;
    if (!mediaKind || !['photo', 'video', 'both'].includes(mediaKind)) {
      return reply.code(400).send({ error: 'media_kind must be photo, video, or both' });
    }
    // Occasion is an in-person matching input (§12); the remote journey has
    // no occasion step, so it's only required for in-person bookings.
    if (type === 'in_person' && (!body.occasion || !OCCASIONS.includes(body.occasion))) {
      return reply.code(400).send({ error: `occasion must be one of ${OCCASIONS.join(', ')}` });
    }

    // Server-side pricing (§8): in-person from pricing_table (service type ×
    // duration); remote from remote_pricing_table (service type × tier).
    let sessionPrice: number;
    let durationHours: number | null = null;
    if (type === 'remote') {
      if (!body.remote_tier) {
        return reply.code(400).send({ error: 'remote_tier is required for remote orders' });
      }
      const price = await remotePriceUsd(mediaKind, body.remote_tier);
      if (price === undefined) {
        return reply
          .code(400)
          .send({ error: `No ${mediaKind} remote package for tier ${body.remote_tier}` });
      }
      sessionPrice = price;
    } else {
      durationHours = Number(body.duration_hours);
      const price = await packagePriceUsd(mediaKind, durationHours);
      if (price === undefined) {
        return reply
          .code(400)
          .send({ error: `No ${mediaKind} package for ${body.duration_hours} hours` });
      }
      sessionPrice = price;
    }

    let scheduledAtIso: string | null = null;
    let assignedCreatorId: string | null = null;

    if (type === 'in_person') {
      if (!body.date || !body.time) {
        return reply.code(400).send({ error: 'date and time are required for in-person bookings' });
      }
      const windowDays = await configNumber('advance_booking_window_days', 14);
      const scheduled = new Date(`${body.date}T${body.time}:00`);
      if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
        return reply.code(400).send({ error: 'scheduled time must be in the future' });
      }
      if (scheduled.getTime() > Date.now() + windowDays * 86400_000) {
        return reply.code(400).send({ error: `bookings open up to ${windowDays} days ahead` });
      }
      scheduledAtIso = scheduled.toISOString();

      // Specialty is a hard filter (§12); availability is re-checked at
      // creation so a stale client can't book a gone slot. (occasion and
      // duration were validated above for the in-person path.)
      const occasion = body.occasion as string;
      const creators = await eligibleCreators(occasion, body.area);
      const slots = await dayAvailability(occasion, body.date, durationHours as number, body.area);
      const slot = slots.find((s) => s.time === body.time);
      if (!slot) return reply.code(409).send({ error: 'That time is no longer available' });

      if (body.creator_id) {
        if (!slot.creator_ids.includes(body.creator_id)) {
          return reply.code(409).send({
            error: 'Selected creator is not available for this slot',
            available_creator_ids: slot.creator_ids,
          });
        }
        assignedCreatorId = body.creator_id;
      } else {
        // Auto-assign: first available, base-area matches first (eligibleCreators
        // sorts by area match; rating-weighted assignment is a later phase).
        assignedCreatorId =
          creators.find((c) => slot.creator_ids.includes(c.user_id))?.user_id ?? slot.creator_ids[0];
      }
    }

    const config = await getConfig();
    const clientFeeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
    const xcdPerUsd = (config['xcd_per_usd'] as number) ?? 2.7;
    const serviceFee = Math.round(sessionPrice * clientFeeRate * 100) / 100;
    const total = Math.round((sessionPrice + serviceFee) * 100) / 100;

    const { data: booking, error } = await supabaseAdmin
      .from('bookings')
      .insert({
        client_id: user.id,
        creator_id: assignedCreatorId,
        type,
        occasion: body.occasion ?? null,
        media_kind: mediaKind,
        duration_hours: durationHours,
        area: body.area ?? null,
        meeting_point: type === 'in_person' ? body.meeting_point ?? null : null,
        scheduled_at: scheduledAtIso,
        status: 'pending',
        price_usd: total,
        pricing_snapshot: {
          media_kind: mediaKind,
          duration_hours: durationHours,
          remote_tier: body.remote_tier ?? null,
          session_price_usd: sessionPrice,
          client_service_fee_rate: clientFeeRate,
          client_service_fee_usd: serviceFee,
          total_usd: total,
          xcd_per_usd: xcdPerUsd,
        },
      })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });

    // Charge at booking (simulated pre-Phase 7 Stripe keys). The booking
    // stays PENDING until the assigned creator accepts within the offer
    // window — 'confirmed' now means a creator actually said yes.
    if (!stripeConfigured) {
      await recordBookingCharge(booking);
    }
    if (assignedCreatorId) {
      const expires = new Date(Date.now() + (await offerWindowMs())).toISOString();
      await supabaseAdmin
        .from('bookings')
        .update({ offer_expires_at: expires })
        .eq('id', booking.id);
      booking.offer_expires_at = expires;
    }
    return reply.code(201).send({ booking });
  });

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
    return { bookings: bookings.filter((b) => b.client_id === user.id || b.creator_id === user.id) };
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
