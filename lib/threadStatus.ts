import { colors } from './theme';

/**
 * WHAT A CONVERSATION IS ABOUT, IN ONE LINE.
 *
 * Shared by the Messages list and the thread screen. Both previously carried
 * their own copy of a `subjectFor` helper, the second one labelled "Mirrors
 * the inbox list" — a comment asking the next person to keep two functions in
 * step by hand. This is the one function.
 *
 * THE DELIVERED RULE IS NOT RE-DERIVED HERE. It is the rule already stated in
 * app/(app)/bookings/index.tsx: `delivered_at`, not `status`, is what makes a
 * booking complete. A booking reads 'completed' the moment an in-person
 * session ends while the edit is still owed — the client is still waiting, so
 * it is not delivered. Changing that rule means changing it there, and this
 * follows.
 */
export interface ThreadLike {
  type: 'in_person' | 'remote';
  /** null on every remote order — they have no occasion step. */
  occasion: string | null;
  scheduled_at: string | null;
  status: string;
  delivered_at?: string | null;
  closed?: boolean;
}

/**
 * Four tones, each meaning something:
 *  soon  — it is happening today or tomorrow, look at it
 *  open  — live but not urgent
 *  done  — finished, nothing owed
 *  alert — went wrong
 */
export type StatusTone = 'soon' | 'open' | 'done' | 'alert';

export const STATUS_TONE: Record<StatusTone, string> = {
  // The same green the Bookings tab uses for Confirmed, so "today" reads as
  // the same kind of fact in both places.
  soon: '#1E7A45',
  open: colors.yellowDark,
  done: colors.grey,
  alert: colors.errorDark,
};

/** "3:30pm" / "15:30" — whichever the device's locale uses. */
function clockOf(d: Date): string {
  return d
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Whole calendar days between two instants, not 24-hour blocks. A session at
 * 09:00 tomorrow is "tomorrow" even when it is only 14 hours away, and a
 * session at 23:00 tonight is still "today".
 */
function daysApart(a: Date, b: Date): number {
  const d1 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const d2 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((d1 - d2) / 86_400_000);
}

export function threadStatus(t: ThreadLike, now: number = Date.now()): {
  phrase: string;
  tone: StatusTone;
} {
  // Closed outranks delivered: closed IS delivered, more than seven days ago,
  // and the fact that matters is that nothing more can be sent.
  if (t.closed) return { phrase: 'closed', tone: 'done' };
  // The endpoint returns the raw enum value. lib/api.ts maps 'no_show' to
  // 'no-show' for the Bookings tab, but that mapping is nowhere near this
  // payload — so accept both rather than silently miss one.
  if (t.status === 'cancelled') return { phrase: 'cancelled', tone: 'alert' };
  if (t.status === 'no_show' || t.status === 'no-show') return { phrase: 'no-show', tone: 'alert' };
  if (t.status === 'disputed') return { phrase: 'disputed', tone: 'alert' };
  if (t.delivered_at) return { phrase: 'delivered', tone: 'done' };
  // A remote order has no session to wait for — it is work from the moment it
  // is paid for, so it is never "upcoming".
  if (t.type === 'remote') return { phrase: 'in progress', tone: 'open' };
  if (!t.scheduled_at) return { phrase: 'not scheduled', tone: 'open' };
  const at = new Date(t.scheduled_at);
  if (Number.isNaN(at.getTime())) return { phrase: 'scheduled', tone: 'open' };

  const days = daysApart(at, new Date(now));
  if (days < 0) return { phrase: 'awaiting delivery', tone: 'open' };
  if (days === 0) return { phrase: `today ${clockOf(at)}`, tone: 'soon' };
  if (days === 1) return { phrase: `tomorrow ${clockOf(at)}`, tone: 'soon' };
  if (days < 7) {
    return { phrase: `${at.toLocaleDateString(undefined, { weekday: 'short' })} ${clockOf(at)}`, tone: 'open' };
  }
  // The time is kept even this far out: "when it happens" is the point, and
  // "14 Aug" alone makes someone open the booking to find out.
  return {
    phrase: `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${clockOf(at)}`,
    tone: 'open',
  };
}

/**
 * The occasion half of the subject. Remote orders carry no occasion, so every
 * branch has to survive a null one — interpolating it directly once printed
 * the literal string "Remote order · null" to anyone with a remote order.
 */
export function threadSubject(t: ThreadLike): string {
  if (t.type === 'remote') return t.occasion ? `Remote order · ${t.occasion}` : 'Remote order';
  return t.occasion ?? 'Session';
}
