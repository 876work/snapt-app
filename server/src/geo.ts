import { supabaseAdmin } from './supabase.js';

// Geo utilities: service-area lookups, haversine distance, and server-side
// geocoding with a permanent DB cache. The 20 named areas ship with seeded
// coordinates, so in normal operation NOTHING here calls Google — the
// Geocoding API (separate IP-restricted key, GOOGLE_MAPS_SERVER_KEY) is only
// hit for a query not already in geocode_cache, once ever per query.

export interface ServiceArea {
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
}

let areaCache: { at: number; areas: ServiceArea[] } | null = null;
const AREA_TTL_MS = 5 * 60_000;

export async function getServiceAreas(): Promise<ServiceArea[]> {
  if (areaCache && Date.now() - areaCache.at < AREA_TTL_MS) return areaCache.areas;
  const { data, error } = await supabaseAdmin
    .from('service_areas')
    .select('name, lat, lng, radius_km')
    .eq('active', true)
    .order('name');
  if (error) throw new Error(`getServiceAreas: ${error.message}`);
  const areas = (data ?? []).map((a) => ({
    name: a.name as string,
    lat: Number(a.lat),
    lng: Number(a.lng),
    radius_km: Number(a.radius_km),
  }));
  areaCache = { at: Date.now(), areas };
  return areas;
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

export async function areaByName(name: string): Promise<ServiceArea | null> {
  const areas = await getServiceAreas();
  return areas.find((a) => a.name === name) ?? null;
}

/** Nearest active area to a point, with the distance to its center. */
export async function nearestArea(
  lat: number,
  lng: number,
): Promise<{ area: ServiceArea; distanceKm: number } | null> {
  const areas = await getServiceAreas();
  let best: { area: ServiceArea; distanceKm: number } | null = null;
  for (const area of areas) {
    const d = haversineKm(lat, lng, area.lat, area.lng);
    if (!best || d < best.distanceKm) best = { area, distanceKm: d };
  }
  return best;
}

/**
 * Authoritative service-area boundary: ONE polygon covering the island's
 * northern region (app_config.service_area_polygon, [lat,lng] vertices,
 * admin-editable). The named areas are labels/highlights only — validity
 * depends solely on this polygon.
 */
export async function getServicePolygon(): Promise<[number, number][]> {
  const { getConfig } = await import('./config.js');
  const config = await getConfig();
  const raw = config['service_area_polygon'];
  return Array.isArray(raw) ? (raw as [number, number][]) : [];
}

/** Ray-casting point-in-polygon on [lat,lng] vertices. */
export function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    const intersects =
      lngI > lng !== lngJ > lng &&
      lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Inside the service area → the nearest named area (for the label);
 * outside → null. An empty/missing polygon fails OPEN (no boundary
 * configured = don't block bookings on a data problem).
 */
export async function areaContaining(lat: number, lng: number): Promise<ServiceArea | null> {
  const polygon = await getServicePolygon();
  if (polygon.length >= 3 && !pointInPolygon(lat, lng, polygon)) return null;
  const nearest = await nearestArea(lat, lng);
  return nearest?.area ?? null;
}

/**
 * Geocode via Google with a permanent DB cache. Each unique query costs one
 * API call ever; cache hits are free. No key configured → null (callers all
 * treat this as "unknown", never an error).
 */
export async function geocodeCached(
  query: string,
): Promise<{ lat: number; lng: number } | null> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const { data: hit } = await supabaseAdmin
    .from('geocode_cache')
    .select('lat, lng')
    .eq('query', normalized)
    .maybeSingle();
  if (hit) return hit.lat != null ? { lat: Number(hit.lat), lng: Number(hit.lng) } : null;

  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      `${query}, Saint Lucia`,
    )}&region=lc&key=${key}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      status: string;
      results?: { geometry: { location: { lat: number; lng: number } }; formatted_address?: string }[];
    };
    const loc = json.status === 'OK' ? json.results?.[0]?.geometry.location : undefined;
    // Cache misses too (lat null) so a bad query never re-bills.
    await supabaseAdmin.from('geocode_cache').insert({
      query: normalized,
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      formatted: json.results?.[0]?.formatted_address ?? null,
    });
    return loc ? { lat: loc.lat, lng: loc.lng } : null;
  } catch {
    return null; // network failure: don't cache, don't break the caller
  }
}
