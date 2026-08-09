/**
 * THE payout method catalog — the one definition.
 *
 * Before this file the six methods lived twice: ids + required fields in
 * earnings.ts, and ids + display names + ETA badges hardcoded in the app's
 * cash-out screen. Two copies meant the ETAs could only change with an OTA
 * and nothing guaranteed the lists agreed. The catalog now lives here, the
 * creator endpoint serves it (name, ETA, enabled state, admin note), and the
 * app renders what it is served — its own list is only an offline fallback.
 *
 * Enable/disable and the creator-facing note are NOT here: they are admin-
 * controlled state in app_config (payout_methods_enabled /
 * payout_methods_notes), so a bank outage can be handled from the portal
 * with no deploy of any kind.
 */

export interface PayoutMethodDef {
  id: string;
  name: string;
  /** Delivery promise shown as the badge on the cash-out screen. */
  eta: string;
  /** Details a creator must save before cashing out to this method. */
  fields: string[];
}

// The six real methods (Don, 2026-07-28). 'cash' needs no fields but its
// pickup locations + identity verification are a PENDING PRODUCT DECISION
// (flagged — not guessed). 'penny_pinch' field pending confirmation of what
// the wallet actually requires.
export const PAYOUT_METHODS: PayoutMethodDef[] = [
  { id: 'cash', name: 'Cash pickup', eta: 'Same day', fields: [] },
  { id: 'penny_pinch', name: 'Penny Pinch', eta: 'Instant', fields: ['email'] },
  { id: 'cibc', name: 'CIBC', eta: '1–2 business days', fields: ['holder_name', 'account_number'] },
  { id: 'republic_ec', name: 'Republic Bank (EC)', eta: '1–2 business days', fields: ['holder_name', 'account_number'] },
  { id: 'bank_slu', name: 'Bank of Saint Lucia', eta: '1–2 business days', fields: ['holder_name', 'account_number'] },
  { id: 'paypal', name: 'PayPal', eta: 'Within 24 hours', fields: ['email'] },
];

export const METHOD_FIELDS: Record<string, string[]> = Object.fromEntries(
  PAYOUT_METHODS.map((m) => [m.id, m.fields]),
);

export function methodName(id: string): string {
  return PAYOUT_METHODS.find((m) => m.id === id)?.name ?? id;
}
