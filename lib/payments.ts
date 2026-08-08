import { Linking, Platform } from 'react-native';
import { handleURLCallback, initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { apiBase, authHeaders } from './api';
import { colors } from './theme';

/**
 * Stripe's canonical return URL for this app. Must match the scheme declared
 * in app.json ("snapt") and the shape the SDK builds itself elsewhere.
 */
const RETURN_URL = 'snapt://safepay';

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

/**
 * Hands 3D Secure return URLs to the Stripe SDK so it dismisses the challenge
 * browser and resolves presentPaymentSheet.
 *
 * The SDK does not observe openURL itself (no RCTLinkingManager or
 * STPURLCallbackHandler wiring in its iOS sources), so when iOS foregrounds
 * the app with snapt://safepay… nothing tells Stripe the challenge finished.
 * handleURLCallback returns false for URLs it doesn't own, so this is safe to
 * run over every incoming link.
 *
 * Returns the unsubscribe function.
 */
export function installStripeReturnHandler(): () => void {
  if (Platform.OS !== 'ios') return () => {};
  const onUrl = ({ url }: { url: string }) => {
    if (url.startsWith(RETURN_URL)) void handleURLCallback(url);
  };
  const sub = Linking.addEventListener('url', onUrl);
  // A cold start can deliver the URL before the listener attaches.
  void Linking.getInitialURL().then((url) => {
    if (url) onUrl({ url });
  });
  return () => sub.remove();
}

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
/**
 * Present the sheet for a Social selection-extras charge. The params come
 * from POST /v1/bookings/:id/selection; the selection LOCKS when the
 * webhook confirms — the caller polls the selection endpoint for `locked`
 * rather than trusting the sheet's word.
 */
/**
 * CHECKOUT — the only booking payment path.
 *
 * Opens the sheet from a priced quote; the booking does not exist yet and
 * will not until Stripe confirms. Returns the created booking id once the
 * webhook has made one, so the caller can route to it.
 *
 * Previously the app created the booking (and with it a live creator offer)
 * BEFORE opening the sheet — closing the sheet left a creator holding an
 * unpaid job.
 */
export type CheckoutOutcome =
  | { ok: true; bookingId: string | null }
  /** Paid, but the webhook has not produced a booking yet. NEVER silent:
   * with booking creation behind the webhook, this is the difference
   * between "confirming" and "we took your money and made nothing". */
  | { ok: false; reason: 'paid_unconfirmed'; paymentIntentId: string }
  | { ok: false; reason: 'cancelled' | 'failed' | 'unavailable'; message?: string }
  | { ok: false; reason: 'conflict'; conflict: import('./api').SlotConflict };

export async function checkoutBooking(
  /** Progress copy for the caller to display while this runs. Called with
   * '' to clear. Checkout is slow enough on a cold dyno that silence reads
   * as a crash, so the stages are part of the contract, not decoration. */
  onStage: (message: string) => void,
  params: Record<string, unknown>,
): Promise<CheckoutOutcome> {
  const { apiBase, authHeaders } = await import('./api');
  if (!apiBase) return { ok: false, reason: 'unavailable', message: 'No server configured.' };

  onStage('Starting secure checkout…');
  // Render's free tier sleeps; a cold dyno can take 30-60s to answer. Say
  // so rather than letting the screen look dead — and BOUND it, because
  // React Native's fetch has no default timeout and would otherwise hang
  // forever on a server that never wakes.
  const waking = setTimeout(() => onStage('Waking the server — first request can take up to a minute…'), 6000);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 90_000);

  let res: Response;
  try {
    res = await fetch(`${apiBase}/v1/checkout/intent`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(params),
      signal: abort.signal,
    });
  } catch (err) {
    const timedOut = (err as { name?: string })?.name === 'AbortError';
    return {
      ok: false,
      reason: 'unavailable',
      message: timedOut
        ? 'The server did not respond in time. Nothing was charged — please try again.'
        : "Couldn't reach the server — check your connection and try again. Nothing was charged.",
    };
  } finally {
    clearTimeout(waking);
    clearTimeout(timeout);
  }
  const json = (await res.json().catch(() => ({}))) as {
    client_secret?: string;
    customer_id?: string;
    ephemeral_key?: string;
    payment_intent_id?: string;
    error?: string;
    code?: string;
    alternative_times?: string[];
    rematch_available?: boolean;
  };
  if (!res.ok || !json.client_secret) {
    if (json.code === 'slot_taken' || json.code === 'creator_taken') {
      return {
        ok: false,
        reason: 'conflict',
        conflict: {
          code: json.code,
          error: json.error ?? 'That time is no longer available',
          alternative_times: json.alternative_times ?? [],
          rematch_available: json.rematch_available ?? false,
        },
      };
    }
    return { ok: false, reason: 'unavailable', message: json.error ?? 'Could not start checkout.' };
  }

  const init = await initPaymentSheet({
    merchantDisplayName: 'Snapt App',
    paymentIntentClientSecret: json.client_secret,
    customerId: json.customer_id,
    customerEphemeralKeySecret: json.ephemeral_key,
    allowsDelayedPaymentMethods: false,
    returnURL: RETURN_URL, // required for 3DS — see payForBooking
    appearance: APPEARANCE,
  });
  if (init.error) return { ok: false, reason: 'unavailable', message: init.error.message };

  onStage('');
  const { error } = await presentPaymentSheet();
  if (error) {
    // Sheet closed or declined. NOTHING was created — no booking, no offer,
    // no notification — so there is nothing to abandon or clean up.
    const cancelled = error.code === 'Canceled';
    return {
      ok: false,
      reason: cancelled ? 'cancelled' : 'failed',
      message: cancelled ? undefined : error.message,
    };
  }

  // Paid. The BOOKING is created by the webhook, so wait for the server's
  // word rather than the sheet's.
  onStage('Payment received — confirming your booking…');
  const bookingId = json.payment_intent_id
    ? await waitForCheckoutBooking(json.payment_intent_id)
    : null;
  onStage('');
  if (!bookingId && json.payment_intent_id) {
    // The charge went through but no booking came back. Almost always the
    // Stripe webhook not reaching us — and since the webhook is what
    // CREATES the booking, staying quiet here would strand a paid client
    // on an empty bookings list.
    return { ok: false, reason: 'paid_unconfirmed', paymentIntentId: json.payment_intent_id };
  }
  return { ok: true, bookingId };
}

/** Poll until the webhook has created the booking for this intent. */
export async function waitForCheckoutBooking(
  paymentIntentId: string,
  timeoutMs = 20_000,
): Promise<string | null> {
  const { apiBase, authHeaders } = await import('./api');
  if (!apiBase) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `${apiBase}/v1/checkout/status?payment_intent_id=${encodeURIComponent(paymentIntentId)}`,
        { headers: await authHeaders() },
      );
      if (res.ok) {
        const body = (await res.json()) as { paid?: boolean; booking_id?: string | null };
        if (body.booking_id) return body.booking_id;
      }
    } catch {
      /* keep polling — transient */
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null; // paid; the webhook will finish. Caller routes to the list.
}

export async function payForSelectionExtras(params: {
  client_secret: string;
  customer_id?: string;
  ephemeral_key?: string;
}): Promise<PayOutcome> {
  const init = await initPaymentSheet({
    merchantDisplayName: 'Snapt App',
    paymentIntentClientSecret: params.client_secret,
    customerId: params.customer_id,
    customerEphemeralKeySecret: params.ephemeral_key,
    allowsDelayedPaymentMethods: false,
    returnURL: RETURN_URL, // same 3DS return contract as payForBooking
    appearance: APPEARANCE,
  });
  if (init.error) return { ok: false, reason: 'unavailable', message: init.error.message };
  const { error } = await presentPaymentSheet();
  if (error) {
    const cancelled = error.code === 'Canceled';
    return {
      ok: false,
      reason: cancelled ? 'cancelled' : 'failed',
      message: cancelled ? undefined : error.message,
    };
  }
  return { ok: true };
}

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
    // REQUIRED for 3D Secure on iOS. PaymentSheet does NOT fall back to
    // StripeProvider's urlScheme — StripeSdkImpl+PaymentSheet.swift only sets
    // configuration.returnURL from this param, and the SDK itself warns that
    // without it "payment methods that require redirects will not be shown".
    // With it nil the bank approves, then the challenge browser has nowhere
    // to return to and strands the user on "Authentication Complete".
    //
    // The value must be exactly <scheme>://safepay — that is what the SDK
    // builds for every other flow (Mappers.mapToReturnURL) and what its URL
    // handler recognises. app/safepay/[...rest].tsx catches it so expo-router
    // never renders "Unmatched Route" if the app is foregrounded with it.
    returnURL: RETURN_URL,
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
