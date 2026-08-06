import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { configNumber } from '../config.js';
import { suspendUser } from './moderation.js';
import { creatorStanding } from '../strikes.js';
import { eligibleCreators } from '../availability.js';

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

  // Bookings: the full ledger. `unassigned=true` is the manual-dispatch
  // queue (pending, no creator) — the Assign action lives on the detail.
  app.get<{ Querystring: { status?: string; unassigned?: string; before?: string; limit?: string } }>(
    '/v1/admin/bookings',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const limit = Math.min(Math.max(Number(request.query.limit) || 40, 1), 100);
      let query = supabaseAdmin
        .from('bookings')
        .select('id, status, occasion, type, area, scheduled_at, duration_hours, price_usd, client_id, creator_id, legal_hold, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (request.query.unassigned === 'true') {
        query = query.eq('status', 'pending').is('creator_id', null);
      } else if (request.query.status) {
        query = query.eq('status', request.query.status);
      }
      if (request.query.before) query = query.lt('created_at', request.query.before);
      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      const names = await profileMap((data ?? []).flatMap((b) => [b.client_id, b.creator_id ?? '']));
      return {
        bookings: (data ?? []).map((b) => ({
          ...b,
          client_name: names.get(b.client_id)?.name ?? null,
          creator_name: b.creator_id ? names.get(b.creator_id)?.name ?? null : null,
        })),
      };
    },
  );

  // One booking's full story. When it's dispatchable, the eligible-creator
  // list rides along so Assign needs no second request.
  app.get<{ Params: { id: string } }>('/v1/admin/bookings/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const id = request.params.id;
    const { data: booking, error } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!booking) return reply.code(404).send({ error: 'No such booking' });

    const [{ data: session }, { data: txRows }, { data: disputeRows }, { data: mediaRows }, { data: revisionRows }, { data: actionRows }] =
      await Promise.all([
        supabaseAdmin.from('sessions').select('*').eq('booking_id', id).maybeSingle(),
        supabaseAdmin.from('transactions').select('id, user_id, type, status, amount_usd, created_at').eq('booking_id', id).order('created_at', { ascending: true }),
        supabaseAdmin.from('disputes').select('id, opened_by, category, status, resolution, created_at, resolved_at').eq('booking_id', id),
        supabaseAdmin.from('booking_media').select('id, kind, content_type, deleted_at, created_at').eq('booking_id', id),
        supabaseAdmin.from('revision_requests').select('id, status, notes, created_at').eq('booking_id', id).order('created_at', { ascending: true }),
        supabaseAdmin.from('admin_actions').select('id, admin_id, action, detail, created_at').eq('target', id).order('created_at', { ascending: false }).limit(20),
      ]);

    const dispatchable = booking.status === 'pending' && !booking.creator_id;
    const eligible = dispatchable
      ? (await eligibleCreators(booking.occasion, booking.area ?? undefined)).slice(0, 25)
      : [];

    const media_summary = {
      total: (mediaRows ?? []).length,
      deliverables: (mediaRows ?? []).filter((m) => m.kind === 'deliverable' && !m.deleted_at).length,
      deleted: (mediaRows ?? []).filter((m) => m.deleted_at).length,
    };

    const names = await profileMap([
      booking.client_id,
      booking.creator_id ?? '',
      ...(disputeRows ?? []).map((d) => d.opened_by),
      ...(actionRows ?? []).map((a) => a.admin_id),
      ...(booking.declined_creator_ids ?? []),
    ]);
    return {
      booking: {
        ...booking,
        client_name: names.get(booking.client_id)?.name ?? null,
        creator_name: booking.creator_id ? names.get(booking.creator_id)?.name ?? null : null,
        declined_creators: (booking.declined_creator_ids ?? []).map((cid: string) => names.get(cid)?.name ?? cid.slice(0, 8)),
      },
      session: session ?? null,
      transactions: txRows ?? [],
      disputes: (disputeRows ?? []).map((d) => ({ ...d, opened_by_name: names.get(d.opened_by)?.name ?? null })),
      media_summary,
      revisions: revisionRows ?? [],
      admin_history: (actionRows ?? []).map((a) => ({ ...a, admin_name: names.get(a.admin_id)?.name ?? null })),
      eligible_creators: eligible,
    };
  });

  // Customer lookup: list/search. Default view is recent signups; a query
  // searches name/email/phone the same way global search does.
  app.get<{ Querystring: { q?: string; before?: string; limit?: string } }>(
    '/v1/admin/users',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin', 'support']);
      if (!admin) return;
      const limit = Math.min(Math.max(Number(request.query.limit) || 30, 1), 100);
      let query = supabaseAdmin
        .from('profiles')
        .select('id, full_name, email, phone, mode, created_at, suspended_at, false_report_count')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (request.query.before) query = query.lt('created_at', request.query.before);
      const q = request.query.q?.trim().replace(/[,()%]/g, ' ').trim();
      if (q) query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%`);
      const { data, error } = await query;
      if (error) return reply.code(500).send({ error: error.message });
      const ids = (data ?? []).map((u) => u.id);
      const creatorByUser = new Map<string, { vetting_status: string; verified: boolean }>();
      if (ids.length) {
        const { data: creators } = await supabaseAdmin
          .from('creator_profiles')
          .select('user_id, vetting_status, verified')
          .in('user_id', ids);
        for (const c of creators ?? []) creatorByUser.set(c.user_id, c);
      }
      return { users: (data ?? []).map((u) => ({ ...u, creator: creatorByUser.get(u.id) ?? null })) };
    },
  );

  // Customer lookup: one person's whole picture in a single round trip.
  app.get<{ Params: { id: string } }>('/v1/admin/users/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const id = request.params.id;
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, mode, currency, avatar_url, created_at, suspended_at, deleted_at, false_report_count')
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!profile) return reply.code(404).send({ error: 'No such user' });

    const [{ data: creator }, { data: bookingRows }, { data: txRows }, { data: disputeRows }, { data: consentRows }, { data: actionRows }] =
      await Promise.all([
        supabaseAdmin
          .from('creator_profiles')
          .select('vetting_status, verified, is_available, service_type, specialties, applied_at')
          .eq('user_id', id)
          .maybeSingle(),
        supabaseAdmin
          .from('bookings')
          .select('id, status, occasion, type, area, scheduled_at, duration_hours, price_usd, creator_id, created_at')
          .eq('client_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabaseAdmin
          .from('transactions')
          .select('id, booking_id, type, status, amount_usd, created_at')
          .eq('user_id', id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabaseAdmin
          .from('disputes')
          .select('id, booking_id, category, status, created_at, resolved_at')
          .eq('opened_by', id)
          .order('created_at', { ascending: false })
          .limit(10),
        supabaseAdmin
          .from('consent_records')
          .select('doc_type, version, consented_at')
          .eq('user_id', id)
          .order('consented_at', { ascending: false })
          .limit(30),
        supabaseAdmin
          .from('admin_actions')
          .select('id, admin_id, action, detail, created_at')
          .eq('target', id)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

    // Lifetime stats come from full aggregates, not the trimmed lists above.
    const countBookings = async (filter?: (q: any) => any) => {
      let q = supabaseAdmin.from('bookings').select('*', { count: 'exact', head: true }).eq('client_id', id);
      if (filter) q = filter(q);
      return (await q).count ?? 0;
    };
    const { data: chargeRows } = await supabaseAdmin
      .from('transactions')
      .select('type, status, amount_usd')
      .eq('user_id', id)
      .eq('status', 'succeeded');
    let spend = 0;
    for (const t of chargeRows ?? []) {
      if (t.type === 'charge') spend += Number(t.amount_usd);
      if (t.type === 'refund') spend -= Number(t.amount_usd);
    }
    const stats = {
      bookings_total: await countBookings(),
      bookings_completed: await countBookings((q) => q.eq('status', 'completed')),
      lifetime_spend_usd: Math.round(spend * 100) / 100,
      disputes_opened: (disputeRows ?? []).length,
    };

    // Latest consent per doc type only — the history lives in Legal.
    const latestConsent = new Map<string, { doc_type: string; version: number; consented_at: string }>();
    for (const c of consentRows ?? []) if (!latestConsent.has(c.doc_type)) latestConsent.set(c.doc_type, c);

    const names = await profileMap([
      ...(bookingRows ?? []).map((b) => b.creator_id ?? ''),
      ...(actionRows ?? []).map((a) => a.admin_id),
    ]);
    return {
      profile,
      creator: creator ?? null,
      stats,
      bookings: (bookingRows ?? []).map((b) => ({
        ...b,
        creator_name: b.creator_id ? names.get(b.creator_id)?.name ?? null : null,
      })),
      transactions: txRows ?? [],
      disputes: disputeRows ?? [],
      consents: [...latestConsent.values()],
      admin_history: (actionRows ?? []).map((a) => ({ ...a, admin_name: names.get(a.admin_id)?.name ?? null })),
    };
  });

  // Manual suspension with a required reason — same semantics as the
  // moderation-triggered path (profile flag + creator matching removal +
  // user notification). Unsuspend already exists on the moderation routes.
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/v1/admin/users/:id/suspend',
    async (request, reply) => {
      const admin = await requireAdmin(request, reply, ['admin']);
      if (!admin) return;
      const reason = request.body?.reason?.trim();
      if (!reason) return reply.code(400).send({ error: 'reason is required' });
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, suspended_at')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!profile) return reply.code(404).send({ error: 'No such user' });
      if (profile.suspended_at) return reply.code(409).send({ error: 'Already suspended' });
      await suspendUser(request.params.id, reason);
      await audit(admin, 'user_suspended', request.params.id, { reason });
      return { suspended: true };
    },
  );

  // Creator management: the roster. In-review applications sort first —
  // they are the queue — then by most recently applied.
  app.get<{ Querystring: { status?: string } }>('/v1/admin/creators', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    let query = supabaseAdmin
      .from('creator_profiles')
      .select('user_id, vetting_status, background_check_status, verified, is_available, service_type, specialties, base_area, applied_at, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (request.query.status) query = query.eq('vetting_status', request.query.status);
    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });
    const names = await profileMap((data ?? []).map((c) => c.user_id));
    const rank = (s: string) => (s === 'in_review' ? 0 : 1);
    const creators = (data ?? [])
      .map((c) => ({
        ...c,
        name: names.get(c.user_id)?.name ?? '',
        email: names.get(c.user_id)?.email ?? null,
      }))
      .sort((a, b) => rank(a.vetting_status) - rank(b.vetting_status));
    return { creators };
  });

  // One creator's whole picture: application, standing, money, work.
  app.get<{ Params: { id: string } }>('/v1/admin/creators/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply, ['admin', 'support']);
    if (!admin) return;
    const id = request.params.id;
    const { data: creator, error } = await supabaseAdmin
      .from('creator_profiles')
      .select(
        'user_id, vetting_status, background_check_status, background_check_completed_at, specialties, service_type, service_radius_km, base_area, bio, availability, blocked_dates, verified, promo_fee_rate, is_available, applied_at, rejection_reason, payout_methods, created_at',
      )
      .eq('user_id', id)
      .maybeSingle();
    if (error) return reply.code(500).send({ error: error.message });
    if (!creator) return reply.code(404).send({ error: 'No such creator' });

    const [{ data: profile }, { data: strikeRows }, { data: payoutRows }, { data: reviewRows }, { data: portfolioRows }, { data: bookingRows }] =
      await Promise.all([
        supabaseAdmin
          .from('profiles')
          .select('id, full_name, email, phone, created_at, suspended_at')
          .eq('id', id)
          .maybeSingle(),
        supabaseAdmin.from('strikes').select('*').eq('creator_id', id).order('occurred_at', { ascending: false }).limit(20),
        supabaseAdmin.from('creator_payouts').select('amount_usd, status').eq('creator_id', id),
        supabaseAdmin
          .from('reviews')
          .select('id, booking_id, client_id, rating, comment, created_at')
          .eq('creator_id', id)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('portfolio_items')
          .select('id, caption, status, created_at')
          .eq('creator_id', id)
          .order('created_at', { ascending: false })
          .limit(12),
        supabaseAdmin
          .from('bookings')
          .select('id, status, occasion, type, area, scheduled_at, price_usd, client_id, created_at')
          .eq('creator_id', id)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

    // Payout methods stay masked here — the raw details belong to the payout
    // fulfilment queue, where paying requires them.
    const pm = (creator.payout_methods ?? {}) as { selected?: string; methods?: Record<string, unknown> };
    const payout_summary = { selected: pm.selected ?? null, configured: Object.keys(pm.methods ?? {}) };
    const { payout_methods: _dropped, ...creatorSafe } = creator as Record<string, unknown>;

    const earnings = { pending: 0, available: 0, paid_out: 0 };
    for (const p of payoutRows ?? []) {
      const amt = Number(p.amount_usd);
      if (p.status === 'paid_out') earnings.paid_out += amt;
      else if (p.status === 'available' || p.status === 'requested') earnings.available += amt;
      else if (p.status === 'pending' || p.status === 'held') earnings.pending += amt;
    }
    for (const k of Object.keys(earnings) as (keyof typeof earnings)[]) {
      earnings[k] = Math.round(earnings[k] * 100) / 100;
    }

    const ratingCount = (reviewRows ?? []).length;
    const ratingAvg = ratingCount
      ? Math.round(((reviewRows ?? []).reduce((s, r) => s + Number(r.rating), 0) / ratingCount) * 100) / 100
      : null;

    const names = await profileMap([
      ...(bookingRows ?? []).map((b) => b.client_id),
      ...(reviewRows ?? []).slice(0, 5).map((r) => r.client_id),
    ]);

    return {
      profile,
      creator: { ...creatorSafe, payout_summary },
      standing: await creatorStanding(id),
      strikes: strikeRows ?? [],
      earnings,
      rating: { average: ratingAvg, count: ratingCount },
      reviews: (reviewRows ?? []).slice(0, 5).map((r) => ({
        ...r,
        client_name: names.get(r.client_id)?.name ?? null,
      })),
      portfolio: portfolioRows ?? [],
      bookings: (bookingRows ?? []).map((b) => ({
        ...b,
        client_name: names.get(b.client_id)?.name ?? null,
      })),
    };
  });

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
