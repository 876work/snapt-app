import { apiBase, authHeaders } from './api';

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
}

function put(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (fraction: number) => void,
  /** Cancels the transfer in flight. Only the draft path passes one — the
   *  creator's deliverable and proof uploads keep their exact behaviour. */
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; aborted?: boolean }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
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
  onProgress: (fraction: number) => void,
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

export async function uploadDraftFile(
  draftId: string,
  file: { uri: string; name: string; mimeType?: string; sizeBytes?: number },
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<DraftUploadResult> {
  if (!apiBase) return { ok: false, error: 'No server configured.' };
  const contentType = file.mimeType ?? 'application/octet-stream';

  let target: { upload_url: string; storage_path: string };
  try {
    const res = await fetch(`${apiBase}/v1/upload-drafts/${draftId}/upload-url`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        filename: file.name,
        content_type: contentType,
        size_bytes: file.sizeBytes,
      }),
    });
    const json = (await res.json()) as { upload_url?: string; storage_path?: string; error?: string };
    if (!res.ok || !json.upload_url || !json.storage_path) {
      return { ok: false, error: json.error ?? "Couldn't start the upload." };
    }
    target = { upload_url: json.upload_url, storage_path: json.storage_path };
  } catch {
    return { ok: false, error: 'Network error starting the upload.' };
  }
  if (signal?.aborted) return { ok: false, aborted: true };

  let blob: Blob;
  try {
    blob = await (await fetch(file.uri)).blob();
  } catch {
    return { ok: false, error: "Couldn't read the file off your device." };
  }
  const sent = await put(target.upload_url, blob, contentType, onProgress, signal);
  if (sent.aborted) return { ok: false, aborted: true };
  if (!sent.ok) {
    return { ok: false, error: sent.status ? `Upload failed (${sent.status}).` : 'Upload failed — connection lost.' };
  }

  // Registered = claimable by checkout. An object with no row is invisible
  // to the claim and gets swept, so this step is what makes the upload real.
  try {
    const res = await fetch(`${apiBase}/v1/upload-drafts/${draftId}/media`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ storage_path: target.storage_path, content_type: contentType }),
    });
    const json = (await res.json().catch(() => ({}))) as { media?: { id: string }; error?: string };
    if (!res.ok || !json.media?.id) {
      return { ok: false, error: json.error ?? 'Uploaded, but could not attach to the order.' };
    }
    onProgress(1);
    return { ok: true, mediaId: json.media.id };
  } catch {
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
  onProgress: (fraction: number) => void,
): Promise<RawUploadResult> {
  if (!apiBase) return { ok: false, error: 'No server configured.' };
  const contentType = file.mimeType ?? 'application/octet-stream';

  // 1. Presign. The server validates type and size before handing out a URL.
  let target: { upload_url: string; storage_path: string };
  try {
    const res = await fetch(`${apiBase}/v1/bookings/${bookingId}/media/upload-url`, {
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
    });
    const json = (await res.json()) as { upload_url?: string; storage_path?: string; error?: string };
    if (!res.ok || !json.upload_url || !json.storage_path) {
      return { ok: false, error: json.error ?? "Couldn't start the upload." };
    }
    target = { upload_url: json.upload_url, storage_path: json.storage_path };
  } catch {
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
    const res = await fetch(`${apiBase}/v1/bookings/${bookingId}/media`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ kind, storage_path: target.storage_path, content_type: contentType }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error ?? 'Uploaded, but could not attach to the order.' };
    }
  } catch {
    return { ok: false, error: 'Uploaded, but could not attach to the order.' };
  }
  onProgress(1);
  return { ok: true };
}
