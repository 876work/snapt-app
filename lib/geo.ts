// Client geo for the meeting-point map. Server data (/v1/service-areas) is
// authoritative; these constants mirror it exactly so mock mode behaves
// identically. All snapping/validation is pure math on fetched coordinates —
// nothing here makes a billable Google request.

export interface GeoArea {
  name: string;
  lat: number;
  lng: number;
}

/** The 19 FINAL highlighted locations (exact coordinates from Don —
 * visual highlights + snap labels only; validity is the polygon's call). */
export const MOCK_AREAS: GeoArea[] = [
  { name: 'Cap Estate', lat: 14.097186074877438, lng: -60.940764449273566 },
  { name: 'Cas en Bas', lat: 14.089693829162256, lng: -60.93063642799379 },
  { name: 'Gros Islet', lat: 14.084199359342136, lng: -60.9474592430009 },
  { name: 'Rodney Bay', lat: 14.06721561704259, lng: -60.947630904378514 },
  { name: 'Monchy', lat: 14.049564508897042, lng: -60.93115141212666 },
  { name: 'Mongiraud', lat: 14.037241230427039, lng: -60.948832534021875 },
  { name: 'La Clery', lat: 14.019421264112948, lng: -60.98024656612697 },
  { name: 'Vigie', lat: 14.018755070302479, lng: -60.995867751490714 },
  { name: 'Balata', lat: 14.016923027351767, lng: -60.951579116063854 },
  { name: 'Babonneau', lat: 14.010427484517816, lng: -60.94230940167218 },
  { name: 'Garrand', lat: 14.013258897579771, lng: -60.920851729469256 },
  { name: 'Castries', lat: 14.010927148183564, lng: -60.98934461914102 },
  { name: 'Ciceron', lat: 13.993105138838141, lng: -61.00891401619009 },
  { name: 'Grande Riviere', lat: 14.039414596118403, lng: -60.952947590395866 },
  { name: 'Bisee', lat: 14.024123357383369, lng: -60.975365704015815 },
  { name: 'Bonneterre', lat: 14.06454020338986, lng: -60.94229245584657 },
  { name: 'Beausejour Phase 1&2', lat: 14.075964057045471, lng: -60.93769133190049 },
  { name: 'Pigeon Island', lat: 14.092367360368574, lng: -60.964747717840034 },
  { name: 'Cap Marquis', lat: 14.051773268392779, lng: -60.888090262733535 },
];

/**
 * DRAFT northern-region boundary ([lat, lng], clockwise from the west-coast
 * point below Ciceron). Mirrors app_config.service_area_polygon — the server
 * copy is authoritative and this fallback only serves mock mode. Pending
 * Don's boundary review.
 */
export const MOCK_POLYGON: [number, number][] = [
  [13.984, -61.008], [13.993, -61.0135], [14.008, -61.006], [14.0125, -61.0025],
  [14.0185, -61.0035], [14.026, -60.993], [14.043, -60.977], [14.058, -60.968],
  [14.07, -60.963], [14.08, -60.964], [14.09, -60.97], [14.096, -60.97],
  [14.103, -60.96], [14.11, -60.95], [14.113, -60.94], [14.106, -60.928],
  [14.095, -60.92], [14.087, -60.918], [14.076, -60.91], [14.062, -60.895],
  [14.053, -60.883], [14.04, -60.885], [14.015, -60.9], [13.998, -60.93],
  [13.985, -60.965], [13.98, -60.995],
];

/** Frames the whole northern region (polygon bounds + padding). */
export const DEFAULT_REGION = {
  latitude: 14.0465,
  longitude: -60.948,
  latitudeDelta: 0.155,
  longitudeDelta: 0.15,
};

/** Hard pan limits — slightly outside the polygon's bounding box. */
export const MAP_BOUNDS = {
  northEast: { latitude: 14.125, longitude: -60.86 },
  southWest: { latitude: 13.965, longitude: -61.03 },
};

/** Minimum zoom ≈ the default framing; users can't zoom out beyond it. */
export const MIN_ZOOM_LEVEL = 11;

/**
 * Maximum zoom. Zooming in stays effectively unrestricted (21 is the Google
 * SDK's own ceiling) — but the prop must ALWAYS accompany minZoomLevel: the
 * Fabric Google-iOS view defaults an unset maxZoom to 0 and calls
 * [GMSMapView setMinZoom:11 maxZoom:0], and min > max makes the Google SDK
 * throw mid-mount — an uncatchable native crash (TestFlight build 10).
 */
export const MAX_ZOOM_LEVEL = 21;

/**
 * Highlight markers hide when latitudeDelta < this (≈ zoom 13, a ~4.4 km
 * viewport): past that the user is picking an exact spot and the labels
 * are clutter; above it they're orientation.
 */
export const HIGHLIGHT_HIDE_DELTA = 0.04;

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

/** The polygon is the ONLY authority on inside/outside. */
export function insideServiceArea(polygon: [number, number][], lat: number, lng: number): boolean {
  return polygon.length >= 3 && pointInPolygon(lat, lng, polygon);
}
