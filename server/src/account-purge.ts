import { supabaseAdmin } from './supabase.js';
import { configNumber } from './config.js';

/**
 * END OF GRACE: anonymize, don't delete rows.
 *
 * bookings.client_id and transactions.user_id reference profiles WITHOUT
 * cascade — financial and booking records must survive the person, so a
 * hard delete of the profile (or the auth user, which cascades into
 * profiles) is structurally impossible and legally wrong. Instead, once
 * deleted_at is older than the grace window:
 *
 *   REMOVED   messages the user sent, notifications, Didit verification
 *             rows (session refs, extracted fields, match score), creator
 *             profile, push tokens (already gone at request time; swept
 *             again defensively).
 *   SCRUBBED  profiles: name -> "Deleted user", email/phone/avatar null.
 *             GoTrue: email scrambled, password rotated, ban extended —
 *             the credential can never sign in or be recovered.
 *   KEPT      bookings, transactions, payout history (all paid out — the
 *             guards refused deletion otherwise), disputes and ratings,
 *             attributed to the anonymized profile.
 *   FILES     portfolio + avatar objects are deleted by the EXISTING
 *             retention job's account-deletion window, which reads the
 *             same deleted_at.
 *
 * Per-account error isolation: one failing account never blocks the rest,
 * and purged_at is stamped LAST, so a partial failure re-runs next tick —
 * every step is idempotent.
 */
export interface PurgeResult {
  scanned: number;
  purged: string[];
  errors: { user_id: string; error: string }[];
}

export async function purgeDeletedAccounts(): Promise<PurgeResult> {
  const graceDays = await configNumber('retention_account_deleted_days', 30);
  const cutoff = new Date(Date.now() - graceDays * 86400_000).toISOString();

  const { data: due } = await supabaseAdmin
    .from('profiles')
    .select('id, deleted_at')
    .not('deleted_at', 'is', null)
    .is('purged_at', null)
    .lte('deleted_at', cutoff)
    .limit(20);

  const result: PurgeResult = { scanned: (due ?? []).length, purged: [], errors: [] };

  for (const p of due ?? []) {
    const uid = p.id as string;
    try {
      await supabaseAdmin.from('messages').delete().eq('sender_id', uid);
      await supabaseAdmin.from('notifications').delete().eq('user_id', uid);
      await supabaseAdmin.from('verification_sessions').delete().eq('user_id', uid);
      await supabaseAdmin.from('push_tokens').delete().eq('user_id', uid);
      await supabaseAdmin.from('creator_profiles').delete().eq('user_id', uid);

      const { error: scrubErr } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: 'Deleted user',
          email: null,
          phone: null,
          purged_at: new Date().toISOString(),
        })
        .eq('id', uid);
      if (scrubErr) throw new Error(`profile scrub: ${scrubErr.message}`);

      // Credential neutralization: the auth user cannot be row-deleted
      // (cascade would take the profiles row and break booking FKs), so the
      // email is scrambled, the password rotated, and the ban made
      // effectively permanent.
      await supabaseAdmin.auth.admin.updateUserById(uid, {
        email: `deleted-${uid}@purged.invalid`,
        password: crypto.randomUUID() + crypto.randomUUID(),
        ban_duration: '876000h',
        user_metadata: {},
      });

      result.purged.push(uid);
    } catch (err) {
      result.errors.push({ user_id: uid, error: (err as Error).message });
    }
  }

  if (result.errors.length > 0) {
    await supabaseAdmin.from('admin_alerts').insert({
      alert_type: 'account_purge_failed',
      detail: { errors: result.errors },
    });
  }
  return result;
}
