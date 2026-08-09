import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { createDownloadUrl, createUploadTarget, MediaBucket } from '../storage.js';
import { createPayoutForBooking } from '../payments.js';
import { notify } from '../notify.js';

// Media pipeline (handoff §3 Phase 3). ACCESS RULE: raw footage is
// creator/editor-side only. Clients may UPLOAD raw (remote-edit orders) but
// no endpoint ever returns a raw download URL to a client — only final
// deliverables are client-accessible.
//
// 'proof' (Social bundles) is deliberately NOT an exception to that rule:
// proofs are a CURATED watermarked/low-res set the creator exports for the
// client to choose from — processed output, not camera originals. Raw stays
// invisible to clients exactly as before; proofs are client-visible because
// selection is their entire purpose.

interface BookingRow {
  id: string;
  client_id: string;
  creator_id: string | null;
  type: string;
  status: string;
  price_usd: number;
  pricing_snapshot: Record<string, unknown>;
}

async function loadBooking(id: string, reply: FastifyReply): Promise<BookingRow | null> {
  const { data } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!data) {
    reply.code(404).send({ error: 'Booking not found' });
    return null;
  }
  return data as BookingRow;
}

type MediaKind = 'raw' | 'deliverable' | 'proof';
const KINDS: MediaKind[] = ['raw', 'deliverable', 'proof'];

// Upload limits, enforced HERE. The app checks the same rules to give a
// good error message, but the client is not the authority: a presigned URL
// handed out without validation is an open door to the bucket.
const ACCEPTED_MIME = /^(image\/(jpeg|jpg|png|heic|heif|webp)|video\/(mp4|quicktime|x-m4v))$/i;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;   // 50MB
const MAX_VIDEO_BYTES = 750 * 1024 * 1024;  // 750MB
/** Locked product rule: 15 client source files per remote order. */
const MAX_RAW_FILES = 15;

// Proofs live in the deliverables bucket: they are processed exports with
// the same lifecycle, not camera originals.
function bucketFor(kind: MediaKind): MediaBucket {
  return kind === 'raw' ? 'raw-footage' : 'deliverables';
}

function isSocial(booking: BookingRow): boolean {
  return typeof booking.pricing_snapshot?.['social_tier'] === 'string';
}

export function registerMediaRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { kind?: MediaKind; filename?: string; content_type?: string; size_bytes?: number };
  }>('/v1/bookings/:id/media/upload-url', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    const { kind, filename, content_type } = request.body ?? {};
    if (!kind || !KINDS.includes(kind)) {
      return reply.code(400).send({ error: 'kind must be raw, deliverable, or proof' });
    }
    if (!filename) return reply.code(400).send({ error: 'filename is required' });
    if (kind === 'proof' && !isSocial(booking)) {
      return reply.code(400).send({ error: 'Proof galleries are for Social bundle bookings' });
    }

    if (kind === 'raw') {
      const ct = content_type ?? '';
      if (!ACCEPTED_MIME.test(ct)) {
        return reply.code(400).send({
          error: 'Unsupported file type. Send JPG, PNG, HEIC, WEBP, MP4 or MOV.',
        });
      }
      const declared = Number(request.body?.size_bytes ?? 0);
      const cap = ct.startsWith('video') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (declared > cap) {
        return reply.code(400).send({
          error: `That file is too large — ${ct.startsWith('video') ? '750MB' : '50MB'} is the limit per ${ct.startsWith('video') ? 'video' : 'image'}.`,
        });
      }
      // The 15-file ceiling is a product rule, so it is checked against what
      // is ALREADY registered — not against what the client claims to hold.
      const { count } = await supabaseAdmin
        .from('booking_media')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', booking.id)
        .eq('kind', 'raw')
        .is('deleted_at', null);
      if ((count ?? 0) >= MAX_RAW_FILES) {
        return reply.code(409).send({
          error: `This order already has the maximum of ${MAX_RAW_FILES} files.`,
        });
      }
    }

    // Who may upload what:
    // - deliverable: assigned creator only
    // - raw: assigned creator (in-person footage) or the client on their own
    //   REMOTE order (uploading source footage for editing)
    const isCreator = user.id === booking.creator_id;
    const isClient = user.id === booking.client_id;
    const allowed =
      kind === 'deliverable' || kind === 'proof'
        ? isCreator
        : isCreator || (isClient && booking.type === 'remote');
    if (!allowed) return reply.code(403).send({ error: 'Not allowed to upload this kind' });

    const safeName = filename.replace(/[^\w.\-]/g, '_');
    const path = `${booking.id}/${Date.now()}-${safeName}`;
    const target = await createUploadTarget(bucketFor(kind), path, content_type ?? 'application/octet-stream');
    return target;
  });

  app.post<{
    Params: { id: string };
    Body: { kind?: MediaKind; storage_path?: string; content_type?: string };
  }>('/v1/bookings/:id/media', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    const { kind, storage_path, content_type } = request.body ?? {};
    if (!kind || !KINDS.includes(kind) || !storage_path) {
      return reply.code(400).send({ error: 'kind and storage_path are required' });
    }
    const isCreator = user.id === booking.creator_id;
    const isClient = user.id === booking.client_id;
    const allowed =
      kind === 'deliverable' || kind === 'proof'
        ? isCreator
        : isCreator || (isClient && booking.type === 'remote');
    if (!allowed) return reply.code(403).send({ error: 'Not allowed' });

    let position: number | null = null;
    if (kind === 'proof') {
      if (!isSocial(booking)) {
        return reply.code(400).send({ error: 'Proof galleries are for Social bundle bookings' });
      }
      // Selection math needs to know photo vs video, and auto-pick needs an
      // order. Position = upload order = the creator's preference ranking.
      if (!content_type || !/^(image|video)\//.test(content_type)) {
        return reply.code(400).send({ error: 'Proofs need an image/* or video/* content_type' });
      }
      const { count } = await supabaseAdmin
        .from('booking_media')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', booking.id)
        .eq('kind', 'proof');
      position = (count ?? 0) + 1;
    }

    const { data, error } = await supabaseAdmin
      .from('booking_media')
      .insert({
        booking_id: booking.id,
        kind,
        storage_path,
        content_type: content_type ?? null,
        uploaded_by: user.id,
        ...(position !== null ? { position } : {}),
      })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });
    if (kind === 'raw' && isCreator) {
      // Doc §3: footage submission is internal-only — editing queue, never
      // a client-facing notification.
      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: 'footage_submitted',
        booking_id: booking.id,
        detail: { storage_path, uploaded_by: user.id },
      });
    }
    return reply.code(201).send({ media: data });
  });

  // Listing: creator gets everything (raw + deliverables) with signed URLs;
  // client gets deliverables ONLY — raw entries are not even listed.
  app.get<{ Params: { id: string } }>('/v1/bookings/:id/media', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    const isCreator = user.id === booking.creator_id;
    const isClient = user.id === booking.client_id;
    if (!isCreator && !isClient) return reply.code(403).send({ error: 'Not your booking' });

    let query = supabaseAdmin
      .from('booking_media')
      .select('id, kind, storage_path, content_type, created_at, deleted_at, position, selected_at, selection_source')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true });
    // Clients see deliverables and (Social) proofs; raw is never listed.
    if (!isCreator) query = query.in('kind', ['deliverable', 'proof']);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    // Retention-deleted files keep their registry row but never a URL — the
    // app renders a "no longer available" state instead of a broken link.
    const media = await Promise.all(
      (data ?? []).map(async (m) => ({
        id: m.id,
        kind: m.kind,
        storage_path: m.storage_path,
        content_type: m.content_type,
        created_at: m.created_at,
        deleted: m.deleted_at != null,
        position: m.position,
        selected: m.selected_at != null,
        selection_source: m.selection_source,
        download_url: m.deleted_at
          ? null
          : await createDownloadUrl(bucketFor(m.kind as MediaKind), m.storage_path),
      })),
    );

    // When deliverables expire (retention window), so the client screen can
    // show the date alongside the download prompts.
    const { data: bRow } = await supabaseAdmin
      .from('bookings')
      .select('delivered_at')
      .eq('id', booking.id)
      .maybeSingle();
    const { getConfig } = await import('../config.js');
    const config = await getConfig();
    const deliverableDays = (config['retention_deliverable_days'] as number) ?? 365;
    const files_expire_at = bRow?.delivered_at
      ? new Date(new Date(bRow.delivered_at).getTime() + deliverableDays * 86400_000).toISOString()
      : null;

    // How many source files this order was created with. Clients never get
    // raw files LISTED (the filter above is deliberate), but "Files uploaded"
    // on the order tracker must be the real number, not a hardcoded 3 — a
    // count leaks no content.
    const { count: source_count } = await supabaseAdmin
      .from('booking_media')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', booking.id)
      .eq('kind', 'raw')
      .is('deleted_at', null);

    return { media, files_expire_at, source_count: source_count ?? 0 };
  });

  // Delivery: creator marks the final edit delivered. Requires at least one
  // registered deliverable; completes the booking and starts the payout hold.
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/deliver', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Only the assigned creator can deliver' });
    }
    if (!['confirmed', 'completed'].includes(booking.status)) {
      return reply.code(409).send({ error: `Booking is ${booking.status}` });
    }
    const { count } = await supabaseAdmin
      .from('booking_media')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', booking.id)
      .eq('kind', 'deliverable');
    if (!count) {
      return reply.code(409).send({ error: 'Upload at least one deliverable before delivering' });
    }
    // Social: the edit is DEFINED by the client's locked selection. A
    // delivery before lock would be editing a guess.
    if (isSocial(booking)) {
      const { data: b } = await supabaseAdmin
        .from('bookings')
        .select('selections_locked_at')
        .eq('id', booking.id)
        .maybeSingle();
      if (!b?.selections_locked_at) {
        return reply.code(409).send({ error: 'Deliver after the client selection locks' });
      }
    }
    // delivered_at anchors the retention windows (raw +30d, deliverables
    // +12mo); a revision re-delivery moves it forward (new final delivery).
    await supabaseAdmin
      .from('bookings')
      .update({ status: 'completed', delivered_at: new Date().toISOString() })
      .eq('id', booking.id);
    await createPayoutForBooking(booking);
    await notify(booking.client_id, 'delivery_ready', 'Your content is ready!', 'Your edited files are delivered — open the app to view, download, and rate your experience.', { booking_id: booking.id });
    await notify(user.id, 'payout_pending', 'Payout on the way', 'Delivery made — your earnings are pending and clear once the 7-day dispute window closes.', { booking_id: booking.id });
    return { delivered: true, payout: 'held_7_days' };
  });
}
