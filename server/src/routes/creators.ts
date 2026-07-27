import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { eligibleCreators } from '../availability.js';
import { creatorStanding } from '../strikes.js';
import { notify } from '../notify.js';
import { env } from '../env.js';

const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'];

interface ApplyBody {
  specialties?: string[];
  base_area?: string;
  service_radius_km?: number;
  bio?: string;
  availability?: Record<string, { start: string; end: string }[]>;
  // §14: creator application carries TWO active consents — the Creator
  // Agreement and the Background Check & Vetting Disclosure.
  consents?: { creator_agreement?: boolean; background_check?: boolean };
}

export function registerCreatorRoutes(app: FastifyInstance) {
  // Creator application. Approval is server-side (this endpoint never grants
  // it) — the client-side "creatorStatus" simulation is display-only now.
  app.post<{ Body: ApplyBody }>('/v1/creator/apply', async (request, reply) => {
    const user = requireUser(request);
    const body = request.body ?? {};

    const specialties = (body.specialties ?? []).filter((s) => OCCASIONS.includes(s));
    if (specialties.length < 1) {
      return reply.code(400).send({ error: 'At least one specialty is required (§12)' });
    }
    if (!body.consents?.creator_agreement || !body.consents?.background_check) {
      return reply.code(400).send({
        error: 'Both the Creator Agreement and Background Check Disclosure consents are required (§14)',
      });
    }

    // Record consent against the latest version of each doc, snapshotting
    // type+version for audit (§14).
    const { data: docs, error: docsError } = await supabaseAdmin
      .from('policy_documents')
      .select('id, doc_type, version')
      .in('doc_type', ['creator-agreement', 'background-check'])
      .order('version', { ascending: false });
    if (docsError) return reply.code(500).send({ error: docsError.message });
    const latest = new Map<string, { id: string; doc_type: string; version: number }>();
    for (const doc of docs ?? []) if (!latest.has(doc.doc_type)) latest.set(doc.doc_type, doc);

    const { error: insertError } = await supabaseAdmin.from('creator_profiles').insert({
      user_id: user.id,
      vetting_status: 'in_review',
      specialties,
      base_area: body.base_area ?? null,
      service_radius_km: body.service_radius_km ?? null,
      bio: body.bio ?? null,
      availability: body.availability ?? {},
    });
    if (insertError) {
      const conflict = insertError.code === '23505';
      return reply
        .code(conflict ? 409 : 500)
        .send({ error: conflict ? 'Application already exists' : insertError.message });
    }

    const consentRows = [...latest.values()].map((doc) => ({
      user_id: user.id,
      policy_document_id: doc.id,
      doc_type: doc.doc_type,
      version: doc.version,
    }));
    if (consentRows.length > 0) {
      const { error: consentError } = await supabaseAdmin.from('consent_records').insert(consentRows);
      if (consentError) request.log.error(consentError, 'consent recording failed');
    }

    await notify(user.id, 'application_submitted', 'Application received', 'Your creator application is in review — we\'ll notify you the moment there\'s a decision.');
    return reply.code(201).send({ status: 'in_review' });
  });

  app.get('/v1/creator/me', async (request, reply) => {
    const user = requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('creator_profiles')
      .select('vetting_status, background_check_status, specialties, verified, base_area, service_radius_km, availability, blocked_dates')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'No creator application' });
    return data;
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
        })),
      };
    },
  );

  // Stopgap admin approval until the Admin Portal (Phase 5). Guarded by
  // ADMIN_API_TOKEN; disabled when unset.
  app.post<{ Params: { userId: string }; Body: { background_check_passed?: boolean } }>(
    '/v1/admin/creators/:userId/approve',
    async (request, reply) => {
      if (!env.adminApiToken) return reply.code(503).send({ error: 'Admin actions disabled' });
      if (request.headers['x-admin-token'] !== env.adminApiToken) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
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
      return { status: 'approved' };
    },
  );

  // §9: strikes are admin-visible only (plus the tier notification). Full
  // per-creator history + overturn, stopgap until the Admin Portal (Phase 5).
  app.get<{ Params: { userId: string } }>(
    '/v1/admin/creators/:userId/strikes',
    async (request, reply) => {
      if (!env.adminApiToken) return reply.code(503).send({ error: 'Admin actions disabled' });
      if (request.headers['x-admin-token'] !== env.adminApiToken) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
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
      if (!env.adminApiToken) return reply.code(503).send({ error: 'Admin actions disabled' });
      if (request.headers['x-admin-token'] !== env.adminApiToken) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { error } = await supabaseAdmin
        .from('strikes')
        .update({ overturned: true })
        .eq('id', request.params.strikeId);
      if (error) return reply.code(500).send({ error: error.message });
      return { overturned: true };
    },
  );
}
