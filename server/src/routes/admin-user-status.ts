import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { requireAdmin, audit } from '../admin-auth.js';
import { notify } from '../notify.js';

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
  pending_payouts: { count: number; total_usd: number };
}

/** What this user owes the platform before they can be switched off. */
async function commitmentsFor(userId: string): Promise<Commitments> {
  const now = new Date();
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, client_id, scheduled_at, duration_hours, status, price_usd, pricing_snapshot')
    .eq('creator_id', userId)
    .in('status', ['pending', 'confirmed']);

  const names = new Map<string, string>();
  const clientIds = [...new Set((bookings ?? []).map((b) => b.client_id as string))];
  if (clientIds.length) {
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .in('id', clientIds);
    for (const p of profiles ?? []) names.set(p.id as string, (p.full_name as string) || 'Client');
  }

  let active: Commitments['active_session'] = null;
  const future: Commitments['future_bookings'] = [];
  for (const b of bookings ?? []) {
    if (!b.scheduled_at) continue;
    const start = new Date(b.scheduled_at as string);
    const end = new Date(start.getTime() + (Number(b.duration_hours) || 1) * 3600_000);
    const snapshot = (b.pricing_snapshot ?? {}) as Record<string, unknown>;
    if (end >= now && start <= new Date(now.getTime() + 4 * 3600_000)) {
      // Happening now, or close enough that reassignment is urgent.
      active = {
        booking_id: b.id as string,
        client_id: b.client_id as string,
        client_name: names.get(b.client_id as string) ?? 'Client',
        scheduled_at: b.scheduled_at as string,
        started: start <= now,
        creator_payout_usd: Number(snapshot['creator_payout_usd'] ?? 0),
      };
    } else if (start > now) {
      future.push({
        booking_id: b.id as string,
        scheduled_at: b.scheduled_at as string,
        client_name: names.get(b.client_id as string) ?? 'Client',
      });
    }
  }

  const { data: payouts } = await supabaseAdmin
    .from('creator_payouts')
    .select('amount_usd')
    .eq('creator_id', userId)
    .in('status', ['held', 'requested', 'available']);
  const total = (payouts ?? []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);

  return {
    active_session: active,
    future_bookings: future.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)),
    pending_payouts: { count: (payouts ?? []).length, total_usd: Math.round(total * 100) / 100 },
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

      await audit(adminId, 'user_disabled', userId, {
        reason,
        bookings_unassigned: unassigned,
        pending_payouts: commitments.pending_payouts,
        was_available: creator?.is_available ?? null,
        active_session_forced: Boolean(commitments.active_session && request.body?.force),
        login_ban_applied: banned,
      });

      return {
        disabled: true,
        bookings_unassigned: unassigned.length,
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
