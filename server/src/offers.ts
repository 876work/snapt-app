import { supabaseAdmin } from './supabase.js';
import { getConfig } from './config.js';
import { dayAvailability, eligibleCreators } from './availability.js';

// Creator accept/decline window (Don, 2026-07-27). Assignment offers expire
// after offer_window_minutes; decline or timeout reassigns to the next
// eligible creator using the SAME matching logic as initial assignment,
// excluding prior decliners for this booking. No strike is ever written
// here — strikes apply only to accepted bookings.

interface OfferBooking {
  id: string;
  creator_id: string | null;
  occasion: string;
  area: string | null;
  scheduled_at: string | null;
  duration_hours: number | null;
  status: string;
  offer_expires_at: string | null;
  declined_creator_ids: string[];
}

export async function offerWindowMs(): Promise<number> {
  const config = await getConfig();
  return (((config['offer_window_minutes'] as number) ?? 15) as number) * 60_000;
}

/** Assign the next eligible+available creator, or clear the assignment. */
export async function reassignBooking(
  booking: OfferBooking,
  excludeCreatorId: string | null,
): Promise<{ creator_id: string | null }> {
  const declined = [
    ...booking.declined_creator_ids,
    ...(excludeCreatorId ? [excludeCreatorId] : []),
  ];
  let nextCreator: string | null = null;
  if (booking.scheduled_at) {
    const date = booking.scheduled_at.slice(0, 10);
    const time = new Date(booking.scheduled_at).toTimeString().slice(0, 5);
    const creators = await eligibleCreators(booking.occasion, booking.area ?? undefined);
    const slots = await dayAvailability(
      booking.occasion,
      date,
      booking.duration_hours ?? 1,
      booking.area ?? undefined,
    );
    const slot = slots.find((s) => s.time === time);
    nextCreator =
      creators.find((c) => slot?.creator_ids.includes(c.user_id) && !declined.includes(c.user_id))
        ?.user_id ?? null;
  }
  await supabaseAdmin
    .from('bookings')
    .update({
      creator_id: nextCreator,
      declined_creator_ids: declined,
      offer_expires_at: nextCreator
        ? new Date(Date.now() + (await offerWindowMs())).toISOString()
        : null,
    })
    .eq('id', booking.id);
  return { creator_id: nextCreator };
}

/**
 * Lazy timeout sweep: if a pending offer has expired, treat as a decline
 * (no strike) and reassign. Returns the fresh row when anything changed.
 */
export async function expireStaleOffer<T extends OfferBooking>(booking: T): Promise<T> {
  if (
    booking.status !== 'pending' ||
    !booking.creator_id ||
    !booking.offer_expires_at ||
    Date.now() < Date.parse(booking.offer_expires_at)
  ) {
    return booking;
  }
  await reassignBooking(booking, booking.creator_id);
  const { data } = await supabaseAdmin
    .from('bookings')
    .select('*')
    .eq('id', booking.id)
    .single();
  return (data as T) ?? booking;
}
