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

export const CREATORS: Creator[] = [
  { id: 'jordan', name: 'Jordan M.', rating: 4.9, sessions: 128, specialties: ['Portraits', 'Wedding', 'Events'], verified: true, distanceKm: 2.1, tint: '#F2C14E', photo: require('../../assets/design/creators/jordan.webp'), loc: 'Rodney Bay' },
  { id: 'amara', name: 'Amara J.', rating: 5.0, sessions: 96, specialties: ['Family', 'Portraits', 'Social', 'Wedding'], verified: true, distanceKm: 3.4, tint: '#6FD3E0', photo: require('../../assets/design/creators/amara.webp'), loc: 'Gros Islet' },
  { id: 'marcus', name: 'Marcus D.', rating: 4.7, sessions: 74, specialties: ['Events', 'Social'], verified: false, distanceKm: 1.2, tint: '#8ED7A6', photo: require('../../assets/design/creators/marcus.webp'), loc: 'Castries' },
  { id: 'nia', name: 'Nia T.', rating: 5.0, sessions: 61, specialties: ['Wedding', 'Family', 'Portraits'], verified: true, distanceKm: 5.0, tint: '#F2A0B5', photo: require('../../assets/design/creators/nia.webp'), loc: 'Marigot Bay' },
  { id: 'sam', name: 'Sam R.', rating: 4.6, sessions: 42, specialties: ['Social', 'Events'], verified: false, distanceKm: 4.2, tint: '#E8863D', photo: require('../../assets/design/creators/sam.webp'), loc: 'Soufrière' },
];

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

export const SEED_BOOKINGS: Booking[] = [
  {
    id: 'bk-1001',
    type: 'in-person',
    occasion: 'Portraits',
    creatorId: 'jordan',
    area: 'Rodney Bay',
    meetingPoint: 'Pigeon Island causeway entrance',
    scheduledAt: in3Days.toISOString(),
    durationHours: 1,
    mediaKind: 'photo',
    priceUsd: 60,
    status: 'confirmed',
    rescheduleCount: 0,
  },
  {
    id: 'bk-1002',
    type: 'in-person',
    occasion: 'Family',
    creatorId: 'amara',
    area: 'Castries',
    meetingPoint: 'Derek Walcott Square',
    scheduledAt: in30Hours.toISOString(),
    durationHours: 2,
    mediaKind: 'both',
    priceUsd: 260,
    status: 'confirmed',
    rescheduleCount: 1,
  },
  {
    id: 'bk-0900',
    type: 'in-person',
    occasion: 'Portraits',
    creatorId: 'jordan',
    area: 'Rodney Bay',
    meetingPoint: 'Pigeon Island causeway entrance',
    scheduledAt: past.toISOString(),
    durationHours: 1,
    mediaKind: 'photo',
    priceUsd: 60,
    status: 'completed',
    rescheduleCount: 0,
  },
];
