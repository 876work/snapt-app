import { supabaseAdmin } from './supabase.js';

/**
 * Migration-order guard: the headshot columns ship in
 * 20260808160000_creator_headshot.sql. PostgREST fails an ENTIRE select
 * when any requested column is missing, so every query naming the new
 * columns must know whether they exist yet — otherwise deploying the code
 * before the migration silently empties the featured rail, eligible
 * creators (matching!), creator/me and the admin detail. Probed once,
 * cached; flips to true within a minute of the migration running.
 */
let probe: { at: number; present: boolean } | null = null;
const TTL_MS = 60_000;

export async function headshotColumnsPresent(): Promise<boolean> {
  if (probe && (probe.present || Date.now() - probe.at < TTL_MS)) return probe.present;
  const { error } = await supabaseAdmin
    .from('creator_profiles')
    .select('headshot_path')
    .limit(1);
  probe = { at: Date.now(), present: !error };
  return probe.present;
}

/**
 * Same guard, for headshot_pending_path (20260810110000_headshot_pending.sql).
 * Deploying this code before that migration must NOT empty creator/me or the
 * admin creator detail — PostgREST rejects the whole select on one unknown
 * column, so the column is only ever named once it provably exists.
 */
let pendingProbe: { at: number; present: boolean } | null = null;

export async function headshotPendingColumnPresent(): Promise<boolean> {
  if (pendingProbe && (pendingProbe.present || Date.now() - pendingProbe.at < TTL_MS)) {
    return pendingProbe.present;
  }
  const { error } = await supabaseAdmin
    .from('creator_profiles')
    .select('headshot_pending_path')
    .limit(1);
  pendingProbe = { at: Date.now(), present: !error };
  return pendingProbe.present;
}
