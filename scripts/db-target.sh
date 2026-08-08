#!/usr/bin/env bash
# WHICH DATABASE AM I ABOUT TO TOUCH?
#
# server/.env points at the LOCAL Supabase stack (127.0.0.1:54321) because
# that is what `npm run dev` should use. The app's .env.production points at
# the real project. The two look identical once you are holding a service key
# and a curl command, and on 2026-08-08 a whole diagnosis — "zero bookings",
# "zero transactions", "the constraint is still there" — was reported off the
# LOCAL stack and presented as production. Everything in it was true of the
# wrong database.
#
# So: never read a Supabase URL out of an env file by hand again. Ask this,
# and have it fail the command when the target is not what you expected.
#
#   ./scripts/db-target.sh                          # what does server/.env point at?
#   ./scripts/db-target.sh --require production     # exits 1 unless it is prod
#   ./scripts/db-target.sh --require local .env.production
#
# Exit codes: 0 match / 1 mismatch / 2 usage. Prints nothing secret — the
# project ref is already shipped inside the app bundle.
set -euo pipefail

REQUIRE=""
FILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --require) REQUIRE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) FILE="$1"; shift ;;
  esac
done

cd "$(dirname "$0")/.."
FILE="${FILE:-server/.env}"
[[ -f "$FILE" ]] || { echo "no such env file: $FILE" >&2; exit 2; }

# Either spelling, depending on whether it is a server or app env file.
URL="$(grep -m1 -E '^(EXPO_PUBLIC_)?SUPABASE_URL=' "$FILE" | cut -d= -f2- || true)"
[[ -n "$URL" ]] || { echo "no SUPABASE_URL in $FILE" >&2; exit 2; }

case "$URL" in
  *127.0.0.1*|*localhost*|*0.0.0.0*) KIND="local" ;;
  *supabase.co*|*supabase.in*)       KIND="production" ;;
  *)                                 KIND="unknown" ;;
esac

BAR="────────────────────────────────────────────────────────────"
if [[ "$KIND" == "production" ]]; then
  printf '\n%s\n  ** PRODUCTION **  %s\n  file: %s\n%s\n\n' "$BAR" "$URL" "$FILE" "$BAR"
else
  printf '\n%s\n  %s  %s\n  file: %s\n%s\n\n' "$BAR" "$(echo "$KIND" | tr '[:lower:]' '[:upper:]')" "$URL" "$FILE" "$BAR"
fi

if [[ -n "$REQUIRE" && "$REQUIRE" != "$KIND" ]]; then
  echo "REFUSING: expected $REQUIRE, this is $KIND." >&2
  exit 1
fi
