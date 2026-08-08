import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';
import { notify } from '../notify.js';
import { encryptField } from '../crypto.js';
import { enabledPayoutMethods } from '../config.js';

// Creator earnings: Pending (held, inside the 7-day dispute window) →
// Available → Paid out. Held payouts whose hold has elapsed are released
// lazily on read — a scheduled job can take this over later without any
// schema change.

// Payout methods (six, matching the cash-out screen design). Per-method
// required fields; 'cash' needs none but its pickup locations + identity
// verification are a PENDING PRODUCT DECISION (flagged — not guessed here).
// 'penny_pinch' field is account_id pending confirmation of what the wallet
// actually requires.
const METHOD_FIELDS: Record<string, string[]> = {
  cash: [],
  penny_pinch: ['email'],
  cibc: ['holder_name', 'account_number'],
  republic_ec: ['holder_name', 'account_number'],
  bank_slu: ['holder_name', 'account_number'],
  paypal: ['email'],
};

export function registerEarningsRoutes(app: FastifyInstance) {
  app.get('/v1/creator/payout-methods', async (request, reply) => {
    const user = requireUser(request);
    const { data } = await supabaseAdmin
      .from('creator_profiles')
      .select('payout_methods')
      .eq('user_id', user.id)
      .maybeSingle();
    const pm = (data?.payout_methods ?? {}) as { selected?: string; methods?: Record<string, Record<string, string>> };
    const safe: Record<string, Record<string, string>> = {};
    for (const [m, d] of Object.entries(pm.methods ?? {})) {
      const { account_number_enc, account_number_last4, ...rest } = d;
      safe[m] = account_number_last4 ? { ...rest, account_number: `····${account_number_last4}` } : rest;
    }
    // Which methods may be NEWLY selected (admin toggle). The creator's
    // currently-selected method is always reported enabled for THEM — an
    // admin disabling a method parks new signups, never existing setups.
    const toggles = await enabledPayoutMethods();
    const enabled: Record<string, boolean> = {};
    for (const m of Object.keys(METHOD_FIELDS)) {
      enabled[m] = toggles[m] !== false || pm.selected === m;
    }
    return { payout_methods: { selected: pm.selected, methods: safe, enabled } };
  });

  app.put<{ Body: { method?: string; details?: Record<string, string> } }>(
    '/v1/creator/payout-method',
    async (request, reply) => {
      const user = requireUser(request);
      const { method, details } = request.body ?? {};
      if (!method || !(method in METHOD_FIELDS)) {
        return reply.code(400).send({ error: `method must be one of ${Object.keys(METHOD_FIELDS).join(', ')}` });
      }
      // Admin toggle: a disabled method can't be NEWLY selected. A creator
      // who already has it selected may keep using and updating it — the
      // check against their stored selection is below, after the row loads.
      for (const f of METHOD_FIELDS[method]) {
        const v = details?.[f]?.trim();
        if (!v) return reply.code(400).send({ error: `${f} is required for ${method}` });
        if (f === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          return reply.code(400).send({ error: 'Enter a valid email address' });
        }
      }
      // Bank account numbers are encrypted at rest; last-4 kept for display.
      const stored: Record<string, string> = { ...(details ?? {}) };
      if (stored.account_number) {
        stored.account_number_last4 = stored.account_number.slice(-4);
        stored.account_number_enc = encryptField(stored.account_number);
        delete stored.account_number;
      }
      const { data: row } = await supabaseAdmin
        .from('creator_profiles')
        .select('payout_methods')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!row) return reply.code(403).send({ error: 'Not a creator' });
      const pm = (row.payout_methods ?? {}) as { selected?: string; methods?: Record<string, unknown> };
      const toggles = await enabledPayoutMethods();
      if (toggles[method] === false && pm.selected !== method) {
        return reply.code(409).send({
          error: 'That payout method is not currently available — pick another option.',
        });
      }
      const methods = { ...(pm.methods ?? {}), [method]: stored };
      const next = { selected: method, methods };
      await supabaseAdmin.from('creator_profiles').update({ payout_methods: next }).eq('user_id', user.id);
      return { saved: true, payout_methods: next };
    },
  );

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

    // Per-method requirement: the selected payout method must be configured
    // (cash requires no fields; its pickup mechanics are a pending product
    // decision).
    const { data: cp } = await supabaseAdmin
      .from('creator_profiles')
      .select('payout_methods')
      .eq('user_id', user.id)
      .maybeSingle();
    const pm = (cp?.payout_methods ?? {}) as { selected?: string; methods?: Record<string, unknown> };
    const selected = pm.selected;
    if (!selected || (METHOD_FIELDS[selected]?.length > 0 && !pm.methods?.[selected])) {
      return reply.code(409).send({
        error: 'Add payout details for your selected method first',
        action: 'add_payout_details',
      });
    }

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
      detail: {
        creator_id: user.id,
        amount_usd: total,
        payout_ids: rows.map((r) => r.id),
        method: selected,
        method_details: pm.methods?.[selected] ?? {},
      },
    });
    await notify(user.id, 'payout_pending', 'Cash-out requested',
      `Your $${total.toFixed(2)} payout request is with our team — you'll be notified the moment it's sent.`,
      rows.length === 1 ? { payout_id: rows[0].id } : {});
    return { requested_usd: total, count: rows.length };
  });
}
