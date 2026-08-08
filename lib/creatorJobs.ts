import type { JobOffer } from './store/creator';
import { CREATOR_PLATFORM_FEE_RATE } from './constants/business';
import type { ServerBookingListItem } from './api';

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
    payUsd:
      Math.round(
        (b.pricing_snapshot?.session_price_usd ?? b.price_usd) *
          (1 - CREATOR_PLATFORM_FEE_RATE) *
          100,
      ) / 100,
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
  };
}

/** The stage a booking's status implies. */
export function stageForStatus(status: string): 'offer' | 'accepted' | 'submitted' {
  return status === 'pending' ? 'offer' : status === 'completed' ? 'submitted' : 'accepted';
}

export const JOB_STATUSES = ['pending', 'confirmed', 'completed'];
