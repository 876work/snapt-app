import { supabaseAdmin } from './supabase.js';
import { configNumber, getConfig } from './config.js';
import { deleteObject, MediaBucket } from './storage.js';
import { notify } from './notify.js';

// Scheduled file retention (Mechanism 1). R2 lifecycle rules cannot see
// order state, so this job is the source of truth for every window that is
// tied to a booking:
//
//   raw / client source files ... final delivery + 30 days
//   paid deliverables ........... final delivery + 12 months
//   cancelled orders, any file .. cancellation + 30 days
//   never-accepted/abandoned .... booking creation + 7 days
//   portfolio + avatar .......... account deletion + 30 days
//
// ID documents / background-check materials are OUT OF SCOPE by design —
// none exist in the system today, and if they are ever added they are
// governed by the Data Retention Policy, not this job.
//
// HARD SAFETY RULES (checked per file, in this order):
//   1. Explicit legal hold on the booking blocks deletion; after the hold
//      is lifted, files stay ineligible for 90 more days.
//   2. An open dispute, open content/safety report, or open revision
//      request blocks deletion AND raises the explicit hold flag so the
//      90-day post-lift clock applies once an admin lifts it.
//   3. Nothing is ever deleted less than 7 days (dispute filing window)
//      after the event that made it eligible, independent of the windows.
//   4. Dry-run mode (app_config.retention_dry_run, default TRUE) logs
//      what would be deleted and touches nothing.
//   5. Small batches, per-file error isolation: storage delete first, then
//      DB mark — both idempotent, so a crash between them self-heals on
//      the next run.

const BATCH = 25;
const DISPUTE_FILING_WINDOW_DAYS = 7;

interface EligibleFile {
  media_id: string | null;
  booking_id: string | null;
  bucket: MediaBucket;
  storage_path: string;
  reason: string;
  eligible_since: string;
}

export interface RetentionRunResult {
  dry_run: boolean;
  scanned: number;
  eligible: EligibleFile[];
  deleted: number;
  errors: { storage_path: string; error: string }[];
  held: { booking_id: string; reason: string; files: number }[];
  warnings_sent: number;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
const beforeCutoff = (iso: string | null, days: number) =>
  iso != null && iso <= daysAgo(days);

interface BookingRow {
  id: string;
  client_id: string;
  type: string;
  status: string;
  created_at: string;
  cancelled_at: string | null;
  delivered_at: string | null;
  legal_hold: boolean;
  legal_hold_lifted_at: string | null;
  expiry_warned_30_at: string | null;
  expiry_warned_7_at: string | null;
}

/** Open dispute / open report / open revision request → file is untouchable. */
async function openHoldReason(bookingId: string): Promise<string | null> {
  const [dispute, report, safety, revision] = await Promise.all([
    supabaseAdmin
      .from('disputes')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .in('status', ['open', 'evidence_window', 'under_review', 'appealed']),
    supabaseAdmin
      .from('content_reports')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('status', 'open'),
    supabaseAdmin
      .from('safety_reports')
      .select('id, sessions!inner(booking_id)', { count: 'exact', head: true })
      .eq('sessions.booking_id', bookingId)
      .neq('queue_status', 'resolved'),
    supabaseAdmin
      .from('revision_requests')
      .select('id', { count: 'exact', head: true })
      .eq('booking_id', bookingId)
      .eq('status', 'open'),
  ]);
  if (dispute.count) return 'open dispute';
  if (report.count) return 'open content report';
  if (safety.count) return 'open safety report';
  if (revision.count) return 'open revision request';
  return null;
}

async function bookingEligibility(
  b: BookingRow,
  cfg: { raw: number; deliverable: number; cancelled: number; abandoned: number; holdRelease: number },
): Promise<{ blocked: string | null; window: (kind: 'raw' | 'deliverable') => { reason: string; since: string } | null }> {
  // Rule 1: explicit hold, and 90-day tail after a lift.
  if (b.legal_hold) return { blocked: 'legal hold active', window: () => null };
  if (b.legal_hold_lifted_at && !beforeCutoff(b.legal_hold_lifted_at, cfg.holdRelease)) {
    return { blocked: `legal hold lifted < ${cfg.holdRelease} days ago`, window: () => null };
  }
  // Rule 2: open dispute/report/revision — also raise the explicit flag so
  // release requires an admin lift + the 90-day tail.
  const open = await openHoldReason(b.id);
  if (open) {
    await supabaseAdmin.from('bookings').update({ legal_hold: true }).eq('id', b.id);
    return { blocked: open, window: () => null };
  }

  return {
    blocked: null,
    window: (kind) => {
      if (b.status === 'cancelled') {
        return beforeCutoff(b.cancelled_at, cfg.cancelled)
          ? { reason: `cancelled order — ${cfg.cancelled}d after cancellation`, since: b.cancelled_at as string }
          : null;
      }
      if (b.status === 'pending') {
        // Never accepted / abandoned upload: the order never went live.
        return beforeCutoff(b.created_at, cfg.abandoned)
          ? { reason: `never-accepted/abandoned order — ${cfg.abandoned}d after creation`, since: b.created_at }
          : null;
      }
      if (b.status === 'completed' && b.delivered_at) {
        if (kind === 'raw') {
          return beforeCutoff(b.delivered_at, cfg.raw)
            ? { reason: `raw/source — ${cfg.raw}d after final delivery`, since: b.delivered_at }
            : null;
        }
        return beforeCutoff(b.delivered_at, cfg.deliverable)
          ? { reason: `paid deliverable — ${cfg.deliverable}d after final delivery`, since: b.delivered_at }
          : null;
      }
      // confirmed / no_show / disputed (or completed with no delivered_at)
      // fit no window — deliberately untouched.
      return null;
    },
  };
}

async function log(entry: EligibleFile, dryRun: boolean, outcome: 'deleted' | 'dry_run' | 'error', error?: string) {
  await supabaseAdmin.from('retention_log').insert({
    media_id: entry.media_id,
    booking_id: entry.booking_id,
    bucket: entry.bucket,
    storage_path: entry.storage_path,
    reason: entry.reason,
    eligible_since: entry.eligible_since,
    dry_run: dryRun,
    outcome,
    error: error ?? null,
  });
}

/** 30-day and 7-day "download your files" warnings before deliverables expire. */
async function sendExpiryWarnings(dryRun: boolean, deliverableDays: number): Promise<number> {
  let sent = 0;
  for (const [column, daysBefore] of [
    ['expiry_warned_30_at', 30],
    ['expiry_warned_7_at', 7],
  ] as const) {
    // delivered_at + deliverableDays - daysBefore <= now  → warn now.
    const threshold = daysAgo(deliverableDays - daysBefore);
    const { data } = await supabaseAdmin
      .from('bookings')
      .select('id, client_id, delivered_at')
      .eq('status', 'completed')
      .eq('legal_hold', false)
      .is(column, null)
      .not('delivered_at', 'is', null)
      .lte('delivered_at', threshold)
      .limit(200);
    for (const b of data ?? []) {
      const expiresAt = new Date(
        new Date(b.delivered_at as string).getTime() + deliverableDays * 86400_000,
      );
      if (expiresAt.getTime() <= Date.now()) continue; // already past — deletion path handles it
      if (dryRun) continue; // never email real users from a dry run
      const dateLabel = expiresAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      await notify(
        b.client_id,
        'files_expiring',
        daysBefore === 30 ? 'Your files expire in 30 days' : 'Last chance — files expire in 7 days',
        `The delivered files from your Snapt booking are available until ${dateLabel}. Download them to your device before then — after that date they are permanently removed.`,
        { booking_id: b.id as string },
      );
      await supabaseAdmin
        .from('bookings')
        .update({ [column]: new Date().toISOString() })
        .eq('id', b.id);
      sent += 1;
    }
  }
  return sent;
}

/**
 * Is the kill switch actually OFF?
 *
 * Deletion is enabled by an explicit false and by nothing else. A missing
 * row, a true, a typo, an empty string — all keep the job in dry run,
 * because the cost of reading this wrong in the permissive direction is
 * permanently deleted client footage.
 *
 * The string form is accepted because it is reachable, not hypothetical:
 * values reach this jsonb column through supabase-js, which JSON-encodes
 * whatever it is handed, so a write that passes a STRING stores a quoted
 * string and reads back as one. The same mechanism is what broke the daily
 * guard in scheduler.ts. A flag that says "false" in every sense a human
 * would recognise must not silently mean "still dry running".
 */
function retentionIsLive(value: unknown): boolean {
  return value === false || value === 'false' || value === '"false"';
}

export async function runRetention(opts?: { dryRun?: boolean }): Promise<RetentionRunResult> {
  const config = await getConfig();
  const rawDryRun = config['retention_dry_run'];
  const dryRun = opts?.dryRun ?? !retentionIsLive(rawDryRun);
  // Says WHY, not just what. "[retention] dry_run=true" on its own cannot
  // distinguish a flag that is still set from a flag that was flipped and is
  // being read as the wrong type, which is exactly the question asked when
  // the database says false and the job still logs true.
  if (dryRun && opts?.dryRun === undefined) {
    console.log(
      `[retention] dry run ACTIVE — app_config.retention_dry_run read as ${JSON.stringify(rawDryRun)} (${typeof rawDryRun}); deletion needs exactly false`,
    );
  }
  const cfg = {
    raw: await configNumber('retention_raw_days', 30),
    deliverable: await configNumber('retention_deliverable_days', 365),
    cancelled: await configNumber('retention_cancelled_days', 30),
    abandoned: await configNumber('retention_abandoned_days', 7),
    accountDeleted: await configNumber('retention_account_deleted_days', 30),
    holdRelease: await configNumber('retention_hold_release_days', 90),
  };

  const result: RetentionRunResult = {
    dry_run: dryRun,
    scanned: 0,
    eligible: [],
    deleted: 0,
    errors: [],
    held: [],
    warnings_sent: 0,
  };

  // --- Booking media -------------------------------------------------------
  // Only bookings that can possibly have an expired window; oldest first.
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select(
      'id, client_id, type, status, created_at, cancelled_at, delivered_at, legal_hold, legal_hold_lifted_at, expiry_warned_30_at, expiry_warned_7_at',
    )
    .in('status', ['pending', 'completed', 'cancelled'])
    .order('created_at', { ascending: true })
    .limit(500);

  for (const b of (bookings ?? []) as BookingRow[]) {
    const { data: media } = await supabaseAdmin
      .from('booking_media')
      .select('id, kind, storage_path')
      .eq('booking_id', b.id)
      .is('deleted_at', null);
    if (!media?.length) continue;
    result.scanned += media.length;

    const { blocked, window } = await bookingEligibility(b, cfg);
    if (blocked) {
      result.held.push({ booking_id: b.id, reason: blocked, files: media.length });
      continue;
    }
    for (const m of media) {
      const w = window(m.kind as 'raw' | 'deliverable');
      if (!w) continue;
      // Rule 3: the 7-day dispute filing window is enforced regardless of
      // what any window above computed.
      if (!beforeCutoff(w.since, DISPUTE_FILING_WINDOW_DAYS)) continue;
      result.eligible.push({
        media_id: m.id,
        booking_id: b.id,
        bucket: m.kind === 'raw' ? 'raw-footage' : 'deliverables',
        storage_path: m.storage_path,
        reason: w.reason,
        eligible_since: w.since,
      });
    }
  }

  // --- Portfolio + avatars after account deletion --------------------------
  const { data: deletedAccounts } = await supabaseAdmin
    .from('profiles')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null)
    .lte('deleted_at', daysAgo(cfg.accountDeleted))
    .limit(100);
  for (const p of deletedAccounts ?? []) {
    const { data: items } = await supabaseAdmin
      .from('portfolio_items')
      .select('id, storage_path')
      .eq('creator_id', p.id)
      .is('deleted_at', null)
      .not('storage_path', 'is', null);
    for (const item of items ?? []) {
      result.scanned += 1;
      result.eligible.push({
        media_id: item.id,
        booking_id: null,
        bucket: 'portfolio',
        storage_path: item.storage_path as string,
        reason: `portfolio — ${cfg.accountDeleted}d after account deletion`,
        eligible_since: p.deleted_at as string,
      });
    }
  }

  // --- Delete (or dry-run log) in small batches ----------------------------
  for (let i = 0; i < result.eligible.length; i += BATCH) {
    const batch = result.eligible.slice(i, i + BATCH);
    for (const f of batch) {
      if (dryRun) {
        await log(f, true, 'dry_run');
        continue;
      }
      try {
        // Storage first, then DB — a failure never leaves the DB claiming a
        // file is gone while it still exists.
        await deleteObject(f.bucket, f.storage_path);
        const table = f.bucket === 'portfolio' ? 'portfolio_items' : 'booking_media';
        const patch =
          f.bucket === 'portfolio'
            ? { deleted_at: new Date().toISOString() }
            : { deleted_at: new Date().toISOString(), deletion_reason: f.reason };
        const { error } = await supabaseAdmin.from(table).update(patch).eq('id', f.media_id);
        if (error) throw new Error(`DB mark failed after storage delete: ${error.message}`);
        await log(f, false, 'deleted');
        result.deleted += 1;
      } catch (err) {
        // One bad file must not abort the run or desync DB and storage.
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push({ storage_path: f.storage_path, error: message });
        await log(f, false, 'error', message).catch(() => undefined);
      }
    }
  }

  // --- Client expiry warnings (30d / 7d before deliverables expire) --------
  result.warnings_sent = await sendExpiryWarnings(dryRun, cfg.deliverable);

  return result;
}
