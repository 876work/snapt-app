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

function bucketFor(kind: 'raw' | 'deliverable'): MediaBucket {
  return kind === 'raw' ? 'raw-footage' : 'deliverables';
}

export function registerMediaRoutes(app: FastifyInstance) {
  app.post<{
    Params: { id: string };
    Body: { kind?: 'raw' | 'deliverable'; filename?: string; content_type?: string };
  }>('/v1/bookings/:id/media/upload-url', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    const { kind, filename, content_type } = request.body ?? {};
    if (kind !== 'raw' && kind !== 'deliverable') {
      return reply.code(400).send({ error: 'kind must be raw or deliverable' });
    }
    if (!filename) return reply.code(400).send({ error: 'filename is required' });

    // Who may upload what:
    // - deliverable: assigned creator only
    // - raw: assigned creator (in-person footage) or the client on their own
    //   REMOTE order (uploading source footage for editing)
    const isCreator = user.id === booking.creator_id;
    const isClient = user.id === booking.client_id;
    const allowed =
      kind === 'deliverable'
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
    Body: { kind?: 'raw' | 'deliverable'; storage_path?: string; content_type?: string };
  }>('/v1/bookings/:id/media', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    const { kind, storage_path, content_type } = request.body ?? {};
    if ((kind !== 'raw' && kind !== 'deliverable') || !storage_path) {
      return reply.code(400).send({ error: 'kind and storage_path are required' });
    }
    const isCreator = user.id === booking.creator_id;
    const isClient = user.id === booking.client_id;
    const allowed =
      kind === 'deliverable' ? isCreator : isCreator || (isClient && booking.type === 'remote');
    if (!allowed) return reply.code(403).send({ error: 'Not allowed' });

    const { data, error } = await supabaseAdmin
      .from('booking_media')
      .insert({
        booking_id: booking.id,
        kind,
        storage_path,
        content_type: content_type ?? null,
        uploaded_by: user.id,
      })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });
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
      .select('id, kind, storage_path, content_type, created_at')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true });
    if (!isCreator) query = query.eq('kind', 'deliverable');
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    const media = await Promise.all(
      (data ?? []).map(async (m) => ({
        ...m,
        download_url: await createDownloadUrl(
          bucketFor(m.kind as 'raw' | 'deliverable'),
          m.storage_path,
        ),
      })),
    );
    return { media };
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
    await supabaseAdmin.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
    await createPayoutForBooking(booking);
    await notify(booking.client_id, 'delivery_ready', 'Your content is ready!', 'Your edited files are delivered — open the app to view, download, and rate your experience.');
    await notify(user.id, 'payout_pending', 'Payout on the way', 'Delivery made — your earnings are pending and clear once the 7-day dispute window closes.');
    return { delivered: true, payout: 'held_7_days' };
  });
}
