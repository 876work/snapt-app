import { supabaseAdmin } from './supabase.js';
import { notify } from './notify.js';
import { runRetention } from './retention.js';

// Phase 5 job runner — the two named line items:
// 1. Payout release moves from lazy-on-read to scheduled, so the
//    payout_available notification actually fires at release time.
// 2. Dispute evidence-deadline reminders (§10) — one reminder to both
//    parties when <12h remain in the 72h window.
// Interval-based (5 min) — swap for cron/queue infra at production cutover.

async function autoPickSelections(): Promise<void> {
  const { autoPickExpiredSelections } = await import('./routes/social.js');
  await autoPickExpiredSelections();
}

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
      { payout_id: p.id },
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
          'Less than 12 hours left to add evidence to your open dispute — after that the review proceeds on what has been submitted.',
          { booking_id: d.booking_id, dispute_id: d.id });
      }
    }
    await supabaseAdmin
      .from('disputes')
      .update({ evidence_reminder_sent_at: new Date().toISOString() })
      .eq('id', d.id);
  }
}

// Daily retention run, once per calendar day (UTC), guarded by a config row
// so restarts and multiple ticks never double-run it. Dry-run vs live is
// governed inside runRetention by app_config.retention_dry_run.
async function retentionDaily(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from('app_config')
    .select('value')
    .eq('key', 'retention_last_run_day')
    .maybeSingle();
  if (data?.value === today) return;
  await supabaseAdmin
    .from('app_config')
    .upsert({ key: 'retention_last_run_day', value: JSON.stringify(today), description: 'Retention job: last run day (set by the scheduler)' });
  const result = await runRetention();
  console.log(
    `[retention] dry_run=${result.dry_run} scanned=${result.scanned} eligible=${result.eligible.length} deleted=${result.deleted} errors=${result.errors.length} held=${result.held.length} warnings=${result.warnings_sent}`,
  );
}

/** Working days between then and now — weekends don't count against us. */
export function workingDaysSince(iso: string): number {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) return 0;
  let days = 0;
  const cursor = new Date(start);
  while (cursor < new Date()) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) days += 1;
  }
  return days;
}

/**
 * An application waiting past the 2 working days we promise the applicant.
 *
 * Without this a missed application sits forever and the creator's only
 * recourse is the support link on their status card. One unresolved alert per
 * application, re-raised never — resolving it is the admin saying they've
 * seen it.
 */
async function staleApplications(): Promise<void> {
  const { data: waiting } = await supabaseAdmin
    .from('creator_profiles')
    .select('user_id, applied_at')
    .eq('vetting_status', 'in_review')
    .not('applied_at', 'is', null);
  for (const row of waiting ?? []) {
    const age = workingDaysSince(row.applied_at as string);
    if (age < 2) continue;
    const { data: existing } = await supabaseAdmin
      .from('admin_alerts')
      .select('id')
      .eq('alert_type', 'application_stale')
      .is('resolved_at', null)
      .filter('detail->>creator_id', 'eq', row.user_id)
      .maybeSingle();
    if (existing) continue;
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'application_stale',
      detail: {
        creator_id: row.user_id,
        waiting_working_days: age,
        applied_at: row.applied_at,
      },
    });
  }
}

export function startScheduler(): void {
  const tick = () =>
    Promise.all([releasePayouts(), remindEvidenceDeadlines(), retentionDaily(), staleApplications(), autoPickSelections()]).catch((err) =>
      console.error('scheduler tick failed', err),
    );
  void tick();
  setInterval(tick, 5 * 60_000);
}
