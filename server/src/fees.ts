import { getConfig } from './config.js';

// Fee-tier engine (handoff §5/§8). Computed SERVER-SIDE at time of action —
// the app's tier displays are advisory only. All rates come from app_config.

export type CancelTier = 'over48h' | 'between24and48h' | 'under24h';

export interface CancelQuote {
  tier: CancelTier;
  chargeRate: number; // fraction of the SESSION cost kept as the late fee
  chargeUsd: number;
  /** Always kept — the client service fee is non-refundable at every tier. */
  serviceFeeUsd: number;
  refundUsd: number;
}

export interface RescheduleQuote {
  allowed: boolean;
  reason?: 'disabled_under_cutoff' | 'free_reschedule_used';
  feeRate: number;
  feeUsd: number;
  free: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function hoursUntil(scheduledAt: string, now = Date.now()): number {
  return (new Date(scheduledAt).getTime() - now) / 3600_000;
}

/**
 * Cancellation quote. The 8% client service fee is NON-REFUNDABLE at every
 * tier (Don, 2026-07-27) — the charge rate applies to the session cost only,
 * and the service fee is always kept: a >48h cancel refunds the session cost
 * in full but not the fee.
 */
export async function cancelQuote(
  scheduledAt: string,
  sessionPriceUsd: number,
  serviceFeeUsd: number,
): Promise<CancelQuote> {
  const config = await getConfig();
  const tiers = (config['cancel_tiers'] as Record<CancelTier, number>) ?? {
    over48h: 0,
    between24and48h: 0.5,
    under24h: 1,
  };
  const hours = hoursUntil(scheduledAt);
  const tier: CancelTier =
    hours > 48 ? 'over48h' : hours > 24 ? 'between24and48h' : 'under24h';
  const chargeRate = tiers[tier];
  const chargeUsd = round2(sessionPriceUsd * chargeRate);
  return {
    tier,
    chargeRate,
    chargeUsd,
    serviceFeeUsd: round2(serviceFeeUsd),
    refundUsd: round2(sessionPriceUsd - chargeUsd),
  };
}

/**
 * Reschedule quote (§5 + Don's 2026-07-27 decision): free once >48h out;
 * 24–48h carries the same 50% charge as cancelling in that window; disabled
 * entirely under 24h — inside that, the only path is cancel (normal fee
 * tiers) or support. (The cutoff was widened from 6h to 24h, closing the
 * former 6–24h gap; there is no paid reschedule tier inside 24h.)
 */
export async function rescheduleQuote(
  scheduledAt: string,
  sessionPriceUsd: number,
  rescheduleCount: number,
): Promise<RescheduleQuote> {
  const config = await getConfig();
  const disabledUnder = (config['reschedule_disabled_under_hours'] as number) ?? 24;
  const freeCount = (config['reschedule_free_count'] as number) ?? 1;
  const tiers = (config['cancel_tiers'] as Record<CancelTier, number>) ?? {
    over48h: 0,
    between24and48h: 0.5,
    under24h: 1,
  };
  const hours = hoursUntil(scheduledAt);

  if (hours < disabledUnder) {
    return { allowed: false, reason: 'disabled_under_cutoff', feeRate: 0, feeUsd: 0, free: false };
  }
  if (hours > 48) {
    if (rescheduleCount >= freeCount) {
      // Additional >48h reschedules are treated as cancel + rebook (§5):
      // the client cancels (full refund at this tier) and books fresh at
      // current pricing. The endpoint returns this as an explicit action.
      return { allowed: false, reason: 'free_reschedule_used', feeRate: 0, feeUsd: 0, free: false };
    }
    return { allowed: true, feeRate: 0, feeUsd: 0, free: true };
  }
  // Only the 24–48h band remains chargeable.
  const rate = tiers.between24and48h;
  return { allowed: true, feeRate: rate, feeUsd: round2(sessionPriceUsd * rate), free: false };
}
