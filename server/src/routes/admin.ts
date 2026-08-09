import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { audit, requireAdmin } from '../admin-auth.js';
import { reassignBooking, offerWindowMs } from '../offers.js';
import { notify } from '../notify.js';
import { decryptField } from '../crypto.js';
import { sendEmail } from '../email.js';
import { workingDaysSince } from '../scheduler.js';
import { reconcileNames } from '../name-match.js';
import { PAYOUT_METHODS, methodName } from '../payout-methods.js';
import { bustConfigCache, enabledPayoutMethods, payoutMethodNotes } from '../config.js';

// Admin Portal (handoff §15) — original Phase 5 endpoints. Sits on the SAME
// backend and data model as the apps (§15 mandate). The portal UI is now the
// SPA in admin-ui/ (served at /admin, legacy page at /admin/legacy — see
// admin-ui.ts); newer portal endpoints live in admin-portal.ts. Roles:
// requireAdmin defaults to admin-only, view/ops routes widen explicitly.

export function registerAdminRoutes(app: FastifyInstance) {
  /**
   * GHOST BOOKINGS — pending rows with no successful charge behind them.
   *
   * The old checkout created the booking (and pushed a job offer) at slide
   * time, before payment. Every abandoned Stripe sheet left one of these
   * behind, with a creator's offer history polluted by a job that was never
   * paid for. Checkout no longer works that way (see checkout.ts), so this
   * exists to clear the ones already made.
   *
   * GET lists them; POST clears them. Never touches a booking with a
   * succeeded charge, and never touches one whose session already happened.
   */
  async function findGhosts() {
    const { data: pending } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, creator_id, occasion, type, area, scheduled_at, price_usd, created_at, offer_expires_at')
      .eq('status', 'pending');
    const rows = pending ?? [];
    if (rows.length === 0) return [];
    const { data: charges } = await supabaseAdmin
      .from('transactions')
      .select('booking_id')
      .eq('type', 'charge')
      .eq('status', 'succeeded')
      .in('booking_id', rows.map((b) => b.id));
    const paid = new Set((charges ?? []).map((c) => c.booking_id));
    return rows.filter((b) => !paid.has(b.id));
  }

  /**
   * ORPHANED JOB OFFERS: "New job offer" notifications whose booking is
   * cancelled or gone.
   *
   * findGhosts() only sees bookings still sitting at 'pending'. A ghost the
   * app cleaned up client-side is already 'cancelled' with creator_id
   * nulled — but the creator's inbox still holds the offer push, deep-
   * linking to a job that no longer exists. That is the offer-history
   * pollution, and it is invisible to the booking-side query.
   */
  async function findOrphanOffers() {
    const { data: offers } = await supabaseAdmin
      .from('notifications')
      .select('id, user_id, created_at, data')
      .eq('trigger_type', 'offer_received');
    const rows = (offers ?? []).map((n) => ({
      ...n,
      booking_id: ((n.data ?? {}) as Record<string, unknown>).booking_id as string | undefined,
    }));
    const ids = [...new Set(rows.map((r) => r.booking_id).filter(Boolean))] as string[];
    if (ids.length === 0) return rows.filter((r) => !r.booking_id);
    const { data: bookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status')
      .in('id', ids);
    const alive = new Map((bookings ?? []).map((b) => [b.id as string, b.status as string]));
    // A cancelled booking that was PAID is real history: the job existed,
    // the client was charged, the offer genuinely went out. Erasing that
    // would be deleting a record, not cleaning up test detritus. Only
    // offers whose booking was never paid for (or no longer exists at all)
    // are clearable.
    const cancelledIds = [...alive.entries()]
      .filter(([, status]) => status === 'cancelled')
      .map(([id]) => id);
    const paid = new Set<string>();
    if (cancelledIds.length > 0) {
      const { data: charges } = await supabaseAdmin
        .from('transactions')
        .select('booking_id')
        .eq('type', 'charge')
        .eq('status', 'succeeded')
        .in('booking_id', cancelledIds);
      for (const c of charges ?? []) paid.add(c.booking_id as string);
    }
    return rows.filter((r) => {
      if (!r.booking_id) return true; // no target at all
      const status = alive.get(r.booking_id);
      if (status === undefined) return true; // booking gone
      return status === 'cancelled' && !paid.has(r.booking_id);
    });
  }

  app.get('/v1/admin/ghost-bookings', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const ghosts = await findGhosts();
    const orphans = await findOrphanOffers();
    return {
      count: ghosts.length,
      with_creator_offer: ghosts.filter((g) => g.creator_id).length,
      bookings: ghosts,
      orphan_offers: orphans.length,
      orphan_offer_creators: new Set(orphans.map((o) => o.user_id)).size,
      orphan_offer_rows: orphans.map((o) => ({
        user_id: o.user_id,
        booking_id: o.booking_id ?? null,
        created_at: o.created_at,
      })),
    };
  });

  app.post('/v1/admin/ghost-bookings/clear', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const ghosts = await findGhosts();
    const orphansBefore = await findOrphanOffers();
    if (ghosts.length === 0 && orphansBefore.length === 0) {
      return { cleared: 0, offers_withdrawn: 0, bookings: [] };
    }

    // Cancelled, not deleted: the row stays as history (and keeps any
    // foreign keys intact), but it leaves the creator's offer queue and
    // stops occupying the slot in availability.
    const ids = ghosts.map((g) => g.id);
    await supabaseAdmin
      .from('bookings')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: null,
        creator_id: null,
        offer_expires_at: null,
      })
      .in('id', ids);

    // The stale "New job offer" rows in each creator's inbox are the other
    // half of the pollution — they deep-link to a job that no longer exists.
    const offerCreators = ghosts.filter((g) => g.creator_id);
    for (const g of offerCreators) {
      await supabaseAdmin
        .from('notifications')
        .delete()
        .eq('user_id', g.creator_id as string)
        .eq('trigger_type', 'offer_received')
        .eq('data->>booking_id', g.id);
    }

    // Re-scan AFTER the cancels above: those just orphaned their own
    // offers, so this sweep catches both the pre-existing strays and the
    // ones this run created.
    const orphans = await findOrphanOffers();
    for (const o of orphans) {
      await supabaseAdmin.from('notifications').delete().eq('id', o.id);
    }
    await audit(adminId, 'ghost_bookings_cleared', 'checkout', {
      count: ids.length,
      with_creator_offer: offerCreators.length,
      orphan_offers_deleted: orphans.length,
      booking_ids: ids,
    });
    return {
      cleared: ids.length,
      offers_withdrawn: orphans.length,
      orphan_offer_creators: new Set(orphans.map((o) => o.user_id)).size,
      bookings: ids,
    };
  });

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
      .select('user_id, specialties, base_area, vetting_status, applied_at, created_at, profiles!creator_profiles_user_id_fkey!inner(full_name, email)')
      .eq('vetting_status', 'in_review')
      .order('created_at', { ascending: true });
    // Waiting age travels with the row so the list can show staleness before
    // the alert fires — the alert is the safety net, not the first signal.
    const { data: parked } = await supabaseAdmin
      .from('verification_sessions')
      .select('user_id')
      .eq('name_review_required', true);
    const parkedIds = new Set((parked ?? []).map((p) => p.user_id as string));
    return {
      applications: (data ?? []).map((a: any) => ({
        ...a,
        waiting_working_days: a.applied_at ? workingDaysSince(a.applied_at) : 0,
        parked_for_name_review: parkedIds.has(a.user_id),
      })),
    };
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
        .select('id, status, occasion, area, type')
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
      // A remote edit is not "a session booking near you" — that copy told
      // an editor to expect an in-person shoot. Say what the job actually is.
      await notify(creatorId, 'offer_received', 'New job offer',
        booking.type === 'remote'
          ? 'A remote edit order was assigned to you — accept within the offer window to start on the client\'s footage.'
          : `A ${booking.occasion ?? 'session'} booking near ${booking.area ?? 'you'} was assigned to you — accept within the offer window.`,
        { booking_id: booking.id });
      await audit(adminId, 'manual_dispatch', booking.id, { creator_id: creatorId });
      return { assigned: true };
    },
  );

  // Manual payout fulfillment queue (no Stripe Connect): requested
  // cash-outs listed with the creator's payout details; admin marks paid
  // after sending money externally — audited with who and when.
  // ---- Payout method switches --------------------------------------------
  // Turn any of the six methods on or off from the portal — a bank outage
  // is handled here, with no deploy of any kind. The creator-side guard is
  // in earnings.ts (cash-out refuses a disabled method server-side).

  /** Current state per method + how many creators have it as their saved
   *  preference — the portal warns with this count before a disable. */
  app.get('/v1/admin/payout-methods', async (request, reply) => {
    const adminId = await requireAdmin(request, reply, ['admin', 'support']);
    if (!adminId) return;
    const toggles = await enabledPayoutMethods();
    const notes = await payoutMethodNotes();
    const { data: creators } = await supabaseAdmin
      .from('creator_profiles')
      .select('payout_methods')
      .not('payout_methods', 'is', null);
    const savedCount: Record<string, number> = {};
    for (const c of creators ?? []) {
      const sel = (c.payout_methods as { selected?: string } | null)?.selected;
      if (sel) savedCount[sel] = (savedCount[sel] ?? 0) + 1;
    }
    return {
      methods: PAYOUT_METHODS.map((m) => ({
        id: m.id,
        name: m.name,
        eta: m.eta,
        enabled: toggles[m.id] !== false,
        note: notes[m.id] ?? null,
        saved_count: savedCount[m.id] ?? 0,
      })),
    };
  });

  /**
   * Flip one method. Disabling requires a reason (audit) and takes an
   * optional creator-facing note ("Bank transfers are paused until Monday").
   *
   * WRITTEN AS UPSERT + READ-BACK, deliberately. The generic config PUT is
   * an UPDATE that silently no-ops when the key row is missing and still
   * answers {updated:true} — this endpoint must not inherit that. Upsert
   * creates the row if absent, and the follow-up read proves the value the
   * caller is told about is the value the table now holds.
   */
  app.put<{ Params: { id: string }; Body: { enabled?: boolean; reason?: string; note?: string } }>(
    '/v1/admin/payout-methods/:id',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const id = request.params.id;
      if (!PAYOUT_METHODS.some((m) => m.id === id)) {
        return reply.code(404).send({ error: `No payout method '${id}'` });
      }
      const enabled = request.body?.enabled;
      if (typeof enabled !== 'boolean') {
        return reply.code(400).send({ error: 'enabled (boolean) is required' });
      }
      const reason = (request.body?.reason ?? '').trim();
      const note = (request.body?.note ?? '').trim();
      if (!enabled && reason.length < 3) {
        return reply.code(400).send({ error: `A reason is required to disable ${methodName(id)}.` });
      }

      const toggles = { ...(await enabledPayoutMethods()), [id]: enabled };
      const notes = { ...(await payoutMethodNotes()) };
      if (!enabled && note) notes[id] = note;
      else delete notes[id]; // re-enabling clears the outage note

      const { error: upErr } = await supabaseAdmin.from('app_config').upsert(
        [
          { key: 'payout_methods_enabled', value: toggles, confirmed: true },
          { key: 'payout_methods_notes', value: notes, confirmed: true },
        ],
        { onConflict: 'key' },
      );
      if (upErr) return reply.code(500).send({ error: `Config write failed: ${upErr.message}` });

      // Read back and verify — a 200 from this endpoint MEANS the row holds
      // the value, not merely that a statement ran.
      const { data: check } = await supabaseAdmin
        .from('app_config')
        .select('key, value')
        .in('key', ['payout_methods_enabled', 'payout_methods_notes']);
      const held = Object.fromEntries((check ?? []).map((r) => [r.key, r.value]));
      const heldToggles = (held['payout_methods_enabled'] ?? {}) as Record<string, boolean>;
      if (heldToggles[id] !== enabled) {
        return reply.code(500).send({ error: 'Config write did not stick — state unchanged, try again.' });
      }
      bustConfigCache();

      const { data: creators } = await supabaseAdmin
        .from('creator_profiles')
        .select('payout_methods')
        .not('payout_methods', 'is', null);
      const affected = (creators ?? []).filter(
        (c) => (c.payout_methods as { selected?: string } | null)?.selected === id,
      ).length;

      await audit(adminId, enabled ? 'payout_method_enabled' : 'payout_method_disabled', id, {
        reason: reason || null,
        note: !enabled && note ? note : null,
        creators_with_method_saved: affected,
      });
      return { updated: true, id, enabled, note: !enabled && note ? note : null, creators_with_method_saved: affected };
    },
  );

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
      const { data: cp } = await supabaseAdmin.from('creator_profiles').select('payout_methods, legal_name').eq('user_id', e.creator_id).single();
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
      // §6 Payout name check: the name on the receiving account against the
      // VERIFIED legal name. Catches a typo and catches money being routed to
      // someone else's account. Surfaced, never blocking — plenty of these
      // are legitimate (a joint account, a business name) and that is a
      // conversation, not a rejection.
      const holderName = (shown?.holder_name as string | undefined) ?? null;
      let payoutNameCheck: Record<string, unknown> | null = null;
      if (sel && sel !== 'cash' && holderName) {
        if (!cp?.legal_name) {
          payoutNameCheck = {
            state: 'unverified',
            holder_name: holderName,
            legal_name: null,
            note: 'No verified legal name yet — nothing to compare against.',
          };
        } else {
          const cmp = reconcileNames({
            idFullName: cp.legal_name,
            idLastName: null,
            signupName: holderName,
          });
          payoutNameCheck = {
            state:
              cmp.verdict === 'match'
                ? 'ok'
                : cmp.verdict === 'minor_variance'
                  ? 'minor'
                  : 'mismatch',
            holder_name: holderName,
            legal_name: cp.legal_name,
            reasons: cmp.reasons,
          };
        }
      }
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
        payout_name_check: payoutNameCheck,
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
    // Highlight the row only when this fulfilment WAS one row. A batch has
    // no single "the payout record" to open, and picking one arbitrarily
    // would point at a number that isn't the one in the message.
    await notify(creatorId, 'payout_paid', 'Payout sent', '{amount} has been sent to your payout method.',
      rows.length === 1 ? { payout_id: rows[0].id } : {}, { amount: total });
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
