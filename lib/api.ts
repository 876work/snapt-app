import { create } from 'zustand';
import { supabase } from './supabase';
import { Booking, Creator, Occasion } from './mock/data';
import { BookingDraft } from './store';

// Phase 1 API client. When EXPO_PUBLIC_API_URL is set, the booking flow uses
// the real server (availability engine, server-side pricing, §12 matching).
// Helpers still return null on failure, but with an API configured a failure
// also raises the global unreachable flag — the root layout blocks the UI
// with an error state so mock fallback data is never silently mistaken for
// real data. Mock mode is ONLY for local dev with no EXPO_PUBLIC_API_URL.

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');

export const apiConfigured = Boolean(apiUrl);

interface ApiStatus {
  unreachable: boolean;
  setUnreachable: (v: boolean) => void;
}

export const useApiStatus = create<ApiStatus>((set) => ({
  unreachable: false,
  setUnreachable: (v) => set({ unreachable: v }),
}));

function reportApiFailure(): void {
  if (apiConfigured) useApiStatus.getState().setUnreachable(true);
}

function reportApiReachable(): void {
  if (useApiStatus.getState().unreachable) useApiStatus.getState().setUnreachable(false);
}

/** Bearer headers for authenticated calls made outside `request`. */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export const apiBase = apiUrl;

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
    if (!res.ok) {
      reportApiFailure();
      return null;
    }
    const json = (await res.json()) as T;
    reportApiReachable();
    return json;
  } catch {
    reportApiFailure();
    return null;
  }
}

/** Highlighted locations + the authoritative service-area polygon. */
export async function fetchServiceAreas(): Promise<{
  areas: { name: string; lat: number; lng: number }[];
  polygon: [number, number][];
} | null> {
  return request<{
    areas: { name: string; lat: number; lng: number }[];
    polygon: [number, number][];
  }>('/v1/service-areas');
}

/**
 * Public business config (no auth). The XCD display peg lives ONLY in the
 * server's app_config (`xcd_per_usd`, admin-editable) — this pulls it at
 * launch so the client never carries its own copy of the rate.
 */
export async function syncDisplayRates(): Promise<void> {
  const result = await request<{ config: Record<string, unknown> }>('/v1/config');
  const rate = Number(result?.config?.['xcd_per_usd']);
  if (Number.isFinite(rate) && rate > 0) {
    const { setXcdPerUsd } = await import('./constants/business');
    setXcdPerUsd(rate);
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

/**
 * Same endpoint, full slot objects — Order Summary pre-validates the chosen
 * time (and creator) against these before asking anyone to slide.
 */
export async function fetchDaySlotsDetailed(
  occasion: string,
  date: string,
  durationHours: number,
  area?: string | null,
): Promise<{ time: string; creator_ids: string[] }[] | null> {
  const qs =
    `occasion=${encodeURIComponent(occasion)}&date=${date}&duration_hours=${durationHours}` +
    (area ? `&area=${encodeURIComponent(area)}` : '');
  const result = await request<{ slots: { time: string; creator_ids: string[] }[] }>(
    `/v1/availability?${qs}`,
  );
  return result?.slots ?? null;
}

/** Structured slot-conflict payload from POST /v1/bookings (409). */
export interface SlotConflict {
  code: 'slot_taken' | 'creator_taken';
  error: string;
  alternative_times: string[];
  rematch_available: boolean;
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
  /** Real km from the booking area (eligible endpoint only). */
  distance_km?: number | null;
  /** Signed portfolio image URLs (featured endpoint only). */
  work?: string[];
}

/**
 * Eligible creators for an occasion (§12 hard filter), mapped to the app's
 * Creator shape. rating/distance are null until the reviews system and
 * geocoding exist — the UI renders "New" / base area for those.
 */
function mapServerCreators(list: ServerCreator[]): Creator[] {
  return list.map((c, i) => ({
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

export interface FeaturedCreator extends Creator {
  /** Real portfolio images. The server only returns creators who have some. */
  work: string[];
}

/**
 * Featured creators for the home rail. The SERVER excludes anyone without
 * published work, so an empty array here means "nobody qualifies yet" — the
 * rail renders its honest empty state rather than avatar placeholders.
 */
export async function fetchFeaturedCreators(): Promise<FeaturedCreator[] | null> {
  const result = await request<{ creators: ServerCreator[] }>(`/v1/creators/featured`);
  if (!result) return null;
  return mapServerCreators(result.creators).map((c, i) => ({
    ...c,
    work: result.creators[i]?.work ?? [],
  }));
}

export interface SocialProof {
  kind: 'bookings_30d';
  count: number;
  area: string | null;
}

/**
 * Real activity only. The THRESHOLD IS SERVER-SIDE — null here means "not
 * enough to be worth saying", so this can never render a zero or an invented
 * number.
 */
// ---------------------------------------------------------------------------
// Social bundles
// ---------------------------------------------------------------------------

import type { SocialTierDef } from './mock/data';

export interface SocialCatalog {
  tiers: SocialTierDef[];
  addons: { extra_photo_usd: number; extra_video_usd: number };
}

/**
 * LIVE bundle catalog from app_config — an admin price edit shows here with
 * no app update. Callers fall back to the SOCIAL_TIERS mirror when offline.
 */
export async function fetchSocialCatalog(): Promise<SocialCatalog | null> {
  const result = await request<{ config: Record<string, unknown> }>(`/v1/config`);
  if (!result) return null;
  const tiers = result.config['social_pricing_table'];
  const addons = (result.config['social_addons'] ?? {}) as {
    extra_photo_usd?: number;
    extra_video_usd?: number;
  };
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  return {
    tiers: tiers as SocialTierDef[],
    addons: {
      extra_photo_usd: addons.extra_photo_usd ?? 12,
      extra_video_usd: addons.extra_video_usd ?? 35,
    },
  };
}

export interface SelectionProof {
  id: string;
  content_type: string | null;
  is_video: boolean;
  position: number | null;
  selected: boolean;
  selection_source: 'client' | 'auto' | null;
  download_url: string;
}

export interface SelectionState {
  included: { photos: number; videos: number };
  proofs: SelectionProof[];
  selection_deadline_at: string | null;
  locked: boolean;
  addon_prices: { extra_photo_usd: number; extra_video_usd: number };
  client_service_fee_rate: number;
}

export async function fetchSelectionApi(bookingId: string): Promise<SelectionState | null> {
  return request<SelectionState>(`/v1/bookings/${bookingId}/selection`);
}

export interface SelectionSubmitResult {
  locked: boolean;
  extras_usd: number;
  total_usd?: number;
  extra_photos?: number;
  extra_videos?: number;
  client_secret?: string;
  customer_id?: string;
  ephemeral_key?: string;
  error?: string;
}

export async function submitSelectionApi(
  bookingId: string,
  mediaIds: string[],
): Promise<SelectionSubmitResult | null> {
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/bookings/${bookingId}/selection`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ media_ids: mediaIds }),
    });
    const json = (await res.json()) as SelectionSubmitResult;
    if (!res.ok) return { locked: false, extras_usd: 0, error: json.error ?? 'Could not save your selection.' };
    return json;
  } catch {
    return null;
  }
}

export async function proofsReadyApi(bookingId: string): Promise<{ ready?: boolean; error?: string } | null> {
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/bookings/${bookingId}/proofs/ready`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const json = (await res.json()) as { ready?: boolean; error?: string };
    return res.ok ? json : { error: json.error ?? 'Could not publish the proof gallery.' };
  } catch {
    return null;
  }
}

export async function fetchSocialProof(area?: string | null): Promise<SocialProof | null> {
  const qs = area ? `?area=${encodeURIComponent(area)}` : '';
  const result = await request<{ proof: SocialProof | null }>(`/v1/social-proof${qs}`);
  return result?.proof ?? null;
}

/** Unread notification count — the bell dot's single source of truth. */
export async function fetchUnreadNotifications(): Promise<number | null> {
  const result = await request<{ unread: number }>(`/v1/notifications/unread`);
  return result?.unread ?? null;
}

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
    distanceKm: c.distance_km ?? null,
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
  meeting_lat: number | null;
  meeting_lng: number | null;
  scheduled_at: string | null;
  duration_hours: number | null;
  media_kind: Booking['mediaKind'];
  price_usd: number;
  pricing_snapshot?: { session_price_usd?: number; subtotal_usd?: number };
  status: string;
  reschedule_count: number;
  offer_expires_at?: string | null;
  delivered_at?: string | null;
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
    // A parsed response — even an error — means the server is reachable;
    // screens surface these inline. Only network/parse failures below raise
    // the global unreachable state.
    reportApiReachable();
    if (!res.ok) return { error: json.error ?? 'Something went wrong — try again.' };
    return json;
  } catch {
    reportApiFailure();
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

export interface CreatorMe {
  /** Signed URL of the uploaded headshot (any status), for self-view. */
  headshot_url?: string | null;
  headshot_status?: 'pending' | 'approved' | 'rejected' | null;
  status: CreatorStatus;
  specialties?: string[];
  service_type?: 'remote' | 'in_person' | 'both';
  base_area?: string | null;
  service_radius_km?: number | null;
  availability?: Record<string, { start: string; end: string }[]>;
  blocked_dates?: string[];
  is_available?: boolean;
  applied_at?: string | null;
  rejection_reason?: string | null;
  verified?: boolean;
}

/**
 * The single authoritative creator status (server-derived six-state model).
 * The client renders this value and never infers or unlocks locally.
 */
export async function fetchCreatorMe(): Promise<CreatorMe | null> {
  const result = await request<CreatorMe>(`/v1/creator/me`);
  if (!result || !result.status) return null;
  return result;
}

/** Back-compat shim: just the status value. */
export async function fetchCreatorStatus(): Promise<CreatorStatus | null> {
  const me = await fetchCreatorMe();
  return me?.status ?? null;
}

export interface ApplyPayload {
  specialties: string[];
  service_type: 'remote' | 'in_person' | 'both';
  base_area?: string | null;
  service_radius_km?: number | null;
  bio?: string | null;
  portfolio_link?: string;
  /** Full legal name as printed on the ID — reconciled after verification. */
  declared_legal_name?: string;
  consents: { creator_agreement: boolean; background_check?: boolean };
}

/** Fire-and-forget record of the push-permission outcome (null = primed, never answered the OS prompt). */
export function recordPushPermissionApi(granted: boolean | null) {
  return authedPost<{ recorded: boolean }>(`/v1/me/push-permission`, { granted });
}

export function applyAsCreator(payload: ApplyPayload) {
  return authedPost<{ status: string }>(`/v1/creator/apply`, payload);
}

/** Autosave the in-progress application so users resume where they left off. */
export function saveCreatorDraftApi(draft: Partial<ApplyPayload>) {
  return authedPost<{ status: string }>(`/v1/creator/apply/draft`, draft);
}

export async function updateCreatorSettingsApi(patch: {
  availability?: Record<string, { start: string; end: string }[]>;
  blocked_dates?: string[];
  service_radius_km?: number | null;
  is_available?: boolean;
}): Promise<{ updated: boolean } | { error: string } | null> {
  if (!apiUrl) return null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${apiUrl}/v1/creator/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(patch),
    });
    const json = (await res.json()) as { updated?: boolean; error?: string };
    if (!res.ok) return { error: json.error ?? 'Could not save — try again.' };
    return { updated: true };
  } catch {
    return null;
  }
}

// --- Two-way ratings.

export function submitReviewApi(bookingId: string, rating: number, categories?: Record<string, number>, comment?: string) {
  return authedPost<{ reviewed: boolean }>(`/v1/bookings/${bookingId}/review`, {
    rating,
    categories,
    comment,
  });
}

export interface RatingsSummary {
  average: number | null;
  count: number;
  categories: Record<string, number>;
  recent: { rating: number; comment: string | null; created_at: string }[];
}

export async function fetchMyRatingsApi(): Promise<{ as_creator: RatingsSummary; as_client: RatingsSummary } | null> {
  return request(`/v1/me/ratings`);
}

export interface ServerBookingListItem extends ServerBooking {
  client_id: string;
}

export async function fetchMyBookings(): Promise<ServerBookingListItem[] | null> {
  const result = await request<{ bookings: ServerBookingListItem[] }>(`/v1/bookings`);
  return result?.bookings ?? null;
}

/**
 * Server booking -> the shape the app's screens render.
 *
 * Used by the store's hydrate(), so the bookings list, booking detail and
 * order screens all read genuine rows instead of the seed array they used to.
 */
export function toClientBooking(b: ServerBookingListItem): Booking {
  return {
    id: b.id,
    type: b.type === 'remote' ? 'remote' : 'in-person',
    occasion: (b.occasion ?? 'Portraits') as Booking['occasion'],
    creatorId: b.creator_id ?? null,
    area: b.area ?? null,
    meetingPoint: b.meeting_point ?? null,
    meetingLat: b.meeting_lat ?? null,
    meetingLng: b.meeting_lng ?? null,
    scheduledAt: b.scheduled_at ?? new Date().toISOString(),
    durationHours: b.duration_hours ?? 1,
    mediaKind: b.media_kind,
    priceUsd:
      b.pricing_snapshot?.subtotal_usd ?? b.pricing_snapshot?.session_price_usd ?? b.price_usd,
    status: mapServerStatus(b.status),
    rescheduleCount: b.reschedule_count ?? 0,
    deliveredAt: b.delivered_at ?? null,
  } as Booking;
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
  /** Per-method availability from the admin toggle. Absent = enabled. A
   * creator's own selected method always reports enabled for them. */
  enabled?: Record<string, boolean>;
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
    payment_flow: 'sheet',
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
  kind: 'raw' | 'deliverable' | 'proof';
  /** null when the file was removed by the retention job. */
  download_url: string | null;
  content_type: string | null;
  deleted?: boolean;
}

export interface MediaListing {
  media: MediaItem[];
  /** When the retention job will remove the deliverables (ISO), if known. */
  files_expire_at: string | null;
}

export async function fetchMediaApi(id: string): Promise<MediaItem[] | null> {
  const result = await request<MediaListing>(`/v1/bookings/${id}/media`);
  return result?.media ?? null;
}

export async function fetchMediaListingApi(id: string): Promise<MediaListing | null> {
  return request<MediaListing>(`/v1/bookings/${id}/media`);
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

// --- Push token registry (Expo push service; server routes per-trigger).

export function registerPushTokenApi(token: string, platform: 'ios' | 'android') {
  return authedPost<{ registered: boolean }>(`/v1/push-tokens`, { token, platform });
}

/** Server truth for the master toggle: is this device's token active? */
export async function fetchPushTokenActive(token: string): Promise<boolean | null> {
  const result = await request<{ active: boolean }>(
    `/v1/push-tokens/status?token=${encodeURIComponent(token)}`,
  );
  return result?.active ?? null;
}

export async function unregisterPushTokenApi(token: string): Promise<void> {
  if (!apiUrl) return;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (supabase) {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token;
      if (t) headers.Authorization = `Bearer ${t}`;
    }
    await fetch(`${apiUrl}/v1/push-tokens`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ token }),
    });
  } catch {
    // Best effort — sign-out proceeds regardless.
  }
}

/**
 * Content/moderation report (Policy 04). The category choice drives the
 * server's auto-assigned severity and its consequence automation — the
 * screen labels must map 1:1 to the server's four tiers.
 */
/**
 * Real account deletion: soft delete with a 30-day grace period. The server
 * refuses (409, with a reason) while a booking is unfinished or creator
 * earnings are unpaid.
 */
export function deleteAccountApi() {
  return authedPost<{ deleted: boolean; grace_days?: number }>(`/v1/account/delete`, {});
}

export function submitContentReport(
  category: 'child_safety' | 'sexual_violent_hate' | 'content_policy' | 'general' | 'support',
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

/**
 * Headshot: presign, PUT, register. Lands as PENDING — the server only
 * shows approved headshots to clients.
 */
export async function uploadHeadshotApi(file: {
  uri: string;
  name: string;
  mimeType?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = await authedPost<{ upload_url: string; storage_path: string }>(
    '/v1/creator/headshot/upload-url',
    { filename: file.name, content_type: file.mimeType ?? 'image/jpeg' },
  );
  if (!target || 'error' in target) {
    return { ok: false, error: (target as { error?: string })?.error ?? 'Could not start the upload.' };
  }
  try {
    const blob = await (await fetch(file.uri)).blob();
    const put = await fetch(target.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.mimeType ?? 'image/jpeg' },
      body: blob,
    });
    if (!put.ok) return { ok: false, error: 'Upload failed — check your connection and retry.' };
  } catch {
    return { ok: false, error: 'Upload failed — check your connection and retry.' };
  }
  const registered = await authedPost<{ saved?: boolean; error?: string }>('/v1/creator/headshot', {
    storage_path: target.storage_path,
  });
  if (!registered || ('error' in registered && registered.error)) {
    return { ok: false, error: (registered as { error?: string })?.error ?? 'Could not save the headshot.' };
  }
  return { ok: true };
}

/** Presign, PUT the file bytes, and register the media row. */
export async function uploadMediaApi(
  bookingId: string,
  kind: 'raw' | 'deliverable' | 'proof',
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
): Promise<{ booking: Booking } | { error: string } | { conflict: SlotConflict } | null> {
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
        meeting_lat: draft.meetingLat ?? undefined,
        payment_flow: 'sheet',
        meeting_lng: draft.meetingLng ?? undefined,
        date: draft.date,
        time: draft.time,
        // Social bundles: the tier id is the only pricing input; the server
        // derives duration, counts and price from social_pricing_table.
        social_tier: draft.social?.id,
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
    const json = (await res.json()) as {
      booking?: ServerBooking;
      error?: string;
      code?: string;
      alternative_times?: string[];
      rematch_available?: boolean;
    };
    if (!res.ok || !json.booking) {
      // Slot conflicts come back structured so the UI can offer a way
      // forward instead of a dead-end message.
      if (json.code === 'slot_taken' || json.code === 'creator_taken') {
        return {
          conflict: {
            code: json.code,
            error: json.error ?? 'That time is no longer available',
            alternative_times: json.alternative_times ?? [],
            rematch_available: json.rematch_available ?? false,
          },
        };
      }
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
        meetingLat: b.meeting_lat,
        meetingLng: b.meeting_lng,
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
