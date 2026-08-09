import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin } from './supabase.js';

/**
 * THE FOUR REQUIRED PROFILE FIELDS, enforced server-side.
 *
 * Client routing is not the guard. An OAuth account reaches a live session
 * the instant the provider returns, and from that moment it can call this API
 * with a valid token — the completion screen is in front of the UI, not in
 * front of the server. Anything that needs a real person on the other end
 * checks here instead.
 *
 * Three things are gated, and only three:
 *   - creating a booking      — a creator is being committed to turn up
 *   - checking out            — money moves
 *   - applying as a creator   — we are onboarding someone to be paid
 *
 * Reads stay open. Browsing, prices and an existing booking's detail are not
 * blocked by a missing phone number; the point is to stop new commitments,
 * not to brick the app behind a form.
 */

export const REQUIRED_FIELDS = ['full_name', 'email', 'phone', 'country'] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

/**
 * MIGRATION-ORDER GUARD, same shape as schema-probe.ts.
 *
 * PostgREST fails an ENTIRE select when one requested column is missing. If
 * this code reaches production before 20260809140000_profile_country.sql
 * runs, the select below errors, every account looks incomplete, and
 * checkout is refused for EVERYONE. Probed once and cached; flips to true
 * within a minute of the migration running.
 */
let countryProbe: { at: number; present: boolean } | null = null;
const PROBE_TTL_MS = 60_000;

async function countryColumnPresent(): Promise<boolean> {
  if (countryProbe && (countryProbe.present || Date.now() - countryProbe.at < PROBE_TTL_MS)) {
    return countryProbe.present;
  }
  const { error } = await supabaseAdmin.from('profiles').select('country').limit(1);
  countryProbe = { at: Date.now(), present: !error };
  return countryProbe.present;
}

/** Which of the four this account is missing. Empty array = complete. */
export async function profileGaps(userId: string): Promise<RequiredField[]> {
  const hasCountry = await countryColumnPresent();
  const columns = hasCountry ? 'full_name, email, phone, country' : 'full_name, email, phone';
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(columns)
    .eq('id', userId)
    .maybeSingle();
  // A read failure is NOT "complete". Failing open here would let the exact
  // accounts this exists to catch straight through on a transient error.
  if (error || !data) return [...REQUIRED_FIELDS];
  // Cast through unknown: the column list is chosen at runtime, so the
  // client's compile-time row type can't be inferred from it.
  const row = data as unknown as Record<string, unknown>;
  // Before the migration, country simply isn't checked — the other three
  // still are. Nobody is blocked on a column that does not exist yet.
  const fields = hasCountry ? REQUIRED_FIELDS : REQUIRED_FIELDS.filter((f) => f !== 'country');
  return fields.filter((f) => String(row[f] ?? '').trim() === '');
}

/**
 * Refuse the request when the profile is incomplete.
 *
 * Returns true when the caller may proceed. The 403 carries the field list so
 * the app can open the completion step on the right fields rather than making
 * the user rediscover what is missing.
 */
export async function requireCompleteProfile(
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
): Promise<boolean> {
  const missing = await profileGaps(userId);
  if (missing.length === 0) return true;
  request.log.info({ userId, missing }, 'blocked: incomplete profile');
  reply.code(403).send({
    error:
      'Add your name, phone number and country before you can book — a creator needs a way to reach you about the session.',
    code: 'profile_incomplete',
    missing,
  });
  return false;
}
