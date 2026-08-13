import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureHandledError } from './sentry';

/**
 * A LOCK THAT CANNOT LOCK ANYONE OUT.
 *
 * Two places, different rules: the app-start lock is opt-in and OFF by
 * default (a photography app demanding Face ID on first launch reads as
 * invasive), and the payout screen is always on.
 *
 * BOTH FAIL OPEN, AT EVERY STEP. Biometrics fail on wet hands, cracked
 * screens, and whenever someone has turned them off at the OS level — and the
 * thing behind this gate is a creator's own earnings. Locking someone out of
 * their money is worse than the risk this mitigates. So this raises the cost
 * of a casual look at an unattended phone and nothing more; it is not an
 * authentication boundary and must never be treated as one.
 *
 * The ladder, in order. There is no branch that denies access:
 *
 *   1. no hardware            → through, silently
 *   2. hardware, none enrolled→ through, silently
 *   3. biometric succeeds     → through
 *   4. biometric fails        → OS retries, then offers device passcode
 *   5. passcode succeeds      → through
 *   6. cancelled/unavailable  → through, with a visible note
 *   7. anything throws        → through, reported to Sentry
 */

export type UnlockOutcome =
  /** Identity was actually confirmed. */
  | 'verified'
  /** Nothing to check against — no hardware, or nothing enrolled. */
  | 'unavailable'
  /** Let through WITHOUT confirming. The caller should say so. */
  | 'bypassed';

const APP_LOCK_KEY = 'snapt.appLock.enabled';

/** Opt-in, and absent means OFF — never enabled by default. */
export async function isAppLockEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(APP_LOCK_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setAppLockEnabled(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(APP_LOCK_KEY, on ? '1' : '0');
  } catch (err) {
    captureHandledError(err, 'biometrics:persist_toggle');
  }
}

/** True only when the device can actually verify someone. */
export async function canVerify(): Promise<boolean> {
  try {
    const [hardware, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hardware && enrolled;
  } catch {
    return false;
  }
}

export async function unlock(reason: string): Promise<UnlockOutcome> {
  // Steps 1 and 2 — nothing to verify against. Straight through, no prompt,
  // no message: there is nothing the person could do about it.
  if (!(await canVerify())) return 'unavailable';

  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // Step 4: let the OS offer the device passcode after biometrics fail.
      // Disabling this is what turns a wet thumb into a lockout.
      disableDeviceFallback: false,
      cancelLabel: 'Skip',
      requireConfirmation: false,
    });
    // Steps 3 and 5.
    if (res.success) return 'verified';
    // Step 6 — cancelled, or the OS had no way to continue. Through anyway.
    return 'bypassed';
  } catch (err) {
    // Step 7. A thrown error here is a broken lock, not a failed identity
    // check, and a broken lock must not become a closed door.
    captureHandledError(err, 'biometrics:authenticate');
    return 'bypassed';
  }
}
