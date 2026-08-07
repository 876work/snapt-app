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
}

const in3Days = new Date(Date.now() + 3 * 86400_000);
const in30Hours = new Date(Date.now() + 30 * 3600_000);
const past = new Date(Date.now() - 12 * 86400_000);

