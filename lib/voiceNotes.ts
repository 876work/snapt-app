import { apiBase, authHeaders } from './api';
import { captureHandledError } from './sentry';
import { sendVoiceMessage, type ChatMessage } from './chat';

/**
 * Voice-note upload + playback-URL plumbing.
 *
 * Same shape as every other upload in the app (lib/rawUpload.ts): presign →
 * PUT straight to storage → then make it real. The one difference is what
 * "make it real" means — a voice note's registration IS the message row,
 * inserted client-side under the same RLS as a text message, and only after
 * the bytes are safely in storage. A row without bytes would be a bubble
 * that can never play; bytes without a row are invisible and harmless.
 *
 * Failures return a typed stage + human sentence — the bubble shows the
 * sentence, Sentry gets the cause. No failure is silent (handoff rule §6.3).
 */

export const VOICE_CONTENT_TYPE = 'audio/m4a';
export const MAX_VOICE_SECONDS = 120;

export interface VoiceSendFailure {
  ok: false;
  /** Which step broke — Retry re-runs the whole pipeline either way. */
  stage: 'presign' | 'read' | 'upload' | 'insert';
  error: string;
}
export type VoiceSendResult = { ok: true; message: ChatMessage } | VoiceSendFailure;

function put(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<{ ok: boolean; status: number; body?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () =>
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        body: typeof xhr.responseText === 'string' ? xhr.responseText.slice(0, 400) : undefined,
      });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.send(blob);
  });
}

/**
 * The whole send: read bytes → presign (server enforces type + 20 MB and
 * signs the EXACT length) → PUT → insert the message row. The caller owns
 * the optimistic bubble; this function never throws.
 */
export async function sendVoiceNote(
  bookingId: string,
  fileUri: string,
  durationSeconds: number,
  onProgress?: (fraction: number) => void,
): Promise<VoiceSendResult> {
  if (!apiBase) return { ok: false, stage: 'presign', error: 'No server configured.' };

  let blob: Blob;
  try {
    blob = await (await fetch(fileUri)).blob();
  } catch (err) {
    captureHandledError(err, 'voiceNotes:read-file');
    return { ok: false, stage: 'read', error: "Couldn't read the recording off your device." };
  }

  let target: { upload_url: string; storage_path: string };
  try {
    const res = await fetch(`${apiBase}/v1/messages/${bookingId}/voice/upload-url`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        content_type: VOICE_CONTENT_TYPE,
        size_bytes: blob.size,
        duration_seconds: Math.max(1, Math.round(durationSeconds)),
      }),
    });
    const json = (await res.json().catch(() => null)) as
      | { upload_url?: string; storage_path?: string; error?: string }
      | null;
    if (!res.ok || !json?.upload_url || !json?.storage_path) {
      // Our routes reply { error: "<human sentence>" } — show it. Anything
      // framework-shaped gets captured and generalized (same rule as
      // rawUpload's draftServerError).
      const human =
        json && typeof json.error === 'string' && json.error && !('statusCode' in json)
          ? json.error
          : `Server error (${res.status}) — not your phone. Try again in a minute.`;
      if (human !== json?.error) {
        captureHandledError(
          new Error(`voice presign HTTP ${res.status}: ${JSON.stringify(json)?.slice(0, 400)}`),
          'voiceNotes:presign',
        );
      }
      return { ok: false, stage: 'presign', error: human };
    }
    target = { upload_url: json.upload_url, storage_path: json.storage_path };
  } catch (err) {
    captureHandledError(err, 'voiceNotes:presign-network');
    return { ok: false, stage: 'presign', error: 'Not sent — check your connection.' };
  }

  const sent = await put(target.upload_url, blob, VOICE_CONTENT_TYPE, onProgress);
  if (!sent.ok) {
    if (sent.status) {
      captureHandledError(
        new Error(`voice PUT HTTP ${sent.status}: ${sent.body ?? '(no body)'}`),
        'voiceNotes:put',
      );
      return {
        ok: false,
        stage: 'upload',
        error: `Upload failed on our side (HTTP ${sent.status}) — your phone is fine. Try again.`,
      };
    }
    return { ok: false, stage: 'upload', error: 'Not sent — connection lost. Tap to retry.' };
  }

  const message = await sendVoiceMessage(bookingId, target.storage_path, durationSeconds);
  if (!message) {
    // Bytes are in storage but the row insert was refused (connection, RLS,
    // signed-out). Retry re-runs the pipeline; the orphaned object is
    // harmless — nothing references it.
    captureHandledError(new Error('voice message insert refused'), 'voiceNotes:insert');
    return { ok: false, stage: 'insert', error: 'Not sent — check your connection, then tap retry.' };
  }
  onProgress?.(1);
  return { ok: true, message };
}

/**
 * Playback URL, minted at play time — never stored, expires in an hour.
 * Returns null on any failure; the bubble renders a visible error + retry.
 */
export async function fetchVoiceUrl(bookingId: string, path: string): Promise<string | null> {
  if (!apiBase) return null;
  try {
    const res = await fetch(
      `${apiBase}/v1/messages/${bookingId}/voice/url?path=${encodeURIComponent(path)}`,
      { headers: await authHeaders() },
    );
    const json = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!res.ok || !json?.url) {
      captureHandledError(new Error(`voice url HTTP ${res.status}`), 'voiceNotes:url');
      return null;
    }
    return json.url;
  } catch (err) {
    captureHandledError(err, 'voiceNotes:url-network');
    return null;
  }
}
