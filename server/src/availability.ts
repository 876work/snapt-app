import { supabaseAdmin } from './supabase.js';
import { configNumber } from './config.js';

// Slot-availability engine (handoff §3 Phase 1). Real bookable start times,
// computed from:
//   1. the creator's weekly availability template (creator_profiles.availability)
//   2. minus their blocked dates
//   3. minus overlap with their existing pending/confirmed bookings
//   4. within the advance-booking window (app_config, §5: 14 days)
// Slots are generated on a 30-minute grid.
//
// Area handling: eligibility filters by specialty (hard filter, §12).
// Radius/geocoding-based area exclusion needs the production Google Maps key
// (§2) — until then `area` sorts eligible creators (base_area match first)
// but does not exclude.

const SLOT_STEP_MIN = 30;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

interface AvailabilityWindow {
  start: string; // "09:00"
  end: string; // "17:00"
}

export interface EligibleCreator {
  user_id: string;
  full_name: string;
  specialties: string[];
  verified: boolean;
  base_area: string | null;
  availability: Record<string, AvailabilityWindow[]>;
  blocked_dates: string[];
}

interface BookingInterval {
  creator_id: string;
  start_ms: number;
  end_ms: number;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Approved creators with the booking's occasion as a specialty (§12: exclusion, not ranking). */
export async function eligibleCreators(occasion: string, area?: string): Promise<EligibleCreator[]> {
  const { data, error } = await supabaseAdmin
    .from('creator_profiles')
    .select('user_id, specialties, verified, base_area, availability, blocked_dates, profiles!inner(full_name)')
    .eq('vetting_status', 'approved')
    .contains('specialties', [occasion]);
  if (error) throw new Error(`eligibleCreators: ${error.message}`);

  const creators = (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string };
    return {
      user_id: row.user_id as string,
      full_name: profile.full_name,
      specialties: row.specialties as string[],
      verified: row.verified as boolean,
      base_area: row.base_area as string | null,
      availability: (row.availability ?? {}) as Record<string, AvailabilityWindow[]>,
      blocked_dates: (row.blocked_dates ?? []) as string[],
    };
  });
  if (area) {
    creators.sort((a, b) => Number(b.base_area === area) - Number(a.base_area === area));
  }
  return creators;
}

async function bookingIntervals(creatorIds: string[], fromIso: string, toIso: string): Promise<BookingInterval[]> {
  if (creatorIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('creator_id, scheduled_at, duration_hours')
    .in('creator_id', creatorIds)
    .in('status', ['pending', 'confirmed'])
    .gte('scheduled_at', fromIso)
    .lte('scheduled_at', toIso);
  if (error) throw new Error(`bookingIntervals: ${error.message}`);
  return (data ?? [])
    .filter((b) => b.scheduled_at !== null)
    .map((b) => {
      const start = new Date(b.scheduled_at as string).getTime();
      return {
        creator_id: b.creator_id as string,
        start_ms: start,
        end_ms: start + Number(b.duration_hours ?? 1) * 3600_000,
      };
    });
}

/** Start times ("HH:MM") a single creator can host a session of `durationHours` on `date`. */
export function creatorSlotsForDay(
  creator: EligibleCreator,
  date: string, // YYYY-MM-DD
  durationHours: number,
  intervals: BookingInterval[],
): string[] {
  if (creator.blocked_dates.includes(date)) return [];
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
  const windows = creator.availability[weekday] ?? [];
  const slots: string[] = [];
  const durationMin = durationHours * 60;

  for (const w of windows) {
    const windowStart = minutesOf(w.start);
    const windowEnd = minutesOf(w.end);
    for (let t = windowStart; t + durationMin <= windowEnd; t += SLOT_STEP_MIN) {
      const slotStartMs = new Date(`${date}T${pad(Math.floor(t / 60))}:${pad(t % 60)}:00`).getTime();
      const slotEndMs = slotStartMs + durationMin * 60_000;
      if (slotStartMs <= Date.now()) continue;
      const clash = intervals.some(
        (b) => b.creator_id === creator.user_id && slotStartMs < b.end_ms && slotEndMs > b.start_ms,
      );
      if (!clash) slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
    }
  }
  return slots;
}

export interface DayAvailability {
  date: string;
  available: boolean;
}

export interface SlotAvailability {
  time: string;
  creator_ids: string[];
}

/** Per-day availability flags across the advance window, for the day strip. */
export async function windowAvailability(
  occasion: string,
  durationHours: number,
  area?: string,
): Promise<DayAvailability[]> {
  const windowDays = await configNumber('advance_booking_window_days', 14);
  const creators = await eligibleCreators(occasion, area);
  const days: string[] = Array.from({ length: windowDays }, (_, i) =>
    new Date(Date.now() + (i + 1) * 86400_000).toISOString().slice(0, 10),
  );
  const intervals = await bookingIntervals(
    creators.map((c) => c.user_id),
    `${days[0]}T00:00:00Z`,
    `${days[days.length - 1]}T23:59:59Z`,
  );
  return days.map((date) => ({
    date,
    available: creators.some((c) => creatorSlotsForDay(c, date, durationHours, intervals).length > 0),
  }));
}

/** Union of start times across eligible creators for one day. */
export async function dayAvailability(
  occasion: string,
  date: string,
  durationHours: number,
  area?: string,
): Promise<SlotAvailability[]> {
  const creators = await eligibleCreators(occasion, area);
  const intervals = await bookingIntervals(
    creators.map((c) => c.user_id),
    `${date}T00:00:00Z`,
    `${date}T23:59:59Z`,
  );
  const byTime = new Map<string, string[]>();
  for (const creator of creators) {
    for (const time of creatorSlotsForDay(creator, date, durationHours, intervals)) {
      byTime.set(time, [...(byTime.get(time) ?? []), creator.user_id]);
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, creator_ids]) => ({ time, creator_ids }));
}
