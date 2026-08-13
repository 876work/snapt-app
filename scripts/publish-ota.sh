#!/usr/bin/env bash
# THE way to publish an OTA for this project. Publishing any other way can
# strand builds.
#
# Why this wrapper exists (2026-08-08):
#
#   app.config.ts injects GOOGLE_MAPS_IOS_KEY / GOOGLE_MAPS_ANDROID_KEY into
#   NATIVE config, so the runtime fingerprint depends on whether those env
#   vars are visible when the fingerprint is computed. They are stored in the
#   EAS "production" environment with SENSITIVE visibility: EAS builds see
#   them, but a bare `eas update --environment production` resolves config
#   locally WITHOUT them. Result: builds and publishes computed different
#   fingerprints from the same tree — build 12 (8a2b6845…) could never
#   receive an update published the bare way (0f1614b8…).
#
#   `eas env:exec production` runs the publish with the full environment,
#   sensitive vars included, so publish-time fingerprints match build-time.
#
# It also stamps EXPO_PUBLIC_COMMIT so Profile → Build & updates shows the
# exact commit the running bundle came from.
#
# SOURCE MAPS (2026-08-12):
#
#   Crash reports from an OTA bundle are minified garbage without the map for
#   THAT EXACT bundle. So the publish is now three steps instead of one:
#
#     export → upload maps → publish the exported bundle
#
#   The last step uses --input-dir with --skip-bundler deliberately. Letting
#   `eas update` bundle again would publish a bundle that was never the one
#   whose maps were uploaded, and matching is by debug id baked into the
#   bundle at export time — so a second bundling run is exactly the thing
#   that silently breaks symbolication.
#
#   All three run inside `eas env:exec production`: EXPO_PUBLIC_* values are
#   baked into the bundle AT EXPORT TIME, so exporting outside the production
#   environment would ship a bundle with no Supabase URL, no Stripe key and
#   no DSN.
#
#   Uploading is skipped, loudly, when SENTRY_AUTH_TOKEN is absent — a
#   missing token must not block shipping a fix, but it must never be
#   discovered later from an unreadable stack trace.
#
#   ./scripts/publish-ota.sh "message describing the change"
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:?usage: $0 \"update message\"}"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty — commit first so the stamped commit is honest." >&2
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
export EXPO_PUBLIC_COMMIT="$COMMIT"

# Stale bundles from a previous run would be republished by --input-dir.
rm -rf dist

echo "Publishing OTA from $COMMIT (fingerprint computed WITH sensitive env)…"
npx eas-cli@latest env:exec production "$(cat <<INNER
set -euo pipefail

echo '--- 1/3 export (source maps on) ---'
npx expo export --platform all --output-dir dist --source-maps --dump-assetmap

echo '--- 2/3 upload source maps ---'
# sentry-expo-upload-sourcemaps consults the Expo config when ANY of org,
# project or url is unset — and that lookup returns nothing here, so it exits
# 1 even though org and project are both in the environment. Supplying the
# url (a constant, not a secret) keeps it on the environment path entirely.
export SENTRY_URL="\${SENTRY_URL:-https://sentry.io}"
if [[ -n "\${SENTRY_AUTH_TOKEN:-}" ]]; then
  npx sentry-expo-upload-sourcemaps dist
else
  echo 'SENTRY_AUTH_TOKEN is not set in the production environment.' >&2
  echo 'PUBLISHING ANYWAY — crash reports from this update will NOT symbolicate.' >&2
fi

echo '--- 3/3 publish the exported bundle ---'
npx eas-cli@latest update --branch production --environment production \
  --input-dir dist --skip-bundler --message "$MSG [$COMMIT]" --non-interactive
INNER
)"
