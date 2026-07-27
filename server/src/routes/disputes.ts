import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { getConfig } from '../config.js';
import { notify } from '../notify.js';
import { env } from '../env.js';

// Phase 4 dispute intake (§10): tied to a booking, 72h evidence window,
// and payout freezing — an open dispute blocks the booking's payout from
// releasing until resolution.
//
// Edge case (confirmed CLOSED structurally, not by timing luck): a dispute
// can only be OPENED while the booking's payout is still held — once the
// payout has released (available/paid_out), intake returns 409. Since the
// hold equals the filing window (both 7 days), nothing can slip between;
// if either value ever changes independently, this check still prevents a
// dispute against released money, so no clawback path is ever needed.

export function registerDisputeRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { category?: string; description?: string } }>(
    '/v1/bookings/:id/disputes',
    async (request, reply) => {
      const user = requireUser(request);
      const { category, description } = request.body ?? {};
      if (!category || !['quality', 'fulfillment', 'conduct', 'appeal'].includes(category)) {
        return reply.code(400).send({ error: 'category must be quality, fulfillment, conduct, or appeal' });
      }
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, client_id, creator_id, status')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (user.id !== booking.client_id && user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Not your booking' });
      }
      if (!['completed', 'no_show', 'cancelled', 'disputed'].includes(booking.status)) {
        return reply.code(409).send({ error: 'Disputes open after a session/delivery outcome' });
      }

      // Policy 08 §2: the free revision round is the REQUIRED first step
      // for quality disputes — a quality dispute opens only if a delivered
      // revision still allegedly fails the package spec.
      if (category === 'quality') {
        const { count: revised } = await supabaseAdmin
          .from('revision_requests')
          .select('id', { count: 'exact', head: true })
          .eq('booking_id', booking.id)
          .eq('status', 'delivered');
        if (!revised) {
          return reply.code(409).send({
            error: 'Quality concerns start with your included revision round — request a revision first; a dispute opens only if the revised delivery still falls short.',
            action: 'request_revision',
          });
        }
      }

      // Payout gate: filing is only possible while the payout is held.
      const { data: payout } = await supabaseAdmin
        .from('creator_payouts')
        .select('id, status')
        .eq('booking_id', booking.id)
        .maybeSingle();
      if (payout && payout.status !== 'held') {
        return reply.code(409).send({
          error: 'The dispute window for this booking has closed (funds already released)',
        });
      }

      const config = await getConfig();
      const evidenceHours = (config['dispute_evidence_window_hours'] as number) ?? 72;
      const { data: dispute, error } = await supabaseAdmin
        .from('disputes')
        .insert({
          booking_id: booking.id,
          opened_by: user.id,
          category,
          status: 'evidence_window',
          description: description ?? '',
          evidence_deadline_at: new Date(Date.now() + evidenceHours * 3600_000).toISOString(),
        })
        .select()
        .single();
      if (error) return reply.code(500).send({ error: error.message });

      // Freeze the payout: hold_until = null never matches the lazy release
      // (< now) check, so the funds stay held until resolution.
      if (payout) {
        await supabaseAdmin
          .from('creator_payouts')
          .update({ status: 'held', hold_until: null })
          .eq('id', payout.id);
      }
      await supabaseAdmin.from('bookings').update({ status: 'disputed' }).eq('id', booking.id);

      for (const party of [booking.client_id, booking.creator_id]) {
        if (party) {
          await notify(
            party,
            'dispute_opened',
            'A dispute was opened',
            `A ${category} dispute is open on your booking. You have ${evidenceHours} hours to add evidence in the app.`,
          );
        }
      }
      return reply.code(201).send({ dispute });
    },
  );

  // Admin resolution (stopgap until the Phase 5 portal): records the
  // decision and releases or withholds the frozen payout.
  app.post<{
    Params: { disputeId: string };
    Body: { resolution?: string; release_payout?: boolean };
  }>('/v1/admin/disputes/:disputeId/resolve', async (request, reply) => {
    if (!env.adminApiToken) return reply.code(503).send({ error: 'Admin actions disabled' });
    if (request.headers['x-admin-token'] !== env.adminApiToken) {
      return reply.code(403).send({ error: 'Forbidden' });
    }
    const { data: dispute } = await supabaseAdmin
      .from('disputes')
      .select('id, booking_id, opened_by, status')
      .eq('id', request.params.disputeId)
      .maybeSingle();
    if (!dispute) return reply.code(404).send({ error: 'Dispute not found' });
    if (['resolved', 'closed'].includes(dispute.status)) {
      return reply.code(409).send({ error: 'Already resolved' });
    }

    await supabaseAdmin
      .from('disputes')
      .update({
        status: 'resolved',
        resolution: request.body?.resolution ?? '',
        resolved_at: new Date().toISOString(),
      })
      .eq('id', dispute.id);

    if (request.body?.release_payout) {
      await supabaseAdmin
        .from('creator_payouts')
        .update({ status: 'available', available_at: new Date().toISOString() })
        .eq('booking_id', dispute.booking_id)
        .eq('status', 'held');
    }
    const { data: booking } = await supabaseAdmin
      .from('bookings')
      .select('client_id, creator_id')
      .eq('id', dispute.booking_id)
      .single();
    for (const party of [booking?.client_id, booking?.creator_id]) {
      if (party) {
        await notify(party, 'dispute_resolved', 'Dispute resolved', 'Your dispute has been reviewed and resolved — see the outcome in the app.');
      }
    }
    return { resolved: true, payout_released: Boolean(request.body?.release_payout) };
  });
}
