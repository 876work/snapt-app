// THIS FILE EXISTS FOR ONE REASON: DEBUG IDS.
//
// Sentry matches a minified stack trace to its source map by a Debug ID baked
// into BOTH at bundle time — not by release name, not by filename. Nothing
// injects that ID unless Metro is configured through Sentry's wrapper, and
// the failure mode is silent: source maps upload successfully, the publish
// succeeds, and every stack trace stays minified with no error anywhere to
// say why.
//
// `getSentryExpoConfig` calls Expo's own `getDefaultConfig` internally and
// adds the Sentry serializer on top, so the bundle is otherwise exactly what
// `npx expo export` produced before this file existed.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
