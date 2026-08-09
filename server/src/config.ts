import { supabaseAdmin } from './supabase.js';

// app_config reader with a short cache. Values are admin-editable (handoff
// §0), so nothing here is hard-coded — a stale read of up to 30s is fine.

type ConfigMap = Record<string, unknown>;

let cache: { at: number; config: ConfigMap } | null = null;
const TTL_MS = 30_000;

/** Drop the cache after an admin config write so the change bites on the
 *  very next request instead of up to TTL later. Same-process only — fine
 *  while the API is a single Render service. */
export function bustConfigCache(): void {
  cache = null;
}

export async function getConfig(): Promise<ConfigMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.config;
  const { data, error } = await supabaseAdmin.from('app_config').select('key, value');
  if (error) throw new Error(`Failed to load app_config: ${error.message}`);
  const config: ConfigMap = {};
  for (const row of data) config[row.key] = row.value;
  cache = { at: Date.now(), config };
  return config;
}

export async function configNumber(key: string, fallback: number): Promise<number> {
  const config = await getConfig();
  const v = config[key];
  return typeof v === 'number' ? v : fallback;
}

/**
 * MINIMUM LEAD TIME before a session may start, in minutes.
 *
 * Config rather than a constant so it can be tuned without a deploy — the
 * right number is an operational question that will change as the creator
 * roster grows, not a fact about the product.
 *
 * In-person is deliberately longer: the booking must clear the webhook, find
 * a creator inside a 15-minute acceptance window, survive a possible decline
 * and re-offer, and then have a person travel to the meeting point. Remote
 * edits have no travel, so they need only enough runway to reach an editor.
 */
export async function minimumLeadMinutes(type: 'in_person' | 'remote'): Promise<number> {
  return type === 'remote'
    ? configNumber('min_lead_minutes_remote', 30)
    : configNumber('min_lead_minutes_in_person', 120);
}

export type PricingTable = Record<string, Record<string, number>>;

/** CONFIRMED launch pricing: service type (photo/video/both) × duration hours. */
export async function pricingTable(): Promise<PricingTable> {
  const config = await getConfig();
  return (config['pricing_table'] as PricingTable) ?? {};
}

/** Price in USD for a service type × duration, or undefined if not offered. */
export async function packagePriceUsd(
  mediaKind: string,
  durationHours: number,
): Promise<number | undefined> {
  const table = await pricingTable();
  return table[mediaKind]?.[String(durationHours)];
}

/**
 * CONFIRMED in-person add-on prices. extra_revision is locked to the same
 * value as the remote table intentionally (Don, 2026-07-28).
 */
export async function inPersonAddonPrices(): Promise<{
  rush: number;
  extra_photos: number;
  extra_revision: number;
}> {
  const config = await getConfig();
  const table =
    (config['in_person_addons'] as { rush?: number; extra_photos?: number; extra_revision?: number }) ?? {};
  return {
    rush: table.rush ?? 25,
    extra_photos: table.extra_photos ?? 18,
    extra_revision: table.extra_revision ?? 15,
  };
}

/** CONFIRMED remote add-on prices: flat rush fee + per-round extra revision. */
export async function remoteAddonPrices(): Promise<{ rush: number; extra_revision: number }> {
  const config = await getConfig();
  const table = (config['remote_addons'] as { rush?: number; extra_revision?: number }) ?? {};
  return { rush: table.rush ?? 20, extra_revision: table.extra_revision ?? 15 };
}

// ---------------------------------------------------------------------------
// Social bundles — deliverable-count product (replaces duration pricing for
// the Social occasion). All values admin-editable; the fallbacks below only
// cover a database missing the seed rows and mirror the migration's seeds.
// UNCONFIRMED pricing: seeds ship confirmed=false until Don sets finals.
// ---------------------------------------------------------------------------

export interface SocialTier {
  id: string;
  label: string;
  duration_hours: number;
  /** Included EDITED photo count. */
  photos: number;
  /** Included edited 30-sec video count. */
  videos: number;
  price_usd: number;
}

const SOCIAL_TIER_FALLBACK: SocialTier[] = [
  { id: 'lite', label: 'Lite', duration_hours: 1, photos: 5, videos: 0, price_usd: 75 },
  { id: 'standard', label: 'Standard', duration_hours: 1.5, photos: 10, videos: 1, price_usd: 140 },
  { id: 'full', label: 'Full', duration_hours: 2, photos: 15, videos: 2, price_usd: 200 },
];

/** The Social bundle tiers, in display order. */
export async function socialTiers(): Promise<SocialTier[]> {
  const config = await getConfig();
  const rows = config['social_pricing_table'];
  if (!Array.isArray(rows) || rows.length === 0) return SOCIAL_TIER_FALLBACK;
  // Validate each row rather than trusting the editor: one malformed tier
  // must not make Social unbookable or, worse, price a booking at NaN.
  const valid = (rows as SocialTier[]).filter(
    (t) =>
      typeof t?.id === 'string' &&
      typeof t?.price_usd === 'number' && t.price_usd > 0 &&
      typeof t?.duration_hours === 'number' && t.duration_hours > 0 &&
      Number.isInteger(t?.photos) && t.photos >= 0 &&
      Number.isInteger(t?.videos) && t.videos >= 0,
  );
  return valid.length > 0 ? valid : SOCIAL_TIER_FALLBACK;
}

export async function socialTier(id: string): Promise<SocialTier | undefined> {
  return (await socialTiers()).find((t) => t.id === id);
}

/** Per-unit prices when a client selects beyond their tier's included counts. */
export async function socialAddonPrices(): Promise<{ extra_photo: number; extra_video: number }> {
  const config = await getConfig();
  const table =
    (config['social_addons'] as { extra_photo_usd?: number; extra_video_usd?: number }) ?? {};
  return { extra_photo: table.extra_photo_usd ?? 12, extra_video: table.extra_video_usd ?? 35 };
}

/** Hours the client has to pick proofs before top picks auto-apply. */
export async function socialSelectionWindowHours(): Promise<number> {
  return configNumber('social_selection_window_hours', 72);
}

/**
 * Which payout methods a creator may NEWLY select. Absent key or method =
 * enabled — disabling is the explicit act, so an unlisted method never
 * silently locks creators out.
 */
export async function enabledPayoutMethods(): Promise<Record<string, boolean>> {
  const config = await getConfig();
  return (config['payout_methods_enabled'] as Record<string, boolean>) ?? {};
}

/** Admin's creator-facing note per disabled method ("Bank transfers are
 *  paused until Monday"). Absent = no note. */
export async function payoutMethodNotes(): Promise<Record<string, string>> {
  const config = await getConfig();
  return (config['payout_methods_notes'] as Record<string, string>) ?? {};
}

// ---------------------------------------------------------------------------
// Delivery commitments (admin-editable). Standard is the free promise;
// rush is what the paid add-on buys. Both are measured from when the work
// actually starts — session end in person, footage upload for remote.
// ---------------------------------------------------------------------------

export async function deliveryWindows(): Promise<{
  standardHours: number;
  rushHours: number;
  /** Fraction of the window elapsed before a booking reads "approaching". */
  warnFraction: number;
}> {
  const config = await getConfig();
  const t = (config['delivery_windows'] as {
    standard_hours?: number;
    rush_hours?: number;
    warn_fraction?: number;
  }) ?? {};
  return {
    standardHours: t.standard_hours ?? 24,
    rushHours: t.rush_hours ?? 6,
    warnFraction: t.warn_fraction ?? 0.75,
  };
}

/** CONFIRMED remote-edit pricing: service type × tier key. */
export async function remotePriceUsd(
  mediaKind: string,
  tier: string,
): Promise<number | undefined> {
  const config = await getConfig();
  const table = (config['remote_pricing_table'] as PricingTable) ?? {};
  return table[mediaKind]?.[tier];
}
