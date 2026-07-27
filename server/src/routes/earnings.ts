import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { notify } from '../notify.js';

// Creator earnings: Pending (held, inside the 7-day dispute window) →
// Available → Paid out. Held payouts whose hold has elapsed are released
// lazily on read — a scheduled job can take this over later without any
// schema change.

export function registerEarningsRoutes(app: FastifyInstance) {
  app.get('/v1/creator/earnings', async (request, reply) => {
    const user = requireUser(request);

    // Held→available release is owned by the scheduler (Phase 5) so the
    // payout_available notification fires at release time.

    const { data, error } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, booking_id, amount_usd, fee_rate_applied, is_promo_rate, status, hold_until, available_at, paid_out_at, created_at')
      .eq('creator_id', user.id)
      .order('created_at', { ascending: false });
    if (error) return reply.code(500).send({ error: error.message });

    const rows = data ?? [];
    const sum = (status: string) =>
      Math.round(
        rows.filter((r) => r.status === status).reduce((s, r) => s + Number(r.amount_usd), 0) * 100,
      ) / 100;
    return {
      payouts: rows,
      totals: {
        pending: Math.round((sum('held') + sum('requested')) * 100) / 100,
        available: sum('available'),
        paid_out: sum('paid_out'),
      },
    };
  });

  // Client wallet: the charge/refund ledger (fee rows are internal splits of
  // an existing charge — including them would double-count).
  app.get('/v1/wallet/transactions', async (request, reply) => {
    const user = requireUser(request);
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('id, booking_id, type, amount_usd, created_at')
      .eq('user_id', user.id)
      .in('type', ['charge', 'refund'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return reply.code(500).send({ error: error.message });
    return { transactions: data };
  });

  // Cash out everything available. Stripe Connect transfer when configured;
  // simulated (ledger-only) before Phase 7 keys.
  app.post('/v1/creator/cash-out', async (request, reply) => {
    const user = requireUser(request);
    const { data: rows, error } = await supabaseAdmin
      .from('creator_payouts')
      .select('id, amount_usd')
      .eq('creator_id', user.id)
      .eq('status', 'available');
    if (error) return reply.code(500).send({ error: error.message });
    if (!rows?.length) return reply.code(409).send({ error: 'Nothing available to cash out' });

    const total = Math.round(rows.reduce((s, r) => s + Number(r.amount_usd), 0) * 100) / 100;

    // NO Stripe Connect (Don, 2026-07-28): cash-out creates a payout
    // REQUEST; an admin fulfils it manually (bank transfer etc.) from the
    // portal queue and marks it paid — the creator sees Pending until then.
    await supabaseAdmin
      .from('creator_payouts')
      .update({ status: 'requested' })
      .in('id', rows.map((r) => r.id));
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'payout_requested',
      detail: { creator_id: user.id, amount_usd: total, payout_ids: rows.map((r) => r.id) },
    });
    await notify(user.id, 'payout_pending', 'Cash-out requested',
      `Your $${total.toFixed(2)} payout request is with our team — you'll be notified the moment it's sent.`);
    return { requested_usd: total, count: rows.length };
  });
}
