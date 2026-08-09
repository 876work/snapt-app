import { supabaseAdmin } from './supabase.js';
import { sendEmail } from './email.js';
import { targetFor, type TargetData } from './notification-targets.js';

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
  application_submitted: { category: 'account', push: false, email: true }, // §5 + Don 2026-08-02: confirmation email
  application_approved: { category: 'account', push: true, email: true }, // §5
  application_rejected: { category: 'account', push: true, email: true }, // §5 outcome w/ reason
  no_show_reported: { category: 'account', push: true, email: true }, // not in doc — flagged
  safety_report_received: { category: 'safety', push: false, email: false }, // §6: NO push (deliberate)
  dispute_opened: { category: 'account', push: true, email: true }, // §6
  dispute_resolved: { category: 'account', push: true, email: true }, // §6
  strike_issued: { category: 'account', push: true, email: true }, // §6: with reason stated
  suspension_applied: { category: 'account', push: true, email: true }, // §6
  reconsent_required: { category: 'account', push: true, email: true }, // §14 material change
  // ID check outcome. A creator who photographs their passport and hears
  // nothing is the worst version of this flow. Push always; email only where
  // they are blocked or must act (the two _failed triggers) — a plain pass
  // already gets the verified-name email, and two emails is noise.
  verification_result: { category: 'account', push: true, email: false },
  // Sent by the restore endpoint AFTER status is back to active — otherwise
  // the suppression above would swallow the one notification whose entire
  // job is telling someone their account works again. Email as well as push:
  // a restored user may not have the app open, or installed.
  account_restored: { category: 'account', push: true, email: true },
  // A creator changed mid-booking. All three parties need to know, and none
  // of them can afford to find out on the day — push and email both.
  booking_reassigned: { category: 'bookings', push: true, email: true },
  // The client on a creator's upcoming booking was disabled. The booking is
  // still standing, so this has to reach them BEFORE they travel to it.
  client_account_disabled: { category: 'bookings', push: true, email: true },
  verification_failed: { category: 'account', push: true, email: true },
  files_expiring: { category: 'bookings', push: true, email: true }, // retention: 30d/7d download warnings
  // Chat. Muted by the `messages` preference rather than order_updates —
  // a chat ping is not a booking state change.
  message_received: { category: 'messages', push: true, email: false },
  // Social bundles. proofs_ready starts a deadline, so it gets email too —
  // a missed push must not cost the client their choice.
  proofs_ready: { category: 'bookings', push: true, email: true },
  // A rejected headshot blocks the creator's public face — actionable.
  headshot_rejected: { category: 'account', push: true, email: false },
  selection_locked: { category: 'bookings', push: true, email: false },
  selection_autopicked: { category: 'bookings', push: true, email: false },
};

export async function notify(
  userId: string,
  trigger: keyof typeof TRIGGERS | string,
  title: string,
  body: string,
  /** Resource ids, e.g. { booking_id }. Drives where a tap lands. */
  data: TargetData & Record<string, unknown> = {},
): Promise<void> {
  const spec = TRIGGERS[trigger] ?? { category: 'account' as Category, push: false, email: false };
  const channels = ['in_app', ...(spec.push ? ['push'] : []), ...(spec.email ? ['email'] : [])];
  // Resolved ONCE, here, and then carried by both channels. The inbox row
  // and the push notification hold the same string, so tapping the bell and
  // tapping the banner cannot land in different places.
  const target = targetFor(trigger, data);
  const payload = target ? { ...data, target } : data;
  try {
    /**
     * DISABLED ACCOUNTS GET NOTHING — and get it by never existing, not by
     * being held back. Suppression sits ABOVE the insert deliberately: the
     * row is normally written first and is the durable record, so gating
     * only push/email would still leave an inbox that floods the moment the
     * account is restored. No row, no email, no push, no backlog.
     *
     * A restore is therefore silent by design; the access-restored
     * notification is sent explicitly by the restore endpoint, after status
     * is back to active.
     */
    const { data: recipient } = await supabaseAdmin
      .from('profiles')
      .select('status')
      .eq('id', userId)
      .maybeSingle();
    if (recipient?.status === 'disabled') return;

    // WRITE FIRST. The row is the record; delivery is best-effort on top of
    // it. Nothing below can prevent it being saved.
    await supabaseAdmin.from('notifications').insert({
      user_id: userId,
      trigger_type: trigger,
      category: spec.category,
      title,
      body,
      channels,
      data: payload,
    });
    if (spec.email) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
      if (profile?.email) {
        // The result was discarded, so a Resend outage looked exactly like a
        // delivered email — the creator-application confirmation could fail
        // for every applicant and nothing would say so. The inbox row is
        // already written above, so this only reports; it never blocks.
        const mail = await sendEmail(profile.email, title, `<p>${body}</p>`);
        if (!mail.sent) console.error('[notify] email send FAILED', trigger, userId);
      }
    }
    if (spec.push) {
      // §13 per-category muting, enforced on the push channel only — in-app
      // rows are always written and emails stay transactional. 'bookings'
      // maps to the order_updates preference; 'account' and 'safety' are the
      // non-toggleable critical bucket (payments, disputes, safety). The
      // messages / booking_reminders / promotions prefs gate triggers that
      // don't exist yet (chat push, session reminders, marketing).
      let muted = false;
      if (spec.category === 'bookings' || spec.category === 'messages') {
        const { data: p } = await supabaseAdmin
          .from('profiles')
          .select('notification_prefs')
          .eq('id', userId)
          .maybeSingle();
        const prefs = (p?.notification_prefs ?? {}) as Record<string, boolean>;
        muted =
          spec.category === 'messages' ? prefs.messages === false : prefs.order_updates === false;
      }
      if (!muted) await sendPush(userId, title, body, trigger, payload);
    }
  } catch (err) {
    console.error('notify failed', trigger, err);
  }
}

/**
 * Promotional send — the ONLY way marketing should reach a user.
 *
 * A Firebase console send bypasses this server entirely, which is exactly why
 * those never appear in the inbox. Here the inbox rows are written first, in
 * one batch, and only then does anything go to a device.
 *
 * The caller has already filtered out opt-outs (see promotionAudience); this
 * function never writes a promotional row for a user it wasn't handed.
 */
export async function sendPromotion(
  userIds: string[],
  title: string,
  body: string,
  deepLink?: string,
): Promise<{ written: number; pushed: number }> {
  if (userIds.length === 0) return { written: 0, pushed: 0 };
  const data = deepLink ? { deep_link: deepLink } : {};
  let written = 0;
  // Chunked so one oversized audience can't blow the statement limit, and a
  // failure mid-way still leaves the earlier chunks recorded.
  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    const { error } = await supabaseAdmin.from('notifications').insert(
      chunk.map((userId) => ({
        user_id: userId,
        trigger_type: 'promotion',
        category: 'promotions' as Category,
        title,
        body,
        channels: ['in_app', 'push'],
        data,
      })),
    );
    if (error) console.error('[promotion] inbox write failed', error.message);
    else written += chunk.length;
  }
  let pushed = 0;
  for (const userId of userIds) {
    const ok = await sendPush(userId, title, body, 'promotion', data);
    if (ok) pushed += 1;
  }
  return { written, pushed };
}

/**
 * Push transport: Expo Push Service (relays to FCM on Android and APNs on
 * iOS — credentials live in EAS, none needed server-side). The per-trigger
 * push/in-app routing above is the reconciled 11_Notification_Trigger_Mapping
 * table; this function is transport only. Dead tokens (uninstalled devices)
 * are pruned on DeviceNotRegistered.
 */
async function sendPush(
  userId: string,
  title: string,
  body: string,
  trigger: string,
  /** Carried to the device so a tap can route without a round trip. */
  payload: Record<string, unknown> = {},
): Promise<boolean> {
  const { data: tokens } = await supabaseAdmin
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId);
  if (!tokens || tokens.length === 0) return false;
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        // `uid` rides along so the app can tell that a notification was for
        // a DIFFERENT account before it opens someone else's booking. A
        // token outlives a sign-out by design (we only prune on
        // DeviceNotRegistered), so this is a real case, not a theoretical
        // one.
        tokens.map((t) => ({
          to: t.token,
          title,
          body,
          sound: 'default',
          data: { ...payload, trigger, uid: userId },
        })),
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
    return (json.data ?? []).some((t) => t.status === 'ok');
  } catch (err) {
    // Push is best-effort; in-app (and email where flagged) already landed.
    console.error('[push] send failed', trigger, err);
    return false;
  }
}
