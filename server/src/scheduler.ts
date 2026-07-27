import { supabaseAdmin } from './supabase.js';
import { notify } from './notify.js';

// Phase 5 job runner — the two named line items:
// 1. Payout release moves from lazy-on-read to scheduled, so the
//    payout_available notification actually fires at release time.
// 2. Dispute evidence-deadline reminders (§10) — one reminder to both
//    parties when <12h remain in the 72h window.
// Interval-based (5 min) — swap for cron/queue infra at production cutover.

async function releasePayouts(): Promise<void> {
  const { data: due } = await supabaseAdmin
    .from('creator_payouts')
    .select('id, creator_id, amount_usd')
    .eq('status', 'held')
    .lt('hold_until', new Date().toISOString());
  for (const p of due ?? []) {
    await supabaseAdmin
      .from('creator_payouts')
      .update({ status: 'available', available_at: new Date().toISOString() })
      .eq('id', p.id);
    await notify(
      p.creator_id,
      'payout_available',
      'Earnings available',
      `$${Number(p.amount_usd).toFixed(2)} cleared the holding window — cash out any time.`,
    );
  }
}

async function remindEvidenceDeadlines(): Promise<void> {
  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 12 * 3600_000).toISOString();
  const { data: disputes } = await supabaseAdmin
    .from('disputes')
    .select('id, booking_id')
    .eq('status', 'evidence_window')
    .is('evidence_reminder_sent_at', null)
    .gt('evidence_deadline_at', now)
    .lt('evidence_deadline_at', soon);
  for (const d of disputes ?? []) {
    const { data: b } = await supabaseAdmin
      .from('bookings')
      .select('client_id, creator_id')
      .eq('id', d.booking_id)
      .single();
    for (const party of [b?.client_id, b?.creator_id]) {
      if (party) {
        await notify(party, 'dispute_opened', 'Evidence window closing soon',
          'Less than 12 hours left to add evidence to your open dispute — after that the review proceeds on what has been submitted.');
      }
    }
    await supabaseAdmin
      .from('disputes')
      .update({ evidence_reminder_sent_at: new Date().toISOString() })
      .eq('id', d.id);
  }
}

export function startScheduler(): void {
  const tick = () =>
    Promise.all([releasePayouts(), remindEvidenceDeadlines()]).catch((err) =>
      console.error('scheduler tick failed', err),
    );
  void tick();
  setInterval(tick, 5 * 60_000);
}
