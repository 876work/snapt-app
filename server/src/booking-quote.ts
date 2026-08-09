import { supabaseAdmin } from './supabase.js';
import {
  configNumber,
  getConfig,
  inPersonAddonPrices,
  minimumLeadMinutes,
  packagePriceUsd,
  remoteAddonPrices,
  remotePriceUsd,
  socialTier,
  socialTiers,
} from './config.js';
import { dayAvailability, eligibleCreators } from './availability.js';

/**
 * PRICE AND VALIDATE A BOOKING WITHOUT CREATING ANYTHING.
 *
 * This used to live inside POST /v1/bookings, which created the row,
 * assigned a creator, started the 15-minute offer clock and pushed "New job
 * offer" — all BEFORE the client had entered a card. Sliding to confirm was
 * enough to put a creator to work on an unpaid booking, and closing the
 * Stripe sheet left that offer live.
 *
 * The same function now runs twice: once to price the PaymentIntent, and
 * again inside the webhook once Stripe confirms the money. Nothing here
 * writes a row, assigns anyone, or notifies anyone — that is the point.
 *
 * §8 still holds: every financially relevant number comes from app_config,
 * never from the client.
 */

export interface CreateBookingBody {
  type?: 'in_person' | 'remote';
  occasion?: string;
  media_kind?: 'photo' | 'video' | 'both';
  duration_hours?: number;
  remote_tier?: string;
  social_tier?: string;
  /** Remote edits: the look the client chose (EDIT_STYLES id). Descriptive
   *  only — it never affects price, but the editor cannot work without it. */
  edit_style?: string;
  addons?: { rush?: boolean; extra_photos?: boolean; extra_revisions?: number };
  area?: string;
  meeting_point?: string;
  meeting_lat?: number;
  meeting_lng?: number;
  date?: string; // YYYY-MM-DD
  time?: string; // HH:MM
  creator_id?: string;
}

export interface BookingQuote {
  type: 'in_person' | 'remote';
  mediaKind: string;
  durationHours: number | null;
  scheduledAtIso: string | null;
  /** Who WOULD take this job. Not committed to anything until payment. */
  assignedCreatorId: string | null;
  total: number;
  snapshot: Record<string, unknown>;
}

export interface QuoteError {
  status: number;
  error: string;
  code?: string;
  alternative_times?: string[];
  rematch_available?: boolean;
  available_creator_ids?: string[];
}

export type QuoteResult = { quote: BookingQuote } | { failure: QuoteError };

/**
 * Can a rush order physically finish before 23:00 on the session's clock?
 * end-of-session + rush window must land STRICTLY before 23:00 ("before
 * 11pm", so landing exactly at 23:00 refuses). Wall-clock arithmetic on the
 * HH:MM string — no Date, no timezone, no server-TZ skew. A malformed time
 * passes through: the scheduling validator owns that failure, not this gate.
 */
export function rushFeasible(time: string, durationHours: number, rushHours: number): boolean {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return true;
  const end = Number(m[1]) + Number(m[2]) / 60 + durationHours + rushHours;
  return end < 23;
}

export function isQuoteFailure(r: QuoteResult): r is { failure: QuoteError } {
  return 'failure' in r;
}

export async function quoteBooking(
  userId: string,
  body: CreateBookingBody,
  /**
   * True on the webhook re-run. Slot re-validation still happens, but a
   * lost slot is no longer fatal: the money is already taken, so the
   * booking is created unassigned for manual dispatch rather than thrown
   * away. Only the CALLER decides that — this flag just relaxes the error.
   */
  postPayment = false,
): Promise<QuoteResult> {
  const fail = (status: number, error: string, extra: Partial<QuoteError> = {}): QuoteResult => ({
    failure: { status, error, ...extra },
  });
  const type = body.type ?? 'in_person';

  const { data: me } = await supabaseAdmin
    .from('profiles')
    .select('suspended_at')
    .eq('id', userId)
    .maybeSingle();
  if (me?.suspended_at) {
    return fail(403, 'Your account is suspended — contact hello@snaptcarib.app');
  }

  const mediaKind = body.media_kind;
  if (!mediaKind || !['photo', 'video', 'both'].includes(mediaKind)) {
    return fail(400, 'media_kind must be photo, video, or both');
  }
  const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'];
  if (type === 'in_person' && (!body.occasion || !OCCASIONS.includes(body.occasion))) {
    return fail(400, `occasion must be one of ${OCCASIONS.join(', ')}`);
  }

  // ---- Session price ------------------------------------------------------
  let sessionPrice: number;
  let durationHours: number | null = null;
  let socialSnapshot: Record<string, unknown> | null = null;
  if (type === 'remote') {
    if (!body.remote_tier) return fail(400, 'remote_tier is required for remote orders');
    const price = await remotePriceUsd(mediaKind, body.remote_tier);
    if (price === undefined) {
      return fail(400, `No ${mediaKind} remote package for tier ${body.remote_tier}`);
    }
    sessionPrice = price;
  } else if (body.occasion === 'Social') {
    // Bundle-priced by deliverable count, not duration.
    const tier = body.social_tier ? await socialTier(body.social_tier) : undefined;
    if (!tier) {
      const ids = (await socialTiers()).map((t) => t.id).join(', ');
      return fail(400, `social_tier must be one of ${ids}`);
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
      return fail(400, `No ${mediaKind} package for ${body.duration_hours} hours`);
    }
    sessionPrice = price;
  }

  // ---- Add-ons ------------------------------------------------------------
  const extraRevisions = Number(body.addons?.extra_revisions ?? 0);
  if (!Number.isInteger(extraRevisions) || extraRevisions < 0 || extraRevisions > 5) {
    return fail(400, 'extra_revisions must be a whole number (0–5)');
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
    // RUSH FEASIBILITY GATE: rush is only sellable when session end + rush
    // window lands before 23:00 on the session's own clock. Pure wall-clock
    // arithmetic on `time` — deliberately timezone-free, so server TZ can
    // never skew it. The client hides the toggle; this refuses a stale
    // client that sends it anyway — nobody buys an impossible promise.
    if (body.addons?.rush && body.time && durationHours != null) {
      const { deliveryWindows } = await import('./config.js');
      const { rushHours } = await deliveryWindows();
      if (!rushFeasible(body.time, durationHours, rushHours)) {
        // AFTER payment this is survivable, same rule as a lost slot: the
        // money is real, the booking is created, rush stays as sold, and
        // the late-delivery board catches any slip.
        if (!postPayment) {
          return fail(
            400,
            `Rush isn't available for this time slot — a ${durationHours}-hour session at ${body.time} can't be delivered before 11pm. Pick an earlier time, or book without rush.`,
            { code: 'rush_unavailable' },
          );
        }
      }
    }
    rushUsd = body.addons?.rush ? prices.rush : 0;
    // Social prices extra photos per-unit at selection time instead.
    extraPhotosUsd =
      body.addons?.extra_photos && body.occasion !== 'Social' ? prices.extra_photos : 0;
    revisionRate = prices.extra_revision;
  }
  const revisionsUsd = extraRevisions * revisionRate;
  const addonsUsd = rushUsd + extraPhotosUsd + revisionsUsd;
  const addonsDetail = {
    rush_usd: rushUsd,
    extra_photos_usd: extraPhotosUsd,
    extra_revisions: extraRevisions,
    extra_revisions_usd: revisionsUsd,
  };

  // ---- Schedule + who COULD take it --------------------------------------
  let scheduledAtIso: string | null = null;
  let assignedCreatorId: string | null = null;

  if (type === 'in_person') {
    if (!body.date || !body.time) {
      return fail(400, 'date and time are required for in-person bookings');
    }
    const windowDays = await configNumber('advance_booking_window_days', 14);
    const scheduled = new Date(`${body.date}T${body.time}:00`);
    if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) {
      return fail(400, 'scheduled time must be in the future');
    }
    /**
     * MINIMUM LEAD TIME, enforced here as well as in the picker — the picker
     * does not offer these slots, but a stale client, a replayed request or a
     * hand-rolled call must not be able to buy one. Skipped after payment for
     * the same reason as every other check on this path: the money is real,
     * so the booking is created and operations handle it.
     */
    if (!postPayment) {
      const leadMin = await minimumLeadMinutes('in_person');
      if (scheduled.getTime() < Date.now() + leadMin * 60_000) {
        const notice = leadMin >= 60 ? `${Math.round(leadMin / 60)} hours` : `${leadMin} minutes`;
        return fail(400, `Sessions need at least ${notice} notice — pick a later time.`, {
          code: 'inside_lead_time',
        });
      }
    }
    if (scheduled.getTime() > Date.now() + windowDays * 86400_000) {
      return fail(400, `bookings open up to ${windowDays} days ahead`);
    }
    scheduledAtIso = scheduled.toISOString();

    const occasion = body.occasion as string;
    const creators = await eligibleCreators(occasion, body.area);
    const slots = await dayAvailability(occasion, body.date, durationHours as number, body.area);
    const slot = slots.find((s) => s.time === body.time);

    // Recovery data for the app's conflict sheet (see notification of the
    // same shape in the booking-time 409 path).
    const timesFor = (creatorId: string | null) =>
      slots
        .filter((s) => (creatorId ? s.creator_ids.includes(creatorId) : s.creator_ids.length > 0))
        .map((s) => s.time)
        .sort(
          (a, b) =>
            Math.abs(Date.parse(`${body.date}T${a}:00`) - scheduled.getTime()) -
            Math.abs(Date.parse(`${body.date}T${b}:00`) - scheduled.getTime()),
        )
        .slice(0, 8);

    if (!slot) {
      // AFTER payment this is survivable: the client paid for a real slot
      // that vanished in the seconds since. Caller creates it unassigned.
      if (!postPayment) {
        return fail(409, 'That time is no longer available', {
          code: 'slot_taken',
          alternative_times: timesFor(body.creator_id ?? null),
          rematch_available: false,
        });
      }
    } else if (body.creator_id) {
      if (!slot.creator_ids.includes(body.creator_id)) {
        if (!postPayment) {
          return fail(409, 'Selected creator is not available for this slot', {
            code: 'creator_taken',
            alternative_times: timesFor(body.creator_id),
            rematch_available: slot.creator_ids.length > 0,
            available_creator_ids: slot.creator_ids,
          });
        }
        // Paid, but their pick is gone — hand it to whoever IS free.
        assignedCreatorId = slot.creator_ids[0] ?? null;
      } else {
        assignedCreatorId = body.creator_id;
      }
    } else {
      assignedCreatorId =
        creators.find((c) => slot.creator_ids.includes(c.user_id))?.user_id ?? slot.creator_ids[0] ?? null;
    }

    // Service-area boundary is authoritative here, not on the device.
    if (body.meeting_lat != null && body.meeting_lng != null) {
      const { areaContaining } = await import('./geo.js');
      const inside = await areaContaining(body.meeting_lat, body.meeting_lng);
      if (!inside && !postPayment) {
        return fail(400, 'That meeting point is outside our current service area.');
      }
    }
  }

  // ---- Money --------------------------------------------------------------
  const config = await getConfig();
  const clientFeeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
  const xcdPerUsd = (config['xcd_per_usd'] as number) ?? 2.72;
  const subtotal = Math.round((sessionPrice + addonsUsd) * 100) / 100;
  const serviceFee = Math.round(subtotal * clientFeeRate * 100) / 100;
  const total = Math.round((subtotal + serviceFee) * 100) / 100;

  return {
    quote: {
      type,
      mediaKind,
      durationHours,
      scheduledAtIso,
      assignedCreatorId,
      total,
      snapshot: {
        media_kind: mediaKind,
        duration_hours: durationHours,
        remote_tier: body.remote_tier ?? null,
        edit_style: body.edit_style ?? null,
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
    },
  };
}

/**
 * The booking request, packed for Stripe metadata.
 *
 * Only the INPUTS travel — the webhook re-prices from config rather than
 * trusting numbers that took a round trip. Stripe caps a metadata value at
 * 500 chars, so free text is truncated; nothing here is load-bearing for
 * money.
 */
export function packBookingParams(body: CreateBookingBody): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return;
    out[k] = String(v).slice(0, 480);
  };
  put('b_type', body.type ?? 'in_person');
  put('b_occasion', body.occasion);
  put('b_media', body.media_kind);
  put('b_dur', body.duration_hours);
  put('b_remote_tier', body.remote_tier);
  put('b_social_tier', body.social_tier);
  put('b_style', body.edit_style);
  put('b_area', body.area);
  put('b_mp', body.meeting_point);
  put('b_lat', body.meeting_lat);
  put('b_lng', body.meeting_lng);
  put('b_date', body.date);
  put('b_time', body.time);
  put('b_creator', body.creator_id);
  put('b_rush', body.addons?.rush ? '1' : '');
  put('b_xphotos', body.addons?.extra_photos ? '1' : '');
  put('b_xrev', body.addons?.extra_revisions || '');
  return out;
}

export function unpackBookingParams(md: Record<string, string>): CreateBookingBody {
  return {
    type: (md.b_type as 'in_person' | 'remote') ?? 'in_person',
    occasion: md.b_occasion,
    media_kind: md.b_media as 'photo' | 'video' | 'both',
    duration_hours: md.b_dur ? Number(md.b_dur) : undefined,
    remote_tier: md.b_remote_tier,
    social_tier: md.b_social_tier,
    edit_style: md.b_style,
    area: md.b_area,
    meeting_point: md.b_mp,
    meeting_lat: md.b_lat ? Number(md.b_lat) : undefined,
    meeting_lng: md.b_lng ? Number(md.b_lng) : undefined,
    date: md.b_date,
    time: md.b_time,
    creator_id: md.b_creator,
    addons: {
      rush: md.b_rush === '1',
      extra_photos: md.b_xphotos === '1',
      extra_revisions: md.b_xrev ? Number(md.b_xrev) : 0,
    },
  };
}
