import { supabaseAdmin } from './supabase.js';
import { sendEmail } from './email.js';

// Central notification dispatcher (handoff §13): every backend state change
// routes through here, never per-feature ad-hoc sends.
//
// FLAGGED: 11_Notification_Trigger_Mapping.md (the source-of-truth trigger
// table) is not in this repo — the channel map below is reconstructed from
// the handoff's category rules and MUST be reconciled against the real doc.
// Push = FCM, stubbed until Phase 7 credentials (logged, never dropped
// silently); email = Resend; in-app = notifications table (always written).

type Category = 'bookings' | 'messages' | 'promotions' | 'safety' | 'account';

interface TriggerSpec {
  category: Category;
  push: boolean;
  email: boolean;
}

const TRIGGERS: Record<string, TriggerSpec> = {
  offer_received: { category: 'bookings', push: true, email: false },
  booking_confirmed: { category: 'bookings', push: true, email: true },
  booking_cancelled_by_creator: { category: 'bookings', push: true, email: true },
  assignment_failed_refunded: { category: 'account', push: true, email: true },
  refund_processed: { category: 'account', push: true, email: true },
  reschedule_confirmed: { category: 'bookings', push: true, email: false },
  no_show_reported: { category: 'account', push: true, email: true },
  strike_issued: { category: 'account', push: true, email: true },
  payout_pending: { category: 'account', push: false, email: false },
  payout_available: { category: 'account', push: true, email: true },
  payout_paid: { category: 'account', push: true, email: true },
  delivery_ready: { category: 'bookings', push: true, email: true },
  dispute_opened: { category: 'account', push: true, email: true },
  dispute_resolved: { category: 'account', push: true, email: true },
  safety_report_received: { category: 'safety', push: true, email: false },
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
      // FCM lands with Phase 7 credentials; the routing decision is made
      // here so no trigger is silently dropped later.
      console.log(`[push stub] user=${userId} trigger=${trigger}`);
    }
  } catch (err) {
    console.error('notify failed', trigger, err);
  }
}
