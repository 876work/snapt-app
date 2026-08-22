import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { getConfig, inPersonAddonPrices, remoteAddonPrices } from '../config.js';
import { notify } from '../notify.js';

// Revision flow (Policy 08 §2 first step): client requests → creator
// re-delivers via the media pipeline → marks the round delivered.
// Entitlement = free rounds (config) + extra_revisions purchased at booking.

export function registerRevisionRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { details?: string } }>(
    '/v1/bookings/:id/revisions',
    async (request, reply) => {
      const user = requireUser(request);
      const details = request.body?.details?.trim();
      if (!details) return reply.code(400).send({ error: 'Describe what needs to change' });
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, client_id, creator_id, status, pricing_snapshot')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (user.id !== booking.client_id) return reply.code(403).send({ error: 'Not your booking' });
      if (booking.status !== 'completed') {
        return reply.code(409).send({ error: 'Revisions open after delivery' });
      }

      /**
       * ONE OPEN ROUND AT A TIME — enforced, not just assumed.
       *
       * This flow is a loop: client requests → creator re-delivers → marks
       * the round delivered. Every other part of it already assumes one open
       * request (the deliver route closes a single id and refuses if it is
       * not open; both creator screens read one). Nothing enforced it, so
       * with enough entitlement a client could open a second while the first
       * was live — and orders aec459a2 and fb32aef6 did exactly that on
       * 2026-08-21/22, leaving a request whose text the creator never saw.
       * A creator working from stale instructions while newer ones sit
       * invisible is a dispute waiting to happen.
       *
       * REFUSED, not queued and not replaced: queueing needs round ordering
       * and an entitlement model that separates requested from consumed, and
       * replacing would destroy what the client wrote.
       *
       * Checked BEFORE entitlement so the client is told the true reason. The
       * copy deliberately avoids "used up" — the app offers to sell another
       * round on that phrase, and another round is not what is needed here.
       */
      const { data: alreadyOpen } = await supabaseAdmin
        .from('revision_requests')
        .select('id')
        .eq('booking_id', booking.id)
        .eq('status', 'open')
        .limit(1)
        .maybeSingle();
      if (alreadyOpen) {
        return reply.code(409).send({
          error:
            "Your creator is working on your last request — you'll be able to send another once they've delivered it.",
          code: 'revision_open',
        });
      }

      const config = await getConfig();
      const freeRounds = (config['free_revisions_per_order'] as number) ?? 1;
      const purchased = Number(
        (booking.pricing_snapshot as { addons?: { extra_revisions?: number } })?.addons
          ?.extra_revisions ?? 0,
      );
      const { count } = await supabaseAdmin
        .from('revision_requests')
        .select('id', { count: 'exact', head: true })
        .eq('booking_id', booking.id);
      if ((count ?? 0) >= freeRounds + purchased) {
        // Post-delivery add-on purchase isn't built yet (flagged) — the only
        // paid rounds are the ones bought at booking time.
        return reply.code(409).send({
          error: 'Revision rounds used up for this order',
          action: 'purchase_revision',
        });
      }

      const { data: revision, error } = await supabaseAdmin
        .from('revision_requests')
        .insert({
          booking_id: booking.id,
          requested_by: user.id,
          details,
          is_free: (count ?? 0) < freeRounds,
        })
        .select()
        .single();
      if (error) return reply.code(500).send({ error: error.message });
      if (booking.creator_id) {
        await notify(booking.creator_id, 'revision_requested', 'Revision requested',
          'The client asked for changes to their delivery — see what they need and re-deliver in the app.',
          { booking_id: booking.id });
      }
      return reply.code(201).send({ revision });
    },
  );

  // Post-delivery purchase of an additional round — same add-on pricing and
  // charge pattern as booking-time add-ons (Policy 05 §3.4: add-ons are
  // charged when ordered). Increments the snapshot entitlement.
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/revisions/purchase', async (request, reply) => {
    const user = requireUser(request);
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, type, status, pricing_snapshot')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!booking) return reply.code(404).send({ error: 'Booking not found' });
    if (user.id !== booking.client_id) return reply.code(403).send({ error: 'Not your booking' });
    if (booking.status !== 'completed') {
      return reply.code(409).send({ error: 'Extra rounds are purchased after delivery' });
    }
    const prices = booking.type === 'remote' ? await remoteAddonPrices() : await inPersonAddonPrices();
    const config = await getConfig();
    const feeRate = (config['client_service_fee_rate'] as number) ?? 0.08;
    const charge = Math.round(prices.extra_revision * (1 + feeRate) * 100) / 100;

    // Simulated charge pre-Phase 7, same as booking-time payments.
    await supabaseAdmin.from('transactions').insert({
      booking_id: booking.id,
      user_id: user.id,
      type: 'charge',
      status: 'succeeded',
      amount_usd: charge,
      fees: { kind: 'extra_revision_purchase', base_usd: prices.extra_revision, fee_rate: feeRate },
    });
    const snapshot = (booking.pricing_snapshot ?? {}) as { addons?: Record<string, number> };
    const addons = { ...(snapshot.addons ?? {}) };
    addons.extra_revisions = Number(addons.extra_revisions ?? 0) + 1;
    addons.extra_revisions_usd = Number(addons.extra_revisions_usd ?? 0) + prices.extra_revision;
    await supabaseAdmin
      .from('bookings')
      .update({ pricing_snapshot: { ...snapshot, addons } })
      .eq('id', booking.id);
    await notify(user.id, 'payment_charged', 'Extra revision round added',
      '{amount} charged — you can now request another revision on this order.',
      { booking_id: booking.id }, { amount: charge });
    return reply.code(201).send({ purchased: true, charged_usd: charge });
  });

  app.post<{ Params: { id: string; revId: string } }>(
    '/v1/bookings/:id/revisions/:revId/deliver',
    async (request, reply) => {
      const user = requireUser(request);
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, client_id, creator_id')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Only the assigned creator delivers revisions' });
      }
      const { data: revision } = await supabaseAdmin
        .from('revision_requests')
        .select('id, status')
        .eq('id', request.params.revId)
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (!revision || revision.status !== 'open') {
        return reply.code(409).send({ error: 'No open revision round to deliver' });
      }
      await supabaseAdmin
        .from('revision_requests')
        .update({ status: 'delivered', delivered_at: new Date().toISOString() })
        .eq('id', revision.id);
      // A re-delivery is the new final delivery — the retention clocks for
      // this booking's files restart from here.
      await supabaseAdmin
        .from('bookings')
        .update({ delivered_at: new Date().toISOString() })
        .eq('id', booking.id);
      await notify(booking.client_id, 'revision_delivered', 'Your revision is ready',
        'The updated files are in — open the app to view and download them.',
        { booking_id: booking.id });
      return { delivered: true };
    },
  );

  /**
   * FLAG A REQUEST AS BEYOND WHAT WAS BOOKED — a signal, never a stop button.
   *
   * A creator facing a request outside the order had two options: do it, or
   * ignore it. This is the third, and it deliberately changes NOTHING about
   * the round: it stays open, it stays deliverable, and the creator can go on
   * and deliver it. Nothing here touches booking status or payouts, which is
   * why this is not a dispute.
   *
   * THE CLIENT IS NEVER TOLD. No notify() call, and target_user_id is left
   * NULL rather than set to the client — belt and braces, because the
   * moderation pipeline's automation keys on target_user_id and severity, and
   * a 'medium' report with a target can suspend an account or send it a
   * content-policy warning. A client learning their request was flagged is
   * the exact outcome this feature exists to avoid, so the row is shaped so
   * that no existing automation can reach them: severity 'low' has no
   * consequence branch at all, and there is no target to act on.
   *
   * This is deliberately NOT POST /v1/reports. That endpoint's automation is
   * the hazard above, and it has no concept of a revision, so flag-once could
   * not be enforced there.
   *
   * NOT A NEGOTIATION. There is no amount, no counter-offer and no reply
   * path: standardised pricing is a locked rule. It files a sentence for an
   * admin to read.
   */
  app.post<{ Params: { id: string; revId: string }; Body: { reason?: string } }>(
    '/v1/bookings/:id/revisions/:revId/flag',
    async (request, reply) => {
      const user = requireUser(request);
      const reason = request.body?.reason?.trim();
      if (!reason || reason.length < 10) {
        return reply.code(400).send({ error: 'Say briefly why this is beyond the order' });
      }
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, client_id, creator_id')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Only the assigned creator can flag a request' });
      }
      const { data: revision } = await supabaseAdmin
        .from('revision_requests')
        .select('id, status')
        .eq('id', request.params.revId)
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (!revision) return reply.code(404).send({ error: 'No such revision request on this order' });

      // Checked first so a second tap reads as a sentence rather than a
      // database error; the partial unique index is what actually holds when
      // two are in flight at once.
      const { data: already } = await supabaseAdmin
        .from('content_reports')
        .select('id')
        .eq('revision_id', revision.id)
        .eq('category', 'revision_scope')
        .maybeSingle();
      if (already) {
        return reply.code(409).send({ error: "You've already flagged this request for review." });
      }

      const { data: report, error } = await supabaseAdmin
        .from('content_reports')
        .insert({
          reporter_id: user.id,
          target_user_id: null,
          booking_id: booking.id,
          revision_id: revision.id,
          category: 'revision_scope',
          severity: 'low',
          details: reason,
        })
        .select('id')
        .single();
      if (error) {
        // 23505 = the unique index caught a race the check above could not.
        if ((error as { code?: string }).code === '23505') {
          return reply.code(409).send({ error: "You've already flagged this request for review." });
        }
        request.log.error({ err: error, revisionId: revision.id }, 'revision flag insert failed');
        return reply.code(500).send({ error: "Couldn't file that just now — try again in a minute." });
      }

      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: 'revision_scope_flagged',
        booking_id: booking.id,
        detail: { report_id: report.id, revision_id: revision.id, creator_id: user.id },
      });
      return reply.code(201).send({ flagged: true });
    },
  );

  app.get<{ Params: { id: string } }>('/v1/bookings/:id/revisions', async (request, reply) => {
    const user = requireUser(request);
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, creator_id')
      .eq('id', request.params.id)
      .maybeSingle();
    if (!booking) return reply.code(404).send({ error: 'Booking not found' });
    if (user.id !== booking.client_id && user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Not your booking' });
    }
    const { data } = await supabaseAdmin
      .from('revision_requests')
      .select('*')
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: true });
    const rows = data ?? [];

    /**
     * `flagged` IS FOR THE CREATOR ONLY.
     *
     * This route serves both roles, and the whole point of the flag is that
     * the client never learns their request was questioned. So the field is
     * attached only when the caller is the assigned creator — the client's
     * response is byte-identical to what it was before. It exists so the
     * creator's screen can show a request as already flagged and stop
     * offering the control twice.
     */
    if (user.id !== booking.creator_id || rows.length === 0) {
      return { revisions: rows };
    }
    const { data: flags } = await supabaseAdmin
      .from('content_reports')
      .select('revision_id')
      .eq('category', 'revision_scope')
      .in(
        'revision_id',
        rows.map((r) => r.id),
      );
    const flagged = new Set((flags ?? []).map((f) => f.revision_id));
    return { revisions: rows.map((r) => ({ ...r, flagged: flagged.has(r.id) })) };
  });
}
