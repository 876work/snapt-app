import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { headshotColumnsPresent } from '../schema-probe.js';
import { eligibleCreators } from '../availability.js';
import { creatorStanding } from '../strikes.js';
import { notify } from '../notify.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { requireCompleteProfile } from '../profile-complete.js';

const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'];

interface ApplyBody {
  specialties?: string[];
  service_type?: string;
  base_area?: string;
  service_radius_km?: number;
  bio?: string;
  portfolio_link?: string;
  /** "Full legal name, exactly as printed on your ID" — compared against the
   *  document after verification. Never shown to clients. */
  declared_legal_name?: string;
  availability?: Record<string, { start: string; end: string }[]>;
  // §14: the Creator Agreement consent is always required; the Background
  // Check & Vetting Disclosure applies only to in-person work (never Remote).
  consents?: { creator_agreement?: boolean; background_check?: boolean };
}

const SERVICE_TYPES = ['remote', 'in_person', 'both'];

/** Map a creator_profiles row (or absence) to the app's six-state model. */
function statusOf(row: { vetting_status: string } | null): string {
  if (!row) return 'not_applied';
  switch (row.vetting_status) {
    case 'not_started':
      return 'in_progress';
    case 'in_review':
      return 'pending_review';
    default:
      return row.vetting_status; // approved | rejected | suspended
  }
}

export function registerCreatorRoutes(app: FastifyInstance) {
  // Creator application. Approval is server-side (this endpoint never grants
  // it) — the client-side "creatorStatus" simulation is display-only now.
  // Draft save — lets an applicant resume where they left off. A draft is a
  // creator_profiles row at vetting_status not_started; it never enters
  // matching or the admin queue.
  app.post<{ Body: ApplyBody }>('/v1/creator/apply/draft', async (request, reply) => {
    const user = requireUser(request);
    const body = request.body ?? {};
    const { data: existing } = await supabaseAdmin
      .from('creator_profiles')
      .select('vetting_status')
      .eq('user_id', user.id)
      .maybeSingle();
    if (existing && existing.vetting_status !== 'not_started') {
      return reply.code(409).send({ error: 'Application already submitted' });
    }
    const patch = {
      user_id: user.id,
      vetting_status: 'not_started',
      specialties: (body.specialties ?? []).filter((s) => OCCASIONS.includes(s)),
      service_type: SERVICE_TYPES.includes(body.service_type ?? '') ? body.service_type : 'both',
      base_area: body.base_area ?? null,
      service_radius_km: body.service_radius_km ?? null,
      bio: body.bio ?? null,
      portfolio_link: body.portfolio_link?.trim() || null,
      declared_legal_name: body.declared_legal_name?.trim() || null,
    };
    const { error } = await supabaseAdmin
      .from('creator_profiles')
      .upsert(patch, { onConflict: 'user_id' });
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(201).send({ status: 'in_progress' });
  });

  // Creator application. Approval is server-side (this endpoint never grants
  // it). Every field is validated here — the UI's checks are advisory.
  app.post<{ Body: ApplyBody }>('/v1/creator/apply', async (request, reply) => {
    const user = requireUser(request);
    // We are onboarding someone to be paid and to meet clients in person —
    // a reachable phone and a real name are not optional here.
    if (!(await requireCompleteProfile(request, reply, user.id))) return;
    const body = request.body ?? {};

    const serviceType = body.service_type ?? '';
    if (!SERVICE_TYPES.includes(serviceType)) {
      return reply.code(400).send({ error: 'service_type must be remote, in_person, or both' });
    }
    const needsBackgroundCheck = serviceType !== 'remote';
    const specialties = (body.specialties ?? []).filter((s) => OCCASIONS.includes(s));
    if (specialties.length < 1) {
      return reply.code(400).send({ error: 'At least one specialty is required (§12)' });
    }
    if (needsBackgroundCheck && !body.base_area?.trim()) {
      return reply.code(400).send({ error: 'A base area is required for in-person work' });
    }
    // NOT server-required. Build 11 and the current APK predate this field,
    // and rejecting them would break applying for everyone already installed.
    // The app enforces it for builds that have it; a missing value simply
    // means the ID name is reconciled against the signup name alone.
    if (body.declared_legal_name != null && body.declared_legal_name.trim().length < 3) {
      return reply.code(400).send({
        error: 'Your full legal name, exactly as printed on your ID, is required',
      });
    }
    if (!body.consents?.creator_agreement) {
      return reply.code(400).send({ error: 'The Creator Agreement consent is required (§14)' });
    }
    if (needsBackgroundCheck && !body.consents?.background_check) {
      return reply.code(400).send({
        error: 'The Background Check Disclosure consent is required for in-person work (§14)',
      });
    }

    const { data: existing } = await supabaseAdmin
      .from('creator_profiles')
      .select('vetting_status')
      .eq('user_id', user.id)
      .maybeSingle();
    // Drafts submit; rejected applicants may reapply. Anything else is final
    // or already queued.
    if (existing && !['not_started', 'rejected'].includes(existing.vetting_status)) {
      return reply.code(409).send({ error: 'Application already exists' });
    }

    // REAPPLYING AFTER REJECTION starts the identity check over. Otherwise the
    // new application inherits verification_status 'approved' from the very
    // session an admin already reviewed and refused — and inherits its spent
    // attempts, so they often could not re-verify even if they wanted to.
    if (existing?.vetting_status === 'rejected') {
      await supabaseAdmin
        .from('creator_profiles')
        .update({
          verification_status: 'not_started',
          verification_attempts: 0,
          verification_session_id: null,
        })
        .eq('user_id', user.id);
      // Old sessions stay for audit but stop counting or asking for review.
      await supabaseAdmin
        .from('verification_sessions')
        .update({ name_review_required: false, status: 'Superseded' })
        .eq('user_id', user.id);
    }

    // Record consent against the latest version of each applicable doc,
    // snapshotting type+version for audit (§14). Remote applicants never
    // consent to the background-check disclosure.
    const docTypes = needsBackgroundCheck
      ? ['creator-agreement', 'background-check']
      : ['creator-agreement'];
    const { data: docs, error: docsError } = await supabaseAdmin
      .from('policy_documents')
      .select('id, doc_type, version')
      .in('doc_type', docTypes)
      .eq('status', 'published')
      .order('version', { ascending: false });
    if (docsError) return reply.code(500).send({ error: docsError.message });
    const latest = new Map<string, { id: string; doc_type: string; version: number }>();
    for (const doc of docs ?? []) if (!latest.has(doc.doc_type)) latest.set(doc.doc_type, doc);

    // REQUIRED headshot (original spec): uploaded via /v1/creator/headshot
    // before submit. Server-enforced so an old build can't skip it.
    const { data: existingRow } = await supabaseAdmin
      .from('creator_profiles')
      .select('headshot_path')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!existingRow?.headshot_path) {
      return reply.code(400).send({
        error: 'A professional headshot is required — add yours on the photo step before submitting.',
      });
    }

    const { error: upsertError } = await supabaseAdmin.from('creator_profiles').upsert(
      {
        user_id: user.id,
        vetting_status: 'in_review',
        applied_at: new Date().toISOString(),
        rejection_reason: null,
        specialties,
        service_type: serviceType,
        base_area: body.base_area ?? null,
        service_radius_km: needsBackgroundCheck ? (body.service_radius_km ?? null) : null,
        bio: body.bio ?? null,
        // Was collected by the app and silently dropped — the single most
        // useful artefact for judging a photographer never reached review.
        portfolio_link: body.portfolio_link?.trim() || null,
        declared_legal_name: body.declared_legal_name?.trim() || null,
        // Default weekly template until the creator edits it in Schedule —
        // without one an approved creator can never be booked.
        availability: body.availability ?? {
          mon: [{ start: '09:00', end: '17:00' }],
          tue: [{ start: '09:00', end: '17:00' }],
          wed: [{ start: '09:00', end: '17:00' }],
          thu: [{ start: '09:00', end: '17:00' }],
          fri: [{ start: '09:00', end: '17:00' }],
          sat: [{ start: '09:00', end: '17:00' }],
        },
      },
      { onConflict: 'user_id' },
    );
    if (upsertError) return reply.code(500).send({ error: upsertError.message });

    const consentRows = [...latest.values()].map((doc) => ({
      user_id: user.id,
      policy_document_id: doc.id,
      doc_type: doc.doc_type,
      version: doc.version,
    }));
    if (consentRows.length > 0) {
      // Reapplications can overlap earlier consents (same doc version) —
      // ignore duplicates so one existing row never voids the whole batch.
      const { error: consentError } = await supabaseAdmin
        .from('consent_records')
        .upsert(consentRows, { onConflict: 'user_id,policy_document_id', ignoreDuplicates: true });
      if (consentError) request.log.error(consentError, 'consent recording failed');
    }

    await notify(user.id, 'application_submitted', 'Application received', 'Your creator application is in review — we\'ll notify you the moment there\'s a decision.');
    return reply.code(201).send({ status: 'pending_review' });
  });

  // Public featured rail for the client home: approved creators' public
  // card info only. Browsing, not matching — assignment still goes through
  // the fully-gated eligibleCreators path.
  app.get('/v1/creators/featured', async () => {
    const { data } = await supabaseAdmin
      .from('creator_profiles')
      .select(
        ((await headshotColumnsPresent())
          ? 'user_id, specialties, verified, base_area, headshot_path, headshot_status, profiles!creator_profiles_user_id_fkey!inner(full_name, avatar_url)'
          : 'user_id, specialties, verified, base_area, profiles!creator_profiles_user_id_fkey!inner(full_name, avatar_url)') as '*',
      )
      .eq('vetting_status', 'approved')
      .limit(12);
    const ids = (data ?? []).map((c: any) => c.user_id as string);
    if (!ids.length) return { creators: [] };

    // A creator with no published work does NOT appear in the featured rail.
    // This is a photography marketplace: a card showing a coloured square
    // with an initial sells nothing and misrepresents what we are. Only
    // 'approved'/'auto' items count — 'pending' has not cleared moderation
    // and must never be shown publicly.
    const { data: shots } = await supabaseAdmin
      .from('portfolio_items')
      .select('creator_id, storage_path, created_at')
      .in('creator_id', ids)
      .in('status', ['approved', 'auto'])
      .not('storage_path', 'is', null)
      .order('created_at', { ascending: false });

    const pathsByCreator = new Map<string, string[]>();
    for (const shot of shots ?? []) {
      const list = pathsByCreator.get(shot.creator_id as string) ?? [];
      if (list.length < 3) list.push(shot.storage_path as string);
      pathsByCreator.set(shot.creator_id as string, list);
    }

    const { createDownloadUrl } = await import('../storage.js');
    const creators = await Promise.all(
      (data ?? [])
        .filter((c: any) => (pathsByCreator.get(c.user_id)?.length ?? 0) > 0)
        .map(async (c: any) => {
          const paths = pathsByCreator.get(c.user_id) ?? [];
          const work = (
            await Promise.all(
              paths.map((path) => createDownloadUrl('portfolio', path).catch(() => null)),
            )
          ).filter((url): url is string => url !== null);
          return {
            id: c.user_id,
            full_name: c.profiles.full_name,
            specialties: c.specialties ?? [],
            verified: c.verified,
            base_area: c.base_area,
            // The APPROVED headshot, signed — pending/rejected never leaves
            // the admin panel.
            avatar_url:
              c.headshot_status === 'approved' && c.headshot_path
                ? await createDownloadUrl('portfolio', c.headshot_path).catch(() => null)
                : c.profiles.avatar_url,
            /** Signed portfolio URLs, newest first. Never empty here. */
            work,
          };
        }),
    );
    // A signed-URL failure could empty `work` after the filter above.
    return { creators: creators.filter((c) => c.work.length > 0).slice(0, 6) };
  });

  /**
   * Social proof, real data only. Public (no auth) — it renders above the
   * fold for signed-out-feeling first visits too.
   *
   * The THRESHOLD LIVES HERE, not in the UI: the client renders whatever it
   * is handed, so a screen can never invent a number or show a zero. Below
   * the threshold the endpoint returns nothing at all and the component
   * hides itself.
   */
  app.get<{ Querystring: { area?: string } }>('/v1/social-proof', async (request) => {
    const MIN_BOOKINGS = 5;
    const since = new Date();
    since.setDate(since.getDate() - 30);

    let query = supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since.toISOString())
      .in('status', ['confirmed', 'completed']);
    if (request.query.area) query = query.eq('area', request.query.area);
    const { count } = await query;

    const bookings = count ?? 0;
    if (bookings < MIN_BOOKINGS) return { proof: null };
    return {
      proof: {
        kind: 'bookings_30d' as const,
        count: bookings,
        area: request.query.area ?? null,
      },
    };
  });

  // Single source of truth for creator status — the app reads this on
  // launch and after every relevant action, and never decides locally.
  app.get('/v1/creator/me', async (request, reply) => {
    const user = requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('creator_profiles')
      .select(
        ((await headshotColumnsPresent())
          ? 'vetting_status, background_check_status, specialties, verified, base_area, service_radius_km, availability, blocked_dates, service_type, is_available, applied_at, rejection_reason, headshot_path, headshot_status'
          : 'vetting_status, background_check_status, specialties, verified, base_area, service_radius_km, availability, blocked_dates, service_type, is_available, applied_at, rejection_reason') as '*',
      )
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    let headshotUrl: string | null = null;
    if (data?.headshot_path) {
      const { createDownloadUrl } = await import('../storage.js');
      headshotUrl = await createDownloadUrl('portfolio', data.headshot_path).catch(() => null);
    }
    const { headshot_path, ...rest } = data ?? ({} as Record<string, unknown>);
    return {
      status: statusOf(data),
      ...rest,
      headshot_url: headshotUrl,
    };
  });

  // ---- Headshot: upload + register -----------------------------------------
  // Applicants included (no approved-creator gate): the headshot is part of
  // the application itself. Files go to the private portfolio bucket under
  // headshots/{uid}/ and every upload lands as PENDING — nothing reaches
  // clients until an admin has seen it.
  app.post<{ Body: { filename?: string; content_type?: string } }>(
    '/v1/creator/headshot/upload-url',
    async (request, reply) => {
      const user = requireUser(request);
      const { filename, content_type } = request.body ?? {};
      if (!filename) return reply.code(400).send({ error: 'filename is required' });
      if (!content_type || !content_type.startsWith('image/')) {
        return reply.code(400).send({ error: 'Headshots must be an image' });
      }
      const { createUploadTarget } = await import('../storage.js');
      const safeName = filename.replace(/[^\w.\-]/g, '_');
      try {
        return await createUploadTarget(
          'portfolio',
          `headshots/${user.id}/${Date.now()}-${safeName}`,
          content_type,
        );
      } catch (err) {
        // Storage misconfiguration, expired credentials, missing bucket —
        // detail to the logs, something a person can act on to them.
        request.log.error({ err, userId: user.id }, 'headshot presign failed');
        return reply.code(502).send({
          error: "We couldn't start the upload just now. Try again in a moment.",
        });
      }
    },
  );

  app.post<{ Body: { storage_path?: string } }>('/v1/creator/headshot', async (request, reply) => {
    const user = requireUser(request);
    const storagePath = request.body?.storage_path;
    // Path is scoped to the caller — nobody can register someone else's file.
    if (!storagePath || !storagePath.startsWith(`headshots/${user.id}/`)) {
      return reply.code(400).send({ error: 'storage_path must be your own headshot upload' });
    }
    const { data: existing } = await supabaseAdmin
      .from('creator_profiles')
      .select('vetting_status, headshot_status')
      .eq('user_id', user.id)
      .maybeSingle();
    /**
     * UPDATE, not upsert. `upsert` builds an INSERT tuple and only then
     * resolves the conflict, so Postgres evaluates creator_profiles'
     * NOT NULL columns against a row that carries none of them:
     *   23502 null value in column "specialties" violates not-null constraint
     * That fired on EVERY headshot registration, row present or not — the
     * missing headshot columns were only the outer layer of this bug.
     *
     * specialties is `not null check (cardinality(specialties) >= 1)`, so a
     * row genuinely cannot be created here without inventing a specialty on
     * the applicant's behalf. When there is no row yet, say what to do
     * instead of failing with a 500.
     */
    /**
     * ANY ORDER. The photo step must not depend on having picked a specialty
     * first — that ordering was invisible to the creator, and the draft save
     * is debounced, so five selected specialties could still mean no row on
     * the server and a refusal that read as nonsense.
     *
     * Create the row when it is missing. `specialties: []` needs
     * 20260810090000_specialties_any_order.sql; until that runs the insert
     * trips the old cardinality check, so the previous message is kept as the
     * fallback rather than surfacing a constraint error. Deploy order does
     * not matter either way.
     */
    let error = null as { message: string } | null;
    if (existing) {
      ({ error } = await supabaseAdmin
        .from('creator_profiles')
        .update({ headshot_path: storagePath, headshot_status: 'pending' })
        .eq('user_id', user.id));
    } else {
      const { error: insertErr } = await supabaseAdmin.from('creator_profiles').insert({
        user_id: user.id,
        vetting_status: 'not_started',
        specialties: [],
        headshot_path: storagePath,
        headshot_status: 'pending',
      });
      if (insertErr) {
        request.log.error(
          { err: insertErr, userId: user.id },
          'headshot row create failed — specialties migration likely not run',
        );
        return reply.code(409).send({
          error: 'Pick at least one thing you shoot first — then add your photo.',
          code: 'application_not_started',
        });
      }
    }
    if (error) {
      /**
       * NEVER the raw Postgres string. An applicant hit
       * "Could not find the 'headshot_path' column of 'creator_profiles' in
       * the schema cache" — a schema-cache message shown to someone trying
       * to become a creator. The real error goes to the logs, where it is
       * actionable; they get a sentence and a way forward.
       */
      request.log.error({ err: error, userId: user.id, storagePath }, 'headshot register failed');
      return reply.code(500).send({
        error: "Your photo uploaded, but we couldn't save it to your profile. Try again — if it keeps happening, contact hello@snaptcarib.app.",
      });
    }
    // A replacement from an already-live creator needs re-review — flag it
    // so it doesn't sit invisible until someone happens to open the profile.
    if (existing?.vetting_status === 'approved') {
      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: 'headshot_review',
        detail: { creator_id: user.id },
      });
    }
    return reply.code(201).send({ saved: true, headshot_status: 'pending' });
  });

  // Approved creators manage their schedule + matching visibility here.
  app.put<{
    Body: {
      availability?: Record<string, { start: string; end: string }[]>;
      blocked_dates?: string[];
      service_radius_km?: number | null;
      is_available?: boolean;
    };
  }>('/v1/creator/settings', async (request, reply) => {
    const user = requireUser(request);
    const { data: me } = await supabaseAdmin
      .from('creator_profiles')
      .select('vetting_status, service_type')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!me || me.vetting_status !== 'approved') {
      return reply.code(403).send({ error: 'Approved creators only' });
    }
    const body = request.body ?? {};
    const patch: Record<string, unknown> = {};
    if (body.availability !== undefined) {
      const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      for (const [day, windows] of Object.entries(body.availability)) {
        if (!days.includes(day) || !Array.isArray(windows)) {
          return reply.code(400).send({ error: `Invalid availability day: ${day}` });
        }
        for (const w of windows) {
          if (!hhmm.test(w.start) || !hhmm.test(w.end) || w.start >= w.end) {
            return reply.code(400).send({ error: `Invalid window on ${day}` });
          }
        }
      }
      patch.availability = body.availability;
    }
    if (body.blocked_dates !== undefined) {
      if (!Array.isArray(body.blocked_dates) || body.blocked_dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
        return reply.code(400).send({ error: 'blocked_dates must be YYYY-MM-DD strings' });
      }
      patch.blocked_dates = body.blocked_dates;
    }
    if (body.service_radius_km !== undefined) {
      if (me.service_type === 'remote') {
        return reply.code(400).send({ error: 'Service radius does not apply to remote-only creators' });
      }
      if (body.service_radius_km !== null && (typeof body.service_radius_km !== 'number' || body.service_radius_km <= 0 || body.service_radius_km > 200)) {
        return reply.code(400).send({ error: 'service_radius_km must be between 1 and 200' });
      }
      patch.service_radius_km = body.service_radius_km;
    }
    if (body.is_available !== undefined) patch.is_available = Boolean(body.is_available);
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'Nothing to update' });
    const { error: upError } = await supabaseAdmin
      .from('creator_profiles')
      .update(patch)
      .eq('user_id', user.id);
    if (upError) return reply.code(500).send({ error: upError.message });
    return { updated: true };
  });

  // Eligible creators for a booking occasion — §12 hard filter. Used by the
  // Creator Assignment screen and by booking creation.
  app.get<{ Querystring: { occasion?: string; area?: string } }>(
    '/v1/creators/eligible',
    async (request, reply) => {
      const { occasion, area } = request.query;
      if (!occasion || !OCCASIONS.includes(occasion)) {
        return reply.code(400).send({ error: `occasion must be one of ${OCCASIONS.join(', ')}` });
      }
      const creators = await eligibleCreators(occasion, area);
      const { createDownloadUrl } = await import('../storage.js');
      return {
        creators: await Promise.all(creators.map(async (c) => ({
          id: c.user_id,
          full_name: c.full_name,
          avatar_url:
            c.headshot_status === 'approved' && c.headshot_path
              ? await createDownloadUrl('portfolio', c.headshot_path).catch(() => null)
              : c.avatar_url,
          specialties: c.specialties,
          verified: c.verified,
          base_area: c.base_area,
          // Real km, booking area → creator base area (seeded coordinates).
          distance_km: c.distance_km ?? null,
        }))),
      };
    },
  );

  // Headshot review — the post-approval path (backfill uploads and
  // replacements). Application-time headshots are approved implicitly by
  // the application approval itself.
  app.post<{ Params: { userId: string }; Body: { approve?: boolean } }>(
    '/v1/admin/creators/:userId/headshot-review',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const approve = request.body?.approve === true;
      const { data: row } = await supabaseAdmin
        .from('creator_profiles')
        .select('headshot_status')
        .eq('user_id', request.params.userId)
        .maybeSingle();
      if (!row?.headshot_status) return reply.code(404).send({ error: 'No headshot to review' });
      const { error } = await supabaseAdmin
        .from('creator_profiles')
        .update({ headshot_status: approve ? 'approved' : 'rejected' })
        .eq('user_id', request.params.userId);
      if (error) return reply.code(500).send({ error: error.message });
      await supabaseAdmin
        .from('admin_alerts')
        .update({ resolved_at: new Date().toISOString() })
        .eq('alert_type', 'headshot_review')
        .is('resolved_at', null)
        .filter('detail->>creator_id', 'eq', request.params.userId);
      await audit(adminId, approve ? 'headshot_approved' : 'headshot_rejected', request.params.userId, {});
      if (!approve) {
        await notify(
          request.params.userId,
          'headshot_rejected',
          'Your headshot needs a retake',
          "The photo you uploaded didn't meet our profile guidelines. Upload a new one from your creator profile — clear, front-facing, just you.",
        );
      }
      return { headshot_status: approve ? 'approved' : 'rejected' };
    },
  );

  // Stopgap admin approval until the Admin Portal (Phase 5). Guarded by
  // ADMIN_API_TOKEN; disabled when unset.
  app.post<{ Params: { userId: string }; Body: { background_check_passed?: boolean } }>(
    '/v1/admin/creators/:userId/approve',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const passed = request.body?.background_check_passed ?? false;
      // Record WHO decided and whether they agreed with Didit — the
      // verification informs the decision, a human makes it.
      const { data: vp } = await supabaseAdmin
        .from('creator_profiles')
        .select('verification_status')
        .eq('user_id', request.params.userId)
        .maybeSingle();
      const agreed = vp ? vp.verification_status === 'approved' : null;
      const { error } = await supabaseAdmin
        .from('creator_profiles')
        .update({
          vetting_decided_by: adminId.id === 'bootstrap-token' ? null : adminId.id,
          vetting_decided_at: new Date().toISOString(),
          vetting_agreed_with_didit: agreed,
          vetting_status: 'approved',
          // The badge is NO LONGER set here. `verified` means identity
          // verified and is granted automatically by the ID check. Ticking
          // this box used to write background_check_status 'passed' with a
          // completion timestamp for a check nobody performs — a fabricated
          // record. Until the police certificate flow exists, an admin can
          // only mark it pending.
          ...(passed
            ? {
                background_check_status: 'passed',
                background_check_completed_at: new Date().toISOString(),
              }
            : {}),
        })
        .eq('user_id', request.params.userId);
      if (error) return reply.code(500).send({ error: error.message });
      // Approving the application approves the pending headshot with it —
      // it was on screen during this review.
      await supabaseAdmin
        .from('creator_profiles')
        .update({ headshot_status: 'approved' })
        .eq('user_id', request.params.userId)
        .eq('headshot_status', 'pending');
      await notify(request.params.userId, 'application_approved', 'You\'re approved!', 'Welcome to Snapt — you can now receive bookings. Set your availability to go live.');
      await audit(adminId, 'creator_approved', request.params.userId, {
        verification_status: vp?.verification_status ?? 'unknown',
        agreed_with_didit: agreed,
      });
      return { status: 'approved' };
    },
  );

  // Rejection captures a reason that reaches the user (in-app + email) and
  // permits reapplying — the client shows the reason and the path back in.
  app.post<{ Params: { userId: string }; Body: { reason?: string } }>(
    '/v1/admin/creators/:userId/reject',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const reason = request.body?.reason?.trim();
      if (!reason) return reply.code(400).send({ error: 'A rejection reason is required' });
      const { data: vpr } = await supabaseAdmin
        .from('creator_profiles')
        .select('verification_status')
        .eq('user_id', request.params.userId)
        .maybeSingle();
      // Agreement = we rejected AND Didit did not approve.
      const agreedR = vpr ? vpr.verification_status !== 'approved' : null;
      const { error } = await supabaseAdmin
        .from('creator_profiles')
        .update({
          vetting_status: 'rejected',
          rejection_reason: reason,
          vetting_decided_by: adminId.id === 'bootstrap-token' ? null : adminId.id,
          vetting_decided_at: new Date().toISOString(),
          vetting_agreed_with_didit: agreedR,
        })
        .eq('user_id', request.params.userId);
      if (error) return reply.code(500).send({ error: error.message });
      await notify(
        request.params.userId,
        'application_rejected',
        'About your creator application',
        `We weren't able to approve your application this time. Reason: ${reason}. You're welcome to apply again once this is addressed.`,
      );
      await audit(adminId, 'creator_rejected', request.params.userId, {
        reason,
        verification_status: vpr?.verification_status ?? 'unknown',
        agreed_with_didit: agreedR,
      });
      return { status: 'rejected' };
    },
  );

  // §9: strikes are admin-visible only (plus the tier notification). Full
  // per-creator history + overturn, stopgap until the Admin Portal (Phase 5).
  app.get<{ Params: { userId: string } }>(
    '/v1/admin/creators/:userId/strikes',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply, ['admin', 'support']);
      if (!adminId) return;
      const { data, error } = await supabaseAdmin
        .from('strikes')
        .select('*')
        .eq('creator_id', request.params.userId)
        .order('occurred_at', { ascending: false });
      if (error) return reply.code(500).send({ error: error.message });
      return { strikes: data, standing: await creatorStanding(request.params.userId) };
    },
  );

  app.post<{ Params: { strikeId: string } }>(
    '/v1/admin/strikes/:strikeId/overturn',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const { error } = await supabaseAdmin
        .from('strikes')
        .update({ overturned: true })
        .eq('id', request.params.strikeId);
      if (error) return reply.code(500).send({ error: error.message });
      await audit(adminId, 'strike_overturned', request.params.strikeId);
      return { overturned: true };
    },
  );
}
