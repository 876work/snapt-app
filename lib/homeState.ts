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

// ---------------------------------------------------------------------------
// THE CARD'S SET, not just its headline.
//
// deriveHomeState above answers "what is the ONE thing worth saying first" and
// still owns the card's copy. These pick WHICH bookings deserve a card at all,
// so Home can cycle through everything live instead of hiding all but one —
// and, critically, so the card is ABSENT rather than inventing something when
// there is nothing live. `book_again` used to render a full card off zero
// active bookings; that is what these replace.
// ---------------------------------------------------------------------------

/**
 * Active = anything not yet finished.
 *
 * Cancelled and no-show are out. A delivered booking stays in for
 * DELIVERY_FRESH_DAYS as the stand-in for "not yet rated" — the client
 * Booking model carries no rating state, so freshness is the honest proxy
 * rather than a guess dressed as certainty.
 */
export function isActiveBooking(b: Booking, now: number = Date.now()): boolean {
  if (b.status === 'cancelled' || b.status === 'no-show') return false;
  if (b.deliveredAt) {
    const at = new Date(b.deliveredAt).getTime();
    if (Number.isNaN(at)) return true;
    return now - at < DELIVERY_FRESH_DAYS * 86400_000;
  }
  return true; // pending, confirmed, in progress, disputed, awaiting delivery
}

/** The state kind for ONE booking, using deriveHomeState's precedence. */
export function kindForBooking(b: Booking, now: number = Date.now()): HomeStateKind {
  const inPerson = b.type === 'in-person';
  if (inPerson && b.status === 'confirmed' && startMs(b) <= now && endMs(b) >= now) return 'session_now';
  if (inPerson && b.status === 'confirmed' && startMs(b) > now && isSameDay(startMs(b), now)) return 'session_today';
  if (b.deliveredAt) return 'delivery_ready';
  if (inPerson && b.status === 'pending') return 'awaiting_creator';
  if (b.type === 'remote') return 'editing';
  return 'upcoming';
}

/**
 * Every active booking worth a card, most imminent first.
 *
 * Role filter: /v1/bookings returns rows where the user is EITHER party, so a
 * dual-role account's store holds their creator jobs too. A booking whose
 * creatorId is the signed-in user is a job they are shooting, not one they
 * booked — it belongs on the creator's Jobs tab, never on the client Home.
 *
 * Order: sessions first by soonest start, then remote orders by oldest first
 * — a remote order's clock starts at upload, so the oldest order is the one
 * due soonest. (An exact due date lives server-side in delivery-clock.ts and
 * is not carried on the client Booking.)
 */
export function activeHomeStates(
  bookings: Booking[],
  userId: string | null,
  now: number = Date.now(),
): HomeState[] {
  const mine = bookings.filter((b) => !userId || b.creatorId !== userId);
  const active = mine.filter((b) => isActiveBooking(b, now));
  const sessions = active
    .filter((b) => b.type === 'in-person')
    .sort((a, b) => startMs(a) - startMs(b));
  const remote = active
    .filter((b) => b.type === 'remote')
    .sort((a, b) => startMs(a) - startMs(b));
  return [...sessions, ...remote].map((b) => ({ kind: kindForBooking(b, now), booking: b }));
}
