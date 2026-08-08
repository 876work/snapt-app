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

echo "Publishing OTA from $COMMIT (fingerprint computed WITH sensitive env)…"
npx eas-cli@latest env:exec production \
  "npx eas-cli@latest update --branch production --environment production --message \"$MSG [$COMMIT]\" --non-interactive"
