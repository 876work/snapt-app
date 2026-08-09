/**
 * WHERE A NOTIFICATION LANDS — client side.
 *
 * The server resolves the destination once, at send time, and writes it to
 * `data.target` on the inbox row AND into the push payload (see
 * server/src/notification-targets.ts). So the bell and the banner read the
 * same string: they are physically incapable of disagreeing.
 *
 * This module exists to READ that string safely, not to compute a second
 * opinion. The only mapping here is LEGACY_TARGETS, which covers rows
 * written before targets existed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface NotificationData {
  target?: string;
  deep_link?: string;
  booking_id?: string;
  bookingId?: string;
  [k: string]: unknown;
}

/**
 * Rows written before the server started stamping `data.target`. Kept
 * deliberately thin — it resolves to a list, not a resource, because the
 * old rows never carried a resource id to resolve to. It can be deleted
 * once notifications older than the retention window have aged out.
 */
const LEGACY_TARGETS: Record<string, string> = {
  offer_received: '/creator',
  delivery_ready: '/(app)/bookings',
  revision_delivered: '/(app)/bookings',
  revision_requested: '/creator',
  payout_pending: '/creator/earnings',
  payout_available: '/creator/earnings',
  payout_paid: '/creator/earnings',
  payment_charged: '/(app)/profile/payments',
  refund_processed: '/(app)/profile/payments',
  fee_charged: '/(app)/profile/payments',
  assignment_failed_refunded: '/(app)/profile/payments',
  application_approved: '/creator',
  application_rejected: '/creator',
  application_submitted: '/creator',
  verification_result: '/creator',
  verification_failed: '/creator',
  strike_issued: '/creator',
  suspension_applied: '/creator',
  reconsent_required: '/creator',
};

/** The destination for a notification, or null when there isn't one. */
export function resolveTarget(
  triggerType: string | undefined,
  data: NotificationData | null | undefined,
): string | null {
  const d = data ?? {};
  if (typeof d.target === 'string' && d.target) return d.target;
  if (typeof d.deep_link === 'string' && d.deep_link) return d.deep_link;

  // Legacy row. Prefer the booking if one happens to be recorded.
  const bookingId = (d.booking_id ?? d.bookingId) as string | undefined;
  if (triggerType && LEGACY_TARGETS[triggerType]) return LEGACY_TARGETS[triggerType];
  return bookingId ? `/(app)/bookings/${bookingId}` : null;
}

/** Creator-only destinations — used to fail loudly rather than blankly. */
export function isCreatorTarget(target: string): boolean {
  return target.startsWith('/creator');
}

// ---------------------------------------------------------------------------
// Pending deep link
// ---------------------------------------------------------------------------

/**
 * A tap that arrives while signed out must not evaporate.
 *
 * Persisted (not held in memory) because the journey between the tap and
 * the landing can include a full app restart: cold start → login → maybe an
 * email verification round trip. It survives all of that, and is consumed
 * exactly once so it can't hijack a later, unrelated sign-in.
 */
const PENDING_KEY = 'snapt.pendingDeepLink';
/** Stale links are worse than none — an hour-old tap is no longer intent. */
const PENDING_TTL_MS = 60 * 60 * 1000;

export async function setPendingLink(target: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ target, at: Date.now() }));
  } catch {
    /* a lost pending link degrades to landing on Home */
  }
}

/**
 * Where to land once the user is authenticated.
 *
 * Every post-auth screen routes through this, so a tap that arrived while
 * signed out finishes where it was going instead of dumping them on Home
 * with no idea why they opened the app.
 *
 * Consumed HERE rather than reactively on a signed-in state change: two
 * places racing to navigate after login is how you get a target that
 * flashes up and is immediately replaced by Home.
 */
export async function landingAfterAuth(): Promise<string> {
  return (await takePendingLink()) ?? '/(app)/home';
}

/** Read AND clear. Returns null when absent or expired. */
export async function takePendingLink(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    await AsyncStorage.removeItem(PENDING_KEY);
    const { target, at } = JSON.parse(raw) as { target?: string; at?: number };
    if (!target || !at || Date.now() - at > PENDING_TTL_MS) return null;
    return target;
  } catch {
    return null;
  }
}

/**
 * Stamp a notification-opened route with its origin, so the target screen's
 * back button returns to the notifications list instead of falling through
 * to safeBack's generic home default.
 *
 * Appends rather than rewrites: targets that already carry a query (e.g.
 * `/(app)/profile/payments?highlight=…`) keep it, so deep-link resolution is
 * completely unchanged — this only adds information.
 */
export function withFrom(target: string, from = 'inbox'): string {
  if (!target) return target;
  return `${target}${target.includes('?') ? '&' : '?'}from=${from}`;
}
