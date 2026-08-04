import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { PROVIDER_GOOGLE } from 'react-native-maps';

// Which native map renderer this binary actually contains. Android is always
// Google (Play Services). iOS is Google only when the build was made with
// GOOGLE_MAPS_IOS_KEY set (app.config.ts compiles in the Google subspec and
// sets this flag); otherwise Apple tiles — passing PROVIDER_GOOGLE to a build
// without the subspec throws at mount, so every MapView must use this const.
export const MAP_PROVIDER =
  Platform.OS === 'android' || Boolean(Constants.expoConfig?.extra?.hasGoogleMapsIOS)
    ? PROVIDER_GOOGLE
    : undefined;
