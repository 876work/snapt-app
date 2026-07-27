import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Service-role client: bypasses RLS. All financially-consequential state
// transitions (booking status, fees, payouts, strikes) go through this server
// per handoff §8 — never through client-side writes.
export const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Verify a Supabase access token and return the user, or null. */
export async function userFromToken(token: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error) return null;
  return data.user;
}
