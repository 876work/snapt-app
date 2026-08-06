import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { notify } from '../notify.js';
import { sendEmail } from '../email.js';
import { configNumber } from '../config.js';
import { createDownloadUrl, createUploadTarget } from '../storage.js';

// Tiered moderation (Policy 04 §6 per Don's confirmed table, 2026-07-29):
//   child_safety        → critical: instant suspension, real-time escalation,
//                          law-enforcement-referral tracking
//   sexual_violent_hate → high: content removed, suspended pending review
//   content_policy      → medium: content held, warning; suspension on repeat
//   general             → low: queued only
// Moderators can adjust the tier on review.

const SEVERITY: Record<string, string> = {
  child_safety: 'critical',
  sexual_violent_hate: 'high',
  content_policy: 'medium',
  general: 'low',
};

const ONCALL = (process.env.ONCALL_EMAILS ?? '').split(',').map((s: string) => s.trim()).filter(Boolean);

export async function suspendUser(userId: string, reason: string): Promise<void> {
  await supabaseAdmin.from('profiles').update({ suspended_at: new Date().toISOString() }).eq('id', userId);
  // Creators additionally drop out of matching via vetting_status.
  await supabaseAdmin.from('creator_profiles').update({ vetting_status: 'suspended' }).eq('user_id', userId);
  await notify(userId, 'suspension_applied', 'Your account is suspended',
    `Reason: ${reason}. Contact hello@snaptcarib.app to respond.`);
}

export function registerModerationRoutes(app: FastifyInstance) {
  app.post<{ Body: { category?: string; details?: string; target_user_id?: string; booking_id?: string; media_id?: string } }>(
    '/v1/reports',
    async (request, reply) => {
      const user = requireUser(request);
      const { category, details, target_user_id, booking_id, media_id } = request.body ?? {};
      if (!category || !(category in SEVERITY)) {
        return reply.code(400).send({ error: `category must be one of ${Object.keys(SEVERITY).join(', ')}` });
      }
      const severity = SEVERITY[category];
      const { data: report, error } = await supabaseAdmin
        .from('content_reports')
        .insert({
          reporter_id: user.id,
          target_user_id: target_user_id ?? null,
          booking_id: booking_id ?? null,
          media_id: media_id ?? null,
          category,
          severity,
          details: details ?? null,
          law_enforcement_referral: severity === 'critical',
        })
        .select()
        .single();
      if (error) return reply.code(500).send({ error: error.message });

      // Consequence automation by tier.
      if ((severity === 'high' || severity === 'medium') && media_id) {
        // Content removed/held where applicable: registry row deleted so it
        // is unreachable (storage object cleanup is an ops task).
        await supabaseAdmin.from('booking_media').delete().eq('id', media_id);
      }
      if (severity === 'critical' && target_user_id) {
        await suspendUser(target_user_id, 'critical safety report under review');
      } else if (severity === 'high' && target_user_id) {
        await suspendUser(target_user_id, 'content policy violation pending review');
      } else if (severity === 'medium' && target_user_id) {
        const { count } = await supabaseAdmin
          .from('content_reports')
          .select('*', { count: 'exact', head: true })
          .eq('target_user_id', target_user_id)
          .neq('status', 'dismissed')
          .neq('id', report.id);
        if ((count ?? 0) > 0) {
          await suspendUser(target_user_id, 'repeat content policy violation');
        } else {
          await notify(target_user_id, 'strike_issued', 'Content policy warning',
            'Content you posted was held for violating the Content & Usage Policy. A repeat violation leads to suspension.');
        }
      }

      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: severity === 'critical' ? 'moderation_critical' : 'moderation',
        booking_id: booking_id ?? null,
        detail: { report_id: report.id, category, severity, target_user_id },
      });
      if (severity === 'critical') {
        for (const to of ONCALL) {
          await sendEmail(to, '🚨 CRITICAL moderation report — immediate attention',
            `<p>Category: ${category}. Target: ${target_user_id ?? 'n/a'}. Report ${report.id}.</p><p>Account suspended automatically; law-enforcement referral tracking is ON.</p>`);
        }
      }
      await notify(user.id, 'safety_report_received', 'We got your report',
        'Our moderation team has been alerted and is reviewing it now.');
      return reply.code(201).send({ report_id: report.id, severity });
    },
  );

  // Presigned upload target for a portfolio image. Creators only — the
  // private 'portfolio' bucket mirrors the booking-media pipeline.
  app.post<{ Body: { filename?: string; content_type?: string } }>(
    '/v1/creator/portfolio/upload-url',
    async (request, reply) => {
      const user = requireUser(request);
      const { filename, content_type } = request.body ?? {};
      if (!filename) return reply.code(400).send({ error: 'filename is required' });
      const { data: cp } = await supabaseAdmin
        .from('creator_profiles')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cp) return reply.code(403).send({ error: 'Creator profile required' });
      const safeName = filename.replace(/[^\w.\-]/g, '_');
      const path = `${user.id}/${Date.now()}-${safeName}`;
      return createUploadTarget('portfolio', path, content_type ?? 'application/octet-stream');
    },
  );

  // A creator's own portfolio, every status, with signed image URLs.
  app.get('/v1/creator/portfolio', async (request) => {
    const user = requireUser(request);
    const { data } = await supabaseAdmin
      .from('portfolio_items')
      .select('id, caption, storage_path, status, created_at')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false });
    const items = await Promise.all(
      (data ?? []).map(async (item) => ({
        id: item.id,
        caption: item.caption,
        status: item.status,
        created_at: item.created_at,
        url: item.storage_path
          ? await createDownloadUrl('portfolio', item.storage_path).catch(() => null)
          : null,
      })),
    );
    return { items };
  });

  // Portfolio submissions: first N need approval, then auto-publish.
  app.post<{ Body: { caption?: string; storage_path?: string } }>('/v1/creator/portfolio', async (request, reply) => {
    const user = requireUser(request);
    const { data: cp } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!cp) return reply.code(403).send({ error: 'Creator profile required' });
    const threshold = await configNumber('portfolio_preapproval_count', 3);
    const { count } = await supabaseAdmin
      .from('portfolio_items')
      .select('*', { count: 'exact', head: true })
      .eq('creator_id', user.id)
      .in('status', ['approved', 'auto']);
    const status = (count ?? 0) >= threshold ? 'auto' : 'pending';
    const { data, error } = await supabaseAdmin
      .from('portfolio_items')
      .insert({ creator_id: user.id, caption: request.body?.caption ?? null, storage_path: request.body?.storage_path ?? null, status })
      .select()
      .single();
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(201).send({ item: data, published: status === 'auto' });
  });

  // Unsuspend: lifts both the profile flag and creator vetting status,
  // required reason, audited — so reversing a bad critical/high suspension
  // never needs direct DB access.
  app.post<{ Params: { userId: string }; Body: { reason?: string } }>(
    '/v1/admin/users/:userId/unsuspend',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply, ['admin', 'moderator']);
      if (!adminId) return;
      const reason = request.body?.reason?.trim();
      if (!reason) return reply.code(400).send({ error: 'reason is required' });
      await supabaseAdmin.from('profiles').update({ suspended_at: null }).eq('id', request.params.userId);
      const { data: cp } = await supabaseAdmin
        .from('creator_profiles')
        .select('vetting_status')
        .eq('user_id', request.params.userId)
        .maybeSingle();
      if (cp?.vetting_status === 'suspended') {
        await supabaseAdmin
          .from('creator_profiles')
          .update({ vetting_status: 'approved' })
          .eq('user_id', request.params.userId);
      }
      // Visibility-only false-report signal: lifting a suspension caused by
      // critical/high reports counts against each reporter, once per report
      // (false_counted_at guards repeat suspend/unsuspend cycles). No
      // automated consequence — this surfaces in the portal queue for a
      // human to notice.
      const { data: overturned } = await supabaseAdmin
        .from('content_reports')
        .select('id, reporter_id')
        .eq('target_user_id', request.params.userId)
        .in('severity', ['critical', 'high'])
        .is('false_counted_at', null);
      for (const report of overturned ?? []) {
        const { data: reporter } = await supabaseAdmin
          .from('profiles')
          .select('false_report_count')
          .eq('id', report.reporter_id)
          .maybeSingle();
        await supabaseAdmin
          .from('profiles')
          .update({ false_report_count: (reporter?.false_report_count ?? 0) + 1 })
          .eq('id', report.reporter_id);
        await supabaseAdmin
          .from('content_reports')
          .update({ false_counted_at: new Date().toISOString() })
          .eq('id', report.id);
      }
      await audit(adminId, 'user_unsuspended', request.params.userId, {
        reason,
        overturned_reports: (overturned ?? []).length,
      });
      await notify(request.params.userId, 'dispute_resolved', 'Your account is reinstated',
        'The suspension on your account has been lifted after review. Welcome back.');
      return { unsuspended: true };
    },
  );

  // Admin moderation queue: severity-sorted reports + pending portfolio.
  app.get('/v1/admin/moderation', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'moderator']);
    if (!adminId) return;
    const { data: reports } = await supabaseAdmin
      .from('content_reports')
      .select('*')
      .eq('status', 'open');
    // Reviewing admins see the reporter's overturned-report history inline —
    // the false-report signal is per-reporter, shown wherever their reports
    // appear.
    const reporterIds = [...new Set((reports ?? []).map((r) => r.reporter_id))];
    const counts = new Map<string, number>();
    if (reporterIds.length) {
      const { data: reporters } = await supabaseAdmin
        .from('profiles')
        .select('id, false_report_count')
        .in('id', reporterIds);
      for (const p of reporters ?? []) counts.set(p.id, p.false_report_count ?? 0);
    }
    const enriched = (reports ?? []).map((r) => ({
      ...r,
      reporter_false_report_count: counts.get(r.reporter_id) ?? 0,
    }));
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const { data: portfolio } = await supabaseAdmin
      .from('portfolio_items')
      .select('id, creator_id, caption, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    return {
      reports: enriched.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9)),
      portfolio_pending: portfolio ?? [],
    };
  });
  app.post<{ Params: { id: string }; Body: { action?: string; severity?: string } }>(
    '/v1/admin/reports/:id',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply, ['admin', 'moderator']);
      if (!adminId) return;
      const { action, severity } = request.body ?? {};
      const patch: Record<string, unknown> = { reviewed_by: adminId.id === 'bootstrap-token' ? null : adminId.id, reviewed_at: new Date().toISOString() };
      if (severity && ['critical', 'high', 'medium', 'low'].includes(severity)) patch.severity = severity;
      if (action === 'actioned' || action === 'dismissed') patch.status = action;
      await supabaseAdmin.from('content_reports').update(patch).eq('id', request.params.id);
      await audit(adminId, 'moderation_review', request.params.id, { action, severity });
      return { updated: true };
    },
  );
  app.post<{ Params: { id: string }; Body: { decision?: 'approved' | 'rejected' } }>(
    '/v1/admin/portfolio/:id',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply, ['admin', 'moderator']);
      if (!adminId) return;
      const decision = request.body?.decision;
      if (decision !== 'approved' && decision !== 'rejected') {
        return reply.code(400).send({ error: 'decision must be approved or rejected' });
      }
      await supabaseAdmin.from('portfolio_items').update({ status: decision }).eq('id', request.params.id);
      await audit(adminId, 'portfolio_' + decision, request.params.id);
      return { updated: true };
    },
  );
}
