import * as Sentry from '@sentry/react-native';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub';

/**
 * CRASH REPORTING.
 *
 * Off unless EXPO_PUBLIC_SENTRY_DSN is present, so a clone with no Sentry
 * account behaves exactly as the app did before this file existed. The DSN
 * has to be EXPO_PUBLIC_ to survive into the bundle; that is fine — a DSN is
 * a write-only ingest endpoint, not a credential, and it ships inside every
 * app that uses Sentry.
 *
 * Everything leaving the device goes through lib/sentryScrub, which rebuilds
 * each event from an allowlist. See that file for why it is shaped that way.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Update identity, so a crash names WHICH over-the-air bundle produced it. */
function updateTags(): Record<string, string> {
  const tags: Record<string, string> = {
    // Stamped by scripts/publish-ota.sh — the exact commit of the running
    // bundle, and the fastest way from a stack trace back to the source.
    commit: process.env.EXPO_PUBLIC_COMMIT ?? 'unknown',
  };
  try {
    // Static getters, but they are native-backed: a dev client without the
    // updates module must not take the whole init down with it.
    const Updates = require('expo-updates') as typeof import('expo-updates');
    tags.update_id = Updates.updateId ?? 'embedded';
    tags.channel = Updates.channel ?? 'none';
    tags.runtime_version = Updates.runtimeVersion ?? 'unknown';
    tags.embedded_launch = String(Updates.isEmbeddedLaunch);
  } catch {
    tags.update_id = 'unavailable';
  }
  return tags;
}

export function initSentry(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    // The channel IS the environment here — production, preview, development
    // are exactly the EAS channels this app publishes to.
    environment: process.env.EXPO_PUBLIC_COMMIT ? 'production' : 'development',

    /* ---- what is NOT collected ------------------------------------- */
    // Never. Both would photograph an ID document or a payout form mid-crash.
    attachScreenshot: false,
    attachViewHierarchy: false,
    // No emails, usernames or IP addresses inferred by the SDK. The one
    // identifier that travels is the user id, attached in scrubEvent.
    sendDefaultPii: false,
    // Failed requests arrive as breadcrumbs on real errors already; capturing
    // each one as its own event adds volume and another URL-bearing surface.
    enableCaptureFailedRequests: false,
    // Crash reporting is the job. Performance tracing sends a transaction per
    // navigation, each carrying URLs, for no crash-diagnosis value.
    tracesSampleRate: 0,

    /* ---- what IS collected ----------------------------------------- */
    attachStacktrace: true,
    // Crash-free session rate. Counts only — no payload.
    enableAutoSessionTracking: true,
    maxBreadcrumbs: 50,

    /* ---- the gate --------------------------------------------------- */
    // Applied at CAPTURE time, so a console line carrying an API response is
    // never even held in the in-memory buffer waiting for a crash.
    beforeBreadcrumb: (breadcrumb) =>
      scrubBreadcrumb(breadcrumb as unknown as Record<string, unknown>) as typeof breadcrumb | null,
    // Applied at SEND time, over the whole event. The two together mean a
    // field has to survive both to leave the device.
    beforeSend: (event) =>
      scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  });

  Sentry.setTags(updateTags());
}

/**
 * Wraps the root component for native error handling and navigation
 * instrumentation. A no-op passthrough when Sentry is off, so the tree is
 * identical to what shipped before.
 */
export const withSentry: <T>(component: T) => T = ((component: unknown) =>
  dsn ? (Sentry.wrap as (c: unknown) => unknown)(component) : component) as never;

/** True when reporting is actually on — used by Profile → Build & updates. */
export const sentryEnabled = Boolean(dsn);

/**
 * Report an error the app CAUGHT and handled.
 *
 * Without this the root error boundary is a blind spot: it turns a render
 * crash into a tidy "Something went wrong" screen, and because the error
 * never reached the global handler, nobody is told it happened. A recovered
 * crash is still a crash.
 */
export function captureHandledError(error: unknown, handledAt: string): void {
  if (!dsn) return;
  Sentry.captureException(error, { tags: { handled_at: handledAt } });
}
