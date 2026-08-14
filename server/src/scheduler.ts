import { supabaseAdmin } from './supabase.js';
import { notify } from './notify.js';
import { runRetention } from './retention.js';
// The grace is defined where the draft endpoints live, because "how long is
// a draft honoured" is one policy read from two places: that module decides
// whether to OFFER a returning client their files, this one decides when to
// DELETE them. They must never disagree.
import { DRAFT_GRACE_HOURS } from './routes/upload-drafts.js';

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
      '{amount} cleared the holding window — cash out any time.',
      { payout_id: p.id },
      { amount: Number(p.amount_usd) },
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
          { booking_id: d.booking_id, dispute_id: d.id, ...(party === b?.creator_id ? { audience: 'creator' as const } : {}) });
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
  /**
   * ONCE PER DAY — which it was not.
   *
   * The write below used to be JSON.stringify(today). `value` is jsonb and
   * supabase-js JSON-encodes what it is handed, so stringifying first stored
   * a string with the quote characters INSIDE it: "2026-08-14", twelve
   * characters. This comparison then measured it against the bare ten-
   * character date, never matched, and never returned early — so the daily
   * job ran on every five-minute tick instead. Invisible while dry-run made
   * every run a no-op; 288 deletion passes a day once it is not.
   *
   * The read stays tolerant of the quoted form because rows written the old
   * way are still in production, and the guard has to work on the very next
   * tick rather than after someone remembers to clean the row by hand.
   */
  const lastRun = typeof data?.value === 'string' ? data.value.replace(/^"+|"+$/g, '') : null;
  if (lastRun === today) return;
  await supabaseAdmin
    .from('app_config')
    .upsert({ key: 'retention_last_run_day', value: today, description: 'Retention job: last run day (set by the scheduler)' });
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

/**
 * WELCOME NOTIFICATION — 5 minutes after registration, once per user ever.
 *
 * Swept from the database, not queued in memory. The scheduler is in-process
 * (setInterval, started at boot), so a setTimeout would be dropped by every
 * restart and deploy — silently, with no record of who missed one. A
 * due-state column survives restarts by construction: whatever was owed
 * before a restart is still owed after it and goes out on the next tick.
 *
 * The tick is every 5 minutes, so delivery lands 5-10 minutes after signup.
 * A precise 5:00 would need either a timer we cannot trust or a much busier
 * sweep.
 *
 * Skipped deliberately: deleted accounts, and anyone who registered before
 * this shipped (the migration stamps them). Disabled users need no check —
 * notify() suppresses them above the insert, so no row, email or push is
 * written at all.
 */
async function sendWelcomes(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: due, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .is('welcome_sent_at', null)
    .is('deleted_at', null)
    .lte('created_at', cutoff)
    .limit(200);
  // Until the migration runs this is a no-op rather than a tick that throws
  // every 5 minutes.
  if (error) return;

  for (const p of due ?? []) {
    const first = String(p.full_name ?? '').trim().split(/\s+/)[0];
    // Never "Welcome !" — a missing name gets a greeting without one.
    const title = first ? `Welcome ${first}! 🎉` : 'Welcome to Snapt! 🎉';
    // Stamp FIRST: a crash mid-send costs one welcome, where a crash before
    // the stamp would resend it on every tick forever.
    await supabaseAdmin
      .from('profiles')
      .update({ welcome_sent_at: new Date().toISOString() })
      .eq('id', p.id);
    await notify(
      p.id,
      'welcome',
      title,
      'Book a vetted local creator for a shoot, or send us footage you have already taken and we will edit it for you. Have a look around whenever you are ready.',
      {},
    );
  }
}

/**
 * UPLOADED, NEVER DELIVERED.
 *
 * Registering a deliverable and delivering it are two different calls.
 * `POST /media` puts the file on the booking; only `POST /deliver` sets
 * `delivered_at`, notifies the client and makes anything downloadable. A
 * creator who finishes the upload and closes the app therefore leaves a
 * paying client with nothing — and leaves it SILENTLY: the booking still
 * reads 'confirmed', no alert exists, and the first person to notice is the
 * client asking where their photos are. That is booking c8a63e3b.
 *
 * The app now warns the creator on screen and confirms before they leave,
 * but a warning only reaches a creator who is still looking at it. This is
 * the part that does not depend on that. One unresolved alert per booking
 * and one nudge to the creator, raised only once the NEWEST deliverable has
 * sat undelivered past the grace — mid-batch uploads are not a fault.
 */
const DELIVER_GRACE_MINUTES = 30;

async function nudgeUndeliveredUploads(): Promise<void> {
  const cutoff = new Date(Date.now() - DELIVER_GRACE_MINUTES * 60_000).toISOString();
  // Start from the SMALL side. Work in progress is a handful of rows at any
  // moment; every deliverable ever registered is not, and this runs every
  // five minutes forever. A delivered booking — including one re-delivered
  // after a revision — never reaches the media query at all.
  const { data: open } = await supabaseAdmin
    .from('bookings')
    .select('id, creator_id, occasion')
    .in('status', ['confirmed', 'completed'])
    .is('delivered_at', null);
  if (!open || open.length === 0) return;

  const { data: media } = await supabaseAdmin
    .from('booking_media')
    .select('booking_id, created_at')
    .eq('kind', 'deliverable')
    .is('deleted_at', null)
    .in('booking_id', open.map((b) => b.id));

  // Per booking: how many finals are sitting there, and when the last one
  // landed.
  const count = new Map<string, number>();
  const newest = new Map<string, string>();
  for (const m of media ?? []) {
    const id = m.booking_id as string;
    const at = m.created_at as string;
    count.set(id, (count.get(id) ?? 0) + 1);
    if (!newest.has(id) || at > newest.get(id)!) newest.set(id, at);
  }

  for (const b of open) {
    const files = count.get(b.id) ?? 0;
    if (files === 0) continue;
    // Still uploading: the batch lands one file at a time, and a creator
    // 20 minutes into a 40-file upload has done nothing wrong.
    if (newest.get(b.id)! >= cutoff) continue;

    const { data: existing } = await supabaseAdmin
      .from('admin_alerts')
      .select('id')
      .eq('alert_type', 'uploaded_not_delivered')
      .eq('booking_id', b.id)
      .is('resolved_at', null)
      .limit(1);
    if (existing && existing.length > 0) continue;

    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'uploaded_not_delivered',
      booking_id: b.id,
      detail: {
        creator_id: b.creator_id,
        deliverables: files,
        last_upload_at: newest.get(b.id),
      },
    });
    // The creator can still fix this themselves in one slide, so they hear
    // about it too — the alert is for when they don't.
    if (b.creator_id) {
      await notify(
        b.creator_id,
        'delivery_not_sent',
        'Your edit is uploaded but not delivered',
        `You uploaded ${files} finished file${files === 1 ? '' : 's'}${
          b.occasion ? ` for the ${b.occasion} job` : ''
        }, but never delivered them — the client still can't see them and your payout hasn't started. Open the job and slide to deliver.`,
        { booking_id: b.id },
      );
    }
  }
}

/**
 * ABANDONED UPLOAD DRAFTS.
 *
 * Uploading on selection means footage lands in R2 for orders that are never
 * paid for — someone picks twelve videos, sees the price, and closes the app.
 * Without this that storage accumulates forever.
 *
 * THE SAFETY RULE, and why it holds: this deletes only rows where
 * `booking_id is null`. The migration's check constraint makes booking_id
 * and draft_id mutually exclusive, so "booking_id is null" is exactly "not
 * attached to any order". checkout.ts sets booking_id inside the Stripe
 * webhook handler, before it returns 2xx, and Stripe retries until it does.
 * So a paid order's files stop matching this query the moment the claim
 * commits — the guarantee is the predicate, not a race against the clock.
 * The 24 hours is headroom for webhook retries, not the thing keeping paid
 * footage alive.
 *
 * Deleting the OBJECT first would reopen the hole it just closed: a webhook
 * could claim the row in the moment between the select and the S3 call, and
 * the paid order would end up owning a file that no longer exists. So each
 * row is first CLAIMED FOR DELETION by a single guarded update, which is the
 * same predicate checkout's claim uses. Exactly one of the two can win a
 * given row. Only after winning it do we touch storage.
 *
 * The residual failure is a crash between the mark and the object delete,
 * which leaves a soft-deleted row and a live object — visible, and retried
 * on the next tick, because the select deliberately does not filter on
 * deleted_at. That is the right way round: an orphaned object costs pennies,
 * a deleted paid file costs the order.
 */
async function sweepAbandonedDrafts(): Promise<void> {
  const cutoff = new Date(Date.now() - DRAFT_GRACE_HOURS * 3600_000).toISOString();
  const { data: stale } = await supabaseAdmin
    .from('booking_media')
    .select('id, storage_path')
    .is('booking_id', null)
    .not('draft_id', 'is', null)
    .lt('created_at', cutoff)
    .limit(200);
  if (!stale || stale.length === 0) return;

  const { deleteObject } = await import('./storage.js');
  let deleted = 0;
  let claimedAway = 0;
  for (const row of stale) {
    // ATOMIC. If a webhook claimed this row first it now has a booking_id,
    // this update matches nothing, and we never go near the object.
    const { data: taken } = await supabaseAdmin
      .from('booking_media')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('booking_id', null)
      .select('id')
      .maybeSingle();
    if (!taken) {
      claimedAway += 1;
      continue;
    }
    try {
      await deleteObject('raw-footage', row.storage_path as string);
    } catch (err) {
      console.error(`[drafts] storage delete failed for ${row.id}`, err);
      continue; // marked, object still there — retried next tick
    }
    await supabaseAdmin.from('booking_media').delete().eq('id', row.id).is('booking_id', null);
    deleted += 1;
  }
  console.log(
    `[drafts] swept ${deleted}/${stale.length} abandoned draft files` +
      (claimedAway > 0 ? ` (${claimedAway} claimed by a payment mid-sweep, left alone)` : ''),
  );
}

async function purgeAccounts(): Promise<void> {
  const { purgeDeletedAccounts } = await import('./account-purge.js');
  await purgeDeletedAccounts();
}

export function startScheduler(): void {
  const tick = () =>
    Promise.all([releasePayouts(), remindEvidenceDeadlines(), retentionDaily(), staleApplications(), autoPickSelections(), purgeAccounts(), sendWelcomes(), nudgeUndeliveredUploads(), sweepAbandonedDrafts()]).catch((err) =>
      console.error('scheduler tick failed', err),
    );
  void tick();
  setInterval(tick, 5 * 60_000);
}
