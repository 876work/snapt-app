import type { JobOffer } from './store/creator';
import { CREATOR_PLATFORM_FEE_RATE } from './constants/business';
import type { ServerBookingListItem } from './api';

/**
 * What this job pays the creator.
 *
 * The server sends `creator_payout_usd` on the creator's own rows, computed
 * by the very function that writes the payout — so this figure and the money
 * that lands are the same number, and it already carries a promo fee rate if
 * the creator has one. The rate itself is deliberately not public, so the app
 * asks for the answer rather than the inputs.
 *
 * The fallback covers mock mode and a server older than the field. It uses
 * the same BASE the server uses (session + every add-on + social extras), so
 * it can never be wrong about add-ons the way the old
 * `session_price_usd × 32%` was — but it can only assume the standard rate.
 */
export function creatorPayUsd(b: ServerBookingListItem): number {
  if (typeof b.creator_payout_usd === 'number') return b.creator_payout_usd;
  const snap = b.pricing_snapshot ?? {};
  const base =
    (snap.session_price_usd ?? b.price_usd) +
    (snap.addons_usd ?? 0) +
    (snap.social_extras_usd ?? 0);
  return Math.round(base * (1 - CREATOR_PLATFORM_FEE_RATE) * 100) / 100;
}

/**
 * Booking row → the creator's job/offer card.
 *
 * Extracted from the Jobs list so the job DETAIL screen can hydrate itself.
 * A deep link straight to /creator/job/{id} never runs the list screen, so
 * the store is empty and the offer isn't there — which is why tapping a job
 * offer notification used to land on a blank white screen.
 */
export function bookingToOffer(b: ServerBookingListItem): JobOffer {
  const snap = (b.pricing_snapshot ?? {}) as Record<string, unknown>;
  const addons = (snap.addons ?? {}) as Record<string, unknown>;
  return {
    id: b.id,
    // Rush is visible on the job itself, not just in the offer push — a
    // creator who accepts and comes back later must still see the clock.
    rush: Number(addons.rush_usd ?? 0) > 0,
    social:
      typeof snap['social_tier'] === 'string'
        ? {
            photos: Number(snap['included_photos'] ?? 0),
            videos: Number(snap['included_videos'] ?? 0),
          }
        : null,
    title: b.occasion ? `${b.occasion} session` : 'Remote edit order',
    occasion: b.occasion ?? 'Portraits',
    payUsd: creatorPayUsd(b),
    scheduledAt: b.scheduled_at,
    durationHours: b.duration_hours,
    when: b.scheduled_at
      ? `${new Date(b.scheduled_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(b.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${b.duration_hours} hrs`
      : 'Remote · deliver in-app',
    loc: b.area ?? 'Remote edit',
    distanceKm: 0,
    meetingLat: b.meeting_lat,
    meetingLng: b.meeting_lng,
    directions: b.meeting_point,
    urgent: b.status === 'pending',
    expiresAt: b.status === 'pending' ? b.offer_expires_at ?? undefined : undefined,
    type: b.type === 'in_person' ? 'in-person' : 'remote',
    deliveredAt: b.delivered_at ?? null,
    remoteTier: typeof snap['remote_tier'] === 'string' ? (snap['remote_tier'] as string) : null,
    editStyle: typeof snap['edit_style'] === 'string' ? (snap['edit_style'] as string) : null,
    mediaKind: b.media_kind as 'photo' | 'video' | 'both' | undefined,
  };
}

/** The stage a booking's status implies. */
export function stageForStatus(status: string): 'offer' | 'accepted' | 'submitted' {
  return status === 'pending' ? 'offer' : status === 'completed' ? 'submitted' : 'accepted';
}

export const JOB_STATUSES = ['pending', 'confirmed', 'completed'];
