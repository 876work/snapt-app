import { supabaseAdmin } from './supabase.js';
import { deliveryWindows } from './config.js';

/**
 * THE DELIVERY CLOCK.
 *
 * Snapt commits to a delivery window — 24h standard, 6h for paid rush — and
 * until now nothing anywhere measured it. A creator could sit on a rushed
 * job indefinitely and the first person to notice would be the client who
 * paid extra for speed.
 *
 * The clock starts when the WORK starts, not when the booking was made:
 * session end for in-person, first footage upload for remote. Computed live
 * rather than stored, so it can never go stale against a rescheduled
 * session or a late upload, and it needed no migration.
 */

export type DeliveryState = 'on_track' | 'approaching' | 'late';

export interface DeliveryStatus {
  booking_id: string;
  client_id: string;
  creator_id: string | null;
  occasion: string | null;
  type: string;
  rush: boolean;
  /** When the clock started (session end / footage upload). */
  started_at: string;
  due_at: string;
  hours_remaining: number;
  /** Negative once late — how far past the promise we are. */
  hours_late: number;
  state: DeliveryState;
}

/** Did this booking pay for rush? The snapshot is the record of what was sold. */
export function isRush(snapshot: Record<string, unknown> | null | undefined): boolean {
  const addons = (snapshot?.['addons'] ?? {}) as Record<string, unknown>;
  return Number(addons['rush_usd'] ?? 0) > 0;
}

/**
 * Every undelivered booking whose clock has started, with how it is doing
 * against its promise. Sorted worst-first, and a late RUSH job outranks a
 * late standard one — a missed paid promise costs a refund and a review.
 */
export async function deliveryStatuses(): Promise<DeliveryStatus[]> {
  const { standardHours, rushHours, warnFraction } = await deliveryWindows();

  // Work in progress: accepted, not yet delivered, not cancelled.
  const { data: bookings } = await supabaseAdmin
    .from('bookings')
    .select('id, client_id, creator_id, occasion, type, status, scheduled_at, duration_hours, delivered_at, pricing_snapshot')
    .in('status', ['confirmed', 'completed'])
    .is('delivered_at', null);
  const rows = bookings ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((b) => b.id);
  // In-person clocks start at session end.
  const { data: sessions } = await supabaseAdmin
    .from('sessions')
    .select('booking_id, session_ended_at')
    .in('booking_id', ids);
  const endedAt = new Map(
    (sessions ?? [])
      .filter((s) => s.session_ended_at)
      .map((s) => [s.booking_id as string, s.session_ended_at as string]),
  );
  // Remote clocks start when the client's footage lands.
  const { data: raws } = await supabaseAdmin
    .from('booking_media')
    .select('booking_id, created_at')
    .eq('kind', 'raw')
    .in('booking_id', ids)
    .order('created_at', { ascending: true });
  const firstRaw = new Map<string, string>();
  for (const m of raws ?? []) {
    if (!firstRaw.has(m.booking_id as string)) firstRaw.set(m.booking_id as string, m.created_at as string);
  }

  const now = Date.now();
  const out: DeliveryStatus[] = [];
  for (const b of rows) {
    const snapshot = (b.pricing_snapshot ?? {}) as Record<string, unknown>;
    const rush = isRush(snapshot);

    let startedAt: string | undefined;
    if (b.type === 'remote') {
      startedAt = firstRaw.get(b.id);
    } else {
      startedAt = endedAt.get(b.id);
      // Fall back to the scheduled end for a session that completed without
      // a session row (older bookings, admin completion).
      if (!startedAt && b.status === 'completed' && b.scheduled_at) {
        startedAt = new Date(
          new Date(b.scheduled_at).getTime() + (Number(b.duration_hours) || 1) * 3600_000,
        ).toISOString();
      }
    }
    // No start = the clock hasn't begun. Not late, just not counting yet.
    if (!startedAt) continue;

    const started = new Date(startedAt).getTime();
    if (Number.isNaN(started)) continue;
    const windowMs = (rush ? rushHours : standardHours) * 3600_000;
    const due = started + windowMs;
    const remainingMs = due - now;
    const state: DeliveryState =
      remainingMs <= 0 ? 'late' : now - started >= windowMs * warnFraction ? 'approaching' : 'on_track';

    out.push({
      booking_id: b.id,
      client_id: b.client_id,
      creator_id: b.creator_id,
      occasion: b.occasion,
      type: b.type,
      rush,
      started_at: new Date(started).toISOString(),
      due_at: new Date(due).toISOString(),
      hours_remaining: Math.round((remainingMs / 3600_000) * 10) / 10,
      hours_late: remainingMs >= 0 ? 0 : Math.round((-remainingMs / 3600_000) * 10) / 10,
      state,
    });
  }

  // Worst first: late before approaching, rush before standard within each,
  // then by how overdue.
  const rank = (d: DeliveryStatus) => (d.state === 'late' ? 0 : d.state === 'approaching' ? 1 : 2);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Number(b.rush) - Number(a.rush) ||
      a.hours_remaining - b.hours_remaining,
  );
}
