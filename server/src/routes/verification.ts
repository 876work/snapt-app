import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { env } from '../env.js';

/**
 * Didit identity verification — HOSTED sessions.
 *
 * The creator opens Didit's hosted URL in an in-app browser; Didit does the
 * capture, liveness and face match. THE RESULT ARRIVES BY WEBHOOK, never
 * from the client: losing signal or closing the app cannot lose the outcome.
 *
 * We store the session reference, status, the extracted fields we need, and
 * the match score. Didit keeps the images; the admin portal proxies them for
 * review rather than mirroring them into our storage.
 *
 * The verification INFORMS the admin decision. It never makes it: an admin
 * can approve or reject regardless, and we record whether they agreed.
 */

const DIDIT_BASE = 'https://verification.didit.me';
const MAX_ATTEMPTS = 2; // one retry, then manual review

type DocType = 'ID' | 'DL' | 'P';
const DOC_TYPES: DocType[] = ['ID', 'DL', 'P'];

export const diditConfigured = Boolean(env.diditApiKey && env.diditWorkflowId);

/** Sorted-key canonical JSON — matches Didit's X-Signature-V2 construction. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function ageFrom(dob: string): number | null {
  const born = new Date(dob);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

/** Pull the fields we keep out of Didit's decision payload. */
function extractDecision(decision: Record<string, any>) {
  const idv = decision?.id_verification ?? decision?.document ?? {};
  const face = decision?.face_match ?? decision?.faceMatch ?? {};
  const liveness = decision?.liveness ?? {};
  const dob: string | null = idv.date_of_birth ?? idv.dateOfBirth ?? null;
  const warnings: unknown[] = [
    ...(Array.isArray(decision?.warnings) ? decision.warnings : []),
    ...(Array.isArray(idv?.warnings) ? idv.warnings : []),
    ...(Array.isArray(face?.warnings) ? face.warnings : []),
    ...(Array.isArray(liveness?.warnings) ? liveness.warnings : []),
  ];
  return {
    extracted: {
      full_name: idv.full_name ?? idv.fullName ?? null,
      first_name: idv.first_name ?? null,
      last_name: idv.last_name ?? null,
      document_number: idv.document_number ?? null,
      document_type: idv.document_type ?? null,
      issuing_country: idv.issuing_state ?? idv.issuing_country ?? null,
      expiry_date: idv.expiration_date ?? null,
      liveness_status: liveness.status ?? null,
      id_verification_status: idv.status ?? null,
      face_match_status: face.status ?? null,
    },
    face_match_score: typeof face.score === 'number' ? face.score : null,
    date_of_birth: dob,
    warnings,
  };
}

export function registerVerificationRoutes(app: FastifyInstance) {
  // ---- Creator: start / resume a verification session ---------------------

  app.post<{ Body: { document_type?: string } }>(
    '/v1/creator/verification/session',
    async (request, reply) => {
      const user = requireUser(request);
      const documentType = request.body?.document_type as DocType;
      if (!DOC_TYPES.includes(documentType)) {
        return reply.code(400).send({ error: 'document_type must be ID, DL, or P' });
      }
      if (!diditConfigured) {
        // Third-party outage/misconfig must never block signup: the
        // application still submits and falls through to manual review.
        return reply.code(503).send({ error: 'verification_unavailable' });
      }

      const { data: profile } = await supabaseAdmin
        .from('creator_profiles')
        .select('verification_attempts, verification_status')
        .eq('user_id', user.id)
        .maybeSingle();
      const attempts = profile?.verification_attempts ?? 0;
      if (attempts >= MAX_ATTEMPTS) {
        return reply.code(409).send({ error: 'max_attempts', manual_review: true });
      }

      try {
        const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
          method: 'POST',
          headers: { 'x-api-key': env.diditApiKey as string, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workflow_id: env.diditWorkflowId,
            vendor_data: user.id,
            callback: 'snapt://creator/verification-complete',
            expected_details: { expected_document_types: [documentType] },
          }),
        });
        if (!res.ok) {
          request.log.error({ status: res.status }, 'didit session create failed');
          return reply.code(503).send({ error: 'verification_unavailable' });
        }
        const body = (await res.json()) as { session_id: string; url: string };
        const { data: session, error } = await supabaseAdmin
          .from('verification_sessions')
          .insert({
            user_id: user.id,
            didit_session_id: body.session_id,
            document_type: documentType,
            status: 'Not Started',
            attempt: attempts + 1,
          })
          .select()
          .single();
        if (error) return reply.code(500).send({ error: error.message });

        await supabaseAdmin
          .from('creator_profiles')
          .update({
            verification_status: 'in_progress',
            verification_session_id: session.id,
            verification_attempts: attempts + 1,
          })
          .eq('user_id', user.id);

        return { url: body.url, session_id: body.session_id, attempt: attempts + 1 };
      } catch (err) {
        request.log.error({ err }, 'didit unreachable');
        return reply.code(503).send({ error: 'verification_unavailable' });
      }
    },
  );

  /** Creator-side status: drives resume, retry, and the "in review" copy. */
  app.get('/v1/creator/verification', async (request, reply) => {
    const user = requireUser(request);
    const { data: session } = await supabaseAdmin
      .from('verification_sessions')
      .select('didit_session_id, document_type, status, attempt, is_18_plus, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: profile } = await supabaseAdmin
      .from('creator_profiles')
      .select('verification_status, verification_attempts')
      .eq('user_id', user.id)
      .maybeSingle();
    return {
      status: profile?.verification_status ?? 'not_started',
      attempts: profile?.verification_attempts ?? 0,
      max_attempts: MAX_ATTEMPTS,
      retries_left: Math.max(0, MAX_ATTEMPTS - (profile?.verification_attempts ?? 0)),
      configured: diditConfigured,
      session: session ?? null,
    };
  });

  // ---- Didit webhook: the ONLY source of verification truth ---------------

  app.post('/v1/didit/webhook', { config: { rawBody: true } }, async (request, reply) => {
    if (!env.diditWebhookSecret) {
      return reply.code(503).send({ error: 'Webhook secret not configured' });
    }
    const sigV2 = request.headers['x-signature-v2'];
    const sigRaw = request.headers['x-signature'];
    const timestamp = request.headers['x-timestamp'];
    if ((typeof sigV2 !== 'string' && typeof sigRaw !== 'string') || typeof timestamp !== 'string') {
      return reply.code(400).send({ error: 'Missing signature headers' });
    }
    // Replay window: reject anything older than 5 minutes.
    const skew = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(skew) || skew > 300) {
      return reply.code(400).send({ error: 'Stale timestamp' });
    }

    const raw = (request.body as Buffer).toString('utf8');
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(raw);
    } catch {
      return reply.code(400).send({ error: 'Invalid JSON' });
    }
    // We keep the raw bytes (rawBody: true), so X-Signature is the exact,
    // unambiguous check and is tried FIRST. X-Signature-V2 is the fallback:
    // it re-serialises to canonical JSON, and float rendering differs across
    // languages (Python emits 88.0 where JS emits 88), so a V2-only match is
    // best-effort. Either way, unverified payloads never reach the handler.
    const secret = env.diditWebhookSecret;
    const rawOk =
      typeof sigRaw === 'string' &&
      safeEqualHex(createHmac('sha256', secret).update(raw, 'utf8').digest('hex'), sigRaw);
    const v2Ok =
      !rawOk &&
      typeof sigV2 === 'string' &&
      safeEqualHex(createHmac('sha256', secret).update(canonical(payload), 'utf8').digest('hex'), sigV2);
    if (!rawOk && !v2Ok) {
      return reply.code(400).send({ error: 'Invalid signature' });
    }

    // Idempotency — Didit retries deliveries.
    const eventId: string | undefined = payload.event_id;
    if (eventId) {
      const { error: dupe } = await supabaseAdmin
        .from('verification_events')
        .insert({ event_id: eventId });
      if (dupe) return { received: true, duplicate: true };
    }

    const sessionId: string | undefined = payload.session_id;
    const status: string = payload.status ?? 'Unknown';
    if (!sessionId) return { received: true };

    const { data: session } = await supabaseAdmin
      .from('verification_sessions')
      .select('id, user_id, attempt')
      .eq('didit_session_id', sessionId)
      .maybeSingle();
    if (!session) return { received: true }; // not one of ours

    const patch: Record<string, unknown> = { status, decided_at: new Date().toISOString() };
    let is18: boolean | null = null;
    if (payload.decision) {
      const parsed = extractDecision(payload.decision);
      patch.extracted = parsed.extracted;
      patch.face_match_score = parsed.face_match_score;
      patch.warnings = parsed.warnings;
      if (parsed.date_of_birth) {
        patch.date_of_birth = parsed.date_of_birth;
        const age = ageFrom(parsed.date_of_birth);
        // 18+ is enforced from the DOCUMENT's date of birth, never a typed
        // field the applicant controls.
        is18 = age != null ? age >= 18 : null;
        patch.is_18_plus = is18;
      }
    }
    await supabaseAdmin.from('verification_sessions').update(patch).eq('id', session.id);

    // Roll up to the application. Under-18 is a hard fail regardless of what
    // Didit concluded; everything else still goes to a human.
    let rollup = 'in_review';
    if (is18 === false) rollup = 'failed_underage';
    else if (status === 'Approved') rollup = 'approved';
    else if (status === 'Declined') rollup = 'declined';
    else if (status === 'In Review') rollup = 'in_review';
    else if (status === 'Abandoned' || status === 'Expired') rollup = 'in_progress';
    await supabaseAdmin
      .from('creator_profiles')
      .update({ verification_status: rollup, verification_session_id: session.id })
      .eq('user_id', session.user_id);

    return { received: true };
  });

  // ---- Admin: review surface ---------------------------------------------

  /**
   * Verification detail for the application screen. Viewing verification
   * data is itself audited — it is sensitive identity information.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/admin/creators/:id/verification',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const { data: sessions } = await supabaseAdmin
        .from('verification_sessions')
        .select('*')
        .eq('user_id', request.params.id)
        .order('created_at', { ascending: false });
      const { data: profile } = await supabaseAdmin
        .from('creator_profiles')
        .select(
          'verification_status, verification_attempts, police_certificate_path, vetting_decided_by, vetting_decided_at, vetting_agreed_with_didit',
        )
        .eq('user_id', request.params.id)
        .maybeSingle();
      await audit(admin, 'verification_viewed', request.params.id);
      return {
        profile: profile ?? null,
        sessions: sessions ?? [],
        // Images stay with Didit; the portal streams them through
        // /image below rather than copying them into our storage.
        image_endpoint: `/v1/admin/creators/${request.params.id}/verification/image`,
        configured: diditConfigured,
      };
    },
  );

  /**
   * Proxy a verification image (portrait / document) from Didit for review.
   * Nothing is written to our storage — we fetch with our API key and stream
   * it to the admin browser. Each view is audited.
   */
  app.get<{ Params: { id: string }; Querystring: { kind?: string } }>(
    '/v1/admin/creators/:id/verification/image',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      if (!diditConfigured) return reply.code(503).send({ error: 'verification_unavailable' });
      const kind = request.query.kind === 'document' ? 'document' : 'portrait';
      const { data: session } = await supabaseAdmin
        .from('verification_sessions')
        .select('didit_session_id')
        .eq('user_id', request.params.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!session) return reply.code(404).send({ error: 'No verification session' });
      try {
        const res = await fetch(`${DIDIT_BASE}/v3/session/${session.didit_session_id}/decision/`, {
          headers: { 'x-api-key': env.diditApiKey as string },
        });
        if (!res.ok) return reply.code(502).send({ error: 'Could not load from Didit' });
        const decision = (await res.json()) as Record<string, any>;
        const url =
          kind === 'portrait'
            ? decision?.face_match?.source_image ?? decision?.liveness?.reference_image
            : decision?.id_verification?.front_image ?? decision?.id_verification?.portrait_image;
        if (!url) return reply.code(404).send({ error: 'No image available' });
        const img = await fetch(url);
        if (!img.ok) return reply.code(502).send({ error: 'Image fetch failed' });
        await audit(admin, 'verification_image_viewed', request.params.id, { kind });
        reply.header('Content-Type', img.headers.get('content-type') ?? 'image/jpeg');
        reply.header('Cache-Control', 'no-store');
        return reply.send(Buffer.from(await img.arrayBuffer()));
      } catch (err) {
        request.log.error({ err }, 'didit image proxy failed');
        return reply.code(502).send({ error: 'Could not load from Didit' });
      }
    },
  );
}
