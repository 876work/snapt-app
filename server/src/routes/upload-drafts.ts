import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { createUploadTarget, deleteObject } from '../storage.js';

/**
 * PRE-BOOKING SOURCE FOOTAGE.
 *
 * A remote client picks files, then chooses a package, a style, and pays.
 * Uploading only after payment meant they sat and watched a progress bar
 * having already been charged; uploading on selection means the transfer
 * overlaps the part of the flow where they are reading anyway.
 *
 * The order does not exist yet at that point, so these rows are stamped with
 * a `draft_id` instead of a `booking_id` (see the 20260810160000 migration).
 * checkout.ts claims them onto the booking it creates.
 *
 * Same rules as the booking-side upload path, enforced here and not trusted
 * from the client: accepted MIME types, per-file size ceilings, and the
 * 15-file cap counted against what is ALREADY registered.
 */

const ACCEPTED_MIME = /^(image\/(jpeg|jpg|png|heic|heif|webp)|video\/(mp4|quicktime|x-m4v))$/i;
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_BYTES = 750 * 1024 * 1024;
const MAX_RAW_FILES = 15;

/**
 * How long an unclaimed draft lives — THE definition, imported by the sweep
 * in scheduler.ts rather than restated there.
 *
 * These two readings have to be the same number, and for a while they were
 * the same number written twice. Drift would not have thrown; it would have
 * shown: set the endpoint's value higher and a returning client is offered
 * files the sweep is about to delete, set it lower and files that are still
 * perfectly good are hidden and re-uploaded. One constant, one meaning.
 */
export const DRAFT_GRACE_HOURS = 24;

/** A uuid we minted, not something a caller can point anywhere it likes. */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function registerUploadDraftRoutes(app: FastifyInstance) {
  /**
   * The draft this client already has in flight, if any.
   *
   * This is what makes "come back tomorrow and your files are still there"
   * true. Older than the grace and the sweep has taken it (or is about to),
   * so it is not offered — the screen says they start again rather than
   * showing files that are moments from deletion.
   */
  app.get('/v1/upload-drafts/current', async (request) => {
    const user = requireUser(request);
    const since = new Date(Date.now() - DRAFT_GRACE_HOURS * 3600_000).toISOString();
    const { data } = await supabaseAdmin
      .from('booking_media')
      .select('id, draft_id, storage_path, content_type, created_at')
      .is('booking_id', null)
      .not('draft_id', 'is', null)
      .eq('uploaded_by', user.id)
      .is('deleted_at', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    const rows = data ?? [];
    if (rows.length === 0) return { draft_id: null, files: [] };

    // Newest draft wins: a client who abandoned twice gets the attempt they
    // were last actually working on.
    const draftId = rows[0].draft_id as string;
    const files = rows
      .filter((r) => r.draft_id === draftId)
      .map((r) => ({
        id: r.id as string,
        // The stored key is `${draft}/${epoch}-${safeName}`; the client only
        // needs something to label a thumbnail with.
        name: String(r.storage_path).split('/').pop()?.replace(/^\d+-/, '') ?? 'file',
        content_type: r.content_type as string | null,
        created_at: r.created_at as string,
      }))
      .reverse();
    return { draft_id: draftId, files };
  });

  /** Start a fresh draft. Returns an id; no rows exist until a file lands. */
  app.post('/v1/upload-drafts', async (request) => {
    requireUser(request);
    return { draft_id: randomUUID() };
  });

  app.post<{
    Params: { draftId: string };
    Body: { filename?: string; content_type?: string; size_bytes?: number };
  }>('/v1/upload-drafts/:draftId/upload-url', async (request, reply) => {
    const user = requireUser(request);
    const { draftId } = request.params;
    if (!isUuid(draftId)) return reply.code(400).send({ error: 'Bad draft id' });
    const { filename, content_type } = request.body ?? {};
    if (!filename) return reply.code(400).send({ error: 'filename is required' });

    const ct = content_type ?? '';
    if (!ACCEPTED_MIME.test(ct)) {
      return reply.code(400).send({
        error: 'Unsupported file type. Send JPG, PNG, HEIC, WEBP, MP4 or MOV.',
      });
    }
    const declared = Number(request.body?.size_bytes ?? 0);
    const isVideo = ct.startsWith('video');
    if (declared > (isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      return reply.code(400).send({
        error: `That file is too large — ${isVideo ? '750MB' : '50MB'} is the limit per ${isVideo ? 'video' : 'image'}.`,
      });
    }
    // Counted against what is registered on THIS draft, by THIS user.
    const { count } = await supabaseAdmin
      .from('booking_media')
      .select('id', { count: 'exact', head: true })
      .eq('draft_id', draftId)
      .eq('uploaded_by', user.id)
      .is('deleted_at', null);
    if ((count ?? 0) >= MAX_RAW_FILES) {
      return reply.code(409).send({
        error: `This order already has the maximum of ${MAX_RAW_FILES} files.`,
      });
    }

    const safeName = filename.replace(/[^\w.\-]/g, '_');
    const path = `${draftId}/${Date.now()}-${safeName}`;
    try {
      return await createUploadTarget('raw-footage', path, content_type ?? 'application/octet-stream');
    } catch (err) {
      // Uncaught, this became a framework 500 whose `error` field is the
      // HTTP status text — context-free words the app then showed verbatim.
      // The real reason (R2 auth, storage quota, network) belongs in the
      // server log; the phone gets a sentence that cannot be misread as
      // being about the phone.
      request.log.error({ err, draftId }, 'upload-draft presign: storage refused an upload URL');
      return reply.code(502).send({
        error: "The upload service couldn't accept this file just now — nothing is wrong with your phone. Try again in a minute.",
      });
    }
  });

  app.post<{
    Params: { draftId: string };
    Body: { storage_path?: string; content_type?: string };
  }>('/v1/upload-drafts/:draftId/media', async (request, reply) => {
    const user = requireUser(request);
    const { draftId } = request.params;
    if (!isUuid(draftId)) return reply.code(400).send({ error: 'Bad draft id' });
    const { storage_path, content_type } = request.body ?? {};
    if (!storage_path) return reply.code(400).send({ error: 'storage_path is required' });
    // The path is minted above and namespaced by draft; refusing anything
    // outside this draft's prefix stops a caller registering someone else's
    // object against their own draft.
    if (!storage_path.startsWith(`${draftId}/`)) {
      return reply.code(400).send({ error: 'storage_path does not belong to this draft' });
    }

    const { data, error } = await supabaseAdmin
      .from('booking_media')
      .insert({
        booking_id: null,
        draft_id: draftId,
        kind: 'raw',
        storage_path,
        content_type: content_type ?? null,
        uploaded_by: user.id,
      })
      .select('id, created_at')
      .single();
    if (error) {
      // error.message here is raw Postgres/PostgREST text. Sent to the app,
      // a database "No space left on device" reads as the PHONE being full —
      // a message about the wrong machine. Log the real error; say something
      // honest and unmistakable to the client.
      request.log.error({ err: error, draftId, storage_path }, 'upload-draft register: insert failed');
      return reply.code(500).send({
        error: "Uploaded, but the order service couldn't record it — nothing is wrong with your phone. Try again in a minute.",
      });
    }
    return reply.code(201).send({ media: data });
  });

  /**
   * Remove one file. The client calls this when a thumbnail's X is tapped,
   * including mid-upload after aborting the transfer — an aborted PUT can
   * still have left a complete object in the bucket.
   *
   * Object first, then the row: a delete that fails halfway must leave a row
   * pointing at nothing rather than an object nothing points at, because the
   * former is visible and the latter is not.
   */
  app.delete<{ Params: { draftId: string; mediaId: string } }>(
    '/v1/upload-drafts/:draftId/media/:mediaId',
    async (request, reply) => {
      const user = requireUser(request);
      const { draftId, mediaId } = request.params;
      const { data: row } = await supabaseAdmin
        .from('booking_media')
        .select('id, storage_path, booking_id')
        .eq('id', mediaId)
        .eq('draft_id', draftId)
        .eq('uploaded_by', user.id)
        .maybeSingle();
      if (!row) return reply.code(404).send({ error: 'No such file on this draft' });
      // Belt and braces: a row that has been claimed onto a booking is no
      // longer a draft file and is not the client's to delete here.
      if (row.booking_id) return reply.code(409).send({ error: 'Already attached to an order' });

      try {
        await deleteObject('raw-footage', row.storage_path as string);
      } catch {
        // Missing object is the outcome we wanted anyway; anything else is
        // swept later by the abandoned-draft job. Never block the client's X.
      }
      await supabaseAdmin.from('booking_media').delete().eq('id', mediaId);
      return { removed: true };
    },
  );

  /** "Start over" — discard every file on this draft. */
  app.delete<{ Params: { draftId: string } }>('/v1/upload-drafts/:draftId', async (request) => {
    const user = requireUser(request);
    const { draftId } = request.params;
    const { data: rows } = await supabaseAdmin
      .from('booking_media')
      .select('id, storage_path')
      .eq('draft_id', draftId)
      .eq('uploaded_by', user.id)
      .is('booking_id', null);
    for (const r of rows ?? []) {
      try {
        await deleteObject('raw-footage', r.storage_path as string);
      } catch {
        // swept later
      }
    }
    await supabaseAdmin
      .from('booking_media')
      .delete()
      .eq('draft_id', draftId)
      .eq('uploaded_by', user.id)
      .is('booking_id', null);
    return { discarded: (rows ?? []).length };
  });
}
