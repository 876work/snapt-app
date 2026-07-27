import { supabaseAdmin } from './supabase.js';
import { getConfig } from './config.js';

// Creator reliability / strike engine (handoff §5/§9).
// - Rolling 60-day window: strikes carry expires_at and decay automatically —
//   standing only counts unexpired, non-overturned strikes.
// - Late (<24h) cancellations count double.
// - No-shows are higher severity: any active no-show strike raises standing
//   to at least suspension, regardless of cumulative weight.
// Strikes are visible only via admin + the tier notification (§9) — no
// client/creator read path.

export type StrikeType = 'cancellation' | 'late_cancellation' | 'no_show';

export async function recordStrike(
  creatorId: string,
  bookingId: string | null,
  type: StrikeType,
): Promise<void> {
  const config = await getConfig();
  const windowDays = (config['strike_window_days'] as number) ?? 60;
  const lateWeight = (config['late_cancel_strike_weight'] as number) ?? 2;
  const weight = type === 'late_cancellation' ? lateWeight : 1;
  await supabaseAdmin.from('strikes').insert({
    creator_id: creatorId,
    booking_id: bookingId,
    type,
    weight,
    expires_at: new Date(Date.now() + windowDays * 86400_000).toISOString(),
  });
}

export interface CreatorStanding {
  activeWeight: number;
  hasActiveNoShow: boolean;
  /** 0 = clear, 1 = warning, 2 = deprioritized, 3 = suspended, 4 = admin review */
  tier: number;
  tierLabel: string;
  deprioritizedUntil: string | null;
  suspendedUntil: string | null;
}

const TIER_LABELS = ['clear', 'warning', 'deprioritization', 'suspension', 'admin_review'];

export async function creatorStanding(creatorId: string): Promise<CreatorStanding> {
  const config = await getConfig();
  const deprioritizeDays = (config['strike_deprioritize_days'] as number) ?? 14;
  const suspensionDays = (config['strike_suspension_days'] as number) ?? 7;

  const { data: strikes, error } = await supabaseAdmin
    .from('strikes')
    .select('type, weight, occurred_at')
    .eq('creator_id', creatorId)
    .eq('overturned', false)
    .gt('expires_at', new Date().toISOString())
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(`creatorStanding: ${error.message}`);

  const active = strikes ?? [];
  const activeWeight = active.reduce((sum, s) => sum + (s.weight ?? 1), 0);
  const hasActiveNoShow = active.some((s) => s.type === 'no_show');

  // Cumulative-weight tier (1st warning, 2nd deprioritization, 3rd
  // suspension, 4th+ admin review); a no-show can skip straight to
  // suspension on first occurrence (§5/§9).
  let tier = Math.min(activeWeight, 4);
  if (hasActiveNoShow && tier < 3) tier = 3;

  const latest = active[0]?.occurred_at ? new Date(active[0].occurred_at).getTime() : Date.now();
  const deprioritizedUntil =
    tier === 2 ? new Date(latest + deprioritizeDays * 86400_000).toISOString() : null;
  const suspendedUntil =
    tier === 3 ? new Date(latest + suspensionDays * 86400_000).toISOString() : null;

  return {
    activeWeight,
    hasActiveNoShow,
    tier,
    tierLabel: TIER_LABELS[tier],
    deprioritizedUntil,
    suspendedUntil,
  };
}

export type MatchingPenalty = 'none' | 'deprioritized' | 'excluded';

function penaltyFromStanding(s: CreatorStanding, now = Date.now()): MatchingPenalty {
  if (s.tier >= 4) return 'excluded';
  if (s.tier === 3 && s.suspendedUntil && now < Date.parse(s.suspendedUntil)) return 'excluded';
  if (s.tier === 2 && s.deprioritizedUntil && now < Date.parse(s.deprioritizedUntil)) {
    return 'deprioritized';
  }
  return 'none';
}

/** Matching enforcement view of standing: excluded (suspended/review) or deprioritized. */
export async function matchingPenalty(creatorId: string): Promise<MatchingPenalty> {
  return penaltyFromStanding(await creatorStanding(creatorId));
}

/** Batch penalties for a creator set — one query, used by the matching path. */
export async function matchingPenalties(
  creatorIds: string[],
): Promise<Map<string, MatchingPenalty>> {
  const config = await getConfig();
  const deprioritizeDays = (config['strike_deprioritize_days'] as number) ?? 14;
  const suspensionDays = (config['strike_suspension_days'] as number) ?? 7;
  const result = new Map<string, MatchingPenalty>(creatorIds.map((id) => [id, 'none']));
  if (creatorIds.length === 0) return result;

  const { data, error } = await supabaseAdmin
    .from('strikes')
    .select('creator_id, type, weight, occurred_at')
    .in('creator_id', creatorIds)
    .eq('overturned', false)
    .gt('expires_at', new Date().toISOString())
    .order('occurred_at', { ascending: false });
  if (error) throw new Error(`matchingPenalties: ${error.message}`);

  const byCreator = new Map<string, { type: string; weight: number; occurred_at: string }[]>();
  for (const s of data ?? []) {
    const list = byCreator.get(s.creator_id) ?? [];
    list.push(s as { type: string; weight: number; occurred_at: string });
    byCreator.set(s.creator_id, list);
  }
  for (const [creatorId, strikes] of byCreator) {
    const weight = strikes.reduce((sum, s) => sum + (s.weight ?? 1), 0);
    const hasNoShow = strikes.some((s) => s.type === 'no_show');
    let tier = Math.min(weight, 4);
    if (hasNoShow && tier < 3) tier = 3;
    const latest = new Date(strikes[0].occurred_at).getTime();
    const standing: CreatorStanding = {
      activeWeight: weight,
      hasActiveNoShow: hasNoShow,
      tier,
      tierLabel: TIER_LABELS[tier],
      deprioritizedUntil:
        tier === 2 ? new Date(latest + deprioritizeDays * 86400_000).toISOString() : null,
      suspendedUntil:
        tier === 3 ? new Date(latest + suspensionDays * 86400_000).toISOString() : null,
    };
    result.set(creatorId, penaltyFromStanding(standing));
  }
  return result;
}
