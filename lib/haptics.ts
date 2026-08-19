import { AccessibilityInfo, Platform } from 'react-native';
import { captureHandledError } from './sentry';

/**
 * THE one place haptics are fired from.
 *
 * Four call sites had already grown their own copy of
 * `import('expo-haptics').then(...).catch(() => undefined)` — the slider and
 * three payment paths — each with its own silent catch and its own idea of
 * which feedback a success deserves. That is the shape of the two bugs this
 * project has already paid for (two payout formulas, two fee rates), so the
 * calls live here and the screens name an intent instead.
 *
 * WHAT EACH FEEL MEANS — pick by meaning, never by how it feels:
 *   success  an action the user committed to has completed
 *   warning  something changed that they need to notice, but nothing failed
 *   error    the thing they asked for did not happen
 *   light    a control reached a threshold — feedback about the GESTURE
 *   medium   a mode started or ended (recording on, recording off)
 *
 * NEVER for routine navigation, tab switches, ordinary taps, scrolling, or
 * anything on a repeating timer. A haptic that fires often stops carrying
 * information and becomes noise the user turns off system-wide, which costs
 * us the ones that matter.
 */
export type Feel = 'success' | 'warning' | 'error' | 'light' | 'medium';

/**
 * OS reduce-motion, read from the SAME source as the `useReduceMotion` hook
 * (AccessibilityInfo + its reduceMotionChanged event). It cannot BE that
 * hook: haptics fire from event handlers, async callbacks and worklet
 * bridges, none of which are React render, and a hook cannot be called from
 * any of them.
 *
 * Cached rather than awaited per call so `haptic()` stays synchronous and
 * can never delay the action it accompanies. It starts false and is
 * corrected on the first tick — a haptic in the first moments of app launch
 * is not a case that exists, since every trigger below needs a user action.
 */
let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduceMotion = v;
  })
  .catch((err) => captureHandledError(err, 'haptics:reduce_motion_probe'));
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reduceMotion = v;
});

/**
 * Fire a haptic. Returns immediately, always.
 *
 * The work is deliberately detached: a device with no taptic engine, a user
 * who disabled system haptics, or a module that fails to load must never
 * delay, block or fail the action this accompanies. Nothing here surfaces to
 * the user — but nothing here is swallowed either: the failure is reported
 * so a whole platform going quiet is discoverable rather than invisible.
 */
export function haptic(feel: Feel): void {
  if (reduceMotion) return;
  // The Taptic Engine renders these as five distinct patterns. Android maps
  // them onto coarser vibration patterns — the same meanings arrive, with
  // less resolution, which is why `light` is iOS-only below.
  if (feel === 'light' && Platform.OS !== 'ios') return;
  void (async () => {
    try {
      const H = await import('expo-haptics');
      switch (feel) {
        case 'success':
          await H.notificationAsync(H.NotificationFeedbackType.Success);
          return;
        case 'warning':
          await H.notificationAsync(H.NotificationFeedbackType.Warning);
          return;
        case 'error':
          await H.notificationAsync(H.NotificationFeedbackType.Error);
          return;
        case 'light':
          await H.impactAsync(H.ImpactFeedbackStyle.Light);
          return;
        case 'medium':
          await H.impactAsync(H.ImpactFeedbackStyle.Medium);
          return;
      }
    } catch (err) {
      captureHandledError(err, `haptics:${feel}`);
    }
  })();
}
