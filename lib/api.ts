import { supabase } from './supabase';
import { Booking } from './mock/data';
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
  status: string;
  reschedule_count: number;
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
        // Note: draft.creatorId is a mock-catalog id, not a server uuid;
        // omit it and let the server auto-assign until the Creator
        // Assignment screen is served from /v1/creators/eligible.
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
        creatorId: draft.creatorId, // keep the picked card for display
        area: (b.area as Booking['area']) ?? draft.area,
        meetingPoint: b.meeting_point ?? undefined,
        scheduledAt: b.scheduled_at ?? new Date().toISOString(),
        durationHours: b.duration_hours ?? draft.durationHours ?? 1,
        mediaKind: b.media_kind,
        priceUsd: b.price_usd,
        status: 'confirmed',
        rescheduleCount: b.reschedule_count,
      },
    };
  } catch {
    return null;
  }
}
