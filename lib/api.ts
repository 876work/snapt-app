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
  occasion: Booking['occasion'] | null;
  creator_id: string | null;
  area: string | null;
  meeting_point: string | null;
  scheduled_at: string | null;
  duration_hours: number | null;
  media_kind: Booking['mediaKind'];
  price_usd: number;
  pricing_snapshot?: { session_price_usd?: number; subtotal_usd?: number };
  status: string;
  reschedule_count: number;
  offer_expires_at?: string | null;
}

export function mapServerStatus(status: string): Booking['status'] {
  return (status === 'no_show' ? 'no-show' : status) as Booking['status'];
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
  /** Non-refundable at every tier (client-initiated cancellations). */
  serviceFeeUsd?: number;
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

// --- Phase 3: creator side, session lifecycle, earnings.

import type { CreatorStatus } from './store';

/** Creator application status from the server (authoritative since Phase 1). */
export async function fetchCreatorStatus(): Promise<CreatorStatus | null> {
  const result = await request<{ vetting_status: string }>(`/v1/creator/me`);
  if (!result) return null;
  return result.vetting_status === 'approved' ? 'approved' : 'review';
}

export function applyAsCreator(specialties: string[], baseArea?: string | null) {
  return authedPost<{ status: string }>(`/v1/creator/apply`, {
    specialties,
    base_area: baseArea ?? undefined,
    consents: { creator_agreement: true, background_check: true },
  });
}

export interface ServerBookingListItem extends ServerBooking {
  client_id: string;
}

export async function fetchMyBookings(): Promise<ServerBookingListItem[] | null> {
  const result = await request<{ bookings: ServerBookingListItem[] }>(`/v1/bookings`);
  return result?.bookings ?? null;
}

export function checkInApi(id: string) {
  return authedPost<{ session: Record<string, unknown> }>(`/v1/bookings/${id}/session/check-in`);
}

export function verifySafetyCodeApi(id: string, code: string) {
  return authedPost<{ verified: boolean }>(`/v1/bookings/${id}/session/verify-code`, { code });
}

export function completeSessionApi(id: string) {
  return authedPost<{ completed: boolean; payout: string }>(`/v1/bookings/${id}/complete`);
}

export interface EarningsPayout {
  id: string;
  booking_id: string;
  amount_usd: number;
  status: 'held' | 'available' | 'paid_out' | string;
  hold_until: string | null;
  created_at: string;
}

export async function fetchEarnings(): Promise<{
  payouts: EarningsPayout[];
  totals: { pending: number; available: number; paid_out: number };
} | null> {
  return request(`/v1/creator/earnings`);
}

export interface PayoutMethods {
  selected?: string;
  methods?: Record<string, Record<string, string>>;
}

export async function fetchPayoutMethods(): Promise<PayoutMethods | null> {
  const result = await request<{ payout_methods: PayoutMethods }>(`/v1/creator/payout-methods`);
  return result?.payout_methods ?? null;
}

export async function savePayoutMethod(method: string, details: Record<string, string>) {
  if (!apiUrl) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const res = await fetch(`${apiUrl}/v1/creator/payout-method`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ method, details }),
    });
    const json = (await res.json()) as { saved?: boolean; error?: string };
    if (!res.ok) return { error: json.error ?? 'Could not save' };
    return { saved: true };
  } catch {
    return null;
  }
}

export function cashOutApi() {
  return authedPost<{ paid_out_usd: number; count: number }>(`/v1/creator/cash-out`);
}

/**
 * Remote-edit order: priced server-side from remote_pricing_table (service
 * type × tier) — never from the client's displayed number.
 */
export async function createRemoteOrderApi(
  mediaKind: Booking['mediaKind'],
  tier: string,
  addons?: { rush?: boolean; extraRevisions?: number },
): Promise<{ booking: Booking } | { error: string } | null> {
  const result = await authedPost<{ booking: ServerBooking }>(`/v1/bookings`, {
    type: 'remote',
    media_kind: mediaKind,
    remote_tier: tier,
    addons: { rush: addons?.rush ?? false, extra_revisions: addons?.extraRevisions ?? 0 },
  });
  if (!result) return null;
  if ('error' in result) return result;
  const b = result.booking;
  return {
    booking: {
      id: b.id,
      type: 'remote',
      occasion: b.occasion ?? 'Portraits', // remote orders have no occasion step
      creatorId: null,
      area: null,
      scheduledAt: b.scheduled_at ?? new Date().toISOString(),
      durationHours: b.duration_hours ?? 1,
      mediaKind: b.media_kind,
      // Pre-fee amount including add-ons, so total-paid displays (×1.08)
      // stay accurate for add-on orders.
      priceUsd: b.pricing_snapshot?.subtotal_usd ?? b.pricing_snapshot?.session_price_usd ?? b.price_usd,
      status: mapServerStatus(b.status),
      rescheduleCount: 0,
    },
  };
}

// --- Offer window (accept/decline) + media pipeline.

export function acceptBookingApi(id: string) {
  return authedPost<{ accepted: boolean }>(`/v1/bookings/${id}/accept`);
}

export function declineBookingApi(id: string) {
  return authedPost<{ declined: boolean }>(`/v1/bookings/${id}/decline`);
}

export interface SessionState {
  safety_code: string | null;
  client_checked_in_at: string | null;
  creator_checked_in_at: string | null;
  session_active_at: string | null;
  session_ended_at: string | null;
}

export async function fetchSessionApi(id: string): Promise<SessionState | null> {
  const result = await request<{ session: SessionState }>(`/v1/bookings/${id}/session`);
  return result?.session ?? null;
}

export interface MediaItem {
  id: string;
  kind: 'raw' | 'deliverable';
  download_url: string;
  content_type: string | null;
}

export async function fetchMediaApi(id: string): Promise<MediaItem[] | null> {
  const result = await request<{ media: MediaItem[] }>(`/v1/bookings/${id}/media`);
  return result?.media ?? null;
}

export function deliverApi(id: string) {
  return authedPost<{ delivered: boolean }>(`/v1/bookings/${id}/deliver`);
}

/** Request a revision round (Policy 08 §2 first step for quality issues). */
export function requestRevisionApi(id: string, details: string) {
  return authedPost<{ revision: { id: string } }>(`/v1/bookings/${id}/revisions`, { details });
}

export interface RevisionRequest {
  id: string;
  status: 'open' | 'delivered';
  details: string;
  created_at: string;
}

export async function fetchRevisionsApi(id: string): Promise<RevisionRequest[] | null> {
  const result = await request<{ revisions: RevisionRequest[] }>(`/v1/bookings/${id}/revisions`);
  return result?.revisions ?? null;
}

export function deliverRevisionApi(id: string, revId: string) {
  return authedPost<{ delivered: boolean }>(`/v1/bookings/${id}/revisions/${revId}/deliver`);
}

export function purchaseRevisionApi(id: string) {
  return authedPost<{ purchased: boolean; charged_usd: number }>(`/v1/bookings/${id}/revisions/purchase`);
}

export async function fetchReconsentNeeded(): Promise<
  { doc_type: string; version: number; title: string }[] | null
> {
  const result = await request<{ needed: { doc_type: string; version: number; title: string }[] }>(
    `/v1/creator/reconsent-needed`,
  );
  return result?.needed ?? null;
}

export function reconsentApi(docType: string) {
  return authedPost<{ consented: boolean }>(`/v1/creator/reconsent`, { doc_type: docType });
}

/** Frictionless safety end — no fees, no penalties, server records for admin review. */
export function endSessionSafetyApi(id: string) {
  return authedPost<{ ended: boolean }>(`/v1/bookings/${id}/safety/end-session`);
}

/** Safety report; 'sos' escalates to on-call staff in real time. */
export function reportSafetyApi(id: string, type: 'sos' | 'safety_concern', details?: string) {
  return authedPost<{ reported: boolean; escalated: boolean }>(`/v1/bookings/${id}/safety/report`, {
    type,
    details,
  });
}

/** Email meeting details to the client's emergency contacts (Resend; no SMS). */
export function authedShareSession(id: string) {
  return authedPost<{ shared: boolean; recipients: number }>(`/v1/bookings/${id}/share-session`);
}

// --- Creator portfolio (moderated — Policy 04 §6.2): first N submissions
// need moderator approval, later ones auto-publish.

export interface PortfolioItem {
  id: string;
  caption: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto';
  created_at: string;
  url: string | null;
}

export async function fetchMyPortfolio(): Promise<PortfolioItem[] | null> {
  const result = await request<{ items: PortfolioItem[] }>(`/v1/creator/portfolio`);
  return result?.items ?? null;
}

/** Presign, PUT the image bytes, and register the portfolio item. */
export async function submitPortfolioItemApi(
  file: { uri: string; name: string; mimeType?: string },
  caption?: string,
): Promise<{ published: boolean } | { error: string } | null> {
  const target = await authedPost<{ upload_url: string; storage_path: string }>(
    `/v1/creator/portfolio/upload-url`,
    { filename: file.name, content_type: file.mimeType ?? 'image/jpeg' },
  );
  if (!target) return null;
  if ('error' in target) return target;
  try {
    const blob = await (await fetch(file.uri)).blob();
    const put = await fetch(target.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType ?? 'image/jpeg' },
      body: blob,
    });
    if (!put.ok) return { error: 'Upload failed — try again.' };
  } catch {
    return { error: 'Upload failed — try again.' };
  }
  return authedPost<{ published: boolean }>(`/v1/creator/portfolio`, {
    caption: caption?.trim() || undefined,
    storage_path: target.storage_path,
  });
}

/**
 * Content/moderation report (Policy 04). The category choice drives the
 * server's auto-assigned severity and its consequence automation — the
 * screen labels must map 1:1 to the server's four tiers.
 */
export function submitContentReport(
  category: 'child_safety' | 'sexual_violent_hate' | 'content_policy' | 'general',
  details: string,
  bookingId?: string | null,
  targetUserId?: string | null,
) {
  return authedPost<{ report_id: string; severity: string }>(`/v1/reports`, {
    category,
    details,
    booking_id: bookingId ?? undefined,
    target_user_id: targetUserId ?? undefined,
  });
}

/** Presign, PUT the file bytes, and register the media row. */
export async function uploadMediaApi(
  bookingId: string,
  kind: 'raw' | 'deliverable',
  file: { uri: string; name: string; mimeType?: string },
): Promise<boolean> {
  const target = await authedPost<{ upload_url: string; storage_path: string }>(
    `/v1/bookings/${bookingId}/media/upload-url`,
    { kind, filename: file.name, content_type: file.mimeType ?? 'application/octet-stream' },
  );
  if (!target || 'error' in target) return false;
  try {
    const blob = await (await fetch(file.uri)).blob();
    const put = await fetch(target.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType ?? 'application/octet-stream' },
      body: blob,
    });
    if (!put.ok) return false;
  } catch {
    return false;
  }
  const registered = await authedPost(`/v1/bookings/${bookingId}/media`, {
    kind,
    storage_path: target.storage_path,
    content_type: file.mimeType,
  });
  return registered != null && !('error' in (registered as object));
}

/**
 * Create the booking server-side (price computed there — §8). Returns the
 * booking mapped to the app's shape, or an error message for the UI.
 */
export async function createBookingApi(
  draft: BookingDraft,
  addons?: { rush?: boolean; extraPhotos?: boolean; extraRevisions?: number },
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
        // Server prices add-ons from in_person_addons config (§8).
        addons: {
          rush: addons?.rush ?? false,
          extra_photos: addons?.extraPhotos ?? false,
          extra_revisions: addons?.extraRevisions ?? 0,
        },
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
        occasion: b.occasion ?? draft.occasion ?? 'Portraits',
        // Server's assignment wins (it may auto-assign); eligible creators
        // are registered in the catalog so this id resolves for display.
        creatorId: b.creator_id ?? draft.creatorId,
        area: (b.area as Booking['area']) ?? draft.area,
        meetingPoint: b.meeting_point ?? undefined,
        scheduledAt: b.scheduled_at ?? new Date().toISOString(),
        durationHours: b.duration_hours ?? draft.durationHours ?? 1,
        mediaKind: b.media_kind,
        // App-side priceUsd is the pre-fee amount (session + add-ons);
        // screens add the 8% for display. Server price_usd is the total.
        priceUsd:
          b.pricing_snapshot?.subtotal_usd ?? b.pricing_snapshot?.session_price_usd ?? b.price_usd,
        // Real status: 'pending' until the creator accepts the offer window.
        status: mapServerStatus(b.status),
        rescheduleCount: b.reschedule_count,
      },
    };
  } catch {
    return null;
  }
}
