import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { getConfig } from '../config.js';
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
          action: 'contact_support',
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
          'The client asked for changes to their delivery — see what they need and re-deliver in the app.');
      }
      return reply.code(201).send({ revision });
    },
  );

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
      await notify(booking.client_id, 'revision_delivered', 'Your revision is ready',
        'The updated files are in — open the app to view and download them.');
      return { delivered: true };
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
    return { revisions: data ?? [] };
  });
}
