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

/**
 * ACCOUNT DISABLED — one interception point for the whole app.
 *
 * An admin can switch an account off while it is signed in and working. The
 * server answers 403 account_disabled on the next request; without this the
 * app would just see "a request failed" and carry on showing a UI the user
 * no longer has access to.
 *
 * A store flag rather than a thrown error: every caller already handles null
 * by showing its own failed state, so this rides alongside without touching
 * a single call site, and the root layout renders one blocking modal over
 * whatever screen they happen to be on.
 */
export const useAccountDisabled = create<{ disabled: boolean; message: string | null; trip: (m: string) => void; clear: () => void }>((set) => ({
  disabled: false,
  message: null,
  trip: (message) => set({ disabled: true, message }),
  clear: () => set({ disabled: false, message: null }),
}));

/**
 * Trips the modal from an ALREADY-PARSED body. Takes the parsed object
 * rather than the Response on purpose: a Response whose body has been read
 * cannot be cloned, so a clone-based check silently did nothing on every
 * call site that had already parsed — which was most of them.
 */
function tripIfDisabled(status: number, body: { code?: string; error?: string } | null): boolean {
  if (status !== 403 || body?.code !== 'account_disabled') return false;
  useAccountDisabled.getState().trip(
    body.error ?? 'Your Snapt account has been disabled. Contact hello@snaptcarib.app.',
  );
  return true;
}

/**
 * The server refused because the profile is missing required fields.
 *
 * This should be unreachable — the app routes an incomplete account to the
 * completion step before it can get here — so reaching it means the client's
 * idea of completeness was stale (fields cleared elsewhere, or a build that
 * predates the step). Recording it flips the flag the router reads, so the
 * next launch lands on the step instead of failing the same call again.
 *
 * Deliberately NOT a modal: unlike a disabled account, nothing here is
 * revoked. The user is mid-task and the fix is a short form, not an ejection.
 */
function noteProfileIncomplete(status: number, body: { code?: string } | null): void {
  if (status !== 403 || body?.code !== 'profile_incomplete') return;
  import('./store').then(({ useAuth }) => {
    useAuth.getState().setProfile({ profileComplete: false });
  });
}

/** For raw-fetch callers that have NOT read the body yet. */
async function checkDisabled(res: Response): Promise<boolean> {
  if (res.status !== 403 || res.bodyUsed) return false;
  try {
    return tripIfDisabled(res.status, (await res.clone().json()) as { code?: string });
  } catch {
    return false; // not JSON — an ordinary 403
  }
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

/**
 * Same disabled interception for the many call sites that use `authHeaders`
 * with a raw fetch instead of `request` (inbox, messages, delete, uploads).
 * Returns true when the response was an account-disabled refusal, so callers
 * that care can bail; callers that don't still get the modal.
 */
export async function noteIfDisabled(res: Response): Promise<boolean> {
  return checkDisabled(res);
}

export const apiBase = apiUrl;

/**
 * The same guarded request the rest of this file uses, exported for screens
 * that read endpoints without a dedicated wrapper (order tracker: config,
 * threads, revisions). Same disabled/offline handling, same null-on-failure.
 */
export function apiRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  return request<T>(path, init);
}

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
      // Disabled is not "the server is unreachable" — don't light up the
      // offline banner for it; the blocking modal owns this case.
      const err = (await res.json().catch(() => null)) as { code?: string } | null;
      if (tripIfDisabled(res.status, err)) return null;
      noteProfileIncomplete(res.status, err);
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
/**
 * Every bookable creator, for the "See all" directory. Separate endpoint
 * from featured: that one is a capped shop window that hides creators with
 * no published work; this one is the full list of people a client can
 * actually book. null = the request FAILED, so the screen can say so
 * instead of claiming the marketplace is empty.
 */
export async function fetchAllCreators(): Promise<FeaturedCreator[] | null> {
  const result = await request<{ creators: ServerCreator[] }>('/v1/creators/all');
  if (!result?.creators) return null;
  return mapServerCreators(result.creators).map((c, i) => ({
    ...c,
    work: result.creators[i]?.work ?? [],
  }));
}

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
/**
 * Live pricing for DISPLAY — one fetch, every price surface. The static
 * mirrors (PRICING_TABLE, REMOTE_PACKAGES, addon constants) are fallback
 * only; the server charges from these same config rows, so a screen that
 * renders this never drifts from what the card is charged.
 */
export interface PricingConfig {
  pricingTable: Record<string, Record<string, number>>;
  remoteTable: Record<string, Record<string, number>>;
  inPersonAddons: { rush: number; extra_photos: number; extra_revision: number };
  remoteAddons: { rush: number; extra_revision: number };
  clientServiceFeeRate: number;
  rushHours: number;
  standardHours: number;
  /** Offer accept window in minutes (offer_window_minutes). */
  offerWindowMinutes: number;
}
export async function fetchPricingConfig(): Promise<PricingConfig | null> {
  const result = await request<{ config: Record<string, unknown> }>(`/v1/config`);
  if (!result) return null;
  const c = result.config;
  const ipa = (c['in_person_addons'] ?? {}) as Record<string, number>;
  const ra = (c['remote_addons'] ?? {}) as Record<string, number>;
  const dw = (c['delivery_windows'] ?? {}) as { standard_hours?: number; rush_hours?: number };
  return {
    pricingTable: (c['pricing_table'] ?? {}) as PricingConfig['pricingTable'],
    remoteTable: (c['remote_pricing_table'] ?? {}) as PricingConfig['remoteTable'],
    inPersonAddons: {
      rush: ipa.rush ?? 25,
      extra_photos: ipa.extra_photos ?? 18,
      extra_revision: ipa.extra_revision ?? 15,
    },
    remoteAddons: { rush: ra.rush ?? 20, extra_revision: ra.extra_revision ?? 15 },
    clientServiceFeeRate: Number(c['client_service_fee_rate'] ?? 0.08),
    rushHours: dw.rush_hours ?? 6,
    standardHours: dw.standard_hours ?? 24,
    // Already published by /v1/config — the creator's offer countdown needs
    // the window length to draw its ring. Default mirrors offers.ts.
    offerWindowMinutes: Number(c['offer_window_minutes'] ?? 15),
  };
}

/** The server's own price for the summary screen — same function that
 * prices the PaymentSheet, without creating anything. */
export interface CheckoutQuote {
  total_usd: number;
  snapshot: {
    session_price_usd: number;
    addons: { rush_usd: number; extra_photos_usd: number; extra_revisions_usd: number };
    addons_usd: number;
    subtotal_usd: number;
    client_service_fee_usd: number;
    total_usd: number;
    xcd_per_usd: number;
  };
}
export function quoteCheckoutApi(params: Record<string, unknown>) {
  return authedPost<CheckoutQuote>(`/v1/checkout/quote`, params);
}

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
  pricing_snapshot?: {
    session_price_usd?: number;
    subtotal_usd?: number;
    /** Every add-on as sold, summed. Part of the creator's payout base. */
    addons_usd?: number;
    /** Social selection extras, priced after the client picks. Also in the base. */
    social_extras_usd?: number;
    /** Remote-edit package tier as sold (e.g. "standard"). */
    remote_tier?: string | null;
    /** USD per addon as sold; rush_usd > 0 means this is a rush order. */
    addons?: { rush_usd?: number; extra_photos_usd?: number; revisions_usd?: number };
  };
  /**
   * What this job pays the creator, computed server-side with the creator's
   * OWN fee rate (promo included) and the same function that writes the
   * payout row. Present only on rows where the requesting user is the
   * creator — see /v1/bookings.
   */
  creator_payout_usd?: number;
  status: string;
  reschedule_count: number;
  offer_expires_at?: string | null;
  delivered_at?: string | null;
  created_at?: string;
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
    if (!res.ok) {
      // The blocking modal owns this case; still return the error so any
      // screen mid-flow shows something rather than hanging. Uses the body
      // already parsed above — cloning a read Response is impossible.
      tripIfDisabled(res.status, json);
      return { error: json.error ?? 'Something went wrong — try again.' };
    }
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
  /** Signed URL of the LIVE, client-facing headshot. */
  headshot_url?: string | null;
  /** Signed URL of a replacement awaiting review. Owner and admin only. */
  headshot_pending_url?: string | null;
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
 * WHICH SIDE OF A BOOKING THIS ACCOUNT IS ON.
 *
 * /v1/bookings returns rows where the caller is the client OR the creator —
 * one endpoint, both shells, by design (creator rows arrive with
 * creator_payout_usd attached). So every consumer must say which role it is
 * rendering for, and these two predicates are THE place that rule is
 * written. The client shell filters with isClientRole; the creator offer
 * hydrators filter with isCreatorRole. A second copy of either comparison
 * is how the two shells drift apart again.
 *
 * A null `me` means the auth store has no user id — a state that shouldn't
 * coexist with a non-empty server list (sign-in and session restore both
 * set it before any authed fetch can succeed). Both predicates deliberately
 * pass everything in that case: the pre-scoping behaviour. The failure mode
 * of guessing the other way is an account's real bookings silently
 * rendering as an empty list — "your money vanished" — which is worse than
 * the cross-role leak this exists to stop.
 */
export function isClientRole(b: ServerBookingListItem, me: string | null): boolean {
  return !me || b.client_id === me;
}

export function isCreatorRole(b: ServerBookingListItem, me: string | null): boolean {
  return !me || b.creator_id === me;
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
    // Kept so screens can tell whose order a row is — dropping it here is
    // what let a creator's assigned jobs render as orders she had placed.
    clientId: b.client_id ?? null,
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

/** One undelivered booking measured against its promised window. */
export interface DeliveryStatus {
  booking_id: string;
  occasion: string | null;
  type: string;
  rush: boolean;
  started_at: string;
  due_at: string;
  hours_remaining: number;
  hours_late: number;
  state: 'on_track' | 'approaching' | 'late';
}

/**
 * The creator's own delivery clock — the same computation the admin Today
 * screen runs, filtered to them. Returns null on failure so the work queue
 * can say so rather than rendering "nothing overdue".
 */
export async function fetchMyDeliveries(): Promise<{
  late: DeliveryStatus[];
  approaching: DeliveryStatus[];
  /** Every started, undelivered clock — the job screen's deadline source. */
  open?: DeliveryStatus[];
} | null> {
  return request('/v1/creator/deliveries');
}

/**
 * The signed-in creator's own fee rate, resolved server-side.
 *
 * `standard_rate` is present only when `is_promo` — it is the rate that
 * would otherwise apply to this creator, and drives the §5 strikethrough.
 * Absent for a standard-rate creator, who has only one rate to show.
 */
export interface CreatorFeeRate {
  rate: number;
  is_promo: boolean;
  standard_rate?: number;
}

export async function fetchEarnings(): Promise<{
  payouts: EarningsPayout[];
  totals: { pending: number; available: number; paid_out: number };
  /** Optional: absent from a server older than this field. */
  fee?: CreatorFeeRate;
} | null> {
  return request(`/v1/creator/earnings`);
}

export interface PayoutMethodOption {
  id: string;
  name: string;
  /** Delivery promise badge — server-owned, so it changes without an OTA. */
  eta: string;
  fields: string[];
  enabled: boolean;
  /** Admin's creator-facing reason, only when disabled. */
  note: string | null;
}

export interface PayoutMethods {
  /** Per-method availability from the admin toggle. Absent = enabled.
   *  TRUTHFUL for everyone, including a creator whose own selection was
   *  disabled — the server refuses cash-outs against it, so pretending it
   *  is enabled would hide the thing they need to act on. */
  enabled?: Record<string, boolean>;
  selected?: string;
  methods?: Record<string, Record<string, string>>;
  /** Names, ETAs and availability from the server — one source of truth.
   *  Absent only when talking to a server older than this build. */
  catalog?: PayoutMethodOption[];
  /** The creator's saved method is currently switched off. */
  selected_disabled?: boolean;
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
  /** Client-only. The server withholds this key from the creator entirely —
   *  the code proves the client is present, so a creator must never be able
   *  to read it from an API response. */
  safety_code?: string | null;
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
  storage_path?: string;
  created_at?: string;
}

export interface MediaListing {
  media: MediaItem[];
  /** When the retention job will remove the deliverables (ISO), if known. */
  files_expire_at: string | null;
  /** Source files the order was created with (raw uploads, never listed). */
  source_count?: number;
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
  /**
   * Whether this round came out of the order's included allowance or was
   * purchased. Always on the wire — the server selects '*' — but typed only
   * now: a client who paid $15 for a round could not see that they had, and
   * a creator could not see which rounds were bought.
   */
  is_free: boolean;
  /**
   * Already flagged as out of scope. Present ONLY when the caller is the
   * assigned creator — the server omits it entirely for the client, who must
   * never learn a request was questioned.
   */
  flagged?: boolean;
}

/**
 * Flag a revision request as beyond what was booked.
 *
 * A signal to admin, not a stop button: the round stays open and the creator
 * can still deliver it. The client is neither notified nor shown anything.
 * Returns the server's sentence on refusal so the reason reaches the screen.
 */
export async function flagRevisionApi(
  bookingId: string,
  revId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await authedPost<{ flagged?: boolean; error?: string }>(
    `/v1/bookings/${bookingId}/revisions/${revId}/flag`,
    { reason },
  );
  if (r && 'flagged' in r && r.flagged) return { ok: true };
  return { ok: false, error: (r as { error?: string } | null)?.error ?? "Couldn't file that — try again." };
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

// ---------------------------------------------------------------------------
// UPLOAD DRAFTS — source footage that exists before the order does.
//
// Remote clients upload on selection, which is before the booking exists (it
// is created by the Stripe webhook). These four calls own the draft the bytes
// land in; checkout claims it onto the booking. See server/src/routes/
// upload-drafts.ts and the claim in server/src/checkout.ts.
// ---------------------------------------------------------------------------

export interface DraftListing {
  draft_id: string | null;
  files: { id: string; name: string; content_type: string | null; created_at: string }[];
}

/** The draft this client left in flight, if it is still inside the grace. */
export async function fetchCurrentDraft(): Promise<DraftListing | null> {
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/upload-drafts/current`, { headers: await authHeaders() });
    if (!res.ok) return null;
    return (await res.json()) as DraftListing;
  } catch {
    return null;
  }
}

export async function createUploadDraft(): Promise<string | null> {
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/v1/upload-drafts`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    return ((await res.json()) as { draft_id?: string }).draft_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Take one uploaded file back out of a delivery that has NOT been sent.
 *
 * Returns the server's own sentence on refusal rather than a bare false: the
 * two reasons a removal is refused — the order is already delivered, or the
 * file is the client's source footage — are things the creator needs to
 * read, and the uploader shows them on the file's row. A delete that fails
 * silently would leave a file in a delivery the creator believes they
 * removed.
 */
export async function deleteBookingMedia(
  bookingId: string,
  mediaId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!apiUrl) return { ok: false, error: 'No server configured.' };
  try {
    const res = await fetch(`${apiUrl}/v1/bookings/${bookingId}/media/${mediaId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    if (res.ok) return { ok: true };
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: json.error ?? `Couldn't remove that file (${res.status}).`,
    };
  } catch (err) {
    // Reported, not swallowed: the creator sees a sentence, and the reason
    // it failed still has to reach us.
    const { captureHandledError } = await import('./sentry');
    captureHandledError(err, 'deleteBookingMedia:network');
    return { ok: false, error: "Couldn't reach the server to remove that file." };
  }
}

/** Remove one uploaded file. Deletes the object as well as the row. */
export async function deleteDraftFile(draftId: string, mediaId: string): Promise<boolean> {
  if (!apiUrl) return false;
  try {
    const res = await fetch(`${apiUrl}/v1/upload-drafts/${draftId}/media/${mediaId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** "Start over" — discard every file on a draft the client came back to. */
export async function discardUploadDraft(draftId: string): Promise<boolean> {
  if (!apiUrl) return false;
  try {
    const res = await fetch(`${apiUrl}/v1/upload-drafts/${draftId}`, {
      method: 'DELETE',
      headers: await authHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
