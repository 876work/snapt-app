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
