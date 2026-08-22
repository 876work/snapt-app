import { apiBase, authHeaders } from './api';
import { captureHandledError } from './sentry';

/**
 * Client source-file upload, one file at a time, with real progress.
 *
 * `fetch` in React Native reports no upload progress, so this uses XHR —
 * on a 700MB video the difference is a live bar versus a frozen screen the
 * user assumes has crashed.
 *
 * The file goes STRAIGHT from the device to storage via a presigned URL;
 * bytes never pass through our server. Files register as kind 'raw', which
 * is creator/editor-side only — no endpoint ever returns a raw download
 * URL to a client, and retention removes them 30 days after final delivery
 * (retention_raw_days).
 */
export interface RawUploadResult {
  ok: boolean;
  /** Present on failure — shown per file, never swallowed. */
  error?: string;
  /**
   * The registered row's id, on success. Needed because a file that has
   * registered can only be taken back out of a delivery by naming its row to
   * the server — dropping it from the local list would leave it attached and
   * /deliver would send it anyway.
   */
  mediaId?: string;
}

/**
 * ONE REQUEST TO OUR SERVER, WITH A DEADLINE.
 *
 * React Native's Android client sets NO network timeouts at all —
 * OkHttpClientProvider.kt builds okhttp with connect/read/write all 0
 * ("No timeouts by default"), so a fetch against a sleeping Render instance
 * waits forever. That is exactly the reported shape: bytes in R2, bar at
 * 100%, and the register call hanging with nothing on screen moving.
 *
 * 75s: comfortably past a normal cold start (20–60s) so a waking server
 * still succeeds, but bounded — past it the caller shows a real error with
 * a retry instead of an indefinite nothing.
 */
const SERVER_CALL_TIMEOUT_MS = 75_000;

async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  tag: string,
): Promise<Response | 'timeout'> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_CALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      captureHandledError(new Error(`${tag} timed out after ${SERVER_CALL_TIMEOUT_MS}ms`), tag);
      return 'timeout';
    }
    throw err; // a real network failure — the caller's catch owns it
  } finally {
    clearTimeout(timer);
  }
}

function put(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number | null) => void,
  /** Cancels the transfer in flight. Only the draft path passes one — the
   *  creator's deliverable and proof uploads keep their exact behaviour. */
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; aborted?: boolean; body?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    /**
     * THE DENOMINATOR IS THE BLOB, NOT THE PLATFORM'S GUESS.
     *
     * `e.total` on Android comes from RequestBodyUtil's
     * `inputStream.available()` (ReactAndroid RequestBodyUtil.kt), which is
     * documented as "bytes that can be read without blocking" — for a large
     * file behind a content:// provider that is a buffer size, not the file
     * size. `e.loaded` counts real bytes written, so it sails past that
     * underestimate: a 66MB video reported 127% and kept climbing.
     *
     * `blob.size` is exactly what we are sending, so it is the only total
     * that can be right. `e.total` stays as a fallback for the case blob.size
     * cannot answer, and the result is clamped either way — a progress bar
     * must never be able to state something impossible.
     */
    const total = blob.size > 0 ? blob.size : 0;
    xhr.upload.onprogress = (e) => {
      const denominator = total > 0 ? total : e.lengthComputable && e.total > 0 ? e.total : 0;
      // null = genuinely unknown. The UI shows an indeterminate state; it
      // must never invent a number to fill the gap.
      onProgress(denominator > 0 ? Math.min(1, Math.max(0, e.loaded / denominator)) : null);
    };
    // `body` carries the storage service's actual refusal (R2/Supabase send
    // an XML or JSON reason) so a failure can be REPORTED with its cause
    // instead of reduced to a bare status number. Additive — the booking
    // path ignores it.
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body: typeof xhr.responseText === 'string' ? xhr.responseText.slice(0, 400) : undefined,
      });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.onabort = () => resolve({ ok: false, status: 0, aborted: true });
    if (signal) {
      if (signal.aborted) {
        resolve({ ok: false, status: 0, aborted: true });
        return;
      }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(blob);
  });
}

export async function uploadRawFile(
  bookingId: string,
  file: { uri: string; name: string; mimeType?: string; sizeBytes?: number },
  onProgress: (fraction: number | null) => void,
): Promise<RawUploadResult> {
  return uploadBookingFile(bookingId, 'raw', file, onProgress);
}

/**
 * The same pipeline, aimed at an upload DRAFT instead of a booking.
 *
 * Remote clients upload the moment they pick, which is before the booking
 * exists — it is created by the Stripe webhook. So the bytes go to a draft
 * and checkout claims them onto the order it creates.
 *
 * Returns the registered row id: the screen needs it to delete the file
 * server-side when a thumbnail's X is tapped. `aborted` distinguishes "the
 * client removed this file" from "the upload broke", so a cancel never
 * renders as a failure the client is invited to retry.
 */
export interface DraftUploadResult extends RawUploadResult {
  mediaId?: string;
  aborted?: boolean;
}

/**
 * What the server said, made safe to put in front of a client.
 *
 * Two kinds of body arrive here. Our own routes reply `{ error: "<human
 * sentence>" }` — those pass through, they were written to be shown. Errors
 * GENERATED by the framework and its plumbing reply `{ statusCode, error:
 * "<HTTP status text>", message }`, and an HTTP status text is about our
 * infrastructure, never about this phone: parroting one of those (507 reads
 * "Insufficient Storage") told people with plenty of free space that their
 * phone was full. Infra-shaped bodies are captured whole to Sentry and shown
 * as a labelled server fault instead.
 */
function draftServerError(json: unknown, status: number, step: string): string {
  const fallback = `Server error (${status}) — not your phone or its storage. Try again in a minute.`;
  const body = (json ?? {}) as Record<string, unknown>;
  if (typeof body.statusCode === 'number' || typeof body.error !== 'string' || !body.error) {
    captureHandledError(
      new Error(`draft ${step} HTTP ${status}: ${JSON.stringify(json)?.slice(0, 400)}`),
      `rawUpload:draft:${step}`,
    );
    return fallback;
  }
  return body.error;
}

export async function uploadDraftFile(
  draftId: string,
  file: { uri: string; name: string; mimeType?: string; sizeBytes?: number },
  onProgress: (fraction: number | null) => void,
  signal?: AbortSignal,
): Promise<DraftUploadResult> {
  if (!apiBase) return { ok: false, error: 'No server configured.' };
  const contentType = file.mimeType ?? 'application/octet-stream';

  let target: { upload_url: string; storage_path: string };
  try {
    const res = await fetchWithDeadline(
      `${apiBase}/v1/upload-drafts/${draftId}/upload-url`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          filename: file.name,
          content_type: contentType,
          size_bytes: file.sizeBytes,
        }),
      },
      'rawUpload:draft:presign-timeout',
    );
    if (res === 'timeout') {
      return { ok: false, error: 'The server is taking too long to answer — it may be waking up. Tap to retry.' };
    }
    const json = (await res.json().catch(() => null)) as
      | { upload_url?: string; storage_path?: string; error?: string }
      | null;
    if (!res.ok || !json?.upload_url || !json?.storage_path) {
      return { ok: false, error: draftServerError(json, res.status, 'presign') };
    }
    target = { upload_url: json.upload_url, storage_path: json.storage_path };
  } catch (err) {
    // These catches used to be bare, which is how a real failure spent weeks
    // wearing whatever message the UI defaulted to. The cause now travels.
    captureHandledError(err, 'rawUpload:draft:presign-network');
    return { ok: false, error: 'Network error starting the upload.' };
  }
  if (signal?.aborted) return { ok: false, aborted: true };

  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch (err) {
    captureHandledError(err, 'rawUpload:draft:read-file');
    return { ok: false, error: "Couldn't read the file off your device." };
  }
  const sent = await put(target.upload_url, blob, contentType, onProgress, signal);
  if (sent.aborted) return { ok: false, aborted: true };
  if (!sent.ok) {
    if (sent.status) {
      captureHandledError(
        new Error(`draft PUT HTTP ${sent.status}: ${sent.body ?? '(no body)'}`),
        'rawUpload:draft:put',
      );
      return {
        ok: false,
        error: `Upload failed on our side (HTTP ${sent.status}) — your phone is fine. Try again in a minute.`,
      };
    }
    return { ok: false, error: 'Upload failed — connection lost.' };
  }

  // Registered = claimable by checkout. An object with no row is invisible
  // to the claim and gets swept, so this step is what makes the upload real.
  try {
    const res = await fetchWithDeadline(
      `${apiBase}/v1/upload-drafts/${draftId}/media`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ storage_path: target.storage_path, content_type: contentType }),
      },
      'rawUpload:draft:register-timeout',
    );
    if (res === 'timeout') {
      // The bytes ARE in storage; only the row is missing. Said that way, so
      // a confirmation stall can never read as the upload itself failing.
      return {
        ok: false,
        error: 'Your file uploaded, but confirming it timed out — the server may be waking up. Tap to retry.',
      };
    }
    const json = (await res.json().catch(() => null)) as
      | { media?: { id: string }; error?: string }
      | null;
    if (!res.ok || !json?.media?.id) {
      return { ok: false, error: draftServerError(json, res.status, 'register') };
    }
    onProgress(1);
    return { ok: true, mediaId: json.media.id };
  } catch (err) {
    captureHandledError(err, 'rawUpload:draft:register-network');
    return { ok: false, error: 'Uploaded, but could not attach to the order.' };
  }
}

/**
 * The same presign → XHR-with-progress → register pipeline for every media
 * kind. The creator's deliverable and proof uploads used to run a separate
 * fetch-based loop with no progress and no per-file retry; there is exactly
 * one upload pattern now.
 */
export async function uploadBookingFile(
  bookingId: string,
  kind: 'raw' | 'deliverable' | 'proof',
  file: { uri: string; name: string; mimeType?: string; sizeBytes?: number },
  onProgress: (fraction: number | null) => void,
): Promise<RawUploadResult> {
  if (!apiBase) return { ok: false, error: 'No server configured.' };
  const contentType = file.mimeType ?? 'application/octet-stream';

  // 1. Presign. The server validates type and size before handing out a URL.
  let target: { upload_url: string; storage_path: string };
  try {
    const res = await fetchWithDeadline(
      `${apiBase}/v1/bookings/${bookingId}/media/upload-url`,
      {
        method: 'POST',
        headers: await authHeaders(),
        // size_bytes lets the server refuse an oversize file BEFORE handing
        // out a presigned URL, rather than after a 700MB round trip.
        body: JSON.stringify({
          kind,
          filename: file.name,
          content_type: contentType,
          size_bytes: file.sizeBytes,
        }),
      },
      'rawUpload:booking:presign-timeout',
    );
    if (res === 'timeout') {
      return { ok: false, error: 'The server is taking too long to answer — it may be waking up. Tap to retry.' };
    }
    const json = (await res.json()) as { upload_url?: string; storage_path?: string; error?: string };
    if (!res.ok || !json.upload_url || !json.storage_path) {
      return { ok: false, error: json.error ?? "Couldn't start the upload." };
    }
    target = { upload_url: json.upload_url, storage_path: json.storage_path };
  } catch (err) {
    captureHandledError(err, 'rawUpload:booking:presign-network');
    return { ok: false, error: 'Network error starting the upload.' };
  }

  // 2. Bytes to storage, device → bucket.
  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch {
    return { ok: false, error: "Couldn't read the file off your device." };
  }
  const sent = await put(target.upload_url, blob, contentType, onProgress);
  if (!sent.ok) {
    return { ok: false, error: sent.status ? `Upload failed (${sent.status}).` : 'Upload failed — connection lost.' };
  }

  // 3. Register. Until this lands the object exists but no creator can see
  // it, so a failure here is a real failure, not a cosmetic one.
  try {
    const res = await fetchWithDeadline(
      `${apiBase}/v1/bookings/${bookingId}/media`,
      {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ kind, storage_path: target.storage_path, content_type: contentType }),
      },
      'rawUpload:booking:register-timeout',
    );
    if (res === 'timeout') {
      return {
        ok: false,
        error: 'Your file uploaded, but confirming it timed out — the server may be waking up. Tap to retry.',
      };
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error ?? 'Uploaded, but could not attach to the order.' };
    }
    // The row id travels back so the file can be taken out again before
    // delivery. A body we cannot parse is not a failure — the file IS
    // registered — it only costs this one file its remove control.
    const body = (await res.json().catch(() => ({}))) as { media?: { id?: string } };
    onProgress(1);
    return { ok: true, mediaId: body?.media?.id };
  } catch (err) {
    captureHandledError(err, 'rawUpload:booking:register-network');
    return { ok: false, error: 'Uploaded, but could not attach to the order.' };
  }
}
