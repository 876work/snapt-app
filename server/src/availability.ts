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
export async function eligibleCreators(
  occasion: string,
  area?: string,
  /** YYYY-MM-DD of the requested session, for the same-day load count. */
  day?: string,
): Promise<EligibleCreator[]> {
  const { data, error } = await supabaseAdmin
    .from('creator_profiles')
    // Cast: the dynamic column list defeats supabase-js's literal-string
    // parser; rows are shaped identically either way apart from the two
    // optional headshot fields.
    .select(
      ((await headshotColumnsPresent())
        ? 'user_id, specialties, verified, base_area, service_radius_km, availability, blocked_dates, headshot_path, headshot_status, profiles!creator_profiles_user_id_fkey!inner(full_name)'
        : 'user_id, specialties, verified, base_area, service_radius_km, availability, blocked_dates, profiles!creator_profiles_user_id_fkey!inner(full_name)') as '*',
    )
    .eq('vetting_status', 'approved')
    .eq('is_available', true)
    /**
     * A DISABLED account is not eligible for anything.
     *
     * This sits beside the other two on purpose. `eligibleCreators` is the
     * single chokepoint for booking eligibility, the quote screen, auto-match
     * reassignment and the admin dispatch pool — so a future endpoint that
     * asks "who can do this job?" inherits the check instead of having to
     * remember it. Disable previously only closed the door on the way IN
     * (login, API, notifications); nothing on the way OUT knew about it, so a
     * disabled creator stayed bookable everywhere.
     *
     * The embed is already `!inner`, so filtering on it is a join predicate
     * rather than a post-filter — a disabled creator never leaves the database.
     */
    .eq('profiles.status', 'active')
    .contains('specialties', [occasion]);
  if (error) throw new Error(`eligibleCreators: ${error.message}`);

  let creators: EligibleCreator[] = (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { full_name: string };
    return {
      user_id: row.user_id as string,
      full_name: profile.full_name,
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
  /**
   * REAL RANKING, in a stated order — never a comparator returning 0 with
   * the database deciding.
   *
   * The old sort ranked by centroid-to-centroid distance, which only ever
   * distinguishes "same area or not", then fell through to 0. Equal
   * candidates came back in whatever order the query produced, and the
   * booking screen labelled row one BEST MATCH.
   *
   *   1. strike penalty — deprioritized creators sink (unchanged)
   *   2. specialty      — they actually shoot this occasion
   *   3. area           — exact base_area match
   *   4. load           — fewest jobs already accepted that day
   *   5. ROTATION       — least recently offered work wins
   *
   * Rotation is last on purpose: it decides only between candidates who are
   * otherwise equal. A fully deterministic order means one creator takes
   * every auto-matched job and the rest conclude Snapt has no work for them.
   * Spreading offers is supply retention, not fairness decoration.
   */
  const ids = enforced.map((c) => c.user_id);
  const load = new Map<string, number>();
  const lastOffered = new Map<string, number>();
  if (ids.length > 0) {
    const { data: theirBookings } = await supabaseAdmin
      .from('bookings')
      .select('creator_id, scheduled_at, created_at, status')
      .in('creator_id', ids)
      .in('status', ['pending', 'confirmed', 'completed']);
    for (const b of theirBookings ?? []) {
      const cid = b.creator_id as string;
      // Load counts only work they have ACCEPTED for the requested day —
      // a pending offer is not yet a commitment.
      if (day && b.status !== 'pending' && String(b.scheduled_at ?? '').slice(0, 10) === day) {
        load.set(cid, (load.get(cid) ?? 0) + 1);
      }
      // Rotation reads the last time work was PUT IN FRONT of them, accepted
      // or not — being offered and declining still means they had their turn.
      const at = Date.parse(String(b.created_at ?? '')) || 0;
      if (at > (lastOffered.get(cid) ?? 0)) lastOffered.set(cid, at);
    }
  }

  const rank = new Map<string, { specialty: number; area: number; load: number; last: number }>();
  for (const c of enforced) {
    rank.set(c.user_id, {
      specialty: (c.specialties ?? []).includes(occasion) ? 0 : 1,
      area: area && c.base_area === area ? 0 : 1,
      load: load.get(c.user_id) ?? 0,
      // Never offered anything = longest wait. They go first.
      last: lastOffered.get(c.user_id) ?? 0,
    });
  }

  enforced.sort((a, b) => {
    const pa = penalties.get(a.user_id) === 'deprioritized' ? 1 : 0;
    const pb = penalties.get(b.user_id) === 'deprioritized' ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const ra = rank.get(a.user_id)!;
    const rb = rank.get(b.user_id)!;
    if (ra.specialty !== rb.specialty) return ra.specialty - rb.specialty;
    if (ra.area !== rb.area) return ra.area - rb.area;
    if (ra.load !== rb.load) return ra.load - rb.load;
    if (ra.last !== rb.last) return ra.last - rb.last;
    // Never 0 — a stable, explicable last resort beats the database's
    // incidental row order.
    return a.user_id.localeCompare(b.user_id);
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
  const creators = await eligibleCreators(occasion, area, date);
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
