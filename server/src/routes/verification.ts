import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { env } from '../env.js';
import { autoAppliable, combinedSignal, reconcileNames } from '../name-match.js';
import { sendEmail } from '../email.js';

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

/**
 * Nothing about someone's identity changes on their account silently.
 * Sent whenever a verified legal name is set or changed, by the webhook or
 * by an admin. Says plainly where the name came from and that the name
 * clients see has not moved.
 */
async function notifyLegalNameSet(
  email: string,
  legalName: string,
  displayName: string,
  verdict: string,
): Promise<void> {
  const varied = verdict !== 'match';
  await sendEmail(
    email,
    'Your verified name on Snapt',
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#191919">
      <h2 style="font-size:19px;margin:0 0 14px">Your verified name has been recorded</h2>
      <p style="font-size:14px;line-height:22px">
        Your ID check is complete. We've recorded the name exactly as it appears on your
        document, and we use it only where a legal name is required — payouts, disputes,
        and our own records.
      </p>
      <table style="font-size:14px;line-height:22px;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 16px 4px 0;color:#6F6F6F">Verified legal name</td>
            <td style="padding:4px 0;font-weight:700">${escapeHtml(legalName)}</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#6F6F6F">Name clients see</td>
            <td style="padding:4px 0;font-weight:700">${escapeHtml(displayName)} <span style="font-weight:400;color:#6F6F6F">(unchanged)</span></td></tr>
      </table>
      <p style="font-size:14px;line-height:22px">
        ${
          varied
            ? 'Your document writes your name slightly differently from your profile — that is completely normal, and we have not altered your profile name.'
            : 'Your profile name already matched your document.'
        }
        You can still edit the name clients see at any time in your profile. The verified
        name comes from your ID, so it can only be changed by our team.
      </p>
      <p style="font-size:13px;line-height:20px;color:#6F6F6F">
        If this isn't your name or you think something is wrong, reply to this email or
        contact hello@snaptcarib.app straight away.
      </p>
    </div>`,
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
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
          // Surface WHY. A bare 'unavailable' cost real testing rounds: the
          // caller (and the log) now get Didit's own complaint, which is
          // validation text, not a secret.
          const detail = (await res.text()).slice(0, 400);
          request.log.error({ status: res.status, detail }, 'didit session create failed');
          return reply.code(503).send({
            error: 'verification_unavailable',
            didit_status: res.status,
            didit_detail: detail,
          });
        }
        const body = (await res.json()) as { session_id: string; url: string };

        // Didit RESUMES rather than recreates: asking for a session while the
        // caller already has an open one returns that same session_id. So a
        // create is not proof of a new attempt, and inserting blindly hits the
        // unique index on didit_session_id (a 500 the creator sees as a dead
        // "ID checks aren't available" screen).
        //
        // A resumed session is the SAME attempt — reusing the row keeps the
        // attempt counter honest, so a creator can reopen a half-finished
        // check without burning their one retry.
        const { data: existing } = await supabaseAdmin
          .from('verification_sessions')
          .select('id, user_id, attempt, document_type')
          .eq('didit_session_id', body.session_id)
          .maybeSingle();

        if (existing && existing.user_id !== user.id) {
          // vendor_data is the user id, so this should be impossible. Refuse
          // rather than attach another person's check to this account.
          request.log.error(
            { sessionId: body.session_id, owner: existing.user_id, caller: user.id },
            'didit returned a session belonging to another user',
          );
          return reply.code(409).send({ error: 'verification_unavailable' });
        }

        let sessionRowId = existing?.id ?? null;
        let attempt = existing?.attempt ?? attempts + 1;

        if (!existing) {
          const { data: inserted, error } = await supabaseAdmin
            .from('verification_sessions')
            .insert({
              user_id: user.id,
              didit_session_id: body.session_id,
              document_type: documentType,
              status: 'Not Started',
              attempt,
            })
            .select('id')
            .single();
          // 23505 = another request inserted the same session between our
          // lookup and this insert. That is a resume too, not a failure.
          if (error && error.code === '23505') {
            const { data: raced } = await supabaseAdmin
              .from('verification_sessions')
              .select('id, attempt')
              .eq('didit_session_id', body.session_id)
              .maybeSingle();
            sessionRowId = raced?.id ?? null;
            attempt = raced?.attempt ?? attempt;
          } else if (error) {
            request.log.error({ err: error }, 'verification session insert failed');
            return reply.code(500).send({ error: error.message });
          } else {
            sessionRowId = inserted.id;
          }
        } else if (existing.document_type !== documentType) {
          // They reopened the flow and picked a different document. Didit
          // still resumes the same session, so keep our record in step.
          await supabaseAdmin
            .from('verification_sessions')
            .update({ document_type: documentType })
            .eq('id', existing.id);
        }

        await supabaseAdmin
          .from('creator_profiles')
          .update({
            verification_status: 'in_progress',
            verification_session_id: sessionRowId,
            // Only a genuinely new session consumes an attempt.
            verification_attempts: attempt,
          })
          .eq('user_id', user.id);

        return { url: body.url, session_id: body.session_id, attempt, resumed: Boolean(existing) };
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
    // Roll up to the application. Under-18 is a hard fail regardless of what
    // Didit concluded; everything else still goes to a human.
    let rollup = 'in_review';
    if (is18 === false) rollup = 'failed_underage';
    else if (status === 'Approved') rollup = 'approved';
    else if (status === 'Declined') rollup = 'declined';
    else if (status === 'In Review') rollup = 'in_review';
    else if (status === 'Abandoned' || status === 'Expired') rollup = 'in_progress';

    const profilePatch: Record<string, unknown> = {
      verification_status: rollup,
      verification_session_id: session.id,
    };

    // Name reconciliation. Only on a document we actually trust: a declined
    // or abandoned session's extracted name is not evidence of anything.
    if (rollup === 'approved' && patch.extracted) {
      const extracted = patch.extracted as Record<string, string | null>;
      const { data: account } = await supabaseAdmin
        .from('profiles')
        .select('full_name, email')
        .eq('id', session.user_id)
        .maybeSingle();
      const { data: creator } = await supabaseAdmin
        .from('creator_profiles')
        .select('declared_legal_name, legal_name')
        .eq('user_id', session.user_id)
        .maybeSingle();

      const comparison = reconcileNames({
        idFullName: extracted.full_name,
        idFirstName: extracted.first_name,
        idLastName: extracted.last_name,
        signupName: account?.full_name ?? null,
        declaredLegalName: creator?.declared_legal_name ?? null,
      });

      patch.name_verdict = comparison.verdict;
      patch.name_detail = { ...comparison, face_match_score: patch.face_match_score ?? null };
      // A substantial mismatch is PARKED, never applied. The discrepancy is
      // the evidence — overwriting it would destroy the signal.
      patch.name_review_required = comparison.verdict === 'substantial_mismatch';

      if (autoAppliable(comparison.verdict) && comparison.id_name) {
        profilePatch.legal_name = comparison.id_name;
        profilePatch.legal_name_source = 'didit';
        profilePatch.legal_name_set_at = new Date().toISOString();
        // The DISPLAY name (profiles.full_name) is deliberately untouched.
        if (account?.email && creator?.legal_name !== comparison.id_name) {
          await notifyLegalNameSet(
            account.email,
            comparison.id_name,
            account.full_name ?? '',
            comparison.verdict,
          ).catch((err) => request.log.error({ err }, 'legal name email failed'));
        }
      }
    }

    await supabaseAdmin.from('verification_sessions').update(patch).eq('id', session.id);
    await supabaseAdmin.from('creator_profiles').update(profilePatch).eq('user_id', session.user_id);

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
          'verification_status, verification_attempts, police_certificate_path, vetting_decided_by, vetting_decided_at, vetting_agreed_with_didit, legal_name, legal_name_source, legal_name_set_at, declared_legal_name',
        )
        .eq('user_id', request.params.id)
        .maybeSingle();
      const { data: account } = await supabaseAdmin
        .from('profiles')
        .select('full_name')
        .eq('id', request.params.id)
        .maybeSingle();

      // The name reconciliation, read TOGETHER with the face match — §3. The
      // panel shows one verdict, not two unrelated numbers.
      const latest = (sessions ?? [])[0];
      const reconciliation = latest
        ? {
            verdict: (latest.name_verdict as string | null) ?? 'unknown',
            detail: latest.name_detail ?? {},
            review_required: Boolean(latest.name_review_required),
            id_name:
              (latest.name_detail as Record<string, unknown> | null)?.id_name ??
              (latest.extracted as Record<string, string> | null)?.full_name ??
              null,
            display_name: account?.full_name ?? null,
            declared_legal_name: profile?.declared_legal_name ?? null,
            face_match_score: latest.face_match_score ?? null,
            signal: combinedSignal(
              ((latest.name_verdict as string | null) ?? 'unknown') as never,
              latest.face_match_score as number | null,
            ),
            /** Applied without a human? Never true for a substantial mismatch. */
            auto_applied:
              profile?.legal_name_source === 'didit' && Boolean(profile?.legal_name),
          }
        : null;

      await audit(admin, 'verification_viewed', request.params.id);
      return {
        profile: profile ?? null,
        reconciliation,
        sessions: sessions ?? [],
        // Images stay with Didit; the portal streams them through
        // /image below rather than copying them into our storage.
        image_endpoint: `/v1/admin/creators/${request.params.id}/verification/image`,
        configured: diditConfigured,
      };
    },
  );

  /**
   * Admin decision on the name reconciliation (§4).
   *
   * `accept_id_name`  — write the document's name as the verified legal name.
   * `keep_display_name` — acknowledge the difference, leave the legal name
   *                       unset. The display name is untouched either way;
   *                       this records that a human looked and chose.
   *
   * Rejecting the application is the existing vetting endpoint — a name
   * dispute is not special-cased into a rejection here.
   */
  app.post<{ Params: { id: string }; Body: { action?: string; note?: string } }>(
    '/v1/admin/creators/:id/legal-name',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const action = request.body?.action;
      if (action !== 'accept_id_name' && action !== 'keep_display_name') {
        return reply.code(400).send({ error: 'action must be accept_id_name or keep_display_name' });
      }

      const { data: session } = await supabaseAdmin
        .from('verification_sessions')
        .select('id, name_verdict, name_detail, extracted, face_match_score')
        .eq('user_id', request.params.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!session) return reply.code(404).send({ error: 'No verification session' });

      const detail = (session.name_detail ?? {}) as Record<string, unknown>;
      const idName =
        (detail.id_name as string | null) ??
        (session.extracted as Record<string, string> | null)?.full_name ??
        null;

      if (action === 'accept_id_name') {
        if (!idName) return reply.code(409).send({ error: 'No name was read from the document' });
        const { data: account } = await supabaseAdmin
          .from('profiles')
          .select('full_name, email')
          .eq('id', request.params.id)
          .maybeSingle();
        await supabaseAdmin
          .from('creator_profiles')
          .update({
            legal_name: idName,
            legal_name_source: 'admin',
            legal_name_set_at: new Date().toISOString(),
          })
          .eq('user_id', request.params.id);
        if (account?.email) {
          await notifyLegalNameSet(
            account.email,
            idName,
            account.full_name ?? '',
            (session.name_verdict as string) ?? 'unknown',
          ).catch((err) => request.log.error({ err }, 'legal name email failed'));
        }
      }

      await supabaseAdmin
        .from('verification_sessions')
        .update({ name_review_required: false })
        .eq('id', session.id);

      await audit(admin, `legal_name_${action}`, request.params.id, {
        id_name: idName,
        verdict: session.name_verdict,
        face_match_score: session.face_match_score,
        note: request.body?.note ?? null,
      });
      return { ok: true, legal_name: action === 'accept_id_name' ? idName : null };
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
