import { supabaseAdmin } from './supabase.js';
import { headshotColumnsPresent } from './schema-probe.js';
import { configNumber, minimumLeadMinutes } from './config.js';
import { matchingPenalties } from './strikes.js';

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
  avatar_url: string | null;
  headshot_path: string | null;
  headshot_status: string | null;
  specialties: string[];
  verified: boolean;
  base_area: string | null;
  service_radius_km: number | null;
  availability: Record<string, AvailabilityWindow[]>;
  blocked_dates: string[];
  /** km from the booking's area/meeting point to the creator's base area. */
  distance_km?: number | null;
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
    // Cast: the dynamic column list defeats supabase-js's literal-string
    // parser; rows are shaped identically either way apart from the two
    // optional headshot fields.
    .select(
      ((await headshotColumnsPresent())
        ? 'user_id, specialties, verified, base_area, service_radius_km, availability, blocked_dates, headshot_path, headshot_status, profiles!creator_profiles_user_id_fkey!inner(full_name, avatar_url)'
        : 'user_id, specialties, verified, base_area, service_radius_km, availability, blocked_dates, profiles!creator_profiles_user_id_fkey!inner(full_name, avatar_url)') as '*',
    )
    .eq('vetting_status', 'approved')
    .eq('is_available', true)
    .contains('specialties', [occasion]);
  if (error) throw new Error(`eligibleCreators: ${error.message}`);

  let creators: EligibleCreator[] = (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string; avatar_url: string | null };
    return {
      user_id: row.user_id as string,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      headshot_path: ((row as Record<string, unknown>).headshot_path as string | undefined) ?? null,
      headshot_status: ((row as Record<string, unknown>).headshot_status as string | undefined) ?? null,
      specialties: row.specialties as string[],
      verified: row.verified as boolean,
      base_area: row.base_area as string | null,
      service_radius_km: row.service_radius_km != null ? Number(row.service_radius_km) : null,
      availability: (row.availability ?? {}) as Record<string, AvailabilityWindow[]>,
      blocked_dates: (row.blocked_dates ?? []) as string[],
    };
  });

  // Real distance (seeded area coordinates, no Google calls): booking area →
  // creator base area. A creator with a service radius set is EXCLUDED when
  // the meeting area is beyond it (their setting is a promise about how far
  // they travel); no radius set = no distance exclusion, matching §12's
  // exclusion-not-ranking rule.
  if (area) {
    const { areaByName, haversineKm } = await import('./geo.js');
    const target = await areaByName(area);
    if (target) {
      const areaCoords = new Map(
        (await (await import('./geo.js')).getServiceAreas()).map((a) => [a.name, a]),
      );
      creators = creators.filter((c) => {
        const home = c.base_area ? areaCoords.get(c.base_area) : undefined;
        c.distance_km = home
          ? Math.round(haversineKm(home.lat, home.lng, target.lat, target.lng) * 10) / 10
          : null;
        if (c.service_radius_km != null && c.distance_km != null) {
          return c.distance_km <= c.service_radius_km;
        }
        return true;
      });
    }
  }
  // Strike enforcement (§9): suspended/under-review creators are excluded
  // from matching entirely; tier-2 creators are deprioritized (sorted last)
  // for the active window.
  const penalties = await matchingPenalties(creators.map((c) => c.user_id));
  // §14 hard gate: creators who haven't accepted the latest published
  // requires_reconsent version of the Creator Agreement / Background Check
  // Disclosure are EXCLUDED from matching until they re-accept (real
  // applicants consent to v1 at application, so only material re-publishes
  // trigger this).
  const { data: consentDocs } = await supabaseAdmin
    .from('policy_documents')
    .select('id, doc_type, version')
    .in('doc_type', ['creator-agreement', 'background-check'])
    .eq('status', 'published')
    .eq('requires_reconsent', true)
    .order('version', { ascending: false });
  const latestDocIds: string[] = [];
  const seenTypes = new Set<string>();
  for (const d of consentDocs ?? []) {
    if (!seenTypes.has(d.doc_type)) {
      seenTypes.add(d.doc_type);
      latestDocIds.push(d.id);
    }
  }
  let consented = new Set(creators.map((c) => c.user_id));
  if (latestDocIds.length > 0 && creators.length > 0) {
    const { data: consents } = await supabaseAdmin
      .from('consent_records')
      .select('user_id, policy_document_id')
      .in('user_id', creators.map((c) => c.user_id))
      .in('policy_document_id', latestDocIds);
    const byUser = new Map<string, number>();
    for (const c of consents ?? []) byUser.set(c.user_id, (byUser.get(c.user_id) ?? 0) + 1);
    consented = new Set(
      creators.filter((c) => (byUser.get(c.user_id) ?? 0) === latestDocIds.length).map((c) => c.user_id),
    );
  }
  const enforced = creators.filter(
    (c) => penalties.get(c.user_id) !== 'excluded' && consented.has(c.user_id),
  );
  enforced.sort((a, b) => {
    const pa = penalties.get(a.user_id) === 'deprioritized' ? 1 : 0;
    const pb = penalties.get(b.user_id) === 'deprioritized' ? 1 : 0;
    if (pa !== pb) return pa - pb;
    // Nearest first when distances are known; area match as tiebreak.
    if (a.distance_km != null && b.distance_km != null && a.distance_km !== b.distance_km) {
      return a.distance_km - b.distance_km;
    }
    if (area) return Number(b.base_area === area) - Number(a.base_area === area);
    return 0;
  });
  return enforced;
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
  /**
   * Earliest start we will offer, as an epoch ms. Same-day booking is only
   * safe behind a lead time: an in-person session has to clear the Stripe
   * webhook, reach a creator inside their 15-minute acceptance window,
   * possibly roll to a second creator on a decline, and then have someone
   * physically travel. Offering a slot minutes away sells a session we
   * cannot staff, and the client's first experience is an auto-cancel.
   */
  earliestStartMs: number = Date.now(),
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
      if (slotStartMs < earliestStartMs) continue;
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
  /**
   * TODAY IS DAY ZERO. Same-day was blocked by this one expression starting
   * at i + 1; the lead time below is what makes it safe, not the date floor.
   * The forward edge is unchanged — the furthest bookable day is still
   * advance_booking_window_days out, so today is added rather than swapped in.
   */
  const days: string[] = Array.from({ length: windowDays + 1 }, (_, i) =>
    new Date(Date.now() + i * 86400_000).toISOString().slice(0, 10),
  );
  const earliestStartMs = Date.now() + (await minimumLeadMinutes('in_person')) * 60_000;
  const intervals = await bookingIntervals(
    creators.map((c) => c.user_id),
    `${days[0]}T00:00:00Z`,
    `${days[days.length - 1]}T23:59:59Z`,
  );
  return days.map((date) => ({
    date,
    available: creators.some(
      (c) => creatorSlotsForDay(c, date, durationHours, intervals, earliestStartMs).length > 0,
    ),
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
  const earliestStartMs = Date.now() + (await minimumLeadMinutes('in_person')) * 60_000;
  const intervals = await bookingIntervals(
    creators.map((c) => c.user_id),
    `${date}T00:00:00Z`,
    `${date}T23:59:59Z`,
  );
  const byTime = new Map<string, string[]>();
  for (const creator of creators) {
    for (const time of creatorSlotsForDay(creator, date, durationHours, intervals, earliestStartMs)) {
      byTime.set(time, [...(byTime.get(time) ?? []), creator.user_id]);
    }
  }
  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, creator_ids]) => ({ time, creator_ids }));
}
