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
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  ios: {
    ...config.ios,
    config: {
      ...config.ios?.config,
      googleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
    },
  },
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
      },
    },
  },
});
