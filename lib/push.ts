import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiConfigured, fetchPushTokenActive, registerPushTokenApi, unregisterPushTokenApi } from './api';

// Device-local record that the user turned push OFF in-app. Without it the
// silent re-registration at sign-in / app-foreground would undo their
// choice. Cleared the moment they toggle back on.
const DISABLED_KEY = 'snapt.push.disabledByUser';

// Expo push registration. All expo-notifications imports are dynamic so this
// module is inert on builds that predate the native module (and in Expo Go).
// Server-side routing decides which triggers push — see server notify.ts.

let cachedToken: string | null = null;

async function getToken(): Promise<string | null> {
  const Device = await import('expo-device');
  if (!Device.isDevice) return null;
  const Notifications = await import('expo-notifications');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const result = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return result.data;
}

/** Foreground notifications show as banners instead of being swallowed. */
export async function initPushHandling(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Native module absent (old build / Expo Go) — nothing to do.
  }
}

/** Full opt-in: OS permission prompt, then register the token. */
export async function enablePush(): Promise<boolean> {
  try {
    // Explicit user intent — clear any earlier in-app off choice.
    await AsyncStorage.removeItem(DISABLED_KEY);
    const Notifications = await import('expo-notifications');
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return false;
    const token = await getToken();
    if (!token) return false;
    cachedToken = token;
    await registerPushTokenApi(token, Platform.OS === 'ios' ? 'ios' : 'android');
    return true;
  } catch {
    return false;
  }
}

/**
 * Master-toggle OFF: the OS permission can't be revoked by the app, so off
 * means "no registered token server-side" — the dispatcher then has nowhere
 * to deliver. In-app notifications and emails are unaffected.
 */
export async function disablePush(): Promise<void> {
  await AsyncStorage.setItem(DISABLED_KEY, '1');
  await unregisterPush();
}

/** Silent refresh at sign-in: re-register only if permission already granted. */
export async function registerIfGranted(): Promise<void> {
  try {
    // Respect an in-app OFF — auto-registration must not undo it.
    if ((await AsyncStorage.getItem(DISABLED_KEY)) === '1') return;
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') await enablePush();
  } catch {
    // Ignore — old build or simulator.
  }
}

export interface DeliveryStatus extends PushStatus {
  /**
   * True when this device's token is registered server-side (= pushes will
   * actually arrive). null when unknowable (mock mode / no permission).
   * In mock mode the local disabled flag stands in for server truth.
   */
  delivering: boolean | null;
}

/** Everything the master toggle needs: OS permission + server-side truth. */
export async function getDeliveryStatus(): Promise<DeliveryStatus> {
  const base = await getPushStatus();
  if (!base.available || base.status !== 'granted') {
    return { ...base, delivering: base.status === 'granted' ? null : false };
  }
  try {
    if (!apiConfigured) {
      const disabled = (await AsyncStorage.getItem(DISABLED_KEY)) === '1';
      return { ...base, delivering: !disabled };
    }
    const token = cachedToken ?? (await getToken());
    if (!token) return { ...base, delivering: false };
    cachedToken = token;
    return { ...base, delivering: await fetchPushTokenActive(token) };
  } catch {
    return { ...base, delivering: null };
  }
}

export interface PushStatus {
  /** False when the native module is absent (old build / Expo Go). */
  available: boolean;
  status: 'granted' | 'denied' | 'undetermined';
  /** False = the OS won't show the dialog again; user must use Settings. */
  canAskAgain: boolean;
}

export async function getPushStatus(): Promise<PushStatus> {
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return { available: false, status: 'undetermined', canAskAgain: true };
    const Notifications = await import('expo-notifications');
    const p = await Notifications.getPermissionsAsync();
    const status = p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';
    return { available: true, status, canAskAgain: p.canAskAgain };
  } catch {
    return { available: false, status: 'undetermined', canAskAgain: true };
  }
}

/** Sign-out hygiene: stop this device receiving the account's pushes. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = cachedToken ?? (await getToken());
    if (token) await unregisterPushTokenApi(token);
  } catch {
    // Best effort.
  }
}
