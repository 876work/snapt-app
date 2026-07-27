// Confirmed values — handoff Section 5. Safe to build against.
// Kept as named exports (not inlined) so a backend/admin config can override later.

export const CLIENT_SERVICE_FEE_RATE = 0.08;
export const CREATOR_PLATFORM_FEE_RATE = 0.32;
// Promo rates may apply, shown with strikethrough against the standard rate (§5).
// Actual promo value is admin-set; 20% is the prototype's illustrative rate.
export const CREATOR_PROMO_FEE_RATE = 0.2;

export const XCD_PER_USD = 2.7;

export const ADVANCE_BOOKING_WINDOW_DAYS = 14;
export const FREE_REVISIONS_PER_ORDER = 1;

export const CANCEL_FULL_REFUND_HOURS = 48;
export const CANCEL_HALF_CHARGE_HOURS = 24;
// Charge rates apply to the SESSION cost; the 8% client service fee is
// non-refundable at every tier (Don, 2026-07-27).
export const CANCEL_TIERS = {
  over48h: { chargeRate: 0, label: 'Full session refund' },
  between24and48h: { chargeRate: 0.5, label: '50% charge' },
  under24h: { chargeRate: 1, label: '100% charge, no refund' },
} as const;

export const RESCHEDULE_FREE_COUNT = 1;
// Confirmed by Don 2026-07-27: widened from 6h to 24h — inside 24 hours the
// only path is cancel (normal fee tiers) or support. The 24–48h reschedule
// keeps the 50% charge; >48h stays free once.
export const RESCHEDULE_DISABLED_UNDER_HOURS = 24;

export const NO_SHOW_GRACE_MINUTES = 15;

export const STRIKE_WINDOW_DAYS = 60;
export const LATE_CANCEL_STRIKE_WEIGHT = 2;
export const STRIKE_TIERS = [
  'Warning',
  'Matching deprioritization (2 weeks)',
  'Suspension (1 week)',
  'Manual admin review',
] as const;

export const DISPUTE_FILING_WINDOW_DAYS = 7;
export const DISPUTE_EVIDENCE_WINDOW_HOURS = 72;
export const DISPUTE_APPEAL_WINDOW_DAYS = 14;
// Confirmed by Don 2026-07-26: hold matches the dispute filing window exactly,
// so no payout is ever released while a dispute could still be filed.
export const PAYOUT_HOLD_DAYS = 7;

// ---------------------------------------------------------------------------
// UNCONFIRMED — verify with Don before these affect financial/legal logic
// (handoff Section 6). Working defaults only.
// ---------------------------------------------------------------------------

export const RAW_FOOTAGE_RETENTION_DAYS = 90; // UNCONFIRMED — verify with Don
export const DELIVERED_CONTENT_AVAILABILITY_MONTHS = 12; // UNCONFIRMED — verify with Don
export const CREATOR_NON_CIRCUMVENTION_MONTHS = 12; // UNCONFIRMED — verify with Don
export const BACKGROUND_CHECK_RECHECK_MONTHS = 24; // UNCONFIRMED — verify with Don

// Events = 2h is the ONLY confirmed occasion default ("Recommended for
// Events" badge on the 2-hour option, §7 + design). Portraits, Social,
// Family, and Wedding defaults are undefined — do not infer values; no
// pre-select or badge for them until Don specifies.
export const OCCASION_DEFAULT_DURATION_HOURS: Partial<Record<string, number>> = {
  Events: 2,
};

export type Currency = 'USD' | 'XCD';

export function formatMoney(usd: number, currency: Currency): string {
  if (currency === 'XCD') {
    return `EC$${(usd * XCD_PER_USD).toFixed(0)}`;
  }
  return `$${usd.toFixed(0)}`;
}

export type CancelTier = keyof typeof CANCEL_TIERS;

export function cancelTierForHoursUntil(hours: number): CancelTier {
  if (hours > CANCEL_FULL_REFUND_HOURS) return 'over48h';
  if (hours > CANCEL_HALF_CHARGE_HOURS) return 'between24and48h';
  return 'under24h';
}
