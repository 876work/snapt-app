import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic config layered over app.json. Its ONLY job is to inject the Google
 * Maps native SDK keys from the environment at prebuild/build time, so the
 * keys never live in the repo.
 *
 * Sources:
 *  - EAS builds: EAS environment variables (production/preview/development)
 *    — NOT .env.production, which is committed and must never hold keys.
 *  - Local dev builds: .env (gitignored) via expo-cli's dotenv loading.
 *
 * These are BUILD-time values baked into the native binaries — an OTA update
 * can never add or change them; a maps key change means a full rebuild.
 * Missing keys (e.g. a fresh clone) still produce a working build — the map
 * views just render blank until a keyed build is made.
 */
/**
 * Sentry's config plugin wires the native source-map upload steps (an Xcode
 * build phase and the Android Gradle plugin). Org and project are passed only
 * when they are set: the plugin writes whatever it is given into
 * sentry.properties, so handing it `undefined` is worse than handing it
 * nothing — with neither key present it falls back to SENTRY_ORG /
 * SENTRY_PROJECT from the environment, which is where they live on EAS.
 *
 * SENTRY_AUTH_TOKEN is deliberately NOT passed through here. The plugin reads
 * it from the environment and strips it from props precisely so it cannot be
 * written into the built application package.
 */
const sentryPluginProps = {
  ...(process.env.SENTRY_ORG ? { organization: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  // The keys go through react-native-maps' own config plugin, NOT through
  // ios.config.googleMapsApiKey — that legacy path makes Expo prebuild inject
  // `pod 'react-native-google-maps'`, a pod that no longer exists in
  // react-native-maps >= 1.20 (Google support moved to the
  // `react-native-maps/Google` subspec, which this plugin wires correctly,
  // along with GMSServices.provideAPIKey in the AppDelegate).
  plugins: [
    ...((config.plugins ?? []) as NonNullable<ExpoConfig['plugins']>),
    [
      'react-native-maps',
      {
        iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
      },
    ],
    Object.keys(sentryPluginProps).length > 0
      ? ['@sentry/react-native', sentryPluginProps]
      : '@sentry/react-native',
  ],
  extra: {
    ...config.extra,
    // Runtime flag for MapView provider selection: Google tiles on iOS only
    // when the Google subspec was actually compiled in (key present at build).
    hasGoogleMapsIOS: Boolean(process.env.GOOGLE_MAPS_IOS_KEY),
  },
});
