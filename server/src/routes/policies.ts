import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { notify } from '../notify.js';

// Phase 6 legal CMS (§14): draft vs published, version history, forced
// re-consent on material changes to the two active-consent docs.

const CONSENT_DOCS = ['creator-agreement', 'background-check'];

async function latestPublished(slug: string) {
  const { data } = await supabaseAdmin
    .from('policy_documents')
    .select('*')
    .eq('doc_type', slug)
    .eq('status', 'published')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export function registerPolicyRoutes(app: FastifyInstance) {
  // Public: latest published per type (Legal list + policy screens).
  app.get('/v1/policies', async () => {
    const { data } = await supabaseAdmin
      .from('policy_documents')
      .select('doc_type, version, title, published_at')
      .eq('status', 'published')
      .order('version', { ascending: false });
    const seen = new Map<string, unknown>();
    for (const d of data ?? []) if (!seen.has(d.doc_type)) seen.set(d.doc_type, d);
    return { policies: [...seen.values()] };
  });
  app.get<{ Params: { slug: string } }>('/v1/policies/:slug', async (request, reply) => {
    const doc = await latestPublished(request.params.slug);
    if (!doc) return reply.code(404).send({ error: 'No published version' });
    return { policy: doc };
  });

  // Creators needing re-consent: latest published reconsent-doc version has
  // no consent_records row for this user.
  app.get('/v1/creator/reconsent-needed', async (request, reply) => {
    const user = requireUser(request);
    const needed: { doc_type: string; version: number; title: string }[] = [];
    for (const slug of CONSENT_DOCS) {
      const doc = await latestPublished(slug);
      if (!doc || !doc.requires_reconsent) continue;
      const { data: consent } = await supabaseAdmin
        .from('consent_records')
        .select('id')
        .eq('user_id', user.id)
        .eq('policy_document_id', doc.id)
        .maybeSingle();
      if (!consent) needed.push({ doc_type: doc.doc_type, version: doc.version, title: doc.title });
    }
    return { needed };
  });
  app.post<{ Body: { doc_type?: string } }>('/v1/creator/reconsent', async (request, reply) => {
    const user = requireUser(request);
    const slug = request.body?.doc_type;
    if (!slug || !CONSENT_DOCS.includes(slug)) {
      return reply.code(400).send({ error: 'doc_type must be creator-agreement or background-check' });
    }
    const doc = await latestPublished(slug);
    if (!doc) return reply.code(404).send({ error: 'No published version' });
    const { error } = await supabaseAdmin.from('consent_records').insert({
      user_id: user.id,
      policy_document_id: doc.id,
      doc_type: doc.doc_type,
      version: doc.version,
    });
    if (error && error.code !== '23505') return reply.code(500).send({ error: error.message });
    return { consented: true, version: doc.version };
  });

  // Admin: version history, new draft version, explicit publish (§14 —
  // edits never go live until published).
  app.get('/v1/admin/policies', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('policy_documents')
      .select('id, doc_type, version, title, status, published_at, requires_reconsent, created_at')
      .order('doc_type')
      .order('version', { ascending: false });
    return { policies: data ?? [] };
  });
  app.post<{ Params: { slug: string }; Body: { title?: string; content?: string; requires_reconsent?: boolean } }>(
    '/v1/admin/policies/:slug',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const { content, title, requires_reconsent } = request.body ?? {};
      if (!content) return reply.code(400).send({ error: 'content required' });
      const { data: latest } = await supabaseAdmin
        .from('policy_documents')
        .select('version, title')
        .eq('doc_type', request.params.slug)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: doc, error } = await supabaseAdmin
        .from('policy_documents')
        .insert({
          doc_type: request.params.slug,
          version: (latest?.version ?? 0) + 1,
          title: title ?? latest?.title ?? request.params.slug,
          content,
          status: 'draft',
          requires_reconsent: requires_reconsent ?? false,
        })
        .select()
        .single();
      if (error) return reply.code(500).send({ error: error.message });
      await audit(adminId, 'policy_draft_created', `${request.params.slug} v${doc.version}`);
      return reply.code(201).send({ policy: doc });
    },
  );
  app.post<{ Params: { id: string } }>('/v1/admin/policies/:id/publish', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data: doc } = await supabaseAdmin
      .from('policy_documents')
      .select('*')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!doc) return reply.code(404).send({ error: 'Not found' });
    if (doc.status === 'published') return reply.code(409).send({ error: 'Already published' });
    await supabaseAdmin
      .from('policy_documents')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', doc.id);
    await audit(adminId, 'policy_published', `${doc.doc_type} v${doc.version}`, {
      requires_reconsent: doc.requires_reconsent,
    });
    // §14 forced re-consent: material change to an active-consent doc
    // prompts every approved creator to re-accept (they're blocked from
    // silently continuing on the old terms).
    if (doc.requires_reconsent && CONSENT_DOCS.includes(doc.doc_type)) {
      const { data: creators } = await supabaseAdmin
        .from('creator_profiles')
        .select('user_id')
        .eq('vetting_status', 'approved');
      for (const c of creators ?? []) {
        await notify(c.user_id, 'reconsent_required', `${doc.title} has changed`,
          'A material update to your agreement needs your review and acceptance — open the app to re-accept before taking new bookings.');
      }
    }
    return { published: true, version: doc.version };
  });
}
