import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { createDownloadUrl, createUploadTarget, deleteObject, MediaBucket, objectSize } from '../storage.js';
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
  occasion: string | null;
  price_usd: number;
  pricing_snapshot: Record<string, unknown>;
  /** Set by /deliver. Once it exists, the client owns what was sent. */
  delivered_at: string | null;
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

    const ct = content_type ?? '';

    /**
     * SIZE CAP, ENFORCED FOR EVERY KIND — deliverables and proofs included.
     *
     * This used to live inside the raw branch only, so a deliverable could
     * be presigned at any size at all. That was invisible while the creator
     * picker was photo-only; the moment video deliverables became selectable
     * (8c598d0) it became live exposure, because deliverables are the one
     * path that is deliberately never compressed.
     *
     * Same limits as raw, on purpose: a finished edit of an in-person
     * session can legitimately approach raw scale, and we do not compress
     * it, so a smaller cap would block real deliveries — the exact failure
     * class just fixed. A larger cap has no case: nothing legitimate
     * exceeds what we accept the camera original at.
     *
     * An UNKNOWN type gets the larger cap. Deliverables and proofs are not
     * type-gated at presign (deliberately — see below), so ct here can be
     * 'application/octet-stream' when the picker withheld a mime type. Give
     * that the image cap and a 60MB video is refused for its missing label,
     * not its size; give it the video cap and the hard ceiling still holds.
     * The cap exists to bound the worst case, not to classify files.
     *
     * The refusal happens at PRESIGN — before a single byte moves — and the
     * sentence travels intact: uploadBookingFile returns `json.error`
     * verbatim and the batch UI pins it to the file's row.
     *
     * Declaration-based, like raw's always was: a client that lies about
     * size_bytes gets past this check (the R2 signature only pins length on
     * the voice-note path). It bounds honest clients and our own app; it is
     * not a security boundary against a hostile one.
     */
    const capIsImage = ct.startsWith('image');
    const declared = Number(request.body?.size_bytes ?? 0);
    if (declared > (capIsImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES)) {
      return reply.code(400).send({
        error: `That file is too large — ${capIsImage ? '50MB' : '750MB'} is the limit per ${
          capIsImage ? 'image' : ct.startsWith('video') ? 'video' : 'file'
        }.`,
      });
    }

    if (kind === 'raw') {
      if (!ACCEPTED_MIME.test(ct)) {
        return reply.code(400).send({
          error: 'Unsupported file type. Send JPG, PNG, HEIC, WEBP, MP4 or MOV.',
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

    // The bytes are already in the bucket by the time this route is called,
    // so storage can be asked what actually landed. Wrapped because a probe
    // failure must cost the size and nothing else: a file that uploaded fine
    // must never fail to register over a metadata read. Null records "not
    // measured" — it is not, and must never be read as, zero.
    let size_bytes: number | null = null;
    try {
      size_bytes = await objectSize(bucketFor(kind), storage_path);
    } catch (err) {
      request.log.error({ err, storage_path, kind }, 'media register: size probe failed');
    }

    const { data, error } = await supabaseAdmin
      .from('booking_media')
      .insert({
        booking_id: booking.id,
        kind,
        storage_path,
        content_type: content_type ?? null,
        uploaded_by: user.id,
        size_bytes,
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

  /**
   * REMOVE A FILE THE CREATOR UPLOADED BUT HAS NOT DELIVERED.
   *
   * The delivery uploader lets a creator take a file back out of the batch,
   * and a file that has already registered cannot be un-registered from the
   * device alone: dropping it from the local list would leave the row on the
   * booking and /deliver would send it anyway. So the control needs this, or
   * it would be a button that lies.
   *
   * THE WINDOW CLOSES AT DELIVERY, deliberately and permanently. Once
   * delivered_at is set, the client has been notified and may already have
   * downloaded the file: it is what they paid for, and no self-serve button
   * takes it back. A post-delivery removal is a support action with a person
   * attached, not a tap. Both guards are here rather than trusted from the
   * app, and the 409 says which one refused.
   *
   * Object first, then the row — same ordering and reasoning as the draft
   * delete: a half-done delete must leave a row pointing at nothing (visible,
   * and the listing renders it as unavailable) rather than an object nothing
   * points at (invisible, and it accrues storage forever).
   */
  app.delete<{ Params: { id: string; mediaId: string } }>(
    '/v1/bookings/:id/media/:mediaId',
    async (request, reply) => {
      const user = requireUser(request);
      const booking = await loadBooking(request.params.id, reply);
      if (!booking) return;
      if (user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Only the assigned creator can remove a file' });
      }
      if (booking.delivered_at) {
        return reply.code(409).send({
          error: 'This order is already delivered — the client has these files. Contact support to have one removed.',
        });
      }
      const { data: row } = await supabaseAdmin
        .from('booking_media')
        .select('id, storage_path, kind, uploaded_by, deleted_at')
        .eq('id', request.params.mediaId)
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (!row) return reply.code(404).send({ error: 'No such file on this order' });
      // Raw is the CLIENT's source footage on a remote order — the creator
      // works from it and never gets to delete it. This route exists for the
      // creator's own uploads only.
      if (row.kind === 'raw') {
        return reply.code(403).send({ error: "Source files belong to the client and can't be removed here" });
      }
      if (row.uploaded_by !== user.id) {
        return reply.code(403).send({ error: 'That file was not uploaded by you' });
      }
      if (row.deleted_at) return { removed: true }; // already gone; idempotent

      try {
        await deleteObject(bucketFor(row.kind as MediaKind), row.storage_path as string);
      } catch (err) {
        // A missing object is the outcome we wanted anyway. Anything else is
        // logged rather than swallowed — but it must not block the creator
        // from taking a file out of a delivery they have not sent.
        request.log.error({ err, mediaId: row.id }, 'booking media delete: object removal failed');
      }
      await supabaseAdmin.from('booking_media').delete().eq('id', row.id);
      return { removed: true };
    },
  );

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
    const { data: finals } = await supabaseAdmin
      .from('booking_media')
      .select('id, content_type')
      .eq('booking_id', booking.id)
      .eq('kind', 'deliverable')
      .is('deleted_at', null);
    if (!finals || finals.length === 0) {
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
    // This push is the moment the product exists for, so it carries the
    // actual numbers: "Your 12 photos and 2 videos are ready", not "your
    // content". Occasion when there is one; remote orders have none.
    const photos = finals.filter((m) => (m.content_type ?? '').startsWith('image/')).length;
    const videos = finals.filter((m) => (m.content_type ?? '').startsWith('video/')).length;
    const parts: string[] = [];
    if (photos > 0) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
    if (videos > 0) parts.push(`${videos} video${videos === 1 ? '' : 's'}`);
    const what = parts.length > 0 ? parts.join(' and ') : `${finals.length} edited file${finals.length === 1 ? '' : 's'}`;
    const title = `Your ${what} ${photos + videos === 1 && parts.length > 0 ? 'is' : 'are'} ready!`;
    const body = booking.occasion
      ? `The edits from your ${booking.occasion} session are in — open the app to view, download, and rate your experience.`
      : 'Your finished edits are in — open the app to view, download, and rate your experience.';
    await notify(booking.client_id, 'delivery_ready', title, body, { booking_id: booking.id });
    await notify(user.id, 'payout_pending', 'Payout on the way', 'Delivery made — your earnings are pending and clear once the 7-day dispute window closes.', { booking_id: booking.id });
    return { delivered: true, payout: 'held_7_days' };
  });
}
