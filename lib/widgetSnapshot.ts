import { Platform } from 'react-native';
import { Booking } from './mock/data';
import { captureHandledError } from './sentry';

/**
 * WHAT THE HOME-SCREEN WIDGET IS SHOWING, AND WHEN IT STOPS.
 *
 * The widget process has no network and no session — everything it renders is
 * pushed from here, across the App Group, by the app. This module is the only
 * writer, so "what does the widget say" has exactly one answer in the code.
 *
 * TWO ENTRIES, NOT ONE, AND THE SECOND IS THE POINT.
 *
 * A snapshot alone goes stale the moment the app closes: the session happens,
 * nobody opens Snapt, and the home screen goes on advertising a session that
 * is over. So every write schedules a SECOND timeline entry at the session's
 * END — WidgetKit swaps the widget into the empty state at that moment with
 * the app closed and no code of ours running. That is what makes "never shows
 * a session that has already happened" a guarantee rather than a hope, and it
 * is the same reasoning that kept the creator's job-count widget unbuilt: a
 * value with no expiry is a wrong value as soon as it ages.
 *
 * The countdown between now and then is the system's — `dateStyle="timer"` in
 * the widget redraws itself — so there are no per-minute entries here.
 */

/** Sessions only. A remote edit order has no time or place to count down to. */
function isCountdownable(b: Booking): boolean {
  if (b.type !== 'in-person') return false;
  if (b.status === 'cancelled' || b.status === 'no-show') return false;
  if (b.deliveredAt) return false;
  const t = Date.parse(b.scheduledAt ?? '');
  return Number.isFinite(t) && t > Date.now();
}

/** The soonest upcoming session, or null. Pure and exported so it is testable. */
export function nextSession(bookings: Booking[]): Booking | null {
  const upcoming = bookings.filter(isCountdownable);
  if (upcoming.length === 0) return null;
  return upcoming.reduce((soonest, b) =>
    Date.parse(b.scheduledAt) < Date.parse(soonest.scheduledAt) ? b : soonest,
  );
}

/** When this session stops being "upcoming" and the widget should empty out. */
function endOf(b: Booking): Date {
  const start = Date.parse(b.scheduledAt);
  const hours = Number.isFinite(b.durationHours) && b.durationHours > 0 ? b.durationHours : 1;
  return new Date(start + hours * 3600_000);
}

/**
 * Push the current state to the widget. Never throws and never blocks a
 * caller: a home-screen widget failing to update must not disturb the app it
 * is decorating, but it must not fail silently either.
 *
 * iOS only — there is no Android widget, and calling into the module on
 * Android would be asking for a target that does not exist.
 */
export async function refreshNextSessionWidget(bookings: Booking[]): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    const { default: NextSession } = await import('../widgets/NextSession');
    const session = nextSession(bookings);

    if (!session) {
      NextSession.updateSnapshot({ hasSession: false, startsAt: 0, occasion: '', area: '' });
      return;
    }

    const live = {
      hasSession: true as const,
      startsAt: Date.parse(session.scheduledAt),
      occasion: session.occasion ?? 'Session',
      // The area is a free-text name from the server; an order without one
      // shows nothing rather than the word "null".
      area: session.area ?? '',
    };
    const empty = { hasSession: false as const, startsAt: 0, occasion: '', area: '' };

    NextSession.updateTimeline([
      { date: new Date(), props: live },
      // The self-expiry described above.
      { date: endOf(session), props: empty },
    ]);
  } catch (err) {
    // A widget that cannot be written is a real failure — it means someone's
    // home screen is showing something we no longer control — so it is
    // reported even though nothing on screen changes.
    captureHandledError(err, 'widgetSnapshot:refresh');
  }
}
