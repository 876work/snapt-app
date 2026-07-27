import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { sendEmail } from '../email.js';
import { notify } from '../notify.js';

// Phase 4 safety backend (§11). End session is FRICTIONLESS by design — no
// fee calculation, no penalty logic, no gating; it just ends. SOS-level
// reports escalate in real time (email to on-call) — never dashboard-only.

const ONCALL = (process.env.ONCALL_EMAILS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean);

async function getSession(bookingId: string) {
  const { data } = await supabaseAdmin
    .from('sessions')
    .select('id, booking_id')
    .eq('booking_id', bookingId)
    .maybeSingle();
  return data;
}

export function registerSafetyRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/v1/bookings/:id/safety/end-session', async (request, reply) => {
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
    const session = await getSession(booking.id);
    if (!session) return reply.code(409).send({ error: 'No session for this booking' });

    // No penalties, no fees — end it immediately, record for admin review.
    await supabaseAdmin
      .from('sessions')
      .update({ session_ended_at: new Date().toISOString(), end_reason: 'safety_end' })
      .eq('id', session.id);
    await supabaseAdmin.from('safety_reports').insert({
      session_id: session.id,
      reporter_id: user.id,
      type: 'end_session',
      queue_status: 'new',
    });
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'session_ended_safety',
      booking_id: booking.id,
      detail: { reporter_id: user.id },
    });
    return { ended: true };
  });

  app.post<{ Params: { id: string }; Body: { type?: 'sos' | 'safety_concern'; details?: string } }>(
    '/v1/bookings/:id/safety/report',
    async (request, reply) => {
      const user = requireUser(request);
      const { type, details } = request.body ?? {};
      if (type !== 'sos' && type !== 'safety_concern') {
        return reply.code(400).send({ error: 'type must be sos or safety_concern' });
      }
      const { data: booking } = await supabaseAdmin
        .from('bookings')
        .select('id, client_id, creator_id, area, meeting_point')
        .eq('id', request.params.id)
        .maybeSingle();
      if (!booking) return reply.code(404).send({ error: 'Booking not found' });
      if (user.id !== booking.client_id && user.id !== booking.creator_id) {
        return reply.code(403).send({ error: 'Not your booking' });
      }
      const session = await getSession(booking.id);
      if (!session) return reply.code(409).send({ error: 'No session for this booking' });

      const { data: report } = await supabaseAdmin
        .from('safety_reports')
        .insert({
          session_id: session.id,
          reporter_id: user.id,
          type,
          details: details ?? null,
          queue_status: type === 'sos' ? 'escalated' : 'new',
          escalated_at: type === 'sos' ? new Date().toISOString() : null,
        })
        .select('id')
        .single();
      await supabaseAdmin.from('admin_alerts').insert({
        alert_type: type === 'sos' ? 'sos' : 'safety_concern',
        booking_id: booking.id,
        detail: { report_id: report?.id, reporter_id: user.id, area: booking.area, meeting_point: booking.meeting_point },
      });

      // SOS: real-time on-call escalation, not just a queue row (§11/§13).
      if (type === 'sos') {
        const html = `<p><strong>SOS report</strong> on booking ${booking.id}.</p>
          <p>Location: ${booking.meeting_point ?? ''} ${booking.area ?? ''}<br/>
          Reporter: ${user.id}</p><p>Open the admin queue immediately.</p>`;
        for (const to of ONCALL) await sendEmail(to, '🚨 Snapt SOS report — immediate attention', html);
        if (ONCALL.length === 0) {
          console.error('[safety] SOS filed but ONCALL_EMAILS is not configured');
        }
      }
      await notify(user.id, 'safety_report_received', 'We got your report', 'Our team has been alerted and is reviewing your report right now.');
      return { reported: true, escalated: type === 'sos' };
    },
  );
}
