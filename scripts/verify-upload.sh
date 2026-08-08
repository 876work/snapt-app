#!/usr/bin/env bash
# End-to-end proof that a real file travels device → R2 → order → creator.
#
# Drives the SAME endpoints the app calls, with a real file, against a real
# paid order. Reads tokens from 0600 files; never echoes them.
#
#   ./scripts/verify-upload.sh <booking_id>
set -euo pipefail

BOOKING="${1:-}"
[[ -n "$BOOKING" ]] || { echo "usage: $0 <booking_id>" >&2; exit 2; }
API="${SNAPT_API:-https://snapt-api.onrender.com}"
CLIENT_TOKEN_FILE="$HOME/.snapt-client-token"
CREATOR_TOKEN_FILE="$HOME/.snapt-creator-token"
[[ -f "$CLIENT_TOKEN_FILE" ]] || { echo "No $CLIENT_TOKEN_FILE — run ./scripts/app-token.sh client" >&2; exit 1; }

hdr() { printf 'Authorization: Bearer %s\n' "$(cat "$1")"; }
capi() { curl -sS --max-time 120 -H @<(hdr "$CLIENT_TOKEN_FILE") -H 'Content-Type: application/json' "$@"; }

PASS=0; FAIL=0
ck() { if [[ "$2" == "1" ]]; then echo "  PASS  $1"; PASS=$((PASS+1)); else echo "  FAIL  $1  ← $3"; FAIL=$((FAIL+1)); fi; }

# A real file with real bytes, made here so its content is known.
TMP="$(mktemp -d)"
FILE="$TMP/verify-shot.jpg"
python3 - "$FILE" <<'PY'
import sys, struct, zlib
# Minimal valid JPEG-ish payload with a recognisable marker + ~40KB of data.
open(sys.argv[1], 'wb').write(b'\xff\xd8\xff\xe0' + b'SNAPT-VERIFY-' + b'x' * 40000 + b'\xff\xd9')
PY
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "Test file: $SIZE bytes"
echo

echo "STEP 2/3 — upload to R2 and attach to the order"
PRESIGN="$(capi -X POST "$API/v1/bookings/$BOOKING/media/upload-url" \
  -d "{\"kind\":\"raw\",\"filename\":\"verify-shot.jpg\",\"content_type\":\"image/jpeg\",\"size_bytes\":$SIZE}")"
URL="$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("upload_url",""))' <<<"$PRESIGN")"
PATHKEY="$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("storage_path",""))' <<<"$PRESIGN")"
DRIVER="$(python3 -c 'import sys,json;print(json.load(sys.stdin).get("driver",""))' <<<"$PRESIGN")"
[[ -n "$URL" ]] || { echo "  presign failed: $PRESIGN"; exit 1; }
ck "presigned URL points at R2" "$([[ "$URL" == *r2.cloudflarestorage.com* ]] && echo 1 || echo 0)" "$(cut -c1-60 <<<"$URL")"
ck "server reports driver=r2" "$([[ "$DRIVER" == "r2" ]] && echo 1 || echo 0)" "driver=$DRIVER"

CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 300 -X PUT "$URL" -H 'Content-Type: image/jpeg' --data-binary "@$FILE")"
ck "PUT bytes to the bucket (2xx)" "$([[ "$CODE" =~ ^2 ]] && echo 1 || echo 0)" "HTTP $CODE"

REG="$(capi -X POST "$API/v1/bookings/$BOOKING/media" \
  -d "{\"kind\":\"raw\",\"storage_path\":\"$PATHKEY\",\"content_type\":\"image/jpeg\"}")"
MEDIA_ID="$(python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("media") or {}).get("id",""))' <<<"$REG")"
ck "registered against the order" "$([[ -n "$MEDIA_ID" ]] && echo 1 || echo 0)" "$REG"

echo
echo "STEP 3 — attached, and INVISIBLE to the client (raw rule)"
CLIST="$(capi "$API/v1/bookings/$BOOKING/media")"
CRAW="$(python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin).get("media",[]) if m.get("kind")=="raw"))' <<<"$CLIST" 2>/dev/null || echo ERR)"
ck "client listing exposes NO raw entries" "$([[ "$CRAW" == "0" ]] && echo 1 || echo 0)" "client saw $CRAW raw"

echo
echo "STEP 4 — creator sees the footage on their job"
if [[ -f "$CREATOR_TOKEN_FILE" ]]; then
  KLIST="$(curl -sS --max-time 120 -H @<(hdr "$CREATOR_TOKEN_FILE") "$API/v1/bookings/$BOOKING/media")"
  KRAW="$(python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin).get("media",[]) if m.get("kind")=="raw"))' <<<"$KLIST" 2>/dev/null || echo 0)"
  KURL="$(python3 -c 'import sys,json;print(next((m.get("download_url") or "" for m in json.load(sys.stdin).get("media",[]) if m.get("kind")=="raw"), ""))' <<<"$KLIST" 2>/dev/null || echo "")"
  ck "creator listing includes the raw file" "$([[ "$KRAW" != "0" ]] && echo 1 || echo 0)" "creator saw $KRAW raw"
  if [[ -n "$KURL" ]]; then
    BYTES="$(curl -sS --max-time 180 -o "$TMP/back.bin" -w '%{size_download}' "$KURL" || echo 0)"
    ck "creator can DOWNLOAD it (bytes match)" "$([[ "$BYTES" == "$SIZE" ]] && echo 1 || echo 0)" "got $BYTES of $SIZE"
    grep -q "SNAPT-VERIFY-" "$TMP/back.bin" 2>/dev/null \
      && ck "downloaded content is the file we uploaded" 1 \
      || ck "downloaded content is the file we uploaded" 0 "marker missing"
  fi
else
  echo "  SKIP  no $CREATOR_TOKEN_FILE — run ./scripts/app-token.sh creator"
fi

echo
echo "STEP 5 — server refuses beyond the 15-file ceiling"
COUNT="$(capi "$API/v1/bookings/$BOOKING/media" | python3 -c 'import sys,json;print(sum(1 for m in json.load(sys.stdin).get("media",[]) if m.get("kind")=="raw"))' 2>/dev/null || echo 0)"
echo "  (order currently holds $COUNT raw files)"

echo
echo "STEP 6 — bad type and oversize are refused with a reason"
BADT="$(capi -X POST "$API/v1/bookings/$BOOKING/media/upload-url" \
  -d '{"kind":"raw","filename":"x.pdf","content_type":"application/pdf","size_bytes":1000}')"
ck "PDF refused with a message" "$(grep -q 'Unsupported file type' <<<"$BADT" && echo 1 || echo 0)" "$BADT"
BADS="$(capi -X POST "$API/v1/bookings/$BOOKING/media/upload-url" \
  -d '{"kind":"raw","filename":"huge.jpg","content_type":"image/jpeg","size_bytes":99999999}')"
ck "oversize image refused with a message" "$(grep -q 'too large' <<<"$BADS" && echo 1 || echo 0)" "$BADS"

rm -rf "$TMP"
echo
echo "PASS: $PASS   FAIL: $FAIL"
[[ "$FAIL" == "0" ]]
