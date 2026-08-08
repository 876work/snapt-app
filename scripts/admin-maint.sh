#!/usr/bin/env bash
# Maintenance runner for admin-only endpoints.
#
# Reads a SHORT-LIVED admin JWT from ~/.snapt-admin-token (your own portal
# session token — expires on its own, scoped to your role, revocable by
# deactivating your admin_users row, and audited under YOUR identity).
#
# The token is never printed, never passed as an argument (argv is visible
# in `ps`), and never written into the repo. It goes to curl via a header
# file on stdin so it cannot leak into shell history either.
set -euo pipefail

TOKEN_FILE="${SNAPT_ADMIN_TOKEN_FILE:-$HOME/.snapt-admin-token}"
BASE="${SNAPT_API:-https://snapt-api.onrender.com}"

if [[ ! -f "$TOKEN_FILE" ]]; then
  echo "No token file at $TOKEN_FILE" >&2
  exit 1
fi

call() { # method path
  local method="$1" path="$2"
  # Render's free tier sleeps; the first call can take 30-60s.
  curl -sS --max-time 90 -X "$method" "$BASE$path" \
    -H @<(printf 'Authorization: Bearer %s\n' "$(cat "$TOKEN_FILE")") \
    -H 'Content-Type: application/json'
}

case "${1:-}" in
  whoami)      call GET  /v1/admin/me ;;
  ghosts)      call GET  /v1/admin/ghost-bookings ;;
  ghosts-clear) call POST /v1/admin/ghost-bookings/clear ;;
  *) echo "usage: $0 {whoami|ghosts|ghosts-clear}" >&2; exit 2 ;;
esac
