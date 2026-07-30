import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { registerPushTokenApi, unregisterPushTokenApi } from './api';

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

/** Silent refresh at sign-in: re-register only if permission already granted. */
export async function registerIfGranted(): Promise<void> {
  try {
    const Notifications = await import('expo-notifications');
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'granted') await enablePush();
  } catch {
    // Ignore — old build or simulator.
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
