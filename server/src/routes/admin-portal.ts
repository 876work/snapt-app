import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { configNumber } from '../config.js';

// Admin Portal rebuild — API surface for the SPA at /admin. Everything here
// is read-heavy composition over the same data model the apps use; all
// consequential writes stay on their existing audited endpoints.

/** Bulk profile lookup: id → { name, email } for embedding into lists. */
async function profileMap(ids: string[]): Promise<Map<string, { name: string; email: string | null }>> {
  const map = new Map<string, { name: string; email: string | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return map;
  const { data } = await supabaseAdmin.from('profiles').select('id, full_name, email').in('id', unique);
  for (const p of data ?? []) map.set(p.id, { name: p.full_name, email: p.email });
  return map;
}

export function registerAdminPortalRoutes(app: FastifyInstance) {
  // Who am I — the SPA validates its stored token and learns its role here.
  app.get('/v1/admin/me', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support', 'moderator']);
    if (!admin) return;
    if (admin.id === 'bootstrap-token') {
      return { admin_id: admin.id, role: admin.role, name: 'Bootstrap token', email: null };
    }
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email')
      .eq('id', admin.id)
      .maybeSingle();
    return { admin_id: admin.id, role: admin.role, name: data?.full_name ?? '', email: data?.email ?? null };
  });

  // The Today screen: everything live or needing a decision, one round trip
  // (Render cold starts make request count matter).
  app.get('/v1/admin/today', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const graceMinutes = await configNumber('no_show_grace_minutes', 15);

    // Unresolved safety/ops alerts, SOS first, unacknowledged before acked.
    const { data: alertRows } = await supabaseAdmin
      .from('admin_alerts')
      .select('*')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    const priority = (t: string) => (t === 'sos' ? 0 : t === 'session_ended_safety' ? 1 : 2);
    const alerts = (alertRows ?? []).sort(
      (a, b) => priority(a.alert_type) - priority(b.alert_type) || Number(Boolean(a.acknowledged_at)) - Number(Boolean(b.acknowledged_at)),
    );

    // Sessions running right now.
    const { data: activeRows } = await supabaseAdmin
      .from('sessions')
      .select('id, booking_id, session_active_at, client_checked_in_at, creator_checked_in_at, bookings!inner(id, occasion, area, type, scheduled_at, duration_hours, price_usd, client_id, creator_id)')
      .not('session_active_at', 'is', null)
      .is('session_ended_at', null);

    // Confirmed bookings around now: future ones are "starting soon / en
    // route" (with per-party check-in state); past-start ones without an
    // active session are in or past the no-show grace window.
    const { data: windowRows } = await supabaseAdmin
      .from('bookings')
      .select('id, occasion, area, type, scheduled_at, duration_hours, price_usd, client_id, creator_id')
      .eq('status', 'confirmed')
      .not('scheduled_at', 'is', null)
      .gte('scheduled_at', new Date(now - 24 * 3600_000).toISOString())
      .lte('scheduled_at', new Date(now + 12 * 3600_000).toISOString())
      .order('scheduled_at', { ascending: true });
    const windowIds = (windowRows ?? []).map((b) => b.id);
    const sessionByBooking = new Map<string, Record<string, unknown>>();
    if (windowIds.length) {
      const { data: sess } = await supabaseAdmin
        .from('sessions')
        .select('booking_id, client_checked_in_at, creator_checked_in_at, session_active_at, session_ended_at')
        .in('booking_id', windowIds);
      for (const s of sess ?? []) sessionByBooking.set(s.booking_id, s);
    }
    const upcoming: Record<string, unknown>[] = [];
    const grace: Record<string, unknown>[] = [];
    for (const b of windowRows ?? []) {
      const s = sessionByBooking.get(b.id) as { session_active_at?: string; session_ended_at?: string; client_checked_in_at?: string; creator_checked_in_at?: string } | undefined;
      if (s?.session_active_at) continue; // running or already ended — not a start-time concern
      const startsAt = Date.parse(b.scheduled_at);
      const entry = {
        ...b,
        client_checked_in_at: s?.client_checked_in_at ?? null,
        creator_checked_in_at: s?.creator_checked_in_at ?? null,
        grace_ends_at: new Date(startsAt + graceMinutes * 60_000).toISOString(),
      };
      if (startsAt > now) upcoming.push(entry);
      else grace.push(entry);
    }

    // Offers awaiting creator acceptance, with their countdown deadline.
    const { data: offerRows } = await supabaseAdmin
      .from('bookings')
      .select('id, occasion, area, type, scheduled_at, price_usd, client_id, creator_id, offer_expires_at')
      .eq('status', 'pending')
      .not('creator_id', 'is', null)
      .gt('offer_expires_at', nowIso)
      .order('offer_expires_at', { ascending: true });

    // Decision queues — counts only; each links to its own screen.
    const count = async (table: string, filter: (q: any) => any) =>
      (await filter(supabaseAdmin.from(table).select('*', { count: 'exact', head: true }))).count ?? 0;
    const { data: payoutRows } = await supabaseAdmin
      .from('creator_payouts')
      .select('creator_id, amount_usd')
      .eq('status', 'requested');
    const payoutTotal = Math.round((payoutRows ?? []).reduce((s, r) => s + Number(r.amount_usd), 0) * 100) / 100;
    const decisions = {
      payouts: { creators: new Set((payoutRows ?? []).map((r) => r.creator_id)).size, total_usd: payoutTotal },
      applications: await count('creator_profiles', (q) => q.eq('vetting_status', 'in_review')),
      open_disputes: await count('disputes', (q) => q.not('status', 'in', '(resolved,closed)')),
      unassigned_bookings: await count('bookings', (q) => q.eq('status', 'pending').is('creator_id', null)),
      moderation_reports: await count('content_reports', (q) => q.eq('status', 'open')),
      portfolio_pending: await count('portfolio_items', (q) => q.eq('status', 'pending')),
    };

    // Names for every participant referenced above, plus acknowledgers.
    const ids: string[] = [];
    for (const r of activeRows ?? []) {
      const embed = r.bookings as unknown;
      const b = (Array.isArray(embed) ? embed[0] : embed) as { client_id: string; creator_id: string | null };
      if (b) ids.push(b.client_id, b.creator_id ?? '');
    }
    for (const b of [...(windowRows ?? []), ...(offerRows ?? [])]) ids.push(b.client_id, b.creator_id ?? '');
    for (const a of alerts) if (a.acknowledged_by) ids.push(a.acknowledged_by);
    const names = await profileMap(ids);
    const withNames = <T extends { client_id?: string; creator_id?: string | null }>(row: T) => ({
      ...row,
      client_name: row.client_id ? names.get(row.client_id)?.name ?? null : null,
      creator_name: row.creator_id ? names.get(row.creator_id)?.name ?? null : null,
    });

    return {
      server_time: nowIso,
      grace_minutes: graceMinutes,
      alerts: alerts.map((a) => ({
        ...a,
        acknowledged_by_name: a.acknowledged_by ? names.get(a.acknowledged_by)?.name ?? null : null,
      })),
      active_sessions: (activeRows ?? []).map((r) => {
        // supabase-js types a to-one embed as an array; at runtime it's an object.
        const { bookings: booking, ...session } = r as unknown as Record<string, unknown> & { bookings: Record<string, unknown> };
        const one = (Array.isArray(booking) ? booking[0] : booking) as { client_id: string; creator_id: string | null };
        return { ...session, booking: withNames(one) };
      }),
      upcoming: upcoming.map(withNames),
      grace_watch: grace.map(withNames),
      offers: (offerRows ?? []).map(withNames),
      decisions,
    };
  });

  // Explicit safety-alert acknowledgement: first acknowledger wins the
  // stamp; resolution stays a separate, later act.
  app.post<{ Params: { id: string } }>('/v1/admin/alerts/:id/ack', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const { data, error } = await supabaseAdmin
      .from('admin_alerts')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: admin.id === 'bootstrap-token' ? null : admin.id,
      })
      .eq('id', request.params.id)
      .is('acknowledged_at', null)
      .select('id, acknowledged_at, acknowledged_by')
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(409).send({ error: 'Already acknowledged' });
    await audit(admin, 'alert_acknowledged', request.params.id);
    return { acknowledged: true, acknowledged_at: data.acknowledged_at };
  });

  // Searchable audit log. Every consequential action already lands in
  // admin_actions via audit(); this is the read side.
  app.get<{ Querystring: { q?: string; action?: string; before?: string; limit?: string } }>(
    '/v1/admin/audit',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const limit = Math.min(Math.max(Number(request.query.limit) || 50, 1), 200);
      let query = supabaseAdmin
        .from('admin_actions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (request.query.action) query = query.eq('action', request.query.action);
      if (request.query.before) query = query.lt('created_at', request.query.before);
      const q = request.query.q?.trim().replace(/[,()%]/g, ' ').trim();
      if (q) query = query.or(`action.ilike.%${q}%,target.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      const names = await profileMap((data ?? []).map((r) => r.admin_id));
      return {
        entries: (data ?? []).map((r) => ({ ...r, admin_name: names.get(r.admin_id)?.name ?? null })),
      };
    },
  );

  // Global search: one box for users, creators, and booking references.
  app.get<{ Querystring: { q?: string } }>('/v1/admin/search', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const raw = request.query.q?.trim() ?? '';
    if (raw.length < 2) return { users: [], bookings: [] };
    const q = raw.replace(/[,()%]/g, ' ').trim();

    const { data: userRows } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, suspended_at, created_at')
      .or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(10);
    const userIds = (userRows ?? []).map((u) => u.id);
    const creatorByUser = new Map<string, { vetting_status: string; verified: boolean }>();
    if (userIds.length) {
      const { data: creators } = await supabaseAdmin
        .from('creator_profiles')
        .select('user_id, vetting_status, verified')
        .in('user_id', userIds);
      for (const c of creators ?? []) creatorByUser.set(c.user_id, c);
    }
    const users = (userRows ?? []).map((u) => ({
      ...u,
      creator: creatorByUser.get(u.id) ?? null,
    }));

    // Booking references are uuids — match on hex-ish prefixes only.
    let bookings: Record<string, unknown>[] = [];
    if (/^[0-9a-f-]{4,36}$/i.test(raw)) {
      const { data: rows } = await supabaseAdmin.rpc('admin_booking_id_search', { prefix: raw.toLowerCase() });
      const names = await profileMap((rows ?? []).flatMap((b: { client_id: string; creator_id: string | null }) => [b.client_id, b.creator_id ?? '']));
      bookings = (rows ?? []).map((b: Record<string, unknown>) => ({
        id: b.id,
        status: b.status,
        occasion: b.occasion,
        type: b.type,
        area: b.area,
        scheduled_at: b.scheduled_at,
        price_usd: b.price_usd,
        client_name: names.get(b.client_id as string)?.name ?? null,
        creator_name: b.creator_id ? names.get(b.creator_id as string)?.name ?? null : null,
      }));
    }
    return { users, bookings };
  });
}
