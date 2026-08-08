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

  // Booking creation (§3 Phase 1). Everything financially relevant — price,
  // fees, peg — is computed HERE from app_config's pricing_table, never
  // trusted from the client (§8).
  app.post<{ Body: CreateBookingBody }>('/v1/bookings', async (request, reply) => {
    const user = requireUser(request);
    const body = request.body ?? {};
    const type = body.type ?? 'in_person';

    const { data: me } = await supabaseAdmin.from('profiles').select('suspended_at').eq('id', user.id).maybeSingle();
    if (me?.suspended_at) {
      return reply.code(403).send({ error: 'Your account is suspended — contact hello@snaptcarib.app' });
    }
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
    let addonsUsd = 0;
    let addonsDetail: Record<string, number> = {};
    let socialSnapshot: Record<string, unknown> | null = null;
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
    } else if (body.occasion === 'Social') {
      // SOCIAL IS BUNDLE-PRICED (deliverable counts), not duration-priced.
      // The tier is the only client input; duration, counts and price all
      // come from social_pricing_table so an admin edit is authoritative
      // with no app update.
      const tier = body.social_tier ? await socialTier(body.social_tier) : undefined;
      if (!tier) {
        const ids = (await socialTiers()).map((t) => t.id).join(', ');
        return reply.code(400).send({ error: `social_tier must be one of ${ids}` });
      }
      durationHours = tier.duration_hours;
      sessionPrice = tier.price_usd;
      socialSnapshot = {
        social_tier: tier.id,
        social_tier_label: tier.label,
        included_photos: tier.photos,
        included_videos: tier.videos,
      };
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

    // Add-ons priced from config (remote_addons / in_person_addons), never
    // client-trusted. extra_revision is intentionally the SAME rate in both
    // tables (locked, not coincidence — Don, 2026-07-28).
    const extraRevisions = Number(body.addons?.extra_revisions ?? 0);
    if (!Number.isInteger(extraRevisions) || extraRevisions < 0 || extraRevisions > 5) {
      return reply.code(400).send({ error: 'extra_revisions must be a whole number (0–5)' });
    }
    let rushUsd = 0;
    let extraPhotosUsd = 0;
    let revisionRate: number;
    if (type === 'remote') {
      const prices = await remoteAddonPrices();
      rushUsd = body.addons?.rush ? prices.rush : 0;
      revisionRate = prices.extra_revision;
    } else {
      const prices = await inPersonAddonPrices();
      rushUsd = body.addons?.rush ? prices.rush : 0;
      // The flat extra_photos flag is the DURATION product's add-on. Social
      // prices extra photos per-unit at selection time (social_addons), so
      // the flag is ignored there rather than double-charging.
      extraPhotosUsd =
        body.addons?.extra_photos && body.occasion !== 'Social' ? prices.extra_photos : 0;
      revisionRate = prices.extra_revision;
    }
    const revisionsUsd = extraRevisions * revisionRate;
    addonsUsd = rushUsd + extraPhotosUsd + revisionsUsd;
    addonsDetail = {
      rush_usd: rushUsd,
      extra_photos_usd: extraPhotosUsd,
      extra_revisions: extraRevisions,
      extra_revisions_usd: revisionsUsd,
    };

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

    // Server-enforced service-area check: the app validates the pin too,
    // but the boundary decision is authoritative here (circle-union around
    // the active service_areas rows).
    if (type === 'in_person' && body.meeting_lat != null && body.meeting_lng != null) {
      const { areaContaining } = await import('../geo.js');
      const inside = await areaContaining(body.meeting_lat, body.meeting_lng);
      if (!inside) {
        return reply.code(400).send({ error: 'That meeting point is outside our current service area.' });
      }
    }

    const config = await getConfig();
    const clientFeeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
    // app_config.xcd_per_usd is the single source of truth for the peg
    // (admin-editable); this fallback only covers a missing config row.
    const xcdPerUsd = (config['xcd_per_usd'] as number) ?? 2.72;
    const subtotal = Math.round((sessionPrice + addonsUsd) * 100) / 100;
    const serviceFee = Math.round(subtotal * clientFeeRate * 100) / 100;
    const total = Math.round((subtotal + serviceFee) * 100) / 100;

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
        // Only reference the pin columns when the app sent a pin — keeps
        // this insert working on a database that hasn't run the
        // service_areas migration yet (old binaries never send these).
        ...(type === 'in_person' && body.meeting_lat != null && body.meeting_lng != null
          ? { meeting_lat: body.meeting_lat, meeting_lng: body.meeting_lng }
          : {}),
        scheduled_at: scheduledAtIso,
        status: 'pending',
        price_usd: total,
        pricing_snapshot: {
          media_kind: mediaKind,
          duration_hours: durationHours,
          remote_tier: body.remote_tier ?? null,
          ...(socialSnapshot ?? {}),
          session_price_usd: sessionPrice,
          addons: addonsDetail,
          addons_usd: addonsUsd,
          subtotal_usd: subtotal,
          client_service_fee_rate: clientFeeRate,
          client_service_fee_usd: serviceFee,
          total_usd: total,
          xcd_per_usd: xcdPerUsd,
        },
      })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });

    // NO server-side charging: the client pays through Stripe PaymentSheet
    // and the webhook ledgers the charge (and sends the receipt). The
    // booking is created unpaid and stays PENDING; if the client abandons
    // the sheet, /v1/payments/abandon withdraws it.
    if (assignedCreatorId) {
      const expires = new Date(Date.now() + (await offerWindowMs())).toISOString();
      await supabaseAdmin
        .from('bookings')
        .update({ offer_expires_at: expires })
        .eq('id', booking.id);
      booking.offer_expires_at = expires;
      await notify(
        assignedCreatorId,
        'offer_received',
        'New job offer',
        `A ${body.occasion ?? 'session'} booking near ${body.area ?? 'you'} is waiting — accept within the offer window.`,
        { booking_id: booking.id },
      );
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
    await notify(
      booking.client_id,
      'booking_confirmed',
      'Your booking is confirmed',
      'Your creator accepted — you\'re locked in. Full details are in your bookings.',
      { booking_id: booking.id },
    );
    await notify(user.id, 'booking_confirmed', 'Booking locked in', 'You accepted this job — it\'s on your schedule. Details in Jobs.', { booking_id: booking.id });
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
