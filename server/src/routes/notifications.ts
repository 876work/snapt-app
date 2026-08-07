import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { sendPromotion } from '../notify.js';

/**
 * The notification INBOX.
 *
 * The inbox is the record; push is an alert on top of it. Rows are written by
 * notify() whether or not any device ever hears about them, so a denied
 * permission, a dead token or an offline phone never loses the fact that a
 * booking was confirmed.
 *
 * These endpoints are the read side, which did not exist: the server has been
 * writing inbox rows since day one and nothing has ever read them back.
 */

const CATEGORY_BY_TAB: Record<string, string[]> = {
  bookings: ['bookings'],
  messages: ['messages'],
  promotions: ['promotions'],
  // 'account' and 'safety' are money/identity/safety events. They have no tab
  // of their own by design — they appear under All, flagged critical.
  all: [],
};

export function registerNotificationRoutes(app: FastifyInstance): void {
  /** The inbox list, newest first, with the unread count for the tab badge. */
  app.get<{ Querystring: { tab?: string; limit?: string; before?: string } }>(
    '/v1/notifications',
    async (request) => {
      const user = requireUser(request);
      const tab = (request.query.tab ?? 'all').toLowerCase();
      const limit = Math.min(Number(request.query.limit ?? 50), 100);

      let query = supabaseAdmin
        .from('notifications')
        .select('id, trigger_type, category, title, body, data, read_at, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);
      const cats = CATEGORY_BY_TAB[tab] ?? [];
      if (cats.length) query = query.in('category', cats);
      if (request.query.before) query = query.lt('created_at', request.query.before);

      const [{ data, error }, { count }] = await Promise.all([
        query,
        supabaseAdmin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .is('read_at', null),
      ]);
      if (error) throw new Error(error.message);
      return { notifications: data ?? [], unread: count ?? 0 };
    },
  );

  /** Unread count alone — cheap enough to poll for the tab-bar badge. */
  app.get('/v1/notifications/unread', async (request) => {
    const user = requireUser(request);
    const { count } = await supabaseAdmin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('read_at', null);
    return { unread: count ?? 0 };
  });

  /** Mark specific rows read, or everything. Idempotent either way. */
  app.post<{ Body: { ids?: string[]; all?: boolean } }>(
    '/v1/notifications/read',
    async (request, reply) => {
      const user = requireUser(request);
      const { ids, all } = request.body ?? {};
      if (!all && (!Array.isArray(ids) || ids.length === 0)) {
        return reply.code(400).send({ error: 'ids or all is required' });
      }
      let update = supabaseAdmin
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('read_at', null);
      if (!all) update = update.in('id', ids as string[]);
      const { error } = await update;
      if (error) return reply.code(500).send({ error: error.message });
      const { count } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('read_at', null);
      return { ok: true, unread: count ?? 0 };
    },
  );

  // ---- Admin: promotional sends ------------------------------------------

  /**
   * Audience preview. Deliberately a separate call so an admin sees the real
   * number BEFORE sending, and so the count and the send use identical rules.
   */
  app.get<{ Querystring: { audience?: string } }>(
    '/v1/admin/promotions/audience',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const recipients = await promotionAudience(request.query.audience ?? 'all');
      return {
        audience: request.query.audience ?? 'all',
        total: recipients.length,
        with_push: recipients.filter((r) => r.hasToken).length,
      };
    },
  );

  /**
   * Send a promotion through the SAME pipeline as everything else: inbox row
   * first, then push. This is the whole point — a Firebase console send
   * bypasses the server, so it can never appear in the inbox.
   */
  app.post<{ Body: { title?: string; body?: string; audience?: string; deep_link?: string } }>(
    '/v1/admin/promotions/send',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const title = request.body?.title?.trim();
      const body = request.body?.body?.trim();
      if (!title || !body) return reply.code(400).send({ error: 'title and body are required' });
      if (title.length > 80) return reply.code(400).send({ error: 'Title must be 80 characters or fewer' });

      const audience = request.body?.audience ?? 'all';
      const recipients = await promotionAudience(audience);
      if (recipients.length === 0) {
        return reply.code(409).send({ error: 'That audience has nobody in it right now' });
      }

      const result = await sendPromotion(
        recipients.map((r) => r.id),
        title,
        body,
        request.body?.deep_link,
      );

      await audit(admin, 'promotion_sent', undefined, {
        audience,
        recipients: recipients.length,
        pushed: result.pushed,
        title,
      });
      return { sent: true, recipients: recipients.length, pushed: result.pushed };
    },
  );
}

interface Recipient {
  id: string;
  hasToken: boolean;
}

/**
 * Who receives a promotion.
 *
 * Opted out of promotions => EXCLUDED here, before anything is written. The
 * rule is that a user who turned promotions off gets no promotional record
 * and no promotional push — not a record they never asked for with the push
 * suppressed.
 *
 * Suspended and deleted accounts are excluded too: marketing to someone whose
 * account we have restricted is a bad look at best.
 */
async function promotionAudience(audience: string): Promise<Recipient[]> {
  const { data: profiles } = await supabaseAdmin
    .from('profiles')
    .select('id, notification_prefs, suspended_at, deleted_at')
    .is('suspended_at', null)
    .is('deleted_at', null);

  let eligible = (profiles ?? []).filter((p) => {
    const prefs = (p.notification_prefs ?? {}) as Record<string, boolean>;
    return prefs.promotions !== false;
  });

  if (audience === 'creators' || audience === 'clients') {
    const { data: creators } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id')
      .eq('vetting_status', 'approved');
    const creatorIds = new Set((creators ?? []).map((c) => c.user_id as string));
    eligible = eligible.filter((p) =>
      audience === 'creators' ? creatorIds.has(p.id) : !creatorIds.has(p.id),
    );
  }

  const { data: tokens } = await supabaseAdmin.from('push_tokens').select('user_id');
  const withToken = new Set((tokens ?? []).map((t) => t.user_id as string));
  return eligible.map((p) => ({ id: p.id as string, hasToken: withToken.has(p.id as string) }));
}
