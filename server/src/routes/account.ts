import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';
import { moneyFor } from '../money.js';
import { requireUser } from '../plugins/auth.js';
import { sendEmail } from '../email.js';

/**
 * Account deletion — the real thing (App Store Guideline 5.1.1(v)).
 *
 * Soft delete with a 30-day grace period:
 *   1. GUARDS refuse deletion while money or obligations are in flight —
 *      an active/upcoming booking, an undelivered order, a legal hold, or
 *      pending creator earnings. Each 409 says exactly what to resolve.
 *   2. profiles.deleted_at is stamped, push tokens are removed (a deleted
 *      account must never buzz a phone again), sign-in is banned at GoTrue
 *      so the ban also kills refresh — the client signs out immediately
 *      and cannot come back in.
 *   3. A confirmation email (Resend) states the grace period plainly.
 *
 * The scheduler's purge job (account-purge.ts) anonymizes PII once the
 * grace period lapses. Recovery within the window is a support action:
 * clear deleted_at, lift the ban.
 */
export function registerAccountRoutes(app: FastifyInstance) {
  app.post('/v1/account/delete', async (request, reply) => {
    const user = requireUser(request);

    const { data: me } = await supabaseAdmin
      .from('profiles')
      .select('full_name, email, deleted_at')
      .eq('id', user.id)
      .maybeSingle();
    if (me?.deleted_at) {
      // Already in grace — idempotent, not an error.
      return { deleted: true, already: true };
    }

    // ---- Guard 1: bookings still in flight --------------------------------
    // Blocking = anything not fully settled: an offer out or a confirmed
    // session (past or future — an unfinished session still needs delivery),
    // a completed session whose edits haven't been delivered, an open
    // dispute, or a legal hold.
    const { data: openBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, status, delivered_at, legal_hold, client_id, creator_id')
      .or(`client_id.eq.${user.id},creator_id.eq.${user.id}`);
    const blocking = (openBookings ?? []).filter(
      (b) =>
        b.legal_hold === true ||
        ['pending', 'confirmed', 'disputed'].includes(b.status as string) ||
        (b.status === 'completed' && !b.delivered_at),
    );
    if (blocking.length > 0) {
      const held = blocking.some((b) => b.legal_hold);
      return reply.code(409).send({
        error: held
          ? 'Part of your account is under review and cannot be deleted right now — contact hello@snaptcarib.app.'
          : `You have ${blocking.length} booking${blocking.length === 1 ? '' : 's'} that ${
              blocking.length === 1 ? "isn't" : "aren't"
            } finished — wait for delivery or cancel ${blocking.length === 1 ? 'it' : 'them'} first, then delete your account.`,
        code: held ? 'legal_hold' : 'open_bookings',
        booking_ids: blocking.map((b) => b.id),
      });
    }

    // ---- Guard 2: pending creator earnings --------------------------------
    // Earnings belong to a person; the account they belong to cannot vanish
    // while any are held, requested, or sitting uncashed.
    const { data: payouts } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, status, amount_usd')
      .eq('creator_id', user.id)
      .in('status', ['held', 'requested', 'available']);
    if ((payouts ?? []).length > 0) {
      const total = (payouts ?? []).reduce((s, p) => s + Number(p.amount_usd || 0), 0);
      return reply.code(409).send({
        error: `You have ${await moneyFor(user.id, total)} in earnings that haven't been paid out — cash out first, then delete your account.`,
        code: 'pending_earnings',
      });
    }

    // ---- Soft delete ------------------------------------------------------
    const now = new Date().toISOString();
    const { error: markErr } = await supabaseAdmin
      .from('profiles')
      .update({ deleted_at: now })
      .eq('id', user.id);
    if (markErr) {
      // Loud, never swallowed — the claim-error lesson from checkout.
      request.log.error({ err: markErr }, 'account deletion mark failed');
      return reply.code(500).send({ error: "Couldn't delete your account just now — try again." });
    }

    // Push tokens go immediately: a deleted account never buzzes a phone.
    await supabaseAdmin.from('push_tokens').delete().eq('user_id', user.id);

    // Ban sign-in for the grace window (720h = 30 days). The ban also kills
    // refresh-token use, so the current session dies with the client's local
    // sign-out; a stale access token can outlive this by at most its own
    // one-hour expiry.
    try {
      await supabaseAdmin.auth.admin.updateUserById(user.id, { ban_duration: '720h' });
    } catch (err) {
      request.log.error({ err }, 'account deletion: GoTrue ban failed (deletion proceeds)');
    }

    // Confirmation email — states the grace period honestly.
    const email = me?.email ?? user.email;
    if (email) {
      await sendEmail(
        email,
        'Your Snapt account is closed',
        `<p>Hi ${me?.full_name || 'there'},</p>
         <p>Your Snapt account was closed today. Your personal data will be permanently
         removed after a 30-day grace period. If this wasn't you, or you change your
         mind, reply to this email or contact hello@snaptcarib.app within 30 days and
         we'll restore your account. After that, recovery is not possible.</p>
         <p>Records we're legally required to keep (completed payments and booking
         history) are retained without your personal details, as described in our Data
         Retention Policy.</p>`,
      );
    }

    return { deleted: true, grace_days: 30, purge_after: new Date(Date.now() + 30 * 86400_000).toISOString() };
  });
}
