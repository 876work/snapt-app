import { Booking } from './mock/data';

/**
 * What Home leads with.
 *
 * The screen used to answer "what is Snapt?" on every visit — identical for a
 * first-time visitor and someone with a shoot in an hour. This derives the
 * ONE thing worth saying first from the user's real bookings.
 *
 * Pure and synchronous: it takes the bookings the store already holds and
 * returns a decision. No fetching, no side effects, so the precedence order
 * is testable on its own.
 */
export type HomeStateKind =
  | 'session_now'
  | 'session_today'
  | 'delivery_ready'
  | 'awaiting_creator'
  | 'editing'
  | 'upcoming'
  | 'book_again'
  | 'first_time';

export interface HomeState {
  kind: HomeStateKind;
  /** The booking the card is about. null for book_again/first_time. */
  booking: Booking | null;
  /** Prior booking whose creator we'd rebook. Only for book_again. */
  lastBooking?: Booking | null;
}

/**
 * PRECEDENCE, highest first. Ordered by "how much does this cost the user if
 * they miss it", not by recency:
 *
 *  1. session_now      — a session is happening RIGHT NOW. Time-critical:
 *                        the safety code and the creator are on this screen.
 *  2. session_today    — confirmed and starting later today. Still time-
 *                        critical (they have to physically be somewhere).
 *  3. delivery_ready   — money already spent, value sitting undelivered.
 *                        Beats future bookings because it is actionable now.
 *  4. awaiting_creator — booked and paid, no creator accepted yet. Ranks
 *                        above a confirmed future booking because it is the
 *                        state most likely to worry someone.
 *  5. editing          — a remote order is with an editor. Matched on status
 *                        alone: a remote order's scheduledAt is its creation
 *                        time, so any time filter drops it immediately and
 *                        the user sees the first-time pitch instead.
 *  6. upcoming         — the next confirmed booking beyond today.
 *  7. book_again       — nothing live, but they have booked before.
 *  8. first_time       — nothing personal to show. The pitch layout.
 *
 * Ties within a tier break on soonest scheduled time (or newest delivery for
 * tier 3), so the card is always about the most imminent thing.
 */
const DELIVERY_FRESH_DAYS = 30;

function startMs(b: Booking): number {
  const t = new Date(b.scheduledAt).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function endMs(b: Booking): number {
  return startMs(b) + (b.durationHours || 1) * 3600_000;
}

function isSameDay(ms: number, now: number): boolean {
  const a = new Date(ms);
  const b = new Date(now);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function deriveHomeState(bookings: Booking[], now: number = Date.now()): HomeState {
  const live = bookings.filter((b) => b.status !== 'cancelled');

  // 1. Happening now — in-person only; a remote order has no session window.
  const nowSession = live
    .filter(
      (b) =>
        b.type === 'in-person' &&
        b.status === 'confirmed' &&
        startMs(b) <= now &&
        endMs(b) >= now,
    )
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (nowSession) return { kind: 'session_now', booking: nowSession };

  // 2. Later today.
  const todaySession = live
    .filter(
      (b) =>
        b.type === 'in-person' &&
        b.status === 'confirmed' &&
        startMs(b) > now &&
        isSameDay(startMs(b), now),
    )
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (todaySession) return { kind: 'session_today', booking: todaySession };

  // 3. Delivered and still fresh. `deliveredAt` — not merely 'completed' —
  // is what makes this claim true; a completed session with nothing
  // delivered yet must not say "your photos are ready".
  const delivered = live
    .filter((b) => {
      if (!b.deliveredAt) return false;
      const at = new Date(b.deliveredAt).getTime();
      return !Number.isNaN(at) && now - at < DELIVERY_FRESH_DAYS * 86400_000;
    })
    .sort((a, b) => new Date(b.deliveredAt!).getTime() - new Date(a.deliveredAt!).getTime())[0];
  if (delivered) return { kind: 'delivery_ready', booking: delivered };

  // 4. Paid, waiting on a creator to accept. In-person only — a remote
  // order is never "waiting for a creator to accept".
  const pending = live
    .filter((b) => b.type === 'in-person' && b.status === 'pending' && startMs(b) > now)
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (pending) return { kind: 'awaiting_creator', booking: pending };

  // 5. Remote order in flight. NO time filter: a remote order's scheduledAt
  // is its creation time, so any elapsed-time test would drop it the moment
  // it was placed.
  const editing = live
    .filter(
      (b) => b.type === 'remote' && !b.deliveredAt && (b.status === 'pending' || b.status === 'confirmed'),
    )
    .sort((a, b) => startMs(b) - startMs(a))[0];
  if (editing) return { kind: 'editing', booking: editing };

  // 6. Next confirmed session beyond today.
  const upcoming = live
    .filter((b) => b.status === 'confirmed' && startMs(b) > now)
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (upcoming) return { kind: 'upcoming', booking: upcoming };

  // 7. Booked before, nothing live now.
  const lastCompleted = bookings
    .filter((b) => b.status === 'completed')
    .sort((a, b) => startMs(b) - startMs(a))[0];
  if (lastCompleted) return { kind: 'book_again', booking: null, lastBooking: lastCompleted };

  return { kind: 'first_time', booking: null };
}

/**
 * "How it works" is education. It earns its space until someone has actually
 * completed a booking, then it is just re-explaining a thing they've done.
 */
export function shouldShowEducation(bookings: Booking[]): boolean {
  return !bookings.some((b) => b.status === 'completed');
}
