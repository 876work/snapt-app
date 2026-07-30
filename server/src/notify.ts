import { supabaseAdmin } from './supabase.js';
import { sendEmail } from './email.js';

// Central notification dispatcher (handoff §13): every backend state change
// routes through here, never per-feature ad-hoc sends.
//
// Reconciled against docs/11_Notification_Trigger_Mapping.md (2026-07-28).
// Doc rule: push only when time-sensitive/actionable/money/safety; routine
// events are in-app only. NOTE: the doc's table specifies push/in-app only —
// the email column below is OUR default (mirrors push for money/account/
// dispute events), pending Don's explicit ruling.
// Push = FCM, stubbed until Phase 7 credentials (logged, never dropped
// silently); email = Resend; in-app = notifications table (always written).

type Category = 'bookings' | 'messages' | 'promotions' | 'safety' | 'account';

interface TriggerSpec {
  category: Category;
  push: boolean;
  email: boolean;
}

const TRIGGERS: Record<string, TriggerSpec> = {
  // §8: offer/accept model now exists — time-sensitive (15-min window) → push.
  offer_received: { category: 'bookings', push: true, email: false },
  booking_confirmed: { category: 'bookings', push: true, email: true }, // §1: both parties
  booking_cancelled_by_creator: { category: 'bookings', push: true, email: true }, // §1
  client_cancelled: { category: 'bookings', push: false, email: false }, // §1: in-app only
  reschedule_confirmed: { category: 'bookings', push: true, email: false }, // §1: both parties
  session_started: { category: 'bookings', push: true, email: false }, // §2: creator checked in
  session_ended: { category: 'bookings', push: false, email: false }, // §2: in-app only
  delivery_ready: { category: 'bookings', push: true, email: true }, // §3: "always push"
  revision_requested: { category: 'bookings', push: true, email: false }, // §3: actionable
  revision_delivered: { category: 'bookings', push: true, email: true }, // §3
  payment_charged: { category: 'account', push: false, email: true }, // §4: receipt, no push
  fee_charged: { category: 'account', push: true, email: true }, // §4: unexpected charge → push
  refund_processed: { category: 'account', push: true, email: true }, // §4
  assignment_failed_refunded: { category: 'account', push: true, email: true }, // refund class (§4)
  payout_pending: { category: 'account', push: false, email: false }, // not in doc; routine
  payout_available: { category: 'account', push: false, email: false }, // §4: in-app ONLY
  payout_paid: { category: 'account', push: true, email: true }, // §4: "payout sent"
  application_submitted: { category: 'account', push: false, email: false }, // §5
  application_approved: { category: 'account', push: true, email: true }, // §5
  no_show_reported: { category: 'account', push: true, email: true }, // not in doc — flagged
  safety_report_received: { category: 'safety', push: false, email: false }, // §6: NO push (deliberate)
  dispute_opened: { category: 'account', push: true, email: true }, // §6
  dispute_resolved: { category: 'account', push: true, email: true }, // §6
  strike_issued: { category: 'account', push: true, email: true }, // §6: with reason stated
  suspension_applied: { category: 'account', push: true, email: true }, // §6
  reconsent_required: { category: 'account', push: true, email: true }, // §14 material change
};

export async function notify(
  userId: string,
  trigger: keyof typeof TRIGGERS | string,
  title: string,
  body: string,
): Promise<void> {
  const spec = TRIGGERS[trigger] ?? { category: 'account' as Category, push: false, email: false };
  const channels = ['in_app', ...(spec.push ? ['push'] : []), ...(spec.email ? ['email'] : [])];
  try {
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      trigger_type: trigger,
      category: spec.category,
      title,
      body,
      channels,
    });
    if (spec.email) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.email) await sendEmail(profile.email, title, `<p>${body}</p>`);
    }
    if (spec.push) {
      await sendPush(userId, title, body, trigger);
    }
  } catch (err) {
    console.error('notify failed', trigger, err);
  }
}

/**
 * Push transport: Expo Push Service (relays to FCM on Android and APNs on
 * iOS — credentials live in EAS, none needed server-side). The per-trigger
 * push/in-app routing above is the reconciled 11_Notification_Trigger_Mapping
 * table; this function is transport only. Dead tokens (uninstalled devices)
 * are pruned on DeviceNotRegistered.
 */
async function sendPush(userId: string, title: string, body: string, trigger: string): Promise<void> {
  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);
  if (!tokens || tokens.length === 0) return;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        tokens.map((t) => ({ to: t.token, title, body, sound: 'default', data: { trigger } })),
      ),
    });
    const json = (await res.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };
    const dead = (json.data ?? [])
      .map((ticket, i) =>
        ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
          ? tokens[i].token
          : null,
      )
      .filter((t): t is string => t !== null);
    if (dead.length > 0) {
      await supabaseAdmin.from('push_tokens').delete().in('token', dead);
    }
  } catch (err) {
    // Push is best-effort; in-app (and email where flagged) already landed.
    console.error('[push] send failed', trigger, err);
  }
}
