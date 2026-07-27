import type { FastifyInstance, FastifyReply } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { createPayoutForBooking } from '../payments.js';

// Phase 3 session lifecycle: check-in → safety-code verification → active →
// complete. Completion is THE payout trigger for a normal, non-disputed
// booking — it writes the CreatorPayout on the 7-day hold.

interface BookingRow {
  id: string;
  client_id: string;
  creator_id: string | null;
  type: string;
  status: string;
  scheduled_at: string | null;
  price_usd: number;
  pricing_snapshot: Record<string, unknown>;
}

async function loadBooking(id: string, reply: FastifyReply): Promise<BookingRow | null> {
  const { data } = await supabaseAdmin.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!data) {
    reply.code(404).send({ error: 'Booking not found' });
    return null;
  }
  return data as BookingRow;
}

async function getOrCreateSession(bookingId: string) {
  const { data: existing } = await supabaseAdmin
    .from('sessions')
    .select('*')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (existing) return existing;
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .insert({ booking_id: bookingId, safety_code: code })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export function registerSessionRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/v1/bookings/:id/session', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.client_id && user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Not your booking' });
    }
    return { session: await getOrCreateSession(booking.id) };
  });

  app.post<{ Params: { id: string } }>('/v1/bookings/:id/session/check-in', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (booking.status !== 'confirmed') {
      return reply.code(409).send({ error: `Booking is ${booking.status}` });
    }
    const role =
      user.id === booking.client_id ? 'client' : user.id === booking.creator_id ? 'creator' : null;
    if (!role) return reply.code(403).send({ error: 'Not your booking' });

    const session = await getOrCreateSession(booking.id);
    const patch: Record<string, string> = {};
    const now = new Date().toISOString();
    if (role === 'client' && !session.client_checked_in_at) patch.client_checked_in_at = now;
    if (role === 'creator' && !session.creator_checked_in_at) patch.creator_checked_in_at = now;
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from('sessions').update(patch).eq('id', session.id);
    }
    return { session: { ...session, ...patch } };
  });

  // Creator verifies the client's safety code — this is what flips the
  // session to active (SOS becomes available in-app only while active, §11).
  app.post<{ Params: { id: string }; Body: { code?: string } }>(
    '/v1/bookings/:id/session/verify-code',
    async (request, reply) => {
      const user = requireUser(request);
      const booking = await loadBooking(request.params.id, reply);
      if (!booking) return;
      if (user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Only the creator verifies the safety code' });
      }
      const session = await getOrCreateSession(booking.id);
      if (request.body?.code !== session.safety_code) {
        return reply.code(400).send({ error: 'Incorrect safety code' });
      }
      const now = new Date().toISOString();
      await supabaseAdmin
        .from('sessions')
        .update({ safety_code_verified_at: now, session_active_at: now })
        .eq('id', session.id);
      return { verified: true, session_active_at: now };
    },
  );

  // Session completion — the payout trigger. In-person: creator marks the
  // session complete after it ran; remote orders complete via /deliver.
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/complete', async (request, reply) => {
    const user = requireUser(request);
    const booking = await loadBooking(request.params.id, reply);
    if (!booking) return;
    if (user.id !== booking.creator_id) {
      return reply.code(403).send({ error: 'Only the assigned creator can complete a session' });
    }
    if (booking.status !== 'confirmed') {
      return reply.code(409).send({ error: `Booking is ${booking.status}` });
    }
    if (booking.type !== 'in_person') {
      return reply.code(422).send({ error: 'Remote orders complete via delivery' });
    }
    const session = await getOrCreateSession(booking.id);
    if (!session.session_active_at) {
      return reply
        .code(409)
        .send({ error: 'Session was never active — verify the safety code at check-in first' });
    }
    const now = new Date().toISOString();
    await supabaseAdmin
      .from('sessions')
      .update({ session_ended_at: session.session_ended_at ?? now })
      .eq('id', session.id);
    await supabaseAdmin.from('bookings').update({ status: 'completed' }).eq('id', booking.id);
    // Starts the 7-day hold (= dispute window). Idempotency guard inside.
    await createPayoutForBooking(booking);
    return { completed: true, payout: 'held_7_days' };
  });
}
