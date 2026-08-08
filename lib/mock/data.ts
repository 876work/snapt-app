export const OCCASIONS = ['Events', 'Portraits', 'Social', 'Family', 'Wedding'] as const;
export type Occasion = (typeof OCCASIONS)[number];

export type MediaKind = 'photo' | 'video' | 'both';

// CONFIRMED launch pricing (Don, 2026-07-27): service type × duration.
// Mirrors the `pricing_table` app_config row — the server is the charging
// authority (§8); this copy only renders prices in the UI.
export const PRICING_TABLE: Record<MediaKind, Record<string, number>> = {
  photo: { '1': 60, '1.5': 90, '2': 120, '3': 180, '4': 240 },
  video: { '1': 90, '1.5': 135, '2': 180, '3': 270, '4': 360 },
  both: { '1': 130, '1.5': 195, '2': 260, '3': 390, '4': 520 },
};

export function packagePrice(kind: MediaKind, hours: number): number | undefined {
  return PRICING_TABLE[kind][String(hours)];
}

// Social bundles: deliverable-count product (replaces duration pricing for
// the Social occasion). This mirrors the social_pricing_table app_config
// seed the same way PRICING_TABLE mirrors pricing_table — display fallback
// only. The booking flow fetches the LIVE table from /v1/config first, so
// an admin price edit shows without an app update; this mirror covers
// offline/mock mode.
export interface SocialTierDef {
  id: string;
  label: string;
  duration_hours: number;
  photos: number;
  videos: number;
  price_usd: number;
}

export const SOCIAL_TIERS: SocialTierDef[] = [
  { id: 'lite', label: 'Lite', duration_hours: 1, photos: 5, videos: 0, price_usd: 75 },
  { id: 'standard', label: 'Standard', duration_hours: 1.5, photos: 10, videos: 1, price_usd: 140 },
  { id: 'full', label: 'Full', duration_hours: 2, photos: 15, videos: 2, price_usd: 200 },
];

export interface DurationOption {
  hours: number;
  label: string;
  deliverables: string;
}

// Deliverables lines are prototype copy pending confirmation; prices come
// from PRICING_TABLE, never from here.
export const DURATIONS: DurationOption[] = [
  { hours: 1, label: '1 hour', deliverables: '20+ edited photos' },
  { hours: 1.5, label: '1.5 hours', deliverables: '30+ edited photos' },
  { hours: 2, label: '2 hours', deliverables: '45+ edited photos' },
  { hours: 3, label: '3 hours', deliverables: '70+ edited photos' },
  { hours: 4, label: '4 hours', deliverables: 'Extended coverage + highlights' },
];

export interface Creator {
  id: string;
  name: string;
  /** null = no reviews yet — render "New" instead of stars. */
  rating: number | null;
  sessions: number;
  specialties: Occasion[];
  verified: boolean;
  /** null = unknown (no geocoding for server creators yet). */
  distanceKm: number | null;
  tint: string;
  /** require() asset, remote avatar, or null → initial-letter fallback. */
  photo: number | { uri: string } | null;
  loc: string;
}

// CREATORS and SEED_BOOKINGS were DELETED (2026-08-07).
//
// They initialised the zustand store and nothing ever replaced them, so the
// bookings list, booking detail, order and creator-browse screens rendered
// invented data over a working backend. Config constants below (OCCASIONS,
// AREAS, DURATIONS, PRICING_TABLE) stay — those are business rules, not
// fake records. Do not reintroduce seed records here.

// The 19 final highlighted locations (northern region). Area is a plain
// string now — the canonical list lives in service_areas / lib/geo.ts.
export const AREAS = [
  'Cap Estate', 'Cas en Bas', 'Gros Islet', 'Rodney Bay', 'Monchy', 'Mongiraud',
  'La Clery', 'Vigie', 'Balata', 'Babonneau', 'Garrand', 'Castries', 'Ciceron',
  'Grande Riviere', 'Bisee', 'Bonneterre', 'Beausejour Phase 1&2', 'Pigeon Island',
  'Cap Marquis',
] as const;
export type Area = string;

export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'disputed';

export interface Booking {
  id: string;
  type: 'in-person' | 'remote';
  occasion: Occasion;
  creatorId: string | null;
  area: Area | null;
  meetingPoint?: string;
  meetingLat?: number | null;
  meetingLng?: number | null;
  scheduledAt: string; // ISO
  durationHours: number;
  mediaKind: MediaKind;
  priceUsd: number;
  status: BookingStatus;
  rescheduleCount: number;
  /** Set when deliverables landed — drives the "photos are ready" state. */
  deliveredAt?: string | null;
}

const in3Days = new Date(Date.now() + 3 * 86400_000);
const in30Hours = new Date(Date.now() + 30 * 3600_000);
const past = new Date(Date.now() - 12 * 86400_000);

