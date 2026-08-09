// Confirmed values — handoff Section 5. Safe to build against.
// Kept as named exports (not inlined) so a backend/admin config can override later.

export const CLIENT_SERVICE_FEE_RATE = 0.08;
export const CREATOR_PLATFORM_FEE_RATE = 0.32;
// Promo rates may apply, shown with strikethrough against the standard rate (§5).
// Actual promo value is admin-set; 20% is the prototype's illustrative rate.
export const CREATOR_PROMO_FEE_RATE = 0.2;

// USD→XCD peg. The single source of truth is the server's app_config row
// `xcd_per_usd` (admin-editable, no code change needed); syncDisplayRates()
// in lib/api pulls it at launch and overrides this bootstrap fallback. Never
// hardcode the rate anywhere else.
const XCD_PER_USD_FALLBACK = 2.72;
let xcdPerUsd = XCD_PER_USD_FALLBACK;
export function getXcdPerUsd(): number {
  return xcdPerUsd;
}
export function setXcdPerUsd(rate: number): void {
  if (Number.isFinite(rate) && rate > 0) xcdPerUsd = rate;
}

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

// Money rules (Don, 2026-08-03): all amounts are stored and calculated in
// USD — XCD is display-only, converted from the USD source at the point of
// display, rounded to 2 decimals (never to whole dollars, never rounded up
// as a convenience, never chained through an already-converted number).

const round2 = (n: number) => Math.round(n * 100) / 100;

/** USD source value → the number shown for the given display currency. */
export function convertForDisplay(usd: number, currency: Currency): number {
  return round2(currency === 'XCD' ? usd * xcdPerUsd : usd);
}

function formatDisplayValue(v: number, currency: Currency): string {
  const sign = v < 0 ? '−' : '';
  const abs = Math.abs(v);
  // Whole USD catalog prices stay clean ($60); anything fractional and all
  // XCD conversions show exact cents.
  const digits = currency === 'USD' && Number.isInteger(abs) ? 0 : 2;
  const num = abs.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  /**
   * XCD is prefixed with its ISO code, matching the server-side formatter
   * that writes emails and notifications (server/src/money.ts). "EC$" was
   * the local symbol and read naturally here, but it left a creator seeing
   * "EC$0.00" in the app and "XCD 0.00" in the same figure by email — and
   * "EC$" is Saint-Lucia-specific in a way the code is not, which is the
   * opposite of the groundwork this currency work is for.
   *
   * USD keeps "$": it is unambiguous in-app, and changing it would restyle
   * every catalog price and checkout line for no gain.
   */
  return `${sign}${currency === 'XCD' ? 'XCD ' : '$'}${num}`;
}

export function formatMoney(usd: number, currency: Currency): string {
  return formatDisplayValue(convertForDisplay(usd, currency), currency);
}

/**
 * Total line for a breakdown: sums the individually converted line items so
 * the displayed lines always add up to the displayed total — any rounding
 * remainder is absorbed here, never shown as maths that doesn't add up.
 */
export function formatMoneyTotal(lineItemsUsd: number[], currency: Currency): string {
  const total = round2(lineItemsUsd.reduce((sum, usd) => sum + convertForDisplay(usd, currency), 0));
  return formatDisplayValue(total, currency);
}

/**
 * Charged-amount presentation (§ currency disclosure): the USD figure is
 * what the card is actually charged; XCD is secondary and approximate.
 */
export function formatCharge(usd: number, currency: Currency): string {
  const base = formatMoney(usd, 'USD');
  return currency === 'XCD' ? `${base} (≈ ${formatMoney(usd, 'XCD')})` : base;
}

/** Short disclosure line for payment/receipt/refund screens. */
export const USD_PROCESSING_NOTE =
  'Charges are processed in USD — your bank may apply its own conversion rate.';

export type CancelTier = keyof typeof CANCEL_TIERS;

export function cancelTierForHoursUntil(hours: number): CancelTier {
  if (hours > CANCEL_FULL_REFUND_HOURS) return 'over48h';
  if (hours > CANCEL_HALF_CHARGE_HOURS) return 'between24and48h';
  return 'under24h';
}
