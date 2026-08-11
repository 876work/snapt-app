import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { env } from '../env.js';
import { autoAppliable, combinedSignal, reconcileNames } from '../name-match.js';
import { sendEmail } from '../email.js';
import { notify } from '../notify.js';

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

/**
 * Fetch the decision. Didit's WEBHOOK carries only a status — the identity
 * data lives behind this call. Relying on `payload.decision` meant the 18+
 * gate and the name reconciliation never ran on a single real session.
 */
async function fetchDecision(diditSessionId: string): Promise<Record<string, any> | null> {
  if (!env.diditApiKey) return null;
  try {
    const res = await fetch(`${DIDIT_BASE}/v3/session/${diditSessionId}/decision/`, {
      headers: { 'x-api-key': env.diditApiKey },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, any>;
  } catch {
    return null;
  }
}

function first<T>(value: unknown): T | undefined {
  return Array.isArray(value) ? (value[0] as T | undefined) : undefined;
}

export interface RiskFlag {
  feature: string;
  risk: string;
  description: string;
  /** The other session this document / face / device also appeared on. */
  duplicate_session_id: string | null;
  /** vendor_data on that session = OUR user id, so it resolves to an account. */
  duplicate_user_id: string | null;
}

/**
 * Duplicate signals are the strongest fraud evidence we get: the same
 * document, face or device appearing under a second account. Didit reports
 * them per-feature, so they are collected from every branch and normalised.
 */
function collectRisk(decision: Record<string, any>): RiskFlag[] {
  const idv = (first<any>(decision?.id_verifications) ?? decision?.id_verification ?? {}) as any;
  const live = (first<any>(decision?.liveness_checks) ?? decision?.liveness ?? {}) as any;
  const ips: any[] = Array.isArray(decision?.ip_analyses) ? decision.ip_analyses : [];

  const buckets: any[] = [
    ...(Array.isArray(decision?.warnings) ? decision.warnings : []),
    ...(Array.isArray(idv?.warnings) ? idv.warnings : []),
    ...(Array.isArray(live?.warnings) ? live.warnings : []),
    ...ips.flatMap((ip) => (Array.isArray(ip?.warnings) ? ip.warnings : [])),
  ];

  // matches[] carries the other session's vendor_data — our user id.
  const matchUser = new Map<string, string>();
  for (const m of [
    ...(Array.isArray(idv?.matches) ? idv.matches : []),
    ...(Array.isArray(live?.matches) ? live.matches : []),
    ...ips.flatMap((ip) => (Array.isArray(ip?.matches) ? ip.matches : [])),
  ]) {
    if (m?.session_id && m?.vendor_data) matchUser.set(m.session_id, m.vendor_data);
  }

  // Didit's own blocklist / allowlist verdict on matched identities. We were
  // ignoring it entirely — an identity Didit already knows is blocked would
  // have sailed through.
  for (const m of [
    ...(Array.isArray(idv?.matches) ? idv.matches : []),
    ...(Array.isArray(live?.matches) ? live.matches : []),
  ]) {
    if (m?.is_blocklisted) {
      buckets.push({
        feature: 'BLOCKLIST',
        risk: 'BLOCKLISTED_IDENTITY',
        short_description: 'This identity is on Didit\'s blocklist.',
        additional_data: { duplicated_session_id: m.session_id ?? null },
      });
    } else if (m?.is_allowlisted) {
      buckets.push({
        feature: 'BLOCKLIST',
        risk: 'ALLOWLISTED_IDENTITY',
        short_description: 'This identity is allowlisted — previously cleared by a human.',
        additional_data: { duplicated_session_id: m.session_id ?? null },
      });
    }
  }

  // Expired documents must not pass. This was read and stored but never checked.
  const expiry: string | null = idv?.expiration_date ?? null;
  if (expiry) {
    const when = new Date(expiry);
    if (!Number.isNaN(when.getTime()) && when.getTime() < Date.now()) {
      buckets.push({
        feature: 'ID_VERIFICATION',
        risk: 'DOCUMENT_EXPIRED',
        short_description: `The document expired on ${expiry}.`,
      });
    }
  }

  // Network context. is_data_center is TRUE for our own in-app browser (it
  // proxies through Fastly), so it is recorded as context, never as a risk on
  // its own — only a VPN/Tor exit is worth flagging.
  for (const ip of ips) {
    if (ip?.is_vpn_or_tor) {
      buckets.push({
        feature: 'LOCATION',
        risk: 'VPN_OR_TOR',
        short_description: `Connected through a VPN or Tor exit (${ip.ip_country ?? 'unknown country'}).`,
      });
    }
  }

  // Liveness estimates an age from the selfie. A wide gap from the document's
  // date of birth is a cheap tell for a forged or borrowed DOB.
  const estimated: number | null = typeof live?.age_estimation === 'number' ? live.age_estimation : null;
  const dobValue: string | null = idv?.date_of_birth ?? null;
  if (estimated != null && dobValue) {
    const documentAge = ageFrom(dobValue);
    if (documentAge != null && Math.abs(documentAge - estimated) > 12) {
      buckets.push({
        feature: 'LIVENESS',
        risk: 'AGE_ESTIMATE_MISMATCH',
        short_description: `Selfie looks about ${Math.round(estimated)}; the document says ${documentAge}.`,
      });
    }
  }

  const seen = new Set<string>();
  const flags: RiskFlag[] = [];
  for (const w of buckets) {
    const dupSession = w?.additional_data?.duplicated_session_id ?? null;
    const key = `${w?.feature}|${w?.risk}|${dupSession ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      feature: String(w?.feature ?? 'UNKNOWN'),
      risk: String(w?.risk ?? 'UNKNOWN'),
      description: String(w?.short_description ?? ''),
      duplicate_session_id: dupSession,
      duplicate_user_id: dupSession ? (matchUser.get(dupSession) ?? null) : null,
    });
  }
  return flags;
}

/** Risks that mean "this identity is already on another account". */
const DUPLICATE_RISKS = new Set([
  'POSSIBLE_DUPLICATED_USER',
  'DUPLICATED_FACE',
  'DUPLICATED_DEVICE_FINGERPRINT',
  'DUPLICATED_DOCUMENT',
]);

export function duplicateFlags(flags: RiskFlag[]): RiskFlag[] {
  return flags.filter((f) => DUPLICATE_RISKS.has(f.risk));
}

/** Pull the fields we keep out of Didit's decision payload. */
function extractDecision(decision: Record<string, any>) {
  // Didit returns ARRAYS (id_verifications, face_matches, liveness_checks).
  // The singular fallbacks are belt-and-braces for older payload shapes.
  const idv = (first<any>(decision?.id_verifications) ?? decision?.id_verification ?? {}) as any;
  const face = (first<any>(decision?.face_matches) ?? decision?.face_match ?? {}) as any;
  const live = (first<any>(decision?.liveness_checks) ?? decision?.liveness ?? {}) as any;
  const dob: string | null = idv.date_of_birth ?? idv.dateOfBirth ?? null;
  const flags = collectRisk(decision);

  return {
    extracted: {
      full_name: idv.full_name ?? idv.fullName ?? null,
      first_name: idv.first_name ?? null,
      last_name: idv.last_name ?? null,
      document_number: idv.document_number ?? null,
      document_type: idv.document_type ?? null,
      issuing_country: idv.issuing_state ?? idv.issuing_country ?? null,
      expiry_date: idv.expiration_date ?? null,
      liveness_status: live.status ?? null,
      liveness_score: typeof live.score === 'number' ? live.score : null,
      id_verification_status: idv.status ?? null,
      face_match_status: face.status ?? null,
      duplicate_count: duplicateFlags(flags).length,
      age_estimation: typeof live.age_estimation === 'number' ? live.age_estimation : null,
      ip_country: first<any>(decision?.ip_analyses)?.ip_country ?? null,
      is_vpn_or_tor: first<any>(decision?.ip_analyses)?.is_vpn_or_tor ?? null,
      // True for our own in-app browser via Fastly — context, not a risk.
      is_data_center: first<any>(decision?.ip_analyses)?.is_data_center ?? null,
      document_expired: flags.some((f) => f.risk === 'DOCUMENT_EXPIRED'),
      blocklisted: flags.some((f) => f.risk === 'BLOCKLISTED_IDENTITY'),
    },
    face_match_score: typeof face.score === 'number' ? face.score : null,
    date_of_birth: dob,
    warnings: flags,
  };
}

/**
 * An attempt is a verification Didit DECIDED — approved or declined. Derived
 * by counting rather than incrementing, so it is idempotent under webhook
 * retries and under the backfill, and an abandoned session never costs one.
 */
async function countAttempts(userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('verification_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('status', ['Approved', 'Declined']);
  return count ?? 0;
}

/**
 * What the creator is told, per outcome. Deliberately plain: no "your
 * submission has been processed" — say what happened and what, if anything,
 * they need to do.
 */
function verificationMessage(
  rollup: string,
  parked: boolean,
  attemptsLeft: boolean,
): { trigger: string; title: string; body: string } | null {
  if (rollup === 'failed_underage') {
    return {
      trigger: 'verification_failed',
      title: 'Age requirement not met',
      body: 'Your document shows you\'re under 18. Snapt creators must be 18 or older, so we can\'t take this application further — but you\'re welcome to apply again once you turn 18.',
    };
  }
  if (rollup === 'declined') {
    return attemptsLeft
      ? {
          trigger: 'verification_failed',
          title: "We couldn't verify your ID",
          body: 'Usually it\'s a blurry photo or glare on the document. You can try once more from your application, or submit anyway and our team will review the documents by hand — usually within 2 working days.',
        }
      : {
          trigger: 'verification_failed',
          title: 'A person is reviewing your documents',
          body: 'Both attempts are used, so our team reviews the documents by hand instead — usually within 2 working days. Nothing else is needed from you.',
        };
  }
  if (rollup === 'approved' && parked) {
    return {
      trigger: 'verification_result',
      title: "We're checking one detail",
      body: 'Your ID and selfie matched. One detail needs a quick look from our team before we finish — usually within 2 working days. Nothing is needed from you, and your application is still moving.',
    };
  }
  if (rollup === 'approved') {
    return {
      trigger: 'verification_result',
      title: 'Identity verified',
      body: 'Your ID and selfie matched. That part of your application is done.',
    };
  }
  if (rollup === 'in_review') {
    return {
      trigger: 'verification_result',
      title: 'A person is reviewing your documents',
      body: 'Our team reviews the documents by hand — usually within 2 working days. Nothing else is needed from you.',
    };
  }
  return null; // in_progress / abandoned — nothing decided, nothing to say
}

/**
 * Apply a Didit outcome to one of our sessions: fetch the decision, store the
 * fields we keep, run the 18+ gate and the name reconciliation, and roll the
 * result up onto the application.
 *
 * Shared by the webhook and the admin backfill so both take exactly the same
 * path — a backfill that reimplements the logic is a second thing to get wrong.
 */
export async function applyDecision(
  session: { id: string; user_id: string; attempt: number; didit_session_id?: string },
  status: string,
  log?: { error: (o: unknown, m: string) => void },
): Promise<{ rollup: string; verdict: string | null; duplicates: number }> {
  const patch: Record<string, unknown> = { status, decided_at: new Date().toISOString() };
  let is18: boolean | null = null;
  let flags: RiskFlag[] = [];
  let parsed: ReturnType<typeof extractDecision> | null = null;

  const diditId =
    session.didit_session_id ??
    (
      await supabaseAdmin
        .from('verification_sessions')
        .select('didit_session_id')
        .eq('id', session.id)
        .maybeSingle()
    ).data?.didit_session_id;

  const decision = diditId ? await fetchDecision(diditId) : null;
  if (decision) {
    parsed = extractDecision(decision);
    patch.extracted = parsed.extracted;
    patch.face_match_score = parsed.face_match_score;
    patch.warnings = parsed.warnings;
    flags = parsed.warnings;
    if (parsed.date_of_birth) {
      patch.date_of_birth = parsed.date_of_birth;
      const age = ageFrom(parsed.date_of_birth);
      // 18+ is enforced from the DOCUMENT's date of birth, never a typed field.
      is18 = age != null ? age >= 18 : null;
      patch.is_18_plus = is18;
    }
  } else if (log) {
    log.error({ sessionId: diditId }, 'didit decision fetch failed — status stored without identity data');
  }

  // A blocklisted identity or an EXPIRED document must never come out the
  // other side as "approved", whatever Didit concluded. Both go to a human
  // instead — these are decision-changing, not background detail.
  const blocked = flags.some((f) => f.risk === 'BLOCKLISTED_IDENTITY');
  const expired = flags.some((f) => f.risk === 'DOCUMENT_EXPIRED');

  /**
   * DEFAULT IS SILENT. This used to default to 'in_review', so ANY status we
   * did not explicitly handle was read as "a human is reviewing this" — and
   * two of them are routine:
   *
   *   'Not Started'  written by our own session-create the instant a creator
   *                  taps Verify my identity
   *   'In Progress'  Didit's status while they are still taking photos
   *
   * Both fell through to the default. The creator was told "A person is
   * reviewing your documents — usually within 2 working days" before they
   * had photographed anything, and the app dismissed the Didit sheet on
   * sight of it (settled() counts in_review), which is the first-tap failure.
   *
   * Only a status we recognise as a DECISION may end an attempt. Anything
   * else — including one Didit adds later that we have never seen — is
   * in_progress: no notification, nothing closed, the flow keeps running.
   */
  let rollup = 'in_progress';
  if (is18 === false) rollup = 'failed_underage';
  else if (blocked || expired) rollup = 'in_review';
  else if (status === 'Approved') rollup = 'approved';
  else if (status === 'Declined') rollup = 'declined';
  else if (status === 'In Review') rollup = 'in_review';
  else if (status === 'Abandoned' || status === 'Expired') rollup = 'in_progress';
  else if (status !== 'Not Started' && status !== 'In Progress' && status !== 'Pending') {
    // Unrecognised: treat as still running, but make it visible rather than
    // silently swallowed, so a new Didit status is noticed by us not them.
    log?.error({ status, sessionId: session.id }, 'unmapped didit status — treated as in_progress');
  }

  const profilePatch: Record<string, unknown> = {
    verification_status: rollup,
    verification_session_id: session.id,
  };

  let verdict: string | null = null;
  // IDENTITY VERIFIED is now what the badge means, and it is earned by the
  // check we actually perform — document, passive liveness, face match, 18+
  // from the document. It is no longer an admin ticking a background check
  // that nobody runs. Blocked/expired/parked never reach here.
  if (rollup === 'approved' && !blocked && !expired) {
    profilePatch.verified = true;
  }

  if (rollup === 'approved' && parsed) {
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
      idFullName: parsed.extracted.full_name,
      idFirstName: parsed.extracted.first_name,
      idLastName: parsed.extracted.last_name,
      signupName: account?.full_name ?? null,
      declaredLegalName: creator?.declared_legal_name ?? null,
    });
    verdict = comparison.verdict;
    patch.name_verdict = comparison.verdict;
    patch.name_detail = { ...comparison, face_match_score: parsed.face_match_score };
    patch.name_review_required = comparison.verdict === 'substantial_mismatch';

    if (autoAppliable(comparison.verdict) && comparison.id_name) {
      profilePatch.legal_name = comparison.id_name;
      profilePatch.legal_name_source = 'didit';
      profilePatch.legal_name_set_at = new Date().toISOString();
      if (account?.email && creator?.legal_name !== comparison.id_name) {
        await notifyLegalNameSet(
          account.email,
          comparison.id_name,
          account.full_name ?? '',
          comparison.verdict,
        ).catch(() => undefined);
      }
    }
  }

  await supabaseAdmin.from('verification_sessions').update(patch).eq('id', session.id);
  // AFTER the session's own status lands, so this decision is included.
  profilePatch.verification_attempts = await countAttempts(session.user_id);
  await supabaseAdmin.from('creator_profiles').update(profilePatch).eq('user_id', session.user_id);

  // Tell the creator. Distinct copy per outcome — "parked for review" is NOT
  // the same as "verified", and saying so is the whole point.
  const parked = patch.name_review_required === true || blocked || expired;
  const message = verificationMessage(rollup, parked, session.attempt < MAX_ATTEMPTS);
  if (message) {
    // No explicit deep_link: notification-targets.ts routes every
    // verification outcome to /creator, which reads the live status and
    // renders approved / parked / rejected. One definition, not two.
    await notify(session.user_id, message.trigger, message.title, message.body);
  }

  return { rollup, verdict, duplicates: duplicateFlags(flags).length };
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

        // Starting a check costs NOTHING. Attempts are counted from sessions
        // Didit actually decided (see countAttempts) — abandoning, losing
        // signal or closing the sheet must never burn one, and previously two
        // abandons locked a creator out of verification permanently.
        await supabaseAdmin
          .from('creator_profiles')
          .update({
            verification_status: 'in_progress',
            verification_session_id: sessionRowId,
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
      .select('didit_session_id, document_type, status, attempt, is_18_plus, name_review_required, created_at')
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
      /** Passed the ID check, but a human still has to resolve something. */
      review_pending: Boolean(session?.name_review_required),
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

    const status: string = payload.status ?? payload.session?.status ?? 'Unknown';

    // Resolve the session DEFENSIVELY. Didit's create response and its webhook
    // do not necessarily agree on where the id lives, and a webhook we cannot
    // match is a verification that silently never lands — the creator waits
    // forever on a result we were told about and dropped.
    const sessionId: string | undefined =
      payload.session_id ?? payload.session?.session_id ?? payload.data?.session_id ?? payload.id;
    // vendor_data is OUR user id — we set it on every session we create, so it
    // is the one identifier we can always resolve, whatever Didit renames.
    const vendorData: string | undefined =
      payload.vendor_data ?? payload.session?.vendor_data ?? payload.data?.vendor_data;

    let session: { id: string; user_id: string; attempt: number } | null = null;
    if (sessionId) {
      const { data } = await supabaseAdmin
        .from('verification_sessions')
        .select('id, user_id, attempt')
        .eq('didit_session_id', sessionId)
        .maybeSingle();
      session = data ?? null;
    }
    if (!session && vendorData) {
      const { data } = await supabaseAdmin
        .from('verification_sessions')
        .select('id, user_id, attempt')
        .eq('user_id', vendorData)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      session = data ?? null;
      // Keep our copy of the id in step with whatever Didit actually reports.
      if (session && sessionId) {
        await supabaseAdmin
          .from('verification_sessions')
          .update({ didit_session_id: sessionId })
          .eq('id', session.id);
      }
    }
    if (!session) {
      // Record the SHAPE of what arrived — key names only, no identity data —
      // so an unmatched delivery is visible instead of silently discarded.
      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: 'didit_webhook_unmatched',
        detail: {
          top_level_keys: Object.keys(payload),
          session_keys: payload.session ? Object.keys(payload.session) : null,
          data_keys: payload.data ? Object.keys(payload.data) : null,
          had_session_id: Boolean(sessionId),
          had_vendor_data: Boolean(vendorData),
          status,
        },
      });
      request.log.error({ keys: Object.keys(payload), status }, 'didit webhook did not match a session');
      return { received: true };
    }

    await applyDecision(session, status);
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

      // Duplicate document / face / device across accounts is the strongest
      // fraud signal we get, so it is resolved to real accounts here rather
      // than left as opaque session ids the reviewer cannot act on.
      const flags: RiskFlag[] = Array.isArray(latest?.warnings) ? (latest.warnings as RiskFlag[]) : [];
      const dupes = duplicateFlags(flags);
      const dupeUserIds = [...new Set(dupes.map((d) => d.duplicate_user_id).filter(Boolean))] as string[];
      const { data: dupeAccounts } = dupeUserIds.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', dupeUserIds)
        : { data: [] };
      const risk = {
        flags,
        duplicates: dupes.map((d) => {
          const acct = (dupeAccounts ?? []).find((a) => a.id === d.duplicate_user_id);
          return {
            ...d,
            duplicate_account: acct ? { id: acct.id, full_name: acct.full_name, email: acct.email } : null,
          };
        }),
      };

      await audit(admin, 'verification_viewed', request.params.id);
      return {
        profile: profile ?? null,
        reconciliation,
        risk,
        sessions: sessions ?? [],
        // Images stay with Didit; the portal streams them through
        // /image below rather than copying them into our storage.
        image_endpoint: `/v1/admin/creators/${request.params.id}/verification/image`,
        configured: diditConfigured,
      };
    },
  );

  /**
   * Backfill / re-pull a decision from Didit for one session, or for every
   * session missing identity data. Also the manual recovery path for any
   * webhook we never received.
   */
  app.post<{ Body: { session_id?: string; all_missing?: boolean } }>(
    '/v1/admin/verification/reconcile',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      if (!diditConfigured) return reply.code(503).send({ error: 'verification_unavailable' });

      let query = supabaseAdmin
        .from('verification_sessions')
        .select('id, user_id, attempt, didit_session_id, status');
      if (request.body?.session_id) {
        query = query.eq('didit_session_id', request.body.session_id);
      } else if (request.body?.all_missing) {
        // Sessions Didit decided but where we hold no identity data.
        query = query.is('date_of_birth', null).neq('status', 'Not Started');
      } else {
        return reply.code(400).send({ error: 'session_id or all_missing is required' });
      }
      const { data: sessions } = await query;
      if (!sessions?.length) return reply.code(404).send({ error: 'No matching sessions' });

      const results = [];
      for (const s of sessions) {
        const outcome = await applyDecision(
          { id: s.id, user_id: s.user_id, attempt: s.attempt, didit_session_id: s.didit_session_id },
          s.status as string,
          request.log,
        );
        results.push({ didit_session_id: s.didit_session_id, ...outcome });
      }
      await audit(admin, 'verification_reconciled', undefined, { count: results.length });
      return { reconciled: results.length, results };
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
      // Allow-list, so an unknown ?kind still resolves to something sane
      // rather than silently falling through to the selfie.
      const KINDS = ['portrait', 'document', 'document_back', 'document_full'] as const;
      const kind = (KINDS as readonly string[]).includes(request.query.kind ?? '')
        ? (request.query.kind as string)
        : 'portrait';
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
        // Didit v3 returns ARRAYS — id_verifications, face_matches,
        // liveness_checks — exactly as extractDecision() above already knows.
        // This route was reading the singular forms only, so `url` was always
        // undefined and every request 404'd as "No image available". The
        // images were in the payload the whole time; no admin has ever seen
        // one (zero `verification_image_viewed` rows in the audit log).
        const idv = (first<any>(decision?.id_verifications) ?? decision?.id_verification ?? {}) as any;
        const face = (first<any>(decision?.face_matches) ?? decision?.face_match ?? {}) as any;
        const live = (first<any>(decision?.liveness_checks) ?? decision?.liveness ?? {}) as any;
        const url =
          kind === 'portrait'
            ? face?.source_image ?? live?.reference_image
            : kind === 'document_back'
              ? idv?.back_image ?? idv?.full_back_image
              : kind === 'document_full'
                ? idv?.full_front_image ?? idv?.front_image
                : idv?.front_image ?? idv?.portrait_image;
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
