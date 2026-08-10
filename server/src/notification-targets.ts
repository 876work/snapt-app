/**
 * WHERE A NOTIFICATION LANDS — the single definition.
 *
 * This is the only place in the system that decides what screen a
 * notification opens. notify() calls it once at send time and writes the
 * result onto the inbox row (`data.target`); the push payload carries the
 * same string. The bell and the push therefore cannot disagree, because
 * they are not two mappings that have to be kept in sync — they are one
 * string, computed once, read twice.
 *
 * Before this existed, exactly one of ~45 send sites passed any deep-link
 * data at all, and the app had no push tap handler, so every push opened
 * the app's front door.
 *
 * ROUTES ARE REAL. Every path below is checked against app/ in
 * notification-targets.test.ts — a typo here is a dead link on someone's
 * phone, and the previous inbox map pointed delivery notifications at
 * /(app)/bookings/{id}/delivery, a route that has never existed.
 */

/** Ids a trigger may carry. All optional — the resolver degrades. */
export interface TargetData {
  booking_id?: string;
  payout_id?: string;
  transaction_id?: string;
  dispute_id?: string;
  thread_id?: string;
  doc_slug?: string;
  /** Explicit override. Set by a caller that knows better than the map. */
  deep_link?: string;
  /**
   * Which side of the booking the recipient is on, for triggers both parties
   * receive. Only booking_confirmed branches on it today.
   */
  audience?: 'client' | 'creator';
}

const booking = (id: string) => `/(app)/bookings/${id}`;
const delivery = (id: string) => `/order/${id}/delivery`;
const order = (id: string) => `/order/${id}`;
const thread = (id: string) => `/(app)/messages/${id}`;
const jobOffer = (id: string) => `/creator/job/${id}`;

/**
 * Resolve the destination for a notification.
 *
 * Returns null only when there genuinely is no specific place to go (a
 * promotion with no link). Everything else lands on a resource or, at
 * worst, the list that resource lives in — never the app's front door.
 */
export function targetFor(trigger: string, data: TargetData = {}): string | null {
  // An explicit deep_link from the caller wins. Used where the sender knows
  // something the trigger type alone doesn't.
  if (data.deep_link) return data.deep_link;

  const b = data.booking_id;

  switch (trigger) {
    // ---- The job offer, with its countdown ------------------------------
    // Straight to the offer screen. This is the one with a 15-minute clock
    // on it; landing on the dashboard and hunting for it wastes the window.
    case 'offer_received':
      return b ? jobOffer(b) : '/creator';

    // ---- That booking ----------------------------------------------------
    // Booking-lifecycle triggers fire to BOTH parties. The map alone is
    // role-blind, so creator recipients used to deep-link into the CLIENT
    // booking screen. The sender declares the audience; creator recipients
    // land on their job screen (which owns cancelled/ended/gone states).
    // The target stays resolved here once, shared by bell and push.
    case 'booking_confirmed':
    case 'booking_cancelled_by_creator':
    case 'client_cancelled':
    case 'reschedule_confirmed':
    case 'session_ended':
    case 'no_show_reported':
    // Reassignment reaches all three parties at once, so it depends on the
    // audience flag more than any other trigger: the outgoing creator, the
    // replacement and the client each need their own side of the booking.
    case 'booking_reassigned':
    case 'client_account_disabled':
      if (b && data.audience === 'creator') return jobOffer(b);
      return b ? booking(b) : '/(app)/bookings';

    // The live session screen — safety code, meeting point, the creator's
    // arrival. Not the booking detail: they are standing outside.
    case 'session_started':
      return b ? `/session/${b}` : '/(app)/bookings';

    // ---- Social bundle selection ----------------------------------------
    // The client chooses proofs on the selection screen; the creator's
    // outcomes land on the job, where the picks are marked.
    case 'proofs_ready':
      return b ? `/order/${b}/select` : '/(app)/bookings';
    case 'selection_locked':
      return b ? jobOffer(b) : '/creator';
    case 'selection_autopicked':
      return b ? order(b) : '/(app)/bookings';

    // ---- That delivery ---------------------------------------------------
    case 'delivery_ready':
    case 'revision_delivered':
    case 'files_expiring':
      return b ? delivery(b) : '/(app)/bookings';

    // Creator side: the order they have to act on, not the client's
    // delivery view.
    case 'revision_requested':
      return b ? order(b) : '/creator';

    // The job screen, because the fix IS on it: the deliver slider sits
    // under the files they already uploaded.
    case 'delivery_not_sent':
      return b ? jobOffer(b) : '/creator';

    // ---- The welcome: straight to the thing it describes ------------------
    case 'welcome':
      return '/(app)/home';

    // ---- That thread -----------------------------------------------------
    case 'message_received':
      return data.thread_id ? thread(data.thread_id) : b ? thread(b) : '/(app)/messages';

    // ---- That transaction under Payments ---------------------------------
    case 'payment_charged':
    case 'refund_processed':
    case 'fee_charged':
    case 'assignment_failed_refunded':
      return data.transaction_id
        ? `/(app)/profile/payments?highlight=${data.transaction_id}`
        : '/(app)/profile/payments';

    // ---- That payout record ----------------------------------------------
    case 'payout_paid':
    case 'payout_available':
    case 'payout_pending':
      return data.payout_id
        ? `/creator/earnings?highlight=${data.payout_id}`
        : '/creator/earnings';

    // ---- The application, in whatever state it is now --------------------
    // /creator is the router: it reads the live status and shows approved,
    // pending, parked, rejected or suspended. Sending an outcome
    // notification to a fixed screen would be a second source of truth for
    // application state, and it would go stale the moment an admin acts.
    case 'application_submitted':
    case 'application_approved':
    case 'application_rejected':
    case 'verification_result':
    case 'verification_failed':
    case 'reconsent_required':
      return '/creator';

    // ---- Account standing -------------------------------------------------
    case 'strike_issued':
    case 'suspension_applied':
      return '/creator';
    // Where the creator re-uploads their headshot.
    case 'headshot_rejected':
      return '/creator/headshot';

    // ---- Disputes ---------------------------------------------------------
    // The evidence screen: an open dispute is a deadline, and evidence is
    // the only thing the recipient can actually do about it.
    // Disputes fire to both parties. Creator recipients land on the creator
    // evidence door (/creator/dispute/{booking}) now that it exists — until
    // 2026-08-09 there was no creator surface and both parties were sent to
    // the client route.
    case 'dispute_opened':
      if (b && data.audience === 'creator') return `/creator/dispute/${b}`;
      return b ? `/(app)/bookings/${b}/evidence` : '/(app)/bookings';
    case 'dispute_resolved':
      if (b && data.audience === 'creator') return jobOffer(b);
      return b ? booking(b) : '/(app)/bookings';

    // Deliberately quiet (no push — see TRIGGERS). The inbox row still
    // opens the report we filed.
    case 'safety_report_received':
      return '/help';

    case 'promotion':
      return null;

    default:
      return b ? booking(b) : null;
  }
}

/**
 * Screens only a creator can open. The app checks this before routing so a
 * client-mode account tapping a stale creator notification gets an
 * explanation instead of a blank screen behind a creator-only fetch.
 */
export function isCreatorTarget(target: string): boolean {
  return target.startsWith('/creator');
}
