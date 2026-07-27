import { supabaseAdmin } from './supabase.js';

// app_config reader with a short cache. Values are admin-editable (handoff
// §0), so nothing here is hard-coded — a stale read of up to 30s is fine.

type ConfigMap = Record<string, unknown>;

let cache: { at: number; config: ConfigMap } | null = null;
const TTL_MS = 30_000;

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
