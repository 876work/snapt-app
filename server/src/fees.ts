import { getConfig } from './config.js';

// Fee-tier engine (handoff §5/§8). Computed SERVER-SIDE at time of action —
// the app's tier displays are advisory only. All rates come from app_config.

export type CancelTier = 'over48h' | 'between24and48h' | 'under24h';

export interface CancelQuote {
  tier: CancelTier;
  chargeRate: number; // fraction of the amount paid that is kept
  chargeUsd: number;
  refundUsd: number;
}

export interface RescheduleQuote {
  allowed: boolean;
  reason?: 'disabled_under_6h' | 'free_reschedule_used';
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
 * Cancellation quote against the amount the client actually paid.
 * NOTE (flagged to Don): the handoff doesn't say whether the 8% client
 * service fee is refundable — this applies the charge rate to the full
 * amount paid (fee included), so a >48h cancel refunds everything.
 */
export async function cancelQuote(scheduledAt: string, amountPaidUsd: number): Promise<CancelQuote> {
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
  const chargeUsd = round2(amountPaidUsd * chargeRate);
  return { tier, chargeRate, chargeUsd, refundUsd: round2(amountPaidUsd - chargeUsd) };
}

/**
 * Reschedule quote (§5): free once >48h out; 24–48h carries the same 50%
 * charge as cancelling in that window; <6h disabled entirely.
 *
 * POLICY GAP (flagged to Don): the 6–24h band is not defined in the handoff.
 * Following the "same charge as cancellation in this window" pattern, it is
 * implemented as a 100% charge — confirm before launch.
 */
export async function rescheduleQuote(
  scheduledAt: string,
  amountPaidUsd: number,
  rescheduleCount: number,
): Promise<RescheduleQuote> {
  const config = await getConfig();
  const disabledUnder = (config['reschedule_disabled_under_hours'] as number) ?? 6;
  const freeCount = (config['reschedule_free_count'] as number) ?? 1;
  const tiers = (config['cancel_tiers'] as Record<CancelTier, number>) ?? {
    over48h: 0,
    between24and48h: 0.5,
    under24h: 1,
  };
  const hours = hoursUntil(scheduledAt);

  if (hours < disabledUnder) {
    return { allowed: false, reason: 'disabled_under_6h', feeRate: 0, feeUsd: 0, free: false };
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
  const rate = hours > 24 ? tiers.between24and48h : tiers.under24h;
  return { allowed: true, feeRate: rate, feeUsd: round2(amountPaidUsd * rate), free: false };
}
