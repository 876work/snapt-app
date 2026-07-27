import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { requireStripe } from '../stripe.js';
import { stripeConfigured } from '../env.js';
import { notify } from '../notify.js';

// Creator earnings: Pending (held, inside the 7-day dispute window) →
// Available → Paid out. Held payouts whose hold has elapsed are released
// lazily on read — a scheduled job can take this over later without any
// schema change.

export function registerEarningsRoutes(app: FastifyInstance) {
  app.get('/v1/creator/earnings', async (request, reply) => {
    const user = requireUser(request);

    // Release any holds that have elapsed (no dispute hold-back yet — open
    // disputes freezing a payout lands with the Phase 4 dispute intake).
    await supabaseAdmin
      .from('creator_payouts')
      .update({ status: 'available', available_at: new Date().toISOString() })
      .eq('creator_id', user.id)
      .eq('status', 'held')
      .lt('hold_until', new Date().toISOString());

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
      totals: { pending: sum('held'), available: sum('available'), paid_out: sum('paid_out') },
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

    let transferId: string | null = null;
    if (stripeConfigured) {
      const { data: creator } = await supabaseAdmin
        .from('creator_profiles')
        .select('stripe_connect_account_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!creator?.stripe_connect_account_id) {
        return reply.code(409).send({ error: 'Complete Stripe onboarding first' });
      }
      const transfer = await requireStripe().transfers.create({
        amount: Math.round(total * 100),
        currency: 'usd',
        destination: creator.stripe_connect_account_id,
        metadata: { creator_id: user.id },
      });
      transferId = transfer.id;
    }

    await supabaseAdmin
      .from('creator_payouts')
      .update({
        status: 'paid_out',
        paid_out_at: new Date().toISOString(),
        stripe_transfer_id: transferId,
      })
      .in('id', rows.map((r) => r.id));
    await notify(user.id, 'payout_paid', 'Cash-out complete', `$${total.toFixed(2)} is on its way to your payout method.`);
    return { paid_out_usd: total, count: rows.length, stripe_transfer_id: transferId };
  });
}
