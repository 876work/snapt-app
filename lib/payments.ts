import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { apiBase, authHeaders } from './api';
import { colors } from './theme';

/**
 * Card payment via Stripe PaymentSheet.
 *
 * CARD DATA NEVER REACHES OUR SERVER: the sheet collects and tokenises the
 * card on-device straight to Stripe. We only ever handle intent/customer
 * ids. The sheet also handles 3D Secure challenges and saved cards itself.
 *
 * Truth about whether money moved comes from the Stripe WEBHOOK, not from
 * this client — `waitForCharge` polls the server until the webhook has
 * ledgered it, so a client that dies mid-payment still gets a paid booking.
 */

export type PayOutcome =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable'; message?: string };

interface IntentResponse {
  client_secret: string;
  customer_id: string;
  ephemeral_key: string;
  amount_usd: number;
}

/** Snapt-branded sheet: our yellow CTA, ink text, the app's rounded cards. */
const APPEARANCE = {
  colors: {
    primary: colors.yellow,
    background: '#FFFFFF',
    componentBackground: '#FAFAFA',
    componentBorder: '#ECECEC',
    componentDivider: '#ECECEC',
    primaryText: colors.ink,
    secondaryText: '#6F6F6F',
    componentText: colors.ink,
    placeholderText: '#9A9A9A',
    icon: '#6F6F6F',
    error: '#C23434',
  },
  shapes: { borderRadius: 14, borderWidth: 1 },
  primaryButton: {
    colors: { background: colors.yellow, text: colors.ink, border: colors.yellow },
    shapes: { borderRadius: 14 },
  },
} as const;

async function post<T>(path: string, body: unknown): Promise<T | null> {
  if (!apiBase) return null;
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Tell the server a sheet was cancelled/failed so the unpaid booking is withdrawn. */
export async function abandonBooking(bookingId: string): Promise<void> {
  await post('/v1/payments/abandon', { booking_id: bookingId });
}

/**
 * Poll until the webhook has recorded the charge. Success is the server's
 * word, never the client's. Returns false if it hasn't landed in time —
 * the booking is still valid and the webhook will finish the job.
 */
export async function waitForCharge(bookingId: string, timeoutMs = 15_000): Promise<boolean> {
  if (!apiBase) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase}/v1/payments/status?booking_id=${bookingId}`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const body = (await res.json()) as { paid?: boolean; failed?: boolean };
        if (body.paid) return true;
        if (body.failed) return false;
      }
    } catch {
      /* keep polling — transient */
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

/**
 * Present the sheet for an already-created (pending) booking.
 * Declines and 3DS are handled inside the sheet; the user can retry there.
 * Closing it returns 'cancelled' and the caller abandons the booking.
 */
export async function payForBooking(bookingId: string, clientName?: string): Promise<PayOutcome> {
  const intent = await post<IntentResponse>('/v1/payments/intent', { booking_id: bookingId });
  if (!intent?.client_secret) {
    return { ok: false, reason: 'unavailable', message: 'Could not start payment. Please try again.' };
  }

  const init = await initPaymentSheet({
    merchantDisplayName: 'Snapt App',
    paymentIntentClientSecret: intent.client_secret,
    customerId: intent.customer_id,
    customerEphemeralKeySecret: intent.ephemeral_key,
    // Saved cards make the "Book again" shortcut one tap.
    allowsDelayedPaymentMethods: false,
    returnURL: 'snapt://stripe-redirect',
    appearance: APPEARANCE,
    defaultBillingDetails: clientName ? { name: clientName } : undefined,
  });
  if (init.error) {
    return { ok: false, reason: 'unavailable', message: init.error.message };
  }

  const { error } = await presentPaymentSheet();
  if (error) {
    // 'Canceled' = user dismissed the sheet (including after a decline they
    // chose not to retry). Anything else is a real failure.
    const cancelled = error.code === 'Canceled';
    return {
      ok: false,
      reason: cancelled ? 'cancelled' : 'failed',
      message: cancelled ? undefined : error.message,
    };
  }
  return { ok: true };
}
