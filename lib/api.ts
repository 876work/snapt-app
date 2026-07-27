import { supabase } from './supabase';
import { Booking, Creator, Occasion } from './mock/data';
import { BookingDraft } from './store';

// Phase 1 API client. When EXPO_PUBLIC_API_URL is set, the booking flow uses
// the real server (availability engine, server-side pricing, §12 matching).
// Every function returns null on failure so screens fall back to mock
// behavior instead of breaking the flow.

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const apiConfigured = Boolean(apiUrl);

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!apiUrl) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${apiUrl}${path}`, { ...init, headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Which days in the advance window have at least one bookable slot. */
export async function fetchDayFlags(
  occasion: string,
  durationHours: number,
): Promise<Record<string, boolean> | null> {
  const result = await request<{ days: { date: string; available: boolean }[] }>(
    `/v1/availability?occasion=${encodeURIComponent(occasion)}&duration_hours=${durationHours}`,
  );
  if (!result) return null;
  return Object.fromEntries(result.days.map((d) => [d.date, d.available]));
}

/** Real bookable start times for one day. */
export async function fetchDaySlots(
  occasion: string,
  date: string,
  durationHours: number,
): Promise<string[] | null> {
  const result = await request<{ slots: { time: string }[] }>(
    `/v1/availability?occasion=${encodeURIComponent(occasion)}&date=${date}&duration_hours=${durationHours}`,
  );
  if (!result) return null;
  return result.slots.map((s) => s.time);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the id came from the server (uuid) rather than the mock catalog. */
export function isServerCreatorId(id: string | null): boolean {
  return id != null && UUID_RE.test(id);
}

const AVATAR_TINTS = ['#F2C14E', '#6FD3E0', '#8ED7A6', '#F2A0B5', '#E8863D'];

interface ServerCreator {
  id: string;
  full_name: string;
  specialties: Occasion[];
  verified: boolean;
  base_area: string | null;
  avatar_url: string | null;
}

/**
 * Eligible creators for an occasion (§12 hard filter), mapped to the app's
 * Creator shape. rating/distance are null until the reviews system and
 * geocoding exist — the UI renders "New" / base area for those.
 */
export async function fetchEligibleCreators(occasion: string, area?: string | null): Promise<Creator[] | null> {
  const qs = area ? `&area=${encodeURIComponent(area)}` : '';
  const result = await request<{ creators: ServerCreator[] }>(
    `/v1/creators/eligible?occasion=${encodeURIComponent(occasion)}${qs}`,
  );
  if (!result) return null;
  return result.creators.map((c, i) => ({
    id: c.id,
    name: c.full_name,
    rating: null,
    sessions: 0,
    specialties: c.specialties,
    verified: c.verified,
    distanceKm: null,
    tint: AVATAR_TINTS[i % AVATAR_TINTS.length],
    photo: c.avatar_url ? { uri: c.avatar_url } : null,
    loc: c.base_area ?? '',
  }));
}

interface ServerBooking {
  id: string;
  type: 'in_person' | 'remote';
  occasion: Booking['occasion'];
  creator_id: string | null;
  area: string | null;
  meeting_point: string | null;
  scheduled_at: string | null;
  duration_hours: number | null;
  media_kind: Booking['mediaKind'];
  price_usd: number;
  pricing_snapshot?: { session_price_usd?: number };
  status: string;
  reschedule_count: number;
}

async function authedPost<T>(path: string, body?: unknown): Promise<T | { error: string } | null> {
  if (!apiUrl) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${apiUrl}${path}`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as T & { error?: string };
    if (!res.ok) return { error: json.error ?? 'Something went wrong — try again.' };
    return json;
  } catch {
    return null;
  }
}

// --- Phase 2 booking actions. The server computes all fees at time of
// action (§8); these results are what the UI should display as final.

export interface CancelResult {
  cancelled_by: 'client' | 'creator';
  tier?: string;
  chargeUsd?: number;
  refundUsd: number;
}

export function cancelBookingApi(id: string) {
  return authedPost<CancelResult>(`/v1/bookings/${id}/cancel`);
}

export interface RescheduleResult {
  rescheduled: boolean;
  scheduled_at: string;
  feeUsd: number;
  free: boolean;
  action?: string;
}

export function rescheduleBookingApi(id: string, date: string, time: string) {
  return authedPost<RescheduleResult>(`/v1/bookings/${id}/reschedule`, { date, time });
}

export function reportNoShowApi(id: string, attemptedContact?: boolean) {
  return authedPost<{ reported: string; refundUsd?: number }>(`/v1/bookings/${id}/no-show`, {
    attempted_contact: attemptedContact,
  });
}

/**
 * Create the booking server-side (price computed there — §8). Returns the
 * booking mapped to the app's shape, or an error message for the UI.
 */
export async function createBookingApi(
  draft: BookingDraft,
): Promise<{ booking: Booking } | { error: string } | null> {
  if (!apiUrl) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${apiUrl}/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        type: draft.type === 'in-person' ? 'in_person' : 'remote',
        occasion: draft.occasion,
        media_kind: draft.mediaKind,
        duration_hours: draft.durationHours,
        area: draft.area,
        meeting_point: draft.meetingPoint || undefined,
        date: draft.date,
        time: draft.time,
        // A tapped creator (server uuid, from /v1/creators/eligible) is the
        // one actually booked; null → "Match me automatically" server-side.
        creator_id: isServerCreatorId(draft.creatorId) ? draft.creatorId : undefined,
      }),
    });
    const json = (await res.json()) as { booking?: ServerBooking; error?: string };
    if (!res.ok || !json.booking) {
      return { error: json.error ?? 'Could not create the booking. Try another time slot.' };
    }
    const b = json.booking;
    return {
      booking: {
        id: b.id,
        type: b.type === 'in_person' ? 'in-person' : 'remote',
        occasion: b.occasion,
        // Server's assignment wins (it may auto-assign); eligible creators
        // are registered in the catalog so this id resolves for display.
        creatorId: b.creator_id ?? draft.creatorId,
        area: (b.area as Booking['area']) ?? draft.area,
        meetingPoint: b.meeting_point ?? undefined,
        scheduledAt: b.scheduled_at ?? new Date().toISOString(),
        durationHours: b.duration_hours ?? draft.durationHours ?? 1,
        mediaKind: b.media_kind,
        // App-side priceUsd is the session price EXCLUDING the 8% client fee
        // (screens add the fee for display); server price_usd is the total.
        priceUsd: b.pricing_snapshot?.session_price_usd ?? b.price_usd,
        status: 'confirmed',
        rescheduleCount: b.reschedule_count,
      },
    };
  } catch {
    return null;
  }
}
