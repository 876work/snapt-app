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

# Local shape check BEFORE spending a network round trip (or an admin
# action) on a token that was never a token. Prints nothing from the token
# itself except its expiry — no signature, no subject, no email.
check_token() {
  local t; t="$(cat "$TOKEN_FILE")"
  local segs; segs="$(awk -F. '{print NF}' <<< "$t")"
  if [[ "${t:0:2}" != "ey" || "$segs" != "3" ]]; then
    echo "NOT A JWT: ${#t} bytes, ${segs} dot-segments, starts '${t:0:2}'." >&2
    echo "A Supabase access token is ~800 bytes, starts 'ey', and has 3 segments." >&2
    return 1
  fi
  local payload exp now
  payload="$(awk -F. '{print $2}' <<< "$t" | tr '_-' '/+')"
  while (( ${#payload} % 4 )); do payload+="="; done
  exp="$(base64 -d <<< "$payload" 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("exp",0))' 2>/dev/null || echo 0)"
  now="$(date +%s)"
  if [[ "$exp" == "0" ]]; then echo "Could not read exp claim." >&2; return 1; fi
  if (( exp <= now )); then
    echo "EXPIRED $(( (now - exp) / 60 )) min ago — grab a fresh one." >&2
    return 1
  fi
  echo "Token looks valid: $(( (exp - now) / 60 )) min remaining."
}

case "${1:-}" in
  check)       check_token ;;
  whoami)      check_token >/dev/null && call GET  /v1/admin/me ;;
  ghosts)      check_token >/dev/null && call GET  /v1/admin/ghost-bookings ;;
  ghosts-clear) check_token >/dev/null && call POST /v1/admin/ghost-bookings/clear ;;
  *) echo "usage: $0 {check|whoami|ghosts|ghosts-clear}" >&2; exit 2 ;;
esac
