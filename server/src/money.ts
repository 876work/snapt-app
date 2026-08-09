import { supabaseAdmin } from './supabase.js';
import { getConfig } from './config.js';
import { methodName } from './payout-methods.js';

/**
 * THE ONE PLACE MONEY BECOMES TEXT.
 *
 * Every outbound amount used to be `$${n.toFixed(2)}` written by hand at the
 * call site — fifteen of them, none naming a currency, none reading what the
 * recipient had actually chosen in the app. That is unshippable outside Saint
 * Lucia, and it is how "$64.80" reaches someone whose app shows XCD.
 *
 * Two rules:
 *   1. Every amount carries its currency code. "USD 64.80", never "$64.80".
 *   2. It renders in the recipient's chosen currency, read from their profile
 *      at send time — never from whatever a client last passed in.
 *
 * THE TRAP this exists to close: we store and charge USD; XCD is a display
 * conversion. So "XCD 176.26" alone, for a card charged USD 64.80, reads as
 * an overcharge. Wherever money actually MOVED, both figures appear, and the
 * verb matches the direction — "charged" on a refund or a payout reads as an
 * error to the person least able to shrug it off.
 */

export type MoneyDirection = 'charged' | 'refunded' | 'paid';

/** USD is base/storage. Anything else is a display conversion at the peg. */
export type DisplayCurrency = 'USD' | 'XCD';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Payout methods that settle in local currency. A creator paid into Bank of
 * Saint Lucia receives XCD whatever their app is set to display, so the
 * settlement currency is a property of the METHOD, not of the preference.
 * PayPal is deliberately absent: it settles USD.
 */
const LOCAL_SETTLEMENT = new Set(['cash', 'penny_pinch', 'cibc', 'republic_ec', 'bank_slu']);

/** The peg, admin-editable so a new territory needs no code change. */
export async function displayRate(): Promise<number> {
  const config = await getConfig();
  return (config['xcd_per_usd'] as number) ?? 2.72;
}

/** The recipient's chosen display currency. Unknown profile falls back to USD. */
export async function currencyFor(userId: string): Promise<DisplayCurrency> {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('currency')
    .eq('id', userId)
    .maybeSingle();
  return data?.currency === 'XCD' ? 'XCD' : 'USD';
}

/**
 * Format one USD amount for one recipient.
 *
 * - USD reader: "USD 64.80" — one figure, never duplicated.
 * - XCD reader, no movement: "XCD 176.26".
 * - XCD reader, money moved: "XCD 176.26 (charged as USD 64.80)".
 */
export function formatMoney(
  amountUsd: number,
  currency: DisplayCurrency,
  rate: number,
  direction?: MoneyDirection,
): string {
  const usd = `USD ${round2(amountUsd).toFixed(2)}`;
  if (currency === 'USD') return usd;
  const converted = `XCD ${round2(amountUsd * rate).toFixed(2)}`;
  return direction ? `${converted} (${direction} as ${usd})` : converted;
}

/**
 * Format for one recipient, resolving their preference and the live rate.
 *
 * For the few send paths that do NOT go through notify() — the admin resend
 * emails build their own HTML — so that they still cannot invent their own
 * currency handling.
 */
export async function moneyFor(
  userId: string,
  amountUsd: number,
  direction?: MoneyDirection,
): Promise<string> {
  const [currency, rate] = await Promise.all([currencyFor(userId), displayRate()]);
  return formatMoney(amountUsd, currency, rate, direction);
}

/**
 * PAYOUTS ARE THE EXCEPTION, and deliberately so.
 *
 * Any local figure we print for a payout is a promise about money a third
 * party will deposit, converted at a rate we do not control — our config peg
 * is not the bank's. Printing "XCD 176.26 has been sent" against a statement
 * that reads something else manufactures exactly the distrust the dual
 * display exists to prevent, only now about a creator's earnings.
 *
 * So the authoritative USD ledger figure leads, and the local figure is an
 * explicitly rounded estimate that helps them recognise the deposit:
 *
 *   "USD 64.80 (about XCD 176)"
 *
 * Only for methods that settle locally; PayPal creators get USD alone.
 */
export async function formatPayout(amountUsd: number, creatorId: string): Promise<string> {
  const usd = `USD ${round2(amountUsd).toFixed(2)}`;
  const { data } = await supabaseAdmin
    .from('creator_profiles')
    .select('payout_methods')
    .eq('user_id', creatorId)
    .maybeSingle();
  const selected = (data?.payout_methods as { selected?: string } | null)?.selected;
  // Naming the destination is what makes the figure checkable: the creator
  // matches it against one account, not against "your payout method".
  const where = selected ? ` sent to ${methodName(selected)}` : ' sent';
  if (!selected || !LOCAL_SETTLEMENT.has(selected)) return `${usd}${where}`;
  const rate = await displayRate();
  // Whole dollars, "about", and "at today's rate" all do the same job: this
  // is an estimate of what a bank will deposit, not a figure we control.
  return `${usd}${where} (about XCD ${Math.round(amountUsd * rate)} at today's rate)`;
}
