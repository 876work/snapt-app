import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { requireAdmin, audit } from '../admin-auth.js';
import { notify } from '../notify.js';
import { estimateCreatorPayout, feeRateFor, type BookingRow } from '../payments.js';
import { getConfig } from '../config.js';

/**
 * ADMIN HARD OFF SWITCH — disable / restore a user account.
 *
 * Not suspension (see suspended_at, a moderation outcome). This is
 * administrative: no login, no API, no notifications, fully reversible.
 *
 * Enforcement is deliberately layered, because one lever doesn't cover the
 * three doors into the product:
 *   1. GoTrue ban      — refuses LOGIN and refresh. The app signs in directly
 *                        against GoTrue, so the server isn't in that path and
 *                        nothing else can refuse a login.
 *   2. profiles.status — the API's auth hook turns the resulting rejection
 *                        into a clear account_disabled response.
 *   3. RLS (migration) — PostgREST and Realtime validate JWTs locally and
 *                        never ask GoTrue, so chat would otherwise keep
 *                        working until the token expired.
 *
 * Nothing here is destructive. Bookings, payouts, creator approval,
 * specialties, schedule, portfolio and Didit state are never written by
 * either direction — which is what makes restore complete by construction
 * rather than by trying to put things back.
 */

interface Commitments {
  active_session: {
    booking_id: string;
    client_id: string;
    client_name: string;
    scheduled_at: string;
    started: boolean;
    creator_payout_usd: number;
  } | null;
  future_bookings: { booking_id: string; scheduled_at: string; client_name: string }[];
  /**
   * EVERY other kind of assigned work, which the disable flow used to be
   * blind to entirely.
   *
   * `commitmentsFor` skipped any booking with no `scheduled_at` — and remote
   * orders never have one. So a paid remote edit assigned to a creator was
   * neither an active session nor a future booking: not shown, not returned
   * to dispatch, not alerted. Booking ac3945a7 sat in exactly that hole.
   * Past-dated confirmed work with nothing delivered fell through the same
   * gap, because `future_bookings` required a start in the future.
   */
  assigned_work: {
    booking_id: string;
    kind: 'unscheduled_remote' | 'overdue_scheduled' | 'offer_pending';
    status: string;
    type: string;
    occasion: string | null;
    scheduled_at: string | null;
    client_id: string;
    client_name: string;
    price_usd: number;
    delivered: boolean;
  }[];
  pending_payouts: { count: number; total_usd: number };
  /**
   * Bookings this user holds AS THE CLIENT — money already taken, a creator
   * already expecting to turn up. Disabling only ever looked at creator_id,
   * so switching off a client silently left a creator booked for a shoot
   * with someone who can no longer be contacted or let in.
   */
  client_bookings: {
    booking_id: string;
    scheduled_at: string;
    creator_name: string | null;
    price_usd: number;
  }[];
}

/** Display names for a set of user ids, in one round trip. */
async function namesFor(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return names;
  const { data } = await supabaseAdmin.from('profiles').select('id, full_name').in('id', unique);
  for (const p of data ?? []) names.set(p.id as string, (p.full_name as string) || '');
  return names;
}

/** What this user owes the platform before they can be switched off. */
async function commitmentsFor(userId: string): Promise<Commitments> {
  const now = new Date();
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, client_id, creator_id, scheduled_at, duration_hours, status, price_usd, pricing_snapshot, occasion, type, delivered_at, offer_expires_at',
    )
    .eq('creator_id', userId)
    .in('status', ['pending', 'confirmed']);

  const names = await namesFor((bookings ?? []).map((b) => b.client_id as string));

  // Whether a session has actually STARTED is the sessions table's answer,
  // not a guess from the clock: a creator who checked in late is still
  // mid-shoot, and one who never showed is not.
  const ids = (bookings ?? []).map((b) => b.id as string);
  const live = new Set<string>();
  if (ids.length) {
    const { data: sessions } = await supabaseAdmin
      .from('sessions')
      .select('booking_id, session_active_at, session_ended_at')
      .in('booking_id', ids);
    for (const s of sessions ?? []) {
      if (s.session_active_at && !s.session_ended_at) live.add(s.booking_id as string);
    }
  }

  let active: Commitments['active_session'] = null;
  const future: Commitments['future_bookings'] = [];
  const assigned: Commitments['assigned_work'] = [];
  for (const b of bookings ?? []) {
    /**
     * No scheduled_at means a REMOTE order, not "nothing to resolve". This
     * used to `continue` and the whole booking vanished from the disable
     * flow. It is assigned, paid work and the admin has to decide about it.
     */
    if (!b.scheduled_at) {
      assigned.push({
        booking_id: b.id as string,
        kind: b.offer_expires_at ? 'offer_pending' : 'unscheduled_remote',
        status: b.status as string,
        type: b.type as string,
        occasion: (b.occasion as string | null) ?? null,
        scheduled_at: null,
        client_id: b.client_id as string,
        client_name: names.get(b.client_id as string) || 'Client',
        price_usd: Number(b.price_usd || 0),
        delivered: Boolean(b.delivered_at),
      });
      continue;
    }
    const start = new Date(b.scheduled_at as string);
    const end = new Date(start.getTime() + (Number(b.duration_hours) || 1) * 3600_000);
    const started = live.has(b.id as string);
    if (started || (end >= now && start <= new Date(now.getTime() + 4 * 3600_000))) {
      // Happening now, or close enough that reassignment is urgent.
      active = {
        booking_id: b.id as string,
        client_id: b.client_id as string,
        client_name: names.get(b.client_id as string) || 'Client',
        scheduled_at: b.scheduled_at as string,
        started,
        creator_payout_usd: await estimateCreatorPayout(b as unknown as BookingRow, userId),
      };
    } else if (start > now) {
      future.push({
        booking_id: b.id as string,
        scheduled_at: b.scheduled_at as string,
        client_name: names.get(b.client_id as string) || 'Client',
      });
    } else if (!b.delivered_at) {
      /**
       * Scheduled in the past, still pending or confirmed, nothing delivered.
       * Neither "future" nor "active", so this used to fall out of the flow
       * entirely — a booking whose date has passed with the work still owed
       * is exactly the kind that must not be orphaned by a disable.
       */
      assigned.push({
        booking_id: b.id as string,
        kind: 'overdue_scheduled',
        status: b.status as string,
        type: b.type as string,
        occasion: (b.occasion as string | null) ?? null,
        scheduled_at: b.scheduled_at as string,
        client_id: b.client_id as string,
        client_name: names.get(b.client_id as string) || 'Client',
        price_usd: Number(b.price_usd || 0),
        delivered: false,
      });
    }
  }

  const { data: payouts } = await supabaseAdmin
    .from('creator_payouts')
    .select('amount_usd')
    .eq('creator_id', userId)
    .in('status', ['held', 'requested', 'available']);
  const total = (payouts ?? []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);

  // The client side of the same person.
  const { data: asClient } = await supabaseAdmin
    .from('bookings')
    .select('id, creator_id, scheduled_at, price_usd')
    .eq('client_id', userId)
    .eq('status', 'confirmed')
    .gte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true });
  const creatorNames = await namesFor((asClient ?? []).map((b) => b.creator_id as string));

  return {
    active_session: active,
    assigned_work: assigned,
    future_bookings: future.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    pending_payouts: { count: (payouts ?? []).length, total_usd: Math.round(total * 100) / 100 },
    client_bookings: (asClient ?? []).map((b) => ({
      booking_id: b.id as string,
      scheduled_at: b.scheduled_at as string,
      creator_name: b.creator_id ? creatorNames.get(b.creator_id as string) || 'Creator' : null,
      price_usd: Number(b.price_usd || 0),
    })),
  };
}

export function registerAdminUserStatusRoutes(app: FastifyInstance) {
  /** What would disabling this user break? Read-only; drives the portal's
   *  confirmation dialog so the admin sees consequences before deciding. */
  app.get<{ Params: { userId: string } }>(
    '/v1/admin/users/:userId/commitments',
    async (request, reply) => {
      if (!(await requireAdmin(request, reply))) return;
      return commitmentsFor(request.params.userId);
    },
  );

  /**
   * REASSIGN a booking to another creator, splitting the payout.
   *
   * This is the way out of the active-session 409: a creator is mid-shoot (or
   * about to be) and has to be switched off, so someone else takes the job
   * and the money is divided between them.
   *
   * THE SPLIT IS WRITTEN NOW, not deferred. The outgoing creator's share
   * becomes a real payout row at reassignment time, on the normal hold, so
   * they can see what they earned instead of waiting on a booking they no
   * longer have. createPayoutForBooking then pays the replacement the
   * remainder when the session completes.
   *
   * The suggested split is pro-rata on elapsed time, which is a starting
   * point and not a rule — a shoot abandoned ten minutes in may still be
   * worth most of the fee, or none of it. The admin sets the number.
   */
  app.post<{
    Params: { bookingId: string };
    Body: { creator_id?: string; original_payout_usd?: number; reason?: string };
  }>('/v1/admin/bookings/:bookingId/reassign', async (request, reply) => {
    const adminId = await requireAdmin(request, reply);
    if (!adminId) return;
    const newCreatorId = request.body?.creator_id;
    if (!newCreatorId) return reply.code(400).send({ error: 'creator_id required' });

    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, creator_id, status, scheduled_at, duration_hours, price_usd, pricing_snapshot, occasion, area, type')
      .eq('id', request.params.bookingId)
      .maybeSingle();
    if (!booking) return reply.code(404).send({ error: 'Not found' });
    if (!booking.creator_id) {
      return reply.code(409).send({ error: 'That booking has no creator to reassign from — dispatch it instead.' });
    }
    if (booking.creator_id === newCreatorId) {
      return reply.code(409).send({ error: 'That creator already has this booking.' });
    }
    if (!['pending', 'confirmed'].includes(booking.status as string)) {
      return reply.code(409).send({ error: `A ${booking.status} booking cannot be reassigned.` });
    }
    const outgoingId = booking.creator_id as string;

    /**
     * Never split money that has already been paid out. Status alone nearly
     * covers this — every createPayoutForBooking call site moves the booking
     * to completed/no_show — but one of them writes the payout BEFORE the
     * status update, leaving a window where a reassignment would add a split
     * on top of a full payout. Checking the payout rows directly closes that
     * window and does not rely on call sites keeping their ordering.
     */
    const { data: paidAlready } = await supabaseAdmin
      .from('creator_payouts')
      .select('id')
      .eq('booking_id', booking.id)
      .limit(1);
    if ((paidAlready ?? []).length > 0) {
      return reply.code(409).send({
        error: 'That booking has already been paid out — it cannot be reassigned.',
      });
    }

    // The replacement has to be able to actually do it.
    const { data: replacement } = await supabaseAdmin
      .from('creator_profiles')
      .select('user_id, vetting_status')
      .eq('user_id', newCreatorId)
      .maybeSingle();
    if (!replacement || replacement.vetting_status !== 'approved') {
      return reply.code(409).send({ error: 'That replacement is not an approved creator.' });
    }
    const { data: replacementProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name, status')
      .eq('id', newCreatorId)
      .maybeSingle();
    if (!replacementProfile || replacementProfile.status === 'disabled') {
      return reply.code(409).send({ error: 'That replacement account is disabled.' });
    }

    const full = await estimateCreatorPayout(booking as unknown as BookingRow, outgoingId);
    // Pro-rata suggestion: how much of the booked time the outgoing creator
    // actually covered. Zero before the session starts.
    const start = booking.scheduled_at ? new Date(booking.scheduled_at as string) : null;
    const durationMs = (Number(booking.duration_hours) || 1) * 3600_000;
    const elapsed = start ? Math.min(Math.max(Date.now() - start.getTime(), 0), durationMs) : 0;
    const suggested = Math.round(full * (elapsed / durationMs) * 100) / 100;

    const requested = request.body?.original_payout_usd;
    const originalShare =
      typeof requested === 'number' && Number.isFinite(requested) ? Math.round(requested * 100) / 100 : suggested;
    if (originalShare < 0 || originalShare > full) {
      return reply.code(400).send({
        error: `The outgoing creator's share must be between $0.00 and $${full.toFixed(2)}.`,
        full_payout_usd: full,
        suggested_usd: suggested,
      });
    }

    // Outgoing creator's money first — before the booking moves, so a failure
    // here cannot leave them without the job AND without the payout.
    if (originalShare > 0) {
      const config = await getConfig();
      const holdDays = (config['payout_hold_days'] as number) ?? 7;
      // The rate this share was already netted at — recorded, not zeroed, so
      // the earnings breakdown and any later audit read the same number the
      // money was actually computed with.
      const { rate, isPromo } = await feeRateFor(outgoingId);
      const { error: payErr } = await supabaseAdmin.from('creator_payouts').insert({
        creator_id: outgoingId,
        booking_id: booking.id,
        amount_usd: originalShare,
        fee_rate_applied: rate,
        is_promo_rate: isPromo,
        status: 'held',
        hold_until: new Date(Date.now() + holdDays * 86400_000).toISOString(),
      });
      if (payErr) {
        request.log.error({ err: payErr }, 'reassign: payout split failed');
        return reply.code(500).send({ error: "Couldn't record the payout split — nothing was changed." });
      }
    }

    const { error: moveErr } = await supabaseAdmin
      .from('bookings')
      .update({ creator_id: newCreatorId })
      .eq('id', booking.id);
    if (moveErr) {
      request.log.error({ err: moveErr }, 'reassign: booking move failed');
      return reply.code(500).send({ error: "Couldn't move that booking — check the payout split before retrying." });
    }

    // What the replacement stands to earn, at the OUTGOING creator's rate.
    // Their actual payout is recomputed at their own rate when the session
    // completes, so this is a reportable figure rather than a promise — the
    // two differ only when one of them is on a promo rate.
    const movedToReplacement = Math.round((full - originalShare) * 100) / 100;
    // `booking_reassigned` / `payout_moved_usd` are read verbatim by the
    // restore summary — renaming either silently empties that report.
    await audit(adminId, 'booking_reassigned', outgoingId, {
      booking_id: booking.id,
      to_creator_id: newCreatorId,
      full_payout_usd: full,
      original_payout_usd: originalShare,
      payout_moved_usd: movedToReplacement,
      suggested_usd: suggested,
      overrode_suggestion: typeof requested === 'number' && requested !== suggested,
      reason: (request.body?.reason ?? '').trim() || null,
    });

    await notify(
      outgoingId,
      'booking_reassigned',
      'A booking was reassigned',
      originalShare > 0
        ? 'This booking has been passed to another creator. Your share of {amount} is on its normal payout hold.'
        : 'This booking has been passed to another creator.',
      { booking_id: booking.id, audience: 'creator' },
      originalShare > 0 ? { amount: originalShare } : {},
    );
    await notify(
      newCreatorId,
      'booking_reassigned',
      'A booking was assigned to you',
      booking.type === 'remote'
        ? 'A remote edit order has been passed to you — open it to pick up the client\'s footage.'
        : `A ${booking.occasion ?? 'session'} booking near ${booking.area ?? 'you'} has been passed to you.`,
      { booking_id: booking.id, audience: 'creator' },
    );
    await notify(
      booking.client_id as string,
      'booking_reassigned',
      'Your creator has changed',
      `${replacementProfile.full_name || 'Another creator'} will be covering your booking. The time, place and price are unchanged.`,
      { booking_id: booking.id, audience: 'client' },
    );

    return {
      reassigned: true,
      full_payout_usd: full,
      original_payout_usd: originalShare,
      payout_moved_usd: movedToReplacement,
    };
  });

  /**
   * DISABLE. Requires a reason. Future bookings are returned to unassigned
   * so dispatch can re-place them — a disable must never orphan paid work.
   * An active session must be resolved by the caller first (the portal shows
   * it); this refuses rather than silently stranding a client mid-shoot.
   */
  app.post<{ Params: { userId: string }; Body: { reason?: string; force?: boolean } }>(
    '/v1/admin/users/:userId/disable',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const reason = (request.body?.reason ?? '').trim();
      if (reason.length < 3) {
        return reply.code(400).send({ error: 'A reason is required to disable an account.' });
      }
      const userId = request.params.userId;
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, status')
        .eq('id', userId)
        .maybeSingle();
      if (!profile) return reply.code(404).send({ error: 'Not found' });
      if (profile.status === 'disabled') return { disabled: true, already: true };

      const commitments = await commitmentsFor(userId);
      if (commitments.active_session && !request.body?.force) {
        // Loud, not silent: the admin must reassign (or explicitly force).
        return reply.code(409).send({
          error: 'This creator has a session in progress or starting within four hours. Reassign it before disabling.',
          code: 'active_session',
          commitments,
        });
      }
      /**
       * ASSIGNED WORK the old flow could not see: unscheduled remote orders,
       * pending offers, and scheduled work whose date has passed with nothing
       * delivered. Each one is paid work with this creator's name on it, so
       * the admin resolves them one by one — reassign to another eligible
       * creator, or return to dispatch — before the disable can complete.
       *
       * Same shape as the active-session refusal above: loud, listed, and
       * forceable only deliberately.
       */
      if (commitments.assigned_work.length > 0 && !request.body?.force) {
        const n = commitments.assigned_work.length;
        return reply.code(409).send({
          error: `This creator has ${n} assigned job${n === 1 ? '' : 's'} that ${n === 1 ? 'is' : 'are'} not finished — including remote orders with no session date. Reassign or return each to dispatch before disabling.`,
          code: 'assigned_work',
          commitments,
        });
      }

      /**
       * The same person as a CLIENT. Their bookings are paid and a creator is
       * expecting to turn up, so this refuses too — but it deliberately does
       * NOT cancel or refund. Money never moves as a side effect of an admin
       * toggle; cancelling is its own decision, made on the booking, with the
       * refund rules that flow applies. Forcing past this leaves the bookings
       * standing and raises an alert instead of quietly stranding a creator.
       */
      if (commitments.client_bookings.length > 0 && !request.body?.force) {
        return reply.code(409).send({
          error: `This client has ${commitments.client_bookings.length} paid booking${commitments.client_bookings.length === 1 ? '' : 's'} still to come. Cancel and refund ${commitments.client_bookings.length === 1 ? 'it' : 'them'} first, or disable anyway to leave ${commitments.client_bookings.length === 1 ? 'it' : 'them'} standing.`,
          code: 'client_paid_bookings',
          commitments,
        });
      }

      // Future bookings go back in the pool rather than staying attached to
      // an account that can no longer work them.
      const unassigned: string[] = [];
      for (const b of commitments.future_bookings) {
        await supabaseAdmin
          .from('bookings')
          .update({ creator_id: null, status: 'pending', offer_expires_at: null })
          .eq('id', b.booking_id);
        unassigned.push(b.booking_id);
      }

      /**
       * Forced past assigned work. Each job returns to dispatch rather than
       * staying attached to an account that cannot do it — and because that
       * is a real change to someone's order, each one raises an alert and
       * tells the client their creator changed. No silent path.
       */
      for (const w of commitments.assigned_work) {
        await supabaseAdmin
          .from('bookings')
          .update({ creator_id: null, status: 'pending', offer_expires_at: null })
          .eq('id', w.booking_id);
        unassigned.push(w.booking_id);
        await supabaseAdmin.from('admin_alerts').insert({
          alert_type: 'assigned_work_returned_to_dispatch',
          booking_id: w.booking_id,
          detail: {
            reason: 'creator_disabled',
            creator_id: userId,
            creator_name: profile.full_name ?? null,
            kind: w.kind,
            price_usd: w.price_usd,
            forced: true,
          },
        });
        // The client's own account may itself be disabled (a self-booking, or
        // both sides switched off) — notify() drops those, so this is safe to
        // call unconditionally.
        await notify(
          w.client_id,
          'booking_reassigned',
          'Your creator changed',
          'The creator on your order is no longer available. It has gone back to our dispatch queue and we are matching you with someone else.',
          { booking_id: w.booking_id },
        );
      }

      // Record what availability WAS, so the audit trail can distinguish a
      // creator who was already unavailable from one we switched off.
      const { data: creator } = await supabaseAdmin
        .from('creator_profiles')
        .select('is_available')
        .eq('user_id', userId)
        .maybeSingle();

      const { error: markErr } = await supabaseAdmin
        .from('profiles')
        .update({ status: 'disabled', disabled_at: new Date().toISOString(), disabled_reason: reason })
        .eq('id', userId);
      if (markErr) {
        request.log.error({ err: markErr }, 'disable failed');
        return reply.code(500).send({ error: "Couldn't disable that account — try again." });
      }

      // Refuse LOGIN. The app authenticates directly against GoTrue, so this
      // is the only lever that can stop a sign-in — and it also invalidates
      // refresh, capping any live session at its remaining access-token life.
      let banned = true;
      try {
        await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' });
      } catch (err) {
        banned = false;
        request.log.error({ err }, 'disable: GoTrue ban failed');
      }

      // Push tokens go now: a disabled account must not buzz a phone even if
      // some future code path forgets to check status.
      await supabaseAdmin.from('push_tokens').delete().eq('user_id', userId);

      /**
       * Forced past paid client bookings. They stay standing and no money
       * moves — but the creator booked for them must not find out by turning
       * up. One alert per booking for ops, one notification for the creator.
       */
      for (const cb of commitments.client_bookings) {
        await supabaseAdmin.from('admin_alerts').insert({
          alert_type: 'client_disabled_with_paid_booking',
          booking_id: cb.booking_id,
          detail: { client_id: userId, scheduled_at: cb.scheduled_at, price_usd: cb.price_usd },
        });
        const { data: b } = await supabaseAdmin
          .from('bookings')
          .select('creator_id')
          .eq('id', cb.booking_id)
          .maybeSingle();
        if (b?.creator_id) {
          await notify(
            b.creator_id as string,
            'client_account_disabled',
            'A booking needs checking before you travel',
            "The client on one of your upcoming bookings has had their Snapt account disabled. Don't set off for this one until we confirm it — we'll be in touch.",
            { booking_id: cb.booking_id, audience: 'creator' },
          );
        }
      }

      await audit(adminId, 'user_disabled', userId, {
        reason,
        bookings_unassigned: unassigned,
        pending_payouts: commitments.pending_payouts,
        was_available: creator?.is_available ?? null,
        active_session_forced: Boolean(commitments.active_session && request.body?.force),
        client_bookings_left_standing: commitments.client_bookings.map((c) => c.booking_id),
        login_ban_applied: banned,
      });

      return {
        disabled: true,
        bookings_unassigned: unassigned.length,
        client_bookings_left_standing: commitments.client_bookings.length,
        pending_payouts: commitments.pending_payouts,
        login_ban_applied: banned,
      };
    },
  );

  /**
   * RESTORE. Deliberately NOT a mirror of disable.
   *
   * Access returns immediately and completely. What was reassigned STAYS
   * reassigned — a replacement creator may already have done the work, and
   * silently reverting that would take a job away from someone who earned
   * it. Bookings sent back to the pool stay in the pool; dispatch re-assigns
   * deliberately if the restored creator should have them.
   *
   * Availability is forced OFF, uniformly: a restored creator opts back in
   * consciously rather than being handed a live offer the second the switch
   * flips. eligibleCreators filters on is_available, so this removes them
   * from matching, client lists and the dispatch picker until they choose.
   */
  app.post<{ Params: { userId: string }; Body: { reason?: string } }>(
    '/v1/admin/users/:userId/restore',
    async (request, reply) => {
      const adminId = await requireAdmin(request, reply);
      if (!adminId) return;
      const userId = request.params.userId;
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, status, disabled_at')
        .eq('id', userId)
        .maybeSingle();
      if (!profile) return reply.code(404).send({ error: 'Not found' });
      if (profile.status !== 'disabled') return { restored: true, already: true };

      const disabledAt = profile.disabled_at as string | null;

      // What happened while they were off — read from the audit trail so the
      // admin gets a summary without digging, and so the restore entry can
      // reference the disable it reverses.
      const { data: entries } = await supabaseAdmin
        .from('admin_actions')
        .select('id, action, detail, created_at')
        .eq('target', userId)
        .gte('created_at', disabledAt ?? new Date(0).toISOString())
        .order('created_at', { ascending: false });
      const disableEntry = (entries ?? []).find((e) => e.action === 'user_disabled');
      const detail = (disableEntry?.detail ?? {}) as Record<string, unknown>;
      const reassignEntries = (entries ?? []).filter((e) => e.action === 'booking_reassigned');
      const summary = {
        bookings_unassigned: ((detail['bookings_unassigned'] as string[]) ?? []).length,
        bookings_reassigned: reassignEntries.length,
        payouts_moved_usd: reassignEntries.reduce(
          (s, e) => s + Number(((e.detail ?? {}) as Record<string, unknown>)['payout_moved_usd'] ?? 0),
          0,
        ),
        pending_payouts: (detail['pending_payouts'] as Record<string, unknown>) ?? { count: 0, total_usd: 0 },
      };

      const { error: clearErr } = await supabaseAdmin
        .from('profiles')
        .update({ status: 'active', disabled_at: null, disabled_reason: null })
        .eq('id', userId);
      if (clearErr) {
        request.log.error({ err: clearErr }, 'restore failed');
        return reply.code(500).send({ error: "Couldn't restore that account — try again." });
      }

      try {
        await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      } catch (err) {
        request.log.error({ err }, 'restore: lifting GoTrue ban failed');
        return reply.code(500).send({
          error: "Account status cleared but the login ban could not be lifted — try restoring again.",
        });
      }

      // Availability off, uniformly — a conscious opt-in, never an automatic
      // return to the matching pool. No-ops for non-creators.
      await supabaseAdmin
        .from('creator_profiles')
        .update({ is_available: false })
        .eq('user_id', userId);

      await audit(adminId, 'user_restored', userId, {
        reason: (request.body?.reason ?? '').trim() || null,
        reverses_disable_action_id: disableEntry?.id ?? null,
        disabled_at: disabledAt,
        summary,
        availability_forced_off: true,
      });

      // ONE notification, sent AFTER status is active so notify() doesn't
      // suppress it. Says plainly if work moved on while they were away.
      const moved = summary.bookings_reassigned + summary.bookings_unassigned;
      await notify(
        userId,
        'account_restored',
        'Your account is active again',
        moved > 0
          ? `You can sign in and use Snapt again. While your account was off, ${moved} booking${moved === 1 ? '' : 's'} ${moved === 1 ? 'was' : 'were'} reassigned or returned to dispatch, so your schedule may look different. Set yourself Available when you're ready for new work.`
          : "You can sign in and use Snapt again. Set yourself Available when you're ready for new work.",
      );

      return { restored: true, summary };
    },
  );
}
