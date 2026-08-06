import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { reassignBooking, offerWindowMs } from '../offers.js';
import { notify } from '../notify.js';
import { decryptField } from '../crypto.js';
import { sendEmail } from '../email.js';

// Admin Portal (handoff §15) — original Phase 5 endpoints. Sits on the SAME
// backend and data model as the apps (§15 mandate). The portal UI is now the
// SPA in admin-ui/ (served at /admin, legacy page at /admin/legacy — see
// admin-ui.ts); newer portal endpoints live in admin-portal.ts. Roles:
// requireAdmin defaults to admin-only, view/ops routes widen explicitly.

export function registerAdminRoutes(app: FastifyInstance) {
  app.get('/v1/admin/alerts', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('admin_alerts')
      .select('*')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    // SOS first — the queue is escalation-tiered, not chronological (§13/§15).
    const priority = (t: string) => (t === 'sos' ? 0 : t === 'session_ended_safety' ? 1 : 2);
    return { alerts: (data ?? []).sort((a, b) => priority(a.alert_type) - priority(b.alert_type)) };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/alerts/:id/resolve', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    await supabaseAdmin
      .from('admin_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('id', request.params.id);
    await audit(adminId, 'alert_resolved', request.params.id);
    return { resolved: true };
  });

  app.get('/v1/admin/disputes', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('disputes')
      .select('*, dispute_evidence(id, submitted_by, kind, content, created_at)')
      .not('status', 'in', '(resolved,closed)')
      .order('created_at', { ascending: true });
    // Additive enrichment for the SPA (names + booking facts); the legacy
    // page ignores these fields.
    const bookingIds = [...new Set((data ?? []).map((d) => d.booking_id))];
    const bookingById = new Map<string, Record<string, unknown>>();
    if (bookingIds.length) {
      const { data: bookings } = await supabaseAdmin
        .from('bookings')
        .select('id, occasion, type, area, scheduled_at, price_usd, client_id, creator_id')
        .in('id', bookingIds);
      for (const b of bookings ?? []) bookingById.set(b.id, b);
    }
    const personIds = (data ?? []).flatMap((d) => {
      const b = bookingById.get(d.booking_id) as { client_id?: string; creator_id?: string | null } | undefined;
      return [d.opened_by, ...(d.dispute_evidence ?? []).map((e: { submitted_by: string }) => e.submitted_by), b?.client_id ?? '', b?.creator_id ?? ''];
    });
    const nameOf = new Map<string, string>();
    if (personIds.length) {
      const { data: profs } = await supabaseAdmin.from('profiles').select('id, full_name').in('id', [...new Set(personIds.filter(Boolean))]);
      for (const p of profs ?? []) nameOf.set(p.id, p.full_name);
    }
    return {
      disputes: (data ?? []).map((d) => {
        const b = bookingById.get(d.booking_id) as ({ client_id: string; creator_id: string | null } & Record<string, unknown>) | undefined;
        return {
          ...d,
          opened_by_name: nameOf.get(d.opened_by) ?? null,
          dispute_evidence: (d.dispute_evidence ?? []).map((e: { submitted_by: string } & Record<string, unknown>) => ({
            ...e,
            submitted_by_name: nameOf.get(e.submitted_by) ?? null,
          })),
          booking: b
            ? {
                ...b,
                client_name: nameOf.get(b.client_id) ?? null,
                creator_name: b.creator_id ? nameOf.get(b.creator_id) ?? null : null,
              }
            : null,
        };
      }),
    };
  });

  app.get('/v1/admin/applications', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id, specialties, base_area, vetting_status, created_at, profiles!creator_profiles_user_id_fkey!inner(full_name, email)')
      .eq('vetting_status', 'in_review')
      .order('created_at', { ascending: true });
    return { applications: data ?? [] };
  });

  // §15 fee/promo settings: every app_config row is admin-editable.
  app.get('/v1/admin/config', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin.from('app_config').select('*').order('key');
    return { config: data ?? [] };
  });
  app.put<{ Params: { key: string }; Body: { value?: unknown; confirmed?: boolean } }>(
    '/v1/admin/config/:key',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const patch: Record<string, unknown> = {};
      if (request.body?.value !== undefined) patch.value = request.body.value;
      if (request.body?.confirmed !== undefined) patch.confirmed = request.body.confirmed;
      const { error } = await supabaseAdmin.from('app_config').update(patch).eq('key', request.params.key);
      if (error) return reply.code(500).send({ error: error.message });
      await audit(adminId, 'config_updated', request.params.key, { value: request.body?.value });
      return { updated: true };
    },
  );

  // --- File retention (scheduled job) -------------------------------------
  // Manual trigger; dry_run defaults to the app_config kill switch. The
  // scheduler runs the same function daily.
  app.post<{ Querystring: { dry_run?: string } }>(
    '/v1/admin/retention/run',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const { runRetention } = await import('../retention.js');
      const dryRun =
        request.query.dry_run === undefined ? undefined : request.query.dry_run !== 'false';
      const result = await runRetention(dryRun === undefined ? undefined : { dryRun });
      await audit(adminId, 'retention_run', undefined, {
        dry_run: result.dry_run,
        eligible: result.eligible.length,
        deleted: result.deleted,
        errors: result.errors.length,
      });
      return result;
    },
  );
  app.get('/v1/admin/retention/log', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('retention_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    return { log: data ?? [] };
  });
  // Explicit legal hold: block deletion on an order (open dispute/report/
  // revision also auto-raises it). Lifting stamps legal_hold_lifted_at —
  // files stay ineligible for retention_hold_release_days (90) after that.
  app.post<{ Params: { id: string }; Body: { hold?: boolean } }>(
    '/v1/admin/bookings/:id/legal-hold',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const hold = request.body?.hold;
      if (typeof hold !== 'boolean') return reply.code(400).send({ error: 'hold: boolean required' });
      const patch = hold
        ? { legal_hold: true }
        : { legal_hold: false, legal_hold_lifted_at: new Date().toISOString() };
      const { error } = await supabaseAdmin.from('bookings').update(patch).eq('id', request.params.id);
      if (error) return reply.code(500).send({ error: error.message });
      await audit(adminId, hold ? 'legal_hold_set' : 'legal_hold_lifted', request.params.id);
      return { legal_hold: hold };
    },
  );

  // §15 analytics: platform counters off the shared data model.
  app.get('/v1/admin/analytics', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const count = async (table: string, filter?: (q: any) => any) => {
      let q = supabaseAdmin.from(table).select('*', { count: 'exact', head: true });
      if (filter) q = filter(q);
      return (await q).count ?? 0;
    };
    const { data: charges } = await supabaseAdmin.from('transactions').select('type, amount_usd');
    const sum = (t: string) =>
      Math.round((charges ?? []).filter((c) => c.type === t).reduce((s, c) => s + Number(c.amount_usd), 0) * 100) / 100;
    return {
      bookings: {
        pending: await count('bookings', (q) => q.eq('status', 'pending')),
        confirmed: await count('bookings', (q) => q.eq('status', 'confirmed')),
        completed: await count('bookings', (q) => q.eq('status', 'completed')),
        cancelled: await count('bookings', (q) => q.eq('status', 'cancelled')),
        disputed: await count('bookings', (q) => q.eq('status', 'disputed')),
      },
      money: { charged_usd: sum('charge'), refunded_usd: sum('refund') },
      creators: {
        approved: await count('creator_profiles', (q) => q.eq('vetting_status', 'approved')),
        in_review: await count('creator_profiles', (q) => q.eq('vetting_status', 'in_review')),
      },
      open_disputes: await count('disputes', (q) => q.not('status', 'in', '(resolved,closed)')),
      active_strikes: await count('strikes', (q) => q.eq('overturned', false).gt('expires_at', new Date().toISOString())),
    };
  });

  // §15 manual dispatch: assign a creator to an unassigned pending booking
  // (goes through the normal accept window, not straight to confirmed).
  app.get('/v1/admin/unassigned', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, occasion, area, scheduled_at, type, declined_creator_ids')
      .eq('status', 'pending')
      .is('creator_id', null)
      .order('created_at', { ascending: true });
    return { bookings: data ?? [] };
  });
  app.post<{ Params: { id: string }; Body: { creator_id?: string } }>(
    '/v1/admin/bookings/:id/assign',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const creatorId = request.body?.creator_id;
      if (!creatorId) return reply.code(400).send({ error: 'creator_id required' });
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, status, occasion, area')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking || booking.status !== 'pending') {
        return reply.code(409).send({ error: 'Only pending bookings can be dispatched' });
      }
      await supabaseAdmin
        .from('bookings')
        .update({
          creator_id: creatorId,
          offer_expires_at: new Date(Date.now() + (await offerWindowMs())).toISOString(),
        })
        .eq('id', booking.id);
      await notify(creatorId, 'offer_received', 'New job offer',
        `A ${booking.occasion ?? 'session'} booking near ${booking.area ?? 'you'} was assigned to you — accept within the offer window.`);
      await audit(adminId, 'manual_dispatch', booking.id, { creator_id: creatorId });
      return { assigned: true };
    },
  );

  // Manual payout fulfillment queue (no Stripe Connect): requested
  // cash-outs listed with the creator's payout details; admin marks paid
  // after sending money externally — audited with who and when.
  app.get('/v1/admin/payout-requests', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const { data } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, creator_id, amount_usd, created_at')
      .eq('status', 'requested');
    const byCreator = new Map<string, { creator_id: string; total: number; ids: string[] }>();
    for (const p of data ?? []) {
      const e = byCreator.get(p.creator_id) ?? { creator_id: p.creator_id, total: 0, ids: [] as string[] };
      e.total = Math.round((e.total + Number(p.amount_usd)) * 100) / 100;
      e.ids.push(p.id);
      byCreator.set(p.creator_id, e);
    }
    const requests: Record<string, unknown>[] = [];
    for (const e of byCreator.values()) {
      const { data: prof } = await supabaseAdmin.from('profiles').select('full_name, email, phone').eq('id', e.creator_id).single();
      const { data: alert } = await supabaseAdmin
        .from('admin_alerts')
        .select('detail')
        .eq('alert_type', 'payout_requested')
        .is('resolved_at', null)
        .filter('detail->>creator_id', 'eq', e.creator_id)
        .limit(1)
        .maybeSingle();
      const { data: cp } = await supabaseAdmin.from('creator_profiles').select('payout_methods').eq('user_id', e.creator_id).single();
      const pm = (cp?.payout_methods ?? {}) as { selected?: string; methods?: Record<string, Record<string, string>> };
      const sel = pm.selected;
      const det = sel ? pm.methods?.[sel] : undefined;
      let shown = det ? { ...det } : undefined;
      if (shown?.account_number_enc) {
        try {
          shown.account_number = decryptField(shown.account_number_enc);
        } catch {
          shown.account_number = '[decrypt failed — check PAYOUT_ENCRYPTION_KEY]';
        }
        delete shown.account_number_enc;
        delete shown.account_number_last4;
      }
      const label = sel === 'cash'
        ? 'Cash pickup — partner location (pickup mechanics TBD)'
        : sel && shown
          ? `${sel}: ${Object.entries(shown).map(([k, v]) => k + '=' + v).join(', ')}`
          : null;
      requests.push({
        ...e,
        name: prof?.full_name,
        email: prof?.email,
        // Cash pickup is arranged by PHONE (WhatsApp/call) — manual by
        // design; the number is the admin's contact path.
        phone: prof?.phone ?? null,
        method: sel ?? null,
        admin_note: (alert?.detail as { admin_note?: string } | null)?.admin_note ?? null,
        payout_details: label,
      });
    }
    return { requests };
  });
  // Free-text note on a payout request ("Arranged Thurs 2pm, ID confirmed")
  // — stored on the request alert, audited like everything else.
  app.post<{ Body: { creator_id?: string; note?: string } }>(
    '/v1/admin/payout-requests/note',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply, ['admin', 'support']);
      if (!adminId) return;
      const { creator_id, note } = request.body ?? {};
      if (!creator_id || !note?.trim()) return reply.code(400).send({ error: 'creator_id and note required' });
      const { data: alert } = await supabaseAdmin
        .from('admin_alerts')
        .select('id, detail')
        .eq('alert_type', 'payout_requested')
        .is('resolved_at', null)
        .filter('detail->>creator_id', 'eq', creator_id)
        .limit(1)
        .maybeSingle();
      if (!alert) return reply.code(404).send({ error: 'No open payout request for this creator' });
      await supabaseAdmin
        .from('admin_alerts')
        .update({ detail: { ...(alert.detail as object), admin_note: note.trim() } })
        .eq('id', alert.id);
      await audit(adminId, 'payout_note', creator_id, { note: note.trim() });
      return { noted: true };
    },
  );

  app.post<{ Body: { creator_id?: string } }>('/v1/admin/payout-requests/fulfill', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const creatorId = request.body?.creator_id;
    if (!creatorId) return reply.code(400).send({ error: 'creator_id required' });
    const { data: rows } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, amount_usd')
      .eq('creator_id', creatorId)
      .eq('status', 'requested');
    if (!rows?.length) return reply.code(409).send({ error: 'No requested payouts for this creator' });
    const total = Math.round(rows.reduce((s, r) => s + Number(r.amount_usd), 0) * 100) / 100;
    await supabaseAdmin
      .from('creator_payouts')
      .update({ status: 'paid_out', paid_out_at: new Date().toISOString() })
      .in('id', rows.map((r) => r.id));
    await supabaseAdmin
      .from('admin_alerts')
      .update({ resolved_at: new Date().toISOString() })
      .eq('alert_type', 'payout_requested')
      .is('resolved_at', null)
      .filter('detail->>creator_id', 'eq', creatorId);
    await audit(adminId, 'payout_fulfilled', creatorId, { amount_usd: total, payout_ids: rows.map((r) => r.id) });
    await notify(creatorId, 'payout_paid', 'Payout sent', `$${total.toFixed(2)} has been sent to your payout method.`);
    return { fulfilled: true, amount_usd: total };
  });

  // Admin login: normal Supabase password auth; membership checked on use.
  // Ops check: verify outbound email (Resend) is actually configured and
  // sending. Returns the Resend message id, or simulated:true when no key.
  app.post<{ Body: { to?: string } }>('/v1/admin/test-email', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const to = request.body?.to?.trim();
    if (!to || !to.includes('@')) return reply.code(400).send({ error: 'to (email) is required' });
    const result = await sendEmail(
      to,
      'Snapt outbound email test',
      '<p>This is a test of Snapt server email delivery. If you can read this, Resend is live.</p>',
    );
    await audit(adminId, 'test_email', to, { ...result });
    return result;
  });

  // Minimal per-IP throttle for the one publicly reachable login endpoint
  // (Phase 7 hardening baseline). In-memory is correct for Render's single
  // instance; revisit if the service ever scales horizontally.
  const loginAttempts = new Map<string, number[]>();
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;
  const LOGIN_MAX_ATTEMPTS = 10;
  function loginThrottled(ip: string): boolean {
    const now = Date.now();
    const hits = (loginAttempts.get(ip) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
    hits.push(now);
    loginAttempts.set(ip, hits);
    if (loginAttempts.size > 5000) {
      for (const [k, v] of loginAttempts) {
        if (v.every((t) => now - t >= LOGIN_WINDOW_MS)) loginAttempts.delete(k);
      }
    }
    return hits.length > LOGIN_MAX_ATTEMPTS;
  }

  app.post<{ Body: { email?: string; password?: string } }>('/v1/admin/login', async (request, reply) => {
    if (loginThrottled(request.ip)) {
      return reply.code(429).send({ error: 'Too many sign-in attempts — wait 15 minutes and try again.' });
    }
    const { email, password } = request.body ?? {};
    if (!email || !password) return reply.code(400).send({ error: 'email and password required' });
    const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    });
    const json = (await res.json()) as { access_token?: string; user?: { id: string } };
    if (!res.ok || !json.access_token || !json.user) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }
    const { data } = await supabaseAdmin.from('admin_users').select('user_id, role').eq('user_id', json.user.id).maybeSingle();
    if (!data) return reply.code(403).send({ error: 'Not an admin account' });
    return { access_token: json.access_token, role: data.role };
  });

}
