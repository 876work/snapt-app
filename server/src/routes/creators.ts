import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { eligibleCreators } from '../availability.js';
import { creatorStanding } from '../strikes.js';
import { notify } from '../notify.js';
import { audit, requireAdmin } from '../admin-auth.js';

const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'];

interface ApplyBody {
  specialties?: string[];
  service_type?: string;
  base_area?: string;
  service_radius_km?: number;
  bio?: string;
  portfolio_link?: string;
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
      .select('user_id, specialties, verified, base_area, profiles!inner(full_name, avatar_url)')
      .eq('vetting_status', 'approved')
      .limit(6);
    return {
      creators: (data ?? []).map((c: any) => ({
        id: c.user_id,
        full_name: c.profiles.full_name,
        specialties: c.specialties ?? [],
        verified: c.verified,
        base_area: c.base_area,
        avatar_url: c.profiles.avatar_url,
      })),
    };
  });

  // Single source of truth for creator status — the app reads this on
  // launch and after every relevant action, and never decides locally.
  app.get('/v1/creator/me', async (request, reply) => {
    const user = requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('creator_profiles')
      .select(
        'vetting_status, background_check_status, specialties, verified, base_area, service_radius_km, availability, blocked_dates, service_type, is_available, applied_at, rejection_reason',
      )
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    return {
      status: statusOf(data),
      ...(data ?? {}),
    };
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
      return {
        creators: creators.map((c) => ({
          id: c.user_id,
          full_name: c.full_name,
          avatar_url: c.avatar_url,
          specialties: c.specialties,
          verified: c.verified,
          base_area: c.base_area,
          // Real km, booking area → creator base area (seeded coordinates).
          distance_km: c.distance_km ?? null,
        })),
      };
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
      const { error } = await supabaseAdmin
        .from('creator_profiles')
        .update({
          vetting_status: 'approved',
          ...(passed
            ? {
                background_check_status: 'passed',
                background_check_completed_at: new Date().toISOString(),
                verified: true, // badge is tied to completed background check (§11)
              }
            : {}),
        })
        .eq('user_id', request.params.userId);
      if (error) return reply.code(500).send({ error: error.message });
      await notify(request.params.userId, 'application_approved', 'You\'re approved!', 'Welcome to Snapt — you can now receive bookings. Set your availability to go live.');
      await audit(adminId, 'creator_approved', request.params.userId);
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
      const { error } = await supabaseAdmin
        .from('creator_profiles')
        .update({ vetting_status: 'rejected', rejection_reason: reason })
        .eq('user_id', request.params.userId);
      if (error) return reply.code(500).send({ error: error.message });
      await notify(
        request.params.userId,
        'application_rejected',
        'About your creator application',
        `We weren't able to approve your application this time. Reason: ${reason}. You're welcome to apply again once this is addressed.`,
      );
      await audit(adminId, 'creator_rejected', request.params.userId, { reason });
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
