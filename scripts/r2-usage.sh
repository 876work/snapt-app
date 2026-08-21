#!/usr/bin/env bash
# WHAT IS ACTUALLY IN THE R2 BUCKET, AND HOW MUCH?
#
# The database can only answer this for RECENT files. booking_media.size_bytes
# exists from 2026-08-21 and is filled at register time from storage's own
# reading of the object — but only for files registered AFTER that server
# deploy. Everything older is null forever: the size was never captured and R2
# is the only place it survives, so there was nothing to backfill from. Two
# things follow. Bucket totals still have to come from R2, which is what this
# script does. And null in that column means "not recorded", never zero — a
# SUM over it silently under-reports the pile this script exists to measure.
#
# Why it matters (2026-08-14): app_config.retention_dry_run is still TRUE, so
# the daily retention job has only ever LOGGED what it would delete. Raw
# footage (up to 1.5GB per order), deliverables, proofs and portfolio images
# have therefore accumulated since day one. Two jobs DO delete for real and
# are not affected by dry-run — the abandoned-draft sweep (every 5 min, files
# on unclaimed drafts older than 24h) and account purge — so unclaimed drafts
# are NOT part of the pile.
#
# CREDENTIALS: read from the environment, never from this repo and never
# printed. They live in the Render dashboard on the API service. Copy them
# into your shell for one run:
#
#   export R2_ACCOUNT_ID=...  R2_ACCESS_KEY_ID=...
#   export R2_SECRET_ACCESS_KEY=...  R2_BUCKET=...
#   ./scripts/r2-usage.sh
#
# Read-only: it issues ListObjectsV2 (Class B operations) and nothing else.
# A bucket of a few thousand objects costs a fraction of a cent to scan.
set -euo pipefail
cd "$(dirname "$0")/.."

MISSING=()
for v in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  [[ -n "${!v:-}" ]] || MISSING+=("$v")
done
if (( ${#MISSING[@]} > 0 )); then
  echo "Missing from the environment: ${MISSING[*]}" >&2
  echo "Find them on the Render dashboard → snapt-api → Environment." >&2
  exit 2
fi

# Run from server/, where @aws-sdk/client-s3 is installed (same SDK the API
# uses to presign, so this reads the bucket exactly as production writes it).
cd server
exec node --input-type=module <<'JS'
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.R2_BUCKET;

const human = (b) => {
  if (b >= 1e12) return `${(b / 1e12).toFixed(2)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
};

// storage.ts keys every object as `${logicalBucket}/${path}`, so the first
// segment is the media class: raw-footage | deliverables | portfolio.
const groups = new Map();
const ageBuckets = [
  { label: 'under 30 days', maxDays: 30, bytes: 0, count: 0 },
  { label: '30 to 90 days', maxDays: 90, bytes: 0, count: 0 },
  { label: '90 to 365 days', maxDays: 365, bytes: 0, count: 0 },
  { label: 'over 365 days', maxDays: Infinity, bytes: 0, count: 0 },
];
const biggest = [];
let total = 0;
let count = 0;
let oldest = null;
let token;
let pages = 0;

do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket, ContinuationToken: token, MaxKeys: 1000 }),
  );
  pages += 1;
  for (const o of page.Contents ?? []) {
    const size = Number(o.Size ?? 0);
    const when = o.LastModified ? new Date(o.LastModified) : null;
    total += size;
    count += 1;
    if (when && (!oldest || when < oldest)) oldest = when;

    const cls = String(o.Key).split('/')[0] || '(root)';
    const g = groups.get(cls) ?? { bytes: 0, count: 0 };
    g.bytes += size;
    g.count += 1;
    groups.set(cls, g);

    if (when) {
      const days = (Date.now() - when.getTime()) / 86400000;
      const slot = ageBuckets.find((b) => days < b.maxDays) ?? ageBuckets[ageBuckets.length - 1];
      slot.bytes += size;
      slot.count += 1;
    }

    biggest.push({ key: o.Key, size });
    if (biggest.length > 400) {
      biggest.sort((a, b) => b.size - a.size);
      biggest.length = 20;
    }
  }
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
  if (pages % 10 === 0) console.error(`  …scanned ${count} objects`);
} while (token);

biggest.sort((a, b) => b.size - a.size);

console.log('');
console.log('R2 BUCKET USAGE');
console.log('═'.repeat(58));
console.log(`  objects        ${count.toLocaleString()}`);
console.log(`  total size     ${human(total)}`);
console.log(`  oldest object  ${oldest ? oldest.toISOString().slice(0, 10) : '(none)'}`);
console.log('');

console.log('BY MEDIA CLASS');
console.log('─'.repeat(58));
for (const [cls, g] of [...groups.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  const pct = total > 0 ? ((g.bytes / total) * 100).toFixed(1) : '0.0';
  console.log(`  ${cls.padEnd(16)} ${human(g.bytes).padStart(10)}  ${String(g.count).padStart(6)} files  ${pct.padStart(5)}%`);
}
console.log('');

console.log('BY AGE  (age alone is NOT retention eligibility — that also');
console.log('         depends on booking state, holds and disputes)');
console.log('─'.repeat(58));
for (const b of ageBuckets) {
  console.log(`  ${b.label.padEnd(16)} ${human(b.bytes).padStart(10)}  ${String(b.count).padStart(6)} files`);
}
console.log('');

console.log('LARGEST 20 OBJECTS');
console.log('─'.repeat(58));
for (const b of biggest.slice(0, 20)) {
  console.log(`  ${human(b.size).padStart(10)}  ${b.key}`);
}
console.log('');

// Cloudflare's own free allowance is 10GB-month of stored data; past that it
// bills per GB. Printed as orientation, not as a limit that blocks uploads —
// R2 does not stop accepting writes at a storage threshold.
const FREE_GB = 10;
const usedGb = total / 1e9;
console.log('HEADROOM');
console.log('─'.repeat(58));
console.log(`  ${usedGb.toFixed(2)} GB stored — R2's free allowance is ${FREE_GB} GB-month.`);
console.log(
  usedGb > FREE_GB
    ? `  Over the free allowance by ${(usedGb - FREE_GB).toFixed(2)} GB (billed, not blocked).`
    : `  ${(FREE_GB - usedGb).toFixed(2)} GB below the free allowance.`,
);
console.log('');
JS
