/**
 * WHAT IS ALLOWED TO LEAVE THE DEVICE.
 *
 * This app holds payout details, government ID verification, private
 * messages and signed URLs to a private media bucket. A crash reporter is a
 * pipe out of the device, so this file is a whitelist, not a blacklist: an
 * outgoing event is REBUILT from a named set of fields, and anything Sentry
 * added that is not on the list is dropped because it was never copied over.
 *
 * A denylist is the wrong shape for this. It fails open — the day the SDK
 * adds a new field, or the day someone puts an account number in an error
 * message, a denylist silently ships it. This fails closed: a new field is
 * absent until someone adds it here on purpose.
 *
 * Deliberately kept as pure functions with no Sentry import, so the rules can
 * be tested directly rather than inferred from a live capture.
 */

/** Fields copied verbatim off the top level of an event. Nothing else is. */
const EVENT_ALLOW = [
  'event_id',
  'timestamp',
  'platform',
  'level',
  'logger',
  'release',
  'dist',
  'environment',
  'sdk',
  'type',
] as const;

/** Context blocks that describe the DEVICE, never the person using it. */
const CONTEXT_ALLOW = ['device', 'os', 'app', 'runtime', 'culture', 'react_native_context'] as const;

/**
 * Breadcrumb categories worth keeping. `console` is absent on purpose — a
 * console line can contain literally anything, including a whole API
 * response. `ui.click` keeps its category but loses its message, because
 * button labels in this app include people's names.
 */
const BREADCRUMB_ALLOW = new Set([
  'navigation',
  'xhr',
  'fetch',
  'http',
  'app.lifecycle',
  'sentry.event',
  'sentry.transaction',
  'ui.lifecycle',
  // Present so the trail of taps leading to a crash survives. Their MESSAGE
  // is dropped below — the trail is what reproduces a bug, the button label
  // is what names a person.
  'ui.click',
  'ui.input',
  'touch',
]);
const BREADCRUMB_MESSAGE_DROP = new Set(['ui.click', 'ui.input', 'touch']);

/**
 * Text redaction, applied to every string that survives the allowlist.
 *
 * The allowlist decides which FIELDS travel; this decides that a field which
 * is allowed to travel cannot smuggle a secret inside it. An exception
 * message is the usual carrier — "failed to PUT https://…?X-Amz-Signature=…"
 * is a normal thing for an upload error to say.
 */
const REDACTIONS: [RegExp, string][] = [
  // JWTs: Supabase session tokens and Supabase storage signed-URL tokens.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  // Presigned-URL credentials, both drivers.
  [/([?&])(X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|token)=[^&\s"']*/gi, '$1$2=[redacted]'],
  // Anything that named itself a secret.
  [/\b(api[_-]?key|secret|password|authorization|auth[_-]?token|client[_-]?secret)"?\s*[:=]\s*"?[^\s,"'}]+/gi, '$1=[redacted]'],
  [/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g, '[email]'],
  // Bank/card-length digit runs. Epoch milliseconds get caught too; that is
  // an acceptable trade for never shipping an account number.
  [/\b\d{9,}\b/g, '[number]'],
];

export function redactText(input: string): string {
  let out = input;
  for (const [re, to] of REDACTIONS) out = out.replace(re, to);
  return out;
}

/**
 * A URL reduced to the shape of the request. Query string is dropped whole —
 * it is where every signature and token lives — and UUID path segments become
 * `:id` so "which endpoint" stays legible without pinning which booking.
 */
export function redactUrl(input: string): string {
  const noQuery = input.split('?')[0].split('#')[0];
  return redactText(
    noQuery.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ':id',
    ),
  );
}

type Dict = Record<string, unknown>;

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out: Dict = {};
    for (const [k, v] of Object.entries(value as Dict)) out[k] = redactDeep(v, depth + 1);
    return out;
  }
  // Functions, symbols — nothing legitimate, and nothing we can inspect.
  return '[dropped]';
}

/**
 * Stack frames, kept for the parts that locate the code and nothing else.
 *
 * `vars` is dropped outright. It is the local-variable snapshot, which on a
 * payout screen is the payout details — the single highest-risk field Sentry
 * can attach, and it is never worth the debugging value.
 */
function scrubFrames(frames: unknown): unknown {
  if (!Array.isArray(frames)) return undefined;
  return frames.map((f) => {
    const frame = (f ?? {}) as Dict;
    return {
      filename: typeof frame.filename === 'string' ? redactUrl(frame.filename) : undefined,
      function: frame.function,
      lineno: frame.lineno,
      colno: frame.colno,
      in_app: frame.in_app,
      platform: frame.platform,
      abs_path: typeof frame.abs_path === 'string' ? redactUrl(frame.abs_path) : undefined,
    };
  });
}

function scrubException(exception: unknown): unknown {
  const ex = exception as Dict | undefined;
  if (!ex || !Array.isArray(ex.values)) return undefined;
  return {
    values: ex.values.map((v) => {
      const val = (v ?? {}) as Dict;
      const st = (val.stacktrace ?? {}) as Dict;
      return {
        type: typeof val.type === 'string' ? redactText(val.type) : val.type,
        value: typeof val.value === 'string' ? redactText(val.value) : val.value,
        module: val.module,
        mechanism: val.mechanism,
        stacktrace: st.frames ? { frames: scrubFrames(st.frames) } : undefined,
      };
    }),
  };
}

export function scrubBreadcrumb(breadcrumb: Dict): Dict | null {
  const category = typeof breadcrumb.category === 'string' ? breadcrumb.category : '';
  if (!BREADCRUMB_ALLOW.has(category)) return null;

  const data = (breadcrumb.data ?? {}) as Dict;
  const out: Dict = {
    type: breadcrumb.type,
    category,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
  };
  if (!BREADCRUMB_MESSAGE_DROP.has(category) && typeof breadcrumb.message === 'string') {
    out.message = redactUrl(breadcrumb.message);
  }
  // Request breadcrumbs keep only what makes them worth having: which call,
  // and how it went.
  const kept: Dict = {};
  if (typeof data.url === 'string') kept.url = redactUrl(data.url);
  if (data.method != null) kept.method = data.method;
  if (data.status_code != null) kept.status_code = data.status_code;
  if (category === 'navigation') {
    if (typeof data.from === 'string') kept.from = redactUrl(data.from);
    if (typeof data.to === 'string') kept.to = redactUrl(data.to);
  }
  if (Object.keys(kept).length > 0) out.data = kept;
  return out;
}

/**
 * The event that actually goes out. Built field by field from an empty
 * object — `event` is only ever read from.
 */
export function scrubEvent(event: Dict): Dict {
  const out: Dict = {};
  for (const k of EVENT_ALLOW) {
    if (event[k] !== undefined) out[k] = event[k];
  }

  if (typeof event.message === 'string') out.message = redactText(event.message);
  else if (event.message != null) out.message = redactDeep(event.message);

  const exception = scrubException(event.exception);
  if (exception) out.exception = exception;

  // The user id and nothing else. It answers "who hit this" against our own
  // database without carrying an email, a name or an IP off the device.
  const user = event.user as Dict | undefined;
  if (user?.id != null) out.user = { id: user.id };

  const contexts = event.contexts as Dict | undefined;
  if (contexts) {
    const kept: Dict = {};
    for (const k of CONTEXT_ALLOW) {
      if (contexts[k] !== undefined) kept[k] = redactDeep(contexts[k]);
    }
    if (Object.keys(kept).length > 0) out.contexts = kept;
  }

  // Our own tags only — set in lib/sentry.ts, so their shape is known.
  if (event.tags && typeof event.tags === 'object') out.tags = redactDeep(event.tags);

  if (Array.isArray(event.breadcrumbs)) {
    out.breadcrumbs = event.breadcrumbs
      .map((b) => scrubBreadcrumb((b ?? {}) as Dict))
      .filter((b): b is Dict => b !== null);
  }

  // Everything else — request, extra, server_name, modules, attachments,
  // screenshots, view hierarchy — is absent because it was never copied.
  return out;
}
