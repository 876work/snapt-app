// Client geo helpers for the meeting-point map. The server's service_areas
// table is the source of truth (fetchServiceAreas); MOCK_AREAS mirrors the
// five confirmed areas so mock mode keeps working with no backend. All
// snapping/validation here is pure math on already-fetched coordinates —
// nothing in this file makes a billable Google request.

export interface GeoArea {
  name: string;
  lat: number;
  lng: number;
  radius_km: number;
}

export const MOCK_AREAS: GeoArea[] = [
  { name: 'Rodney Bay', lat: 14.0722, lng: -60.9498, radius_km: 5 },
  { name: 'Castries', lat: 14.0101, lng: -60.9875, radius_km: 5 },
  { name: 'Gros Islet', lat: 14.0781, lng: -60.953, radius_km: 5 },
  { name: 'Marigot Bay', lat: 13.9664, lng: -61.0242, radius_km: 5 },
  { name: 'Soufrière', lat: 13.856, lng: -61.0565, radius_km: 5 },
];

/** Initial map region: northwest Saint Lucia (Rodney Bay / Castries). */
export const DEFAULT_REGION = {
  latitude: 14.031,
  longitude: -60.972,
  latitudeDelta: 0.22,
  longitudeDelta: 0.18,
};

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(s));
}

export function nearestArea(
  areas: GeoArea[],
  lat: number,
  lng: number,
): { area: GeoArea; distanceKm: number } | null {
  let best: { area: GeoArea; distanceKm: number } | null = null;
  for (const area of areas) {
    const d = haversineKm(lat, lng, area.lat, area.lng);
    if (!best || d < best.distanceKm) best = { area, distanceKm: d };
  }
  return best;
}

/** Inside the service area = within radius of the nearest area center. */
export function insideServiceArea(areas: GeoArea[], lat: number, lng: number): boolean {
  const near = nearestArea(areas, lat, lng);
  return near != null && near.distanceKm <= near.area.radius_km;
}
