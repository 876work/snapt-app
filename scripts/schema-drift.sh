#!/usr/bin/env bash
# WHICH MIGRATIONS HAVE ACTUALLY BEEN APPLIED?
#
# Migrations in this repo are run by pasting SQL into the Supabase editor, so
# nothing records that a file ran. Twice now that gap has surfaced as a broken
# screen instead of a failed deploy:
#
#   - 20260808160000_creator_headshot.sql sat unrun from 8 August until a
#     creator saw "Could not find the 'headshot_path' column of
#     'creator_profiles' in the schema cache" and applications were blocked.
#   - transactions.booking_id kept a NOT NULL constraint the code had already
#     stopped honouring, and every checkout webhook failed silently.
#
# This compares what the migrations DECLARE against what production actually
# has, and exits non-zero listing every gap.
#
#   ./scripts/schema-drift.sh                    # check production
#   ./scripts/schema-drift.sh .env.production    # explicit env file
#
# Exit codes: 0 no drift / 1 drift found / 2 usage or unreachable.
#
# WHAT IT DETECTS: tables and columns a migration declares that production
# does not have. That is the class both bugs above fell into.
#
# WHAT IT DOES NOT DETECT: constraints, defaults, nullability, indexes,
# policies, functions and triggers. PostgREST will not introspect those
# without a helper function, and the OpenAPI root is closed on this project.
# A clean run means "no missing tables or columns" — it is NOT a promise that
# a migration ran in full. Said plainly here so a green result is not read as
# more than it is.
#
# Needs only the ANON key: a missing column answers 42703 BEFORE row-level
# security is consulted, so this cannot expire mid-audit the way an admin
# token does.
set -uo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-.env.production}"
[[ -f "$FILE" ]] || { echo "no such env file: $FILE" >&2; exit 2; }

# Refuse to audit anything but production unless the file says otherwise —
# a drift report against the local stack is worse than none.
./scripts/db-target.sh --require production "$FILE" >/dev/null 2>&1 || {
  ./scripts/db-target.sh "$FILE"
  echo "REFUSING: schema drift is only meaningful against production." >&2
  exit 2
}

SUPABASE_URL="$(grep -m1 -E '^(EXPO_PUBLIC_)?SUPABASE_URL=' "$FILE" | cut -d= -f2-)"
ANON="$(grep -m1 -E '^(EXPO_PUBLIC_)?SUPABASE_ANON_KEY=' "$FILE" | cut -d= -f2-)"
[[ -n "$SUPABASE_URL" && -n "$ANON" ]] || { echo "missing SUPABASE_URL / ANON key in $FILE" >&2; exit 2; }

SUPABASE_URL="$SUPABASE_URL" ANON="$ANON" python3 <<'PY'
import glob, json, os, re, subprocess, sys, urllib.parse

SUP, ANON = os.environ['SUPABASE_URL'].rstrip('/'), os.environ['ANON']

def rest(path):
    """GET against PostgREST with the anon key. Returns (status, body)."""
    out = subprocess.run(
        ['curl', '-sS', '--max-time', '25', '-w', '\n%{http_code}',
         f'{SUP}/rest/v1/{path}', '-H', f'apikey: {ANON}'],
        capture_output=True, text=True).stdout
    body, _, code = out.rpartition('\n')
    return code.strip(), body

# ---- What the migrations declare -----------------------------------------
# Replayed in filename order so a column added and later dropped is not
# reported as missing, and a table dropped later is not expected to exist.
expected: dict[str, set[str]] = {}
origin: dict[tuple[str, str], str] = {}
table_origin: dict[str, str] = {}

for path in sorted(glob.glob('supabase/migrations/*.sql')):
    name = os.path.basename(path)
    sql = re.sub(r'--[^\n]*', '', open(path).read())  # strip line comments

    for m in re.finditer(r'create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);', sql, re.I):
        table, body = m.group(1), m.group(2)
        cols = set()
        depth = 0
        for line in body.split('\n'):
            stripped = line.strip()
            # Skip table-level constraint lines and anything nested in ().
            if depth == 0 and stripped and not re.match(
                r'(constraint|primary\s+key|foreign\s+key|unique|check|exclude)\b', stripped, re.I):
                cm = re.match(r'(\w+)\s+\S', stripped)
                if cm:
                    cols.add(cm.group(1))
            depth += line.count('(') - line.count(')')
        expected.setdefault(table, set()).update(cols)
        table_origin.setdefault(table, name)
        for c in cols:
            origin.setdefault((table, c), name)

    for m in re.finditer(r'alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?(\w+)([\s\S]*?);', sql, re.I):
        table, body = m.group(1), m.group(2)
        for cm in re.finditer(r'add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)', body, re.I):
            expected.setdefault(table, set()).add(cm.group(1))
            origin.setdefault((table, cm.group(1)), name)
        for dm in re.finditer(r'drop\s+column\s+(?:if\s+exists\s+)?(\w+)', body, re.I):
            expected.get(table, set()).discard(dm.group(1))

    for m in re.finditer(r'drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)', sql, re.I):
        expected.pop(m.group(1), None)

# ---- What production has --------------------------------------------------
missing_tables, missing_cols, unreachable = [], [], []

for table in sorted(expected):
    cols = sorted(expected[table])
    if not cols:
        continue
    # One request per table when everything is present — the common case.
    code, body = rest(f'{table}?select={",".join(cols)}&limit=0')
    if code == '200':
        continue
    if '42P01' in body or code == '404' or 'PGRST205' in body:
        missing_tables.append((table, table_origin.get(table, '?')))
        continue
    if '42703' not in body:
        # Reachable but refused for another reason (RLS on a zero-row select
        # should not do this, so surface it rather than call it clean).
        try:
            msg = json.loads(body).get('message', body)[:90]
        except Exception:
            msg = body[:90]
        unreachable.append((table, code, msg))
        continue
    # Something is missing — find every one, not just the first.
    for c in cols:
        c_code, c_body = rest(f'{table}?select={urllib.parse.quote(c)}&limit=0')
        if '42703' in c_body:
            missing_cols.append((table, c, origin.get((table, c), '?')))

# ---- Report ---------------------------------------------------------------
BAR = '=' * 66
print(f'\nMigrations declared : {len(glob.glob("supabase/migrations/*.sql"))} files')
print(f'Tables checked      : {len(expected)}')
print(f'Columns checked     : {sum(len(v) for v in expected.values())}')
print(f'Target              : {SUP}')

if unreachable:
    print(f'\n{BAR}\n  COULD NOT CHECK {len(unreachable)} TABLE(S)\n{BAR}')
    for t, code, msg in unreachable:
        print(f'  {t:<28} HTTP {code}  {msg}')

if not missing_tables and not missing_cols:
    print(f'\n{BAR}\n  NO MISSING TABLES OR COLUMNS\n{BAR}')
    print('  Constraints, defaults, nullability, indexes, policies and')
    print('  functions are NOT checked — see the header. A clean result')
    print('  does not prove every migration ran in full.\n')
    sys.exit(2 if unreachable else 0)

print(f'\n{BAR}')
print(f'  SCHEMA DRIFT — {len(missing_tables)} TABLE(S), {len(missing_cols)} COLUMN(S) MISSING')
print(f'  Production is behind the migrations in this repo.')
print(BAR)
for t, mig in missing_tables:
    print(f'\n  MISSING TABLE   {t}')
    print(f'    declared in   {mig}')
for t, c, mig in missing_cols:
    print(f'\n  MISSING COLUMN  {t}.{c}')
    print(f'    declared in   {mig}')
print(f'\n{BAR}')
print('  Run the migration(s) above in the Supabase SQL editor, then')
print('  re-run this script. Anything the app writes to a missing column')
print('  fails at runtime with a Postgres schema-cache error.')
print(f'{BAR}\n')
sys.exit(1)
PY
