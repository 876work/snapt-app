import { captureHandledError } from './sentry';

/**
 * CLIENT SOURCE VIDEO, MADE UPLOADABLE ON A CARIBBEAN UPLINK.
 *
 * A 66MB phone clip on a ~1–2 Mbps residential uplink is five to ten minutes
 * of progress bar — that transfer, not the server, is the product's real
 * bottleneck. This shrinks CLIENT SOURCE UPLOADS ONLY, before the bytes
 * leave the phone.
 *
 * NEVER wired into creator uploads: deliverables, finished edits, proofs,
 * raw session footage, portfolio images. Those are the product — a finished
 * edit recompressed on its way to the paying client is generational loss we
 * charged money for. The one call site is the client upload-draft flow.
 *
 * SETTINGS, and why: H.264, long edge capped at 1920, video bitrate
 * 3.5 Mbps (react-native-compressor 'manual'; its 'auto' guesses a bitrate
 * from the source, and its DEFAULT maxSize is 640 — unset, it would butcher
 * footage to thumbnail resolution). 1080p at 3.5 Mbps keeps typical phone
 * footage — daylight, steady subjects — visually clean while cutting an
 * 8–17 Mbps camera original to roughly a quarter: a 66MB minute lands
 * around 27MB, a 4K clip far lower. Deliberately NOT maximum compression:
 * these files are edited afterwards, so quality headroom wins over the last
 * few MB.
 */
export const COMPRESS_MIN_BYTES = 8 * 1024 * 1024;
export const TARGET_VIDEO_BITRATE = 3_500_000;
export const TARGET_MAX_DIMENSION = 1920;

/** Extensions that mean video when the picker supplied no mimeType. */
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', '3gp', 'avi', 'mkv', 'webm']);

/**
 * Should this file go through the encoder at all? Pure and exported so the
 * decision — not just the arithmetic — is testable off-device.
 *
 * Below COMPRESS_MIN_BYTES the transfer is already tolerable and an encode
 * costs battery and minutes for single-digit savings: don't transcode for
 * ritual. Photos are out of scope entirely.
 */
export function isCompressibleVideo(opts: {
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}): boolean {
  if (!opts.sizeBytes || opts.sizeBytes < COMPRESS_MIN_BYTES) return false;
  if (opts.mimeType) return opts.mimeType.startsWith('video/');
  const ext = (opts.name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXTENSIONS.has(ext);
}

/**
 * The keep-or-discard decision, after the encoder has spoken. Pure and
 * exported for the same reason as above.
 *
 * A result that failed to measure, didn't shrink, or IS the source file
 * (the library can hand back the input path) means the original uploads —
 * by design, not as an error, so no user-facing note.
 */
export function shouldUseCompressed(opts: {
  originalBytes: number;
  compressedBytes: number | null;
  compressedIsSameFile: boolean;
}): boolean {
  if (opts.compressedIsSameFile) return false;
  if (opts.compressedBytes == null || opts.compressedBytes <= 0) return false;
  return opts.compressedBytes < opts.originalBytes;
}

export interface PreparedUpload {
  uri: string;
  sizeBytes: number;
  /** True when the original is being sent — skipped, no-gain, or fallback. */
  usedOriginal: boolean;
  /** The user cancelled mid-prepare; nothing should upload. */
  aborted?: boolean;
  /**
   * Set ONLY when compression FAILED and the original is uploading instead —
   * the visible note the spec requires. The by-design skips (small file,
   * no gain) say nothing: sending the original was the correct outcome.
   */
  fallbackNote?: string;
}

const normalizeUri = (p: string) => (p.startsWith('file://') ? p : `file://${p}`);

/** Never throws. Reads a local file's size, null when it can't be known. */
async function fileSizeOf(uri: string): Promise<number | null> {
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const size = new FS.File(normalizeUri(uri)).size;
    return typeof size === 'number' && size > 0 ? size : null;
  } catch (err) {
    captureHandledError(err, 'videoCompress:measure');
    return null;
  }
}

/** Delete a temp encode. Never throws, never silent — cleanup must not fail
 *  the upload, and a failing cleanup must not be invisible either. */
async function discardTemp(uri: string): Promise<void> {
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const file = new FS.File(normalizeUri(uri));
    if (file.exists) file.delete();
  } catch (err) {
    captureHandledError(err, 'videoCompress:discard_temp');
  }
}

/**
 * The caller's cleanup hook, for EVERY exit of the upload attempt — success,
 * failure and abort alike. A no-op when the prepared file IS the original
 * (nothing temporary exists to remove); the picked original is never
 * deleted here — its lifecycle belongs to the picker cache.
 */
export async function discardPrepared(preparedUri: string, originalUri: string): Promise<void> {
  if (normalizeUri(preparedUri) === normalizeUri(originalUri)) return;
  await discardTemp(preparedUri);
}

/**
 * Compress one client source video, or explain why the original is going up
 * instead. Every path returns something uploadable; the only exception is a
 * user-driven abort, flagged so the caller stops entirely.
 */
export async function prepareVideoForUpload(
  file: { uri: string; name?: string; mimeType?: string; sizeBytes: number },
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<PreparedUpload> {
  const original: PreparedUpload = {
    uri: file.uri,
    sizeBytes: file.sizeBytes,
    usedOriginal: true,
  };
  if (opts.signal?.aborted) return { ...original, aborted: true };
  if (!isCompressibleVideo(file)) return original;

  let cancellationId: string | null = null;
  let cancelledByUs = false;
  const onAbort = () => {
    cancelledByUs = true;
    if (cancellationId) {
      // Fire-and-forget into the native encoder; the compress promise
      // settles (rejects) as a result and the catch below routes it.
      import('react-native-compressor')
        .then(({ Video }) => Video.cancelCompression(cancellationId as string))
        .catch((err) => captureHandledError(err, 'videoCompress:cancel'));
    }
  };
  opts.signal?.addEventListener('abort', onAbort);

  try {
    const { Video } = await import('react-native-compressor');
    const resultPath = await Video.compress(
      file.uri,
      {
        compressionMethod: 'manual',
        maxSize: TARGET_MAX_DIMENSION,
        bitrate: TARGET_VIDEO_BITRATE,
        getCancellationId: (id) => {
          cancellationId = id;
          // The abort may have fired while the encoder was still starting.
          if (opts.signal?.aborted) onAbort();
        },
      },
      (progress) => opts.onProgress?.(Math.min(1, Math.max(0, progress))),
    );

    if (opts.signal?.aborted) {
      // Cancelled after the encoder finished: the temp exists — remove it.
      await discardTemp(resultPath);
      return { ...original, aborted: true };
    }

    const compressedBytes = await fileSizeOf(resultPath);
    const compressedIsSameFile = normalizeUri(resultPath) === normalizeUri(file.uri);
    if (
      !shouldUseCompressed({
        originalBytes: file.sizeBytes,
        compressedBytes,
        compressedIsSameFile,
      })
    ) {
      // Grew, unmeasurable, or the library returned the input — the encode
      // gained nothing, so the original goes. By design; no note, no error.
      if (!compressedIsSameFile) await discardTemp(resultPath);
      return original;
    }
    return { uri: normalizeUri(resultPath), sizeBytes: compressedBytes as number, usedOriginal: false };
  } catch (err) {
    if (cancelledByUs || opts.signal?.aborted) {
      // The reject IS the cancellation we asked for — not a failure. The
      // native side stops writing; there is no result path to clean.
      return { ...original, aborted: true };
    }
    // A real failure. The upload must not be lost to an optimization: the
    // original goes up, visibly noted — never silently.
    captureHandledError(err, 'videoCompress:compress');
    return {
      ...original,
      fallbackNote: "couldn't be optimized — uploading the original at full size",
    };
  } finally {
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
