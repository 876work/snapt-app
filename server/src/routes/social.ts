import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { createDownloadUrl } from '../storage.js';
import { getConfig, socialAddonPrices, socialSelectionWindowHours } from '../config.js';
import { notify } from '../notify.js';

/**
 * Social bundle selection flow (§ social bundles, 2026-08-08).
 *
 * The client never picks counts BEFORE the shoot — nobody knows how many
 * keepers there will be. Instead:
 *
 *   creator uploads proofs → marks the gallery ready → client selects up to
 *   the tier's included counts (beyond = per-unit add-on, paid through the
 *   normal PaymentSheet + webhook path) → selection locks → creator edits
 *   the chosen set → existing delivery flow.
 *
 * A deadline (social_selection_window_hours, default 72h — the same class
 * of window as dispute evidence: act, or the process proceeds) stops a
 * silent client stalling the pipeline: at the deadline the scheduler locks
 * the creator's top picks (upload order) automatically.
 */

interface BookingRow {
  id: string;
  client_id: string;
  creator_id: string | null;
  status: string;
  pricing_snapshot: Record<string, unknown>;
  selection_deadline_at: string | null;
  selections_locked_at: string | null;
}

interface ProofRow {
  id: string;
  content_type: string | null;
  storage_path: string;
  position: number | null;
  selected_at: string | null;
  selection_source: string | null;
}

const isPhoto = (m: { content_type: string | null }) => (m.content_type ?? '').startsWith('image/');
const isVideo = (m: { content_type: string | null }) => (m.content_type ?? '').startsWith('video/');

async function loadSocialBooking(id: string, reply: FastifyReply): Promise<BookingRow | null> {
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('id, client_id, creator_id, status, pricing_snapshot, selection_deadline_at, selections_locked_at')
    .eq('id', id)
    .maybeSingle();
  if (!data) {
    reply.code(404).send({ error: 'Booking not found' });
    return null;
  }
  if (typeof (data.pricing_snapshot as Record<string, unknown>)?.['social_tier'] !== 'string') {
    reply.code(400).send({ error: 'Not a Social bundle booking' });
    return null;
  }
  return data as BookingRow;
}

function includedCounts(booking: BookingRow): { photos: number; videos: number } {
  const snap = booking.pricing_snapshot;
  return {
    photos: Number(snap['included_photos'] ?? 0),
    videos: Number(snap['included_videos'] ?? 0),
  };
}

async function loadProofs(bookingId: string): Promise<ProofRow[]> {
  const { data } = await supabaseAdmin
    .from('booking_media')
    .select('id, content_type, storage_path, position, selected_at, selection_source')
    .eq('booking_id', bookingId)
    .eq('kind', 'proof')
    .is('deleted_at', null)
    .order('position', { ascending: true });
  return (data ?? []) as ProofRow[];
}

/**
 * Lock a selection: stamp the chosen media rows and the booking, then tell
 * the creator the edit is defined. Shared by the client submit path, the
 * paid-extras webhook path, and the deadline auto-pick.
 */
export async function lockSelection(
  booking: { id: string; client_id: string; creator_id: string | null },
  mediaIds: string[],
  source: 'client' | 'auto',
): Promise<void> {
  const now = new Date().toISOString();
  // Clear-then-set keeps this idempotent for webhook retries.
  await supabaseAdmin
    .from('booking_media')
    .update({ selected_at: null, selection_source: null })
    .eq('booking_id', booking.id)
    .eq('kind', 'proof');
  await supabaseAdmin
    .from('booking_media')
    .update({ selected_at: now, selection_source: source })
    .eq('booking_id', booking.id)
    .in('id', mediaIds);
  await supabaseAdmin.from('bookings').update({ selections_locked_at: now }).eq('id', booking.id);

  if (booking.creator_id) {
    await notify(
      booking.creator_id,
      'selection_locked',
      'Selection locked — ready to edit',
      source === 'client'
        ? 'Your client chose their photos and videos. Their picks are marked in the job — edit and deliver those.'
        : "The selection window closed, so your top picks were locked automatically. They're marked in the job — edit and deliver those.",
      { booking_id: booking.id },
    );
  }
  if (source === 'auto') {
    await notify(
      booking.client_id,
      'selection_autopicked',
      "We went with the photographer's top picks",
      'The selection window closed before you chose, so editing is going ahead with your creator’s recommended set — delivery is on the way.',
      { booking_id: booking.id },
    );
  }
}

/** The scheduler sweep: lock top picks on every booking past its deadline. */
export async function autoPickExpiredSelections(): Promise<void> {
  const { data: due } = await supabaseAdmin
    .from('bookings')
    .select('id, client_id, creator_id, status, pricing_snapshot, selection_deadline_at, selections_locked_at')
    .is('selections_locked_at', null)
    .not('selection_deadline_at', 'is', null)
    .lt('selection_deadline_at', new Date().toISOString())
    .neq('status', 'cancelled');
  for (const b of (due ?? []) as BookingRow[]) {
    const proofs = await loadProofs(b.id);
    const included = includedCounts(b);
    // The client's partial choices still count — they expressed preference.
    // Fill the remainder from the creator's upload order.
    const pick = (filter: (m: ProofRow) => boolean, quota: number) => {
      const pool = proofs.filter(filter);
      const chosen = pool.filter((m) => m.selected_at != null).slice(0, quota);
      for (const m of pool) {
        if (chosen.length >= quota) break;
        if (!chosen.includes(m)) chosen.push(m);
      }
      return chosen;
    };
    const photos = pick(isPhoto, included.photos);
    const videos = pick(isVideo, included.videos);
    await lockSelection(b, [...photos, ...videos].map((m) => m.id), 'auto');
  }
}

export function registerSocialRoutes(app: FastifyInstance) {
  // ---- Creator: the proof gallery is complete — start the clock ----------
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/proofs/ready', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadSocialBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Only the assigned creator can publish proofs' });
    }
    if (booking.selections_locked_at) {
      return reply.code(409).send({ error: 'Selection is already locked' });
    }
    const proofs = await loadProofs(booking.id);
    const included = includedCounts(booking);
    const photoCount = proofs.filter(isPhoto).length;
    const videoCount = proofs.filter(isVideo).length;
    // The gallery must offer MORE options than the tier includes — a proof
    // set equal to the quota isn't a selection, it's a fait accompli.
    if (photoCount < included.photos || videoCount < included.videos) {
      return reply.code(409).send({
        error: `Upload at least the included counts first (${included.photos} photos, ${included.videos} videos). You have ${photoCount} and ${videoCount}.`,
      });
    }

    const hours = await socialSelectionWindowHours();
    const deadline = new Date(Date.now() + hours * 3600_000).toISOString();
    await supabaseAdmin
      .from('bookings')
      .update({ selection_deadline_at: deadline })
      .eq('id', booking.id);

    await notify(
      booking.client_id,
      'proofs_ready',
      'Your photos are ready to choose',
      `Pick your favourites for full editing — you have ${hours} hours before your creator's top picks go ahead automatically.`,
      { booking_id: booking.id },
    );
    return { ready: true, selection_deadline_at: deadline };
  });

  // ---- Both parties: the selection state ---------------------------------
  app.get<{ Params: { id: string } }>('/v1/bookings/:id/selection', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadSocialBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.client_id && user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Not your booking' });
    }
    const proofs = await loadProofs(booking.id);
    const addons = await socialAddonPrices();
    const config = await getConfig();
    const feeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
    const media = await Promise.all(
      proofs.map(async (m) => ({
        id: m.id,
        content_type: m.content_type,
        is_video: isVideo(m),
        position: m.position,
        selected: m.selected_at != null,
        selection_source: m.selection_source,
        download_url: await createDownloadUrl('deliverables', m.storage_path),
      })),
    );
    return {
      included: includedCounts(booking),
      proofs: media,
      selection_deadline_at: booking.selection_deadline_at,
      locked: booking.selections_locked_at != null,
      addon_prices: { extra_photo_usd: addons.extra_photo, extra_video_usd: addons.extra_video },
      client_service_fee_rate: feeRate,
    };
  });

  // ---- Client: submit the selection --------------------------------------
  app.post<{ Params: { id: string }; Body: { media_ids?: string[] } }>(
    '/v1/bookings/:id/selection',
    async (request, reply) => {
      const user = requireUser(request);
      const booking = await loadSocialBooking(request.params.id, reply);
      if (!booking) return;
      if (user.id !== booking.client_id) {
        return reply.code(403).send({ error: 'Only the client selects' });
      }
      if (booking.selections_locked_at) {
        return reply.code(409).send({ error: 'Selection is already locked' });
      }
      if (!booking.selection_deadline_at) {
        return reply.code(409).send({ error: 'The proof gallery is not ready yet' });
      }
      const ids = request.body?.media_ids;
      if (!Array.isArray(ids) || ids.length === 0) {
        return reply.code(400).send({ error: 'media_ids is required' });
      }

      const proofs = await loadProofs(booking.id);
      const byId = new Map(proofs.map((m) => [m.id, m]));
      const chosen = ids.map((id) => byId.get(id)).filter((m): m is ProofRow => m != null);
      if (chosen.length !== ids.length) {
        return reply.code(400).send({ error: 'One or more ids are not proofs on this booking' });
      }

      const included = includedCounts(booking);
      const photoCount = chosen.filter(isPhoto).length;
      const videoCount = chosen.filter(isVideo).length;
      if (photoCount === 0 && videoCount === 0) {
        return reply.code(400).send({ error: 'Choose at least one photo or video' });
      }

      // Beyond the included counts = per-unit add-on, priced HERE from
      // config — the client never sends an amount.
      const addons = await socialAddonPrices();
      const extraPhotos = Math.max(0, photoCount - included.photos);
      const extraVideos = Math.max(0, videoCount - included.videos);
      const extrasBase =
        Math.round((extraPhotos * addons.extra_photo + extraVideos * addons.extra_video) * 100) / 100;

      if (extrasBase === 0) {
        await lockSelection(booking, ids, 'client');
        return { locked: true, extras_usd: 0 };
      }

      // Extras cost money: a REAL charge through the same PaymentSheet +
      // webhook path as booking payment (never the ledger-only simulated
      // pattern). The selection locks when the webhook confirms — the same
      // "payment truth comes from Stripe" rule as everywhere else.
      const config = await getConfig();
      const feeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
      const total = Math.round(extrasBase * (1 + feeRate) * 100) / 100;

      const { requireStripe } = await import('../stripe.js');
      let stripe;
      try {
        stripe = requireStripe();
      } catch {
        return reply.code(503).send({ error: 'Payments are unavailable right now — try again shortly.' });
      }
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .maybeSingle();
      let customerId = profile?.stripe_customer_id ?? null;
      if (!customerId) {
        const customer = await stripe.customers.create({ metadata: { user_id: user.id } });
        customerId = customer.id;
        await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
      }
      const ephemeralKey = await stripe.ephemeralKeys.create(
        { customer: customerId },
        { apiVersion: '2025-08-27.basil' },
      );
      // The chosen ids are persisted NOW (unlocked) so the webhook — which
      // only carries metadata — locks exactly what was quoted. Re-submitting
      // overwrites; the deadline auto-pick keeps in-quota picks if the
      // payment never completes.
      await supabaseAdmin
        .from('booking_media')
        .update({ selected_at: null, selection_source: null })
        .eq('booking_id', booking.id)
        .eq('kind', 'proof');
      await supabaseAdmin
        .from('booking_media')
        .update({ selected_at: new Date().toISOString(), selection_source: 'client' })
        .eq('booking_id', booking.id)
        .in('id', ids);

      const intent = await stripe.paymentIntents.create({
        amount: Math.round(total * 100),
        currency: 'usd',
        customer: customerId,
        metadata: {
          purpose: 'social_extras',
          booking_id: booking.id,
          client_id: user.id,
          extras_base_usd: String(extrasBase),
          extra_photos: String(extraPhotos),
          extra_videos: String(extraVideos),
        },
        automatic_payment_methods: { enabled: true },
      });
      return {
        locked: false,
        extras_usd: extrasBase,
        total_usd: total,
        extra_photos: extraPhotos,
        extra_videos: extraVideos,
        client_secret: intent.client_secret,
        customer_id: customerId,
        ephemeral_key: ephemeralKey.secret,
      };
    },
  );
}
