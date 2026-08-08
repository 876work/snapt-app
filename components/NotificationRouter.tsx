import React from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../lib/store';
import {
  isCreatorTarget,
  resolveTarget,
  setPendingLink,
  type NotificationData,
} from '../lib/notificationTarget';

/**
 * Tapping a push notification opens the thing it is about.
 *
 * Before this existed the app had NO notification response listener at all:
 * every push, on every platform, opened the app wherever it happened to be
 * and left the user to find the booking themselves.
 *
 * Mounted once in the root layout, above the router, so it is alive for both
 * paths a tap can take:
 *
 *   COLD START — app was killed. The OS launches it and the tap is waiting
 *   in getLastNotificationResponseAsync(). This is the case that usually
 *   breaks, because the response is available before the navigator has
 *   mounted; routing too early is a silent no-op. We wait for auth
 *   hydration (which is also when the router is ready) and replay it then.
 *
 *   WARM — app already running, foreground or background. The listener
 *   fires directly.
 *
 * Both paths funnel into one `go()` so they cannot drift apart.
 */
export function NotificationRouter() {
  const router = useRouter();
  const signedIn = useAuth((s) => s.signedIn);
  const hydrated = useAuth((s) => s.hydrated);
  const creatorStatus = useAuth((s) => s.creatorStatus);
  const userId = useAuth((s) => s.userId);

  // Latest values, read at tap time. Without this the listener closes over
  // the state as it was when it was installed — a tap ten minutes later
  // would be judged against a stale signed-in flag.
  const ctx = React.useRef({ signedIn, creatorStatus, userId });
  ctx.current = { signedIn, creatorStatus, userId };

  const go = React.useCallback(
    async (data: NotificationData, trigger?: string) => {
      const target = resolveTarget(trigger, data);
      if (!target) return; // e.g. a promotion with no link — opening Home is correct
      const { signedIn: isIn, creatorStatus: status, userId: me } = ctx.current;

      // EDGE: signed out. Park the target and send them through login —
      // landing on Home after signing in loses the reason they opened the
      // app at all.
      if (!isIn) {
        await setPendingLink(target);
        router.replace('/(auth)/login');
        return;
      }

      // EDGE: the notification belongs to another account. Opening the
      // target would either 404 or, worse, look like this account's data.
      const intended = typeof data.uid === 'string' ? data.uid : null;
      if (intended && me && intended !== me) {
        Alert.alert(
          'That notification is for another account',
          'It was sent to a different Snapt account than the one you are signed in to. Sign in to that account to open it.',
        );
        return;
      }

      // EDGE: creator-only screen while not an approved creator. /creator
      // is itself the router — its layout lands them on the screen for
      // their real status (applying, pending, rejected, suspended), which
      // explains where they stand instead of showing a locked-out blank.
      if (isCreatorTarget(target) && status !== 'approved') {
        router.push('/creator');
        return;
      }

      router.push(target as never);
    },
    [router],
  );

  React.useEffect(() => {
    if (!hydrated) return; // router not ready; cold-start replay happens below
    let cancelled = false;
    let subscription: { remove: () => void } | undefined;
    // Identifiers already acted on, so the cold-start replay and the live
    // listener can never double-navigate for the same tap.
    const handled = new Set<string>();

    (async () => {
      let Notifications: typeof import('expo-notifications');
      try {
        Notifications = await import('expo-notifications');
      } catch {
        return; // no native module (Expo Go / pre-notification build)
      }
      if (cancelled) return;

      const handle = (response: {
        notification: { request: { identifier: string; content: { data?: unknown } } };
      }) => {
        const id = response.notification.request.identifier;
        if (handled.has(id)) return;
        handled.add(id);
        const data = (response.notification.request.content.data ?? {}) as NotificationData;
        void go(data, typeof data.trigger === 'string' ? data.trigger : undefined);
      };

      subscription = Notifications.addNotificationResponseReceivedListener(handle);

      // COLD START. Checked after the listener is installed so a tap
      // arriving in between is caught by one or the other, and deduped by
      // identifier if by both.
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!cancelled && last) handle(last);
      } catch {
        /* nothing waiting */
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [hydrated, go]);

  // NOTE: replaying a tap that arrived while signed out is NOT done here.
  // The auth screens consume it via landingAfterAuth() when they navigate,
  // so there is exactly one navigation after sign-in. Doing it reactively
  // here as well would race the login screen's own redirect and the target
  // would flash up and be replaced by Home.
  return null;
}
