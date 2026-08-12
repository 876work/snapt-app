import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import type { ImagePickerOptions, ImagePickerResult } from 'expo-image-picker';

/**
 * PICK A PHOTO, FROM THE LIBRARY OR THE CAMERA.
 *
 * expo-image-picker has always been able to open the camera and the app has
 * always shipped the permission string for it (`cameraPermission` in
 * app.json) — launchCameraAsync was simply never called. This is the missing
 * half, not a new capability, which is why it needs no new native code and
 * ships over the air.
 *
 * Returns null when the person backed out at the sheet or the camera could
 * not be opened; callers already handle `result.canceled`, so the two read
 * the same at the call site.
 */

async function askSource(
  title: string,
  cameraLabel: string,
  libraryLabel: string,
): Promise<'camera' | 'library' | null> {
  if (Platform.OS === 'ios') {
    return new Promise((resolve) => {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: [cameraLabel, libraryLabel, 'Cancel'], cancelButtonIndex: 2 },
        (i) => resolve(i === 0 ? 'camera' : i === 1 ? 'library' : null),
      );
    });
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      undefined,
      [
        { text: cameraLabel, onPress: () => resolve('camera') },
        { text: libraryLabel, onPress: () => resolve('library') },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      // Tapping outside the dialog is a cancel like any other. Without this
      // the promise never settles and the button stays dead until reload.
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

export async function pickMedia(
  options: ImagePickerOptions,
  copy?: { title?: string; camera?: string; library?: string },
): Promise<ImagePickerResult | null> {
  const ImagePicker = await import('expo-image-picker');
  const source = await askSource(
    copy?.title ?? 'Add a photo',
    copy?.camera ?? 'Take photo',
    copy?.library ?? 'Choose from library',
  );
  if (source === null) return null;
  if (source === 'library') return ImagePicker.launchImageLibraryAsync(options);

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    // Two genuinely different dead ends. While the OS will still ask, saying
    // "go to Settings" sends someone on an errand they do not need; once it
    // will not ask again, Settings is the ONLY route and anything else is a
    // lie. The library is always offered as the way through.
    Alert.alert(
      'Camera access is off',
      perm.canAskAgain
        ? 'Snapt needs the camera to take a photo. Try again and allow access, or choose from your library instead.'
        : 'Snapt needs the camera to take a photo. Turn it on in Settings, or choose from your library instead.',
      perm.canAskAgain
        ? [{ text: 'OK' }]
        : [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => void Linking.openSettings() },
          ],
    );
    return null;
  }

  // Multi-select is a library-only idea — a capture is one photo. Passing
  // these through would be describing something the camera cannot do.
  const { allowsMultipleSelection: _m, selectionLimit: _s, ...cameraOptions } = options;
  try {
    return await ImagePicker.launchCameraAsync(cameraOptions);
  } catch {
    // Simulators, and devices whose camera is held by another app.
    Alert.alert(
      'Camera unavailable',
      "The camera can't be opened right now. Choose from your library instead.",
    );
    return null;
  }
}
