#!/usr/bin/env bash
# Mint a SHORT-LIVED app session token for one of your own accounts.
#
# The client app is React Native — its Supabase session lives in
# AsyncStorage on the device, not in a browser localStorage, so the admin
# portal's devtools trick does not apply. This asks Supabase directly, the
# same call the app makes at sign-in, and writes the token straight to a
# 0600 file.
#
# Your password is read with `read -s` (never echoed, never in argv, never
# in shell history) and is used once for this request. The token expires on
# its own — Supabase's default is 1 hour.
#
#   ./scripts/app-token.sh client     → ~/.snapt-client-token
#   ./scripts/app-token.sh creator    → ~/.snapt-creator-token
#   ./scripts/app-token.sh admin      → ~/.snapt-admin-token
#
# 'admin' is the SAME mechanism, not a second one: admin auth is a normal
# Supabase login whose user id sits in admin_users. Use your portal email.
set -euo pipefail

ROLE="${1:-client}"
case "$ROLE" in
  client|creator|admin) ;;
  *) echo "usage: $0 {client|creator|admin}" >&2; exit 2 ;;
esac
OUT="$HOME/.snapt-${ROLE}-token"

cd "$(dirname "$0")/.."
if [[ ! -f .env.production ]]; then
  echo "No .env.production — cannot find the Supabase URL / anon key." >&2
  exit 1
fi
# Public values only: the URL and the anon key, both already shipped in the app.
SUPABASE_URL="$(grep '^EXPO_PUBLIC_SUPABASE_URL=' .env.production | cut -d= -f2-)"
ANON="$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' .env.production | cut -d= -f2-)"

read -rp "Email for the ${ROLE} account: " EMAIL
read -rsp "Password (not shown, not saved): " PASSWORD; echo

BODY="$(EMAIL="$EMAIL" PASSWORD="$PASSWORD" python3 -c \
  'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PASSWORD"]}))')"

RESP="$(curl -sS --max-time 60 -X POST \
  "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
  -H "apikey: ${ANON}" -H 'Content-Type: application/json' \
  --data-binary "$BODY")"
unset PASSWORD BODY

umask 077
# NOTE: the response is passed in the ENVIRONMENT, not on stdin. A heredoc
# program plus a `<<<` here-string is two stdin redirects — the last wins,
# so python would read the JSON as its own source and silently do nothing.
if ! RESP="$RESP" OUT="$OUT" python3 <<'PY'
import base64, json, os, sys, time

out = os.environ["OUT"]
try:
    d = json.loads(os.environ["RESP"])
except Exception:
    print("Unreadable response from Supabase.", file=sys.stderr)
    sys.exit(1)

tok = d.get("access_token")
if not tok:
    # Surface the reason WITHOUT echoing anything secret.
    reason = d.get("error_description") or d.get("msg") or d.get("error") or "sign-in refused"
    print(f"No token: {reason}", file=sys.stderr)
    sys.exit(1)

with open(out, "w") as fh:
    fh.write(tok)

payload = tok.split(".")[1]
payload += "=" * (-len(payload) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
print(f"Token written to {out} — {int((claims['exp'] - time.time()) / 60)} min remaining.")
PY
then
  exit 1
fi

# The 403 from requireAdmin is identical for an expired token, a missing
# admin_users row and a deactivated admin. Probe once so the difference is
# visible here rather than hours later.
if [[ "$ROLE" == "admin" ]]; then
  API="${SNAPT_API:-https://snapt-api.onrender.com}"
  CODE="$(curl -sS --max-time 45 -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $(cat "$OUT")" "$API/v1/admin/unassigned" || echo 000)"
  case "$CODE" in
    200) echo "Admin access confirmed against $API." ;;
    403) echo "Signed in, but this account is NOT an active admin (no admin_users row, or active=false)." >&2 ;;
    *)   echo "Token written, but the admin check returned HTTP $CODE." >&2 ;;
  esac
fi
