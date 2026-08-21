import { Alert, Linking } from 'react-native';
import { captureHandledError } from './sentry';
import { resolveExtension, utiFor } from './mediaExtension';

/**
 * SAVE A REMOTE FILE TO THE CAMERA ROLL.
 *
 * One implementation. There were two — the creator's source-file download and
 * the client's delivery download — copy-pasted from each other and carrying
 * the same four defects, which is how they survived being reported once
 * already. Both screens call this now.
 *
 * What was wrong, in the order it bit people:
 *
 *  1. `File.downloadFileAsync` REJECTS when the destination already exists
 *     unless `idempotent` is set, and neither copy set it. So the first
 *     attempt that left anything in the cache made every later tap fail at
 *     the download step — permanently, for that file, no matter what. The
 *     message said "try again", which was the one thing that could not work.
 *
 *  2. The error was thrown away by a bare `catch {}`, so the actual reason
 *     existed nowhere: not on screen, not in a log, not in Sentry.
 *
 *  3. Permission was requested AFTER downloading, so a refusal left a cached
 *     file behind and (1) locked the file out for good.
 *
 *  4. Signed URLs last an hour (createDownloadUrl, expiresIn 3600) and the
 *     listing is fetched once on mount. A creator with a job open longer than
 *     that is holding dead links — while the thumbnails still render, because
 *     React Native's Image cache is serving pixels it decoded an hour ago. A
 *     rendered thumbnail was never evidence the URL still worked.
 */

export type SaveFailure =
  | 'permission'
  | 'permission_blocked'
  | 'download'
  /** The phone is genuinely full — established, never assumed. */
  | 'storage'
  | 'save';

export type SaveResult = { ok: true } | { ok: false; kind: SaveFailure; message: string };

/**
 * Extensions the photo library can actually make sense of.
 *
 * This used to trust the FILENAME first and only consult the content type
 * when the name had no extension at all. That is backwards, and it is what
 * made videos unsaveable: the uploader's fallback name was a hardcoded
 * `.jpg`, so a QuickTime file arrived here called `.jpg` with
 * `content_type: video/quicktime`, the name won, and iOS took the image
 * branch on video bytes and refused it.
 *
 * The rule now lives in lib/mediaExtension and is the same one on both
 * sides of the pipeline: CONTENT TYPE WINS when the two disagree.
 */
function extensionFor(name: string, contentType?: string | null): string {
  return resolveExtension(name, contentType);
}

/**
 * A NAME SOMEONE CAN FIND AGAIN.
 *
 * The stored name is a UUID, which in a camera roll of ten thousand photos is
 * indistinguishable from noise. This produces "Snapt-Portraits-2026-08-12-3.jpg".
 */
export function photoFilename(opts: {
  /** Occasion, tier, "Delivery" — whatever this file is of. */
  subject?: string | null;
  /** ISO date of the booking or delivery. Falls back to nothing. */
  date?: string | null;
  /** 1-based position within the set. */
  index?: number;
  /** Original name, only for its extension. */
  originalName?: string;
  contentType?: string | null;
}): string {
  const parts = ['Snapt'];
  const subject = (opts.subject ?? '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
  if (subject) parts.push(subject);
  const day = (opts.date ?? '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) parts.push(day);
  if (opts.index != null) parts.push(String(opts.index));
  return `${parts.join('-')}.${extensionFor(opts.originalName ?? '', opts.contentType)}`;
}

async function ensurePermission(): Promise<SaveResult | null> {
  const MediaLibrary = await import('expo-media-library');
  // writeOnly: saving needs permission to ADD, not to read someone's library.
  // On iOS that is the narrower "Add Photos Only" prompt.
  const current = await MediaLibrary.getPermissionsAsync(true);
  if (current.granted) return null;
  if (!current.canAskAgain) {
    return {
      ok: false,
      kind: 'permission_blocked',
      message: 'Snapt needs permission to add photos to your library. Turn it on in Settings to save this file.',
    };
  }
  const asked = await MediaLibrary.requestPermissionsAsync(true);
  if (asked.granted) return null;
  return {
    ok: false,
    kind: 'permission',
    message: asked.canAskAgain
      ? 'Snapt needs permission to add photos to save this file. Tap download again and choose Allow.'
      : 'Snapt needs permission to add photos to your library. Turn it on in Settings to save this file.',
  };
}

/**
 * IS THE PHONE ACTUALLY FULL?
 *
 * Asked, never assumed. The old copy asserted "check you have storage space
 * free" for every possible write failure, which is precisely how a hard
 * deprecation error read as a full phone to the person holding it.
 *
 * Two independent signals, cheapest first: an explicit out-of-space error
 * from the OS, then a real free-space reading compared against the file we
 * are trying to hand over. Anything that cannot be established returns
 * false, so the caller says something honest instead of guessing again.
 *
 * Runs inside the catch, before the `finally` discards the cache copy, so
 * the file is still there to measure.
 */
async function outOfSpace(err: unknown, localUri: string): Promise<boolean> {
  const e = err as { code?: unknown; message?: unknown } | null;
  const text = `${String(e?.code ?? '')} ${String(e?.message ?? '')}`.toLowerCase();
  if (/enospc|no space left|out of space|not enough space|insufficient (disk )?space/.test(text)) {
    return true;
  }
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const free = FS.Paths.availableDiskSpace;
    const size = new FS.File(localUri).size;
    if (typeof free === 'number' && typeof size === 'number' && size > 0 && free < size) {
      return true;
    }
  } catch {
    // No reading available — say nothing about storage rather than invent it.
  }
  return false;
}

/** Offered only once the OS will no longer ask — same rule as camera capture. */
export function offerSettings(result: SaveResult): void {
  if (result.ok || result.kind !== 'permission_blocked') return;
  Alert.alert('Photo access is off', result.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
  ]);
}

/**
 * THE CACHE COPY HAS TO GO AWAY AGAIN.
 *
 * downloadTo writes a full-size copy of the file into the cache directory,
 * and nothing ever removed it. Saving a delivery therefore cost the phone
 * TWICE the file: once in the photo library, where the client wanted it, and
 * once here forever. On a video delivery that is hundreds of megabytes per
 * tap, and the client has no way to see it, let alone clear it.
 *
 * Two different lifetimes, because the two paths genuinely differ:
 *
 *  - SAVING can delete immediately. saveToLibraryAsync has finished copying
 *    into the library before it resolves, so our copy is already redundant.
 *
 *  - SHARING cannot. expo-sharing hands the target app a URI and resolves as
 *    the sheet closes — WhatsApp may still be reading when we get control
 *    back. Deleting there would break sharing to fix a cache leak. Those
 *    copies age out on the next download instead.
 *
 * The sweep also collects the partial file an interrupted download can leave
 * behind on Android (documented on File.downloadFileAsync).
 */
const CACHE_GRACE_MS = 10 * 60 * 1000;

/** Only ever files this module wrote — photoFilename always names them 'Snapt…'. */
function isOurCacheFile(name: string): boolean {
  return name.startsWith('Snapt-') || name.startsWith('Snapt.');
}

/** Delete one cache copy. Never throws: cleanup must not fail the operation. */
async function discardCached(uri: string): Promise<void> {
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const file = new FS.File(uri);
    if (file.exists) file.delete();
  } catch {
    // A leftover temp file is a much smaller problem than turning someone's
    // successful save into an error.
  }
}

/** Remove our aged-out cache copies. `keepUri` is never touched. */
async function sweepDownloadCache(keepUri?: string): Promise<void> {
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const now = Date.now();
    for (const entry of FS.Paths.cache.list()) {
      if (!(entry instanceof FS.File)) continue;
      if (!isOurCacheFile(entry.name)) continue;
      if (keepUri && entry.uri === keepUri) continue;
      // Unknown age (null) counts as brand new: never delete what we cannot
      // date, or a file still being shared could vanish mid-read.
      if (now - (entry.lastModified ?? now) < CACHE_GRACE_MS) continue;
      try {
        entry.delete();
      } catch {
        // Busy or already gone — the next sweep gets it.
      }
    }
  } catch {
    // A cache sweep must never break the download it runs before.
  }
}

export async function downloadTo(url: string, filename: string): Promise<string> {
  const FS = (await import('expo-file-system')) as Record<string, any>;
  // Collect what earlier saves and shares left behind BEFORE adding to it.
  await sweepDownloadCache();
  // Destination is a FILE, not a directory. Handing over a directory lets the
  // library name the file from the response headers — and an R2 presigned GET
  // sends no Content-Disposition, so the name (and, more dangerously, the
  // extension the photo library needs to identify the media) came from the
  // URL path. Naming it ourselves settles both.
  const target = new FS.File(FS.Paths.cache, filename);
  // idempotent: a second attempt overwrites instead of rejecting. Without it
  // the retry this screen invites is the one action guaranteed to fail.
  const file = await FS.File.downloadFileAsync(url, target, { idempotent: true });
  return file.uri;
}

export async function saveToPhotos(opts: {
  url: string;
  filename: string;
  /**
   * Re-presign and return a fresh URL. Signed links last an hour and the
   * listing is fetched once on mount, so the expired case is ordinary rather
   * than exceptional — worth one silent retry before troubling anyone.
   */
  refreshUrl?: () => Promise<string | null>;
  /** For the Sentry breadcrumb — never a filename or a URL. */
  context: string;
}): Promise<SaveResult> {
  // BEFORE the download, so a refusal cannot leave a file behind.
  const denied = await ensurePermission();
  if (denied) return denied;

  let localUri: string | null = null;
  try {
    localUri = await downloadTo(opts.url, opts.filename);
  } catch (first) {
    // Most likely an expired signature. Ask for a fresh URL and try once more.
    let fresh: string | null = null;
    try {
      fresh = (await opts.refreshUrl?.()) ?? null;
    } catch {
      fresh = null;
    }
    if (fresh && fresh !== opts.url) {
      try {
        localUri = await downloadTo(fresh, opts.filename);
      } catch (second) {
        captureHandledError(second, `saveToPhotos:download_after_refresh:${opts.context}`);
        return {
          ok: false,
          kind: 'download',
          message: "Couldn't download that file — check your connection, then try again.",
        };
      }
    } else {
      captureHandledError(first, `saveToPhotos:download:${opts.context}`);
      return {
        ok: false,
        kind: 'download',
        message: "Couldn't download that file — check your connection, then try again.",
      };
    }
  }

  try {
    /**
     * IMPORTED FROM '/legacy' DELIBERATELY — this import path IS the bug fix.
     *
     * expo-media-library 57 moved to a class-based API, and its ROOT export
     * re-exports a set of legacy shims that throw unconditionally
     * (`export * from './legacyWarnings'`, src/index.ts:161):
     *
     *     export async function saveToLibraryAsync(localUri: string) {
     *       throw errorOnLegacyMethodUse('saveToLibraryAsync');
     *     }
     *
     * So the previous root import never reached the native module at all.
     * EVERY save on every screen failed 100% of the time, and the catch
     * below dressed that deprecation error up as a full phone.
     *
     * getPermissionsAsync/requestPermissionsAsync are NOT shims — they
     * survive in the new API with the same signature, which is why the
     * permission prompt kept working and disguised how total this was.
     *
     * The legacy NATIVE module is still compiled into the binary, so this
     * reaches real code on the existing build with no rebuild.
     */
    const { saveToLibraryAsync } = await import('expo-media-library/legacy');
    await saveToLibraryAsync(localUri);
    return { ok: true };
  } catch (err) {
    // The write itself failed — a genuinely different problem from a failed
    // download, and one that used to wear the same message.
    captureHandledError(err, `saveToPhotos:write:${opts.context}`);
    if (await outOfSpace(err, localUri)) {
      return {
        ok: false,
        kind: 'storage',
        message: 'Your phone is out of storage, so there was nowhere to put this file. Free some space and try again.',
      };
    }
    // NO INVENTED CAUSE. We know the library refused it and we do not know
    // why, so that is exactly what this says — the reason is already on its
    // way to Sentry above.
    return {
      ok: false,
      kind: 'save',
      message: "Downloaded, but your photo library wouldn't accept this file. The reason has been reported — try again, and tell us if it keeps happening.",
    };
  } finally {
    // Either the library took its own copy or it refused the file. Ours is
    // dead weight in both cases — and on a refusal caused by a full phone,
    // keeping it would be actively making the reported problem worse.
    await discardCached(localUri);
  }
}

/**
 * SHARE THE SAME LOCAL FILE THE SAVE PATH PRODUCES.
 *
 * Deliberately built on downloadTo and the same filename rules, so a client
 * sending photos to WhatsApp gets the identical file the camera roll would —
 * and there is one download implementation, not two.
 *
 * Needs no photo-library permission: nothing is written to the library.
 */
export async function shareFile(opts: {
  url: string;
  filename: string;
  mimeType?: string | null;
  refreshUrl?: () => Promise<string | null>;
  context: string;
}): Promise<SaveResult> {
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) {
    return {
      ok: false,
      kind: 'save',
      message: "Sharing isn't available on this device. You can still save to your photos.",
    };
  }

  let localUri: string;
  try {
    localUri = await downloadTo(opts.url, opts.filename);
  } catch (first) {
    // Same expired-signature dance as saving: one silent re-presign.
    let fresh: string | null = null;
    try {
      fresh = (await opts.refreshUrl?.()) ?? null;
    } catch {
      fresh = null;
    }
    if (!fresh || fresh === opts.url) {
      captureHandledError(first, `shareFile:download:${opts.context}`);
      return {
        ok: false,
        kind: 'download',
        message: "Couldn't download that file — check your connection, then try again.",
      };
    }
    try {
      localUri = await downloadTo(fresh, opts.filename);
    } catch (second) {
      captureHandledError(second, `shareFile:download_after_refresh:${opts.context}`);
      return {
        ok: false,
        kind: 'download',
        message: "Couldn't download that file — check your connection, then try again.",
      };
    }
  }

  try {
    await Sharing.shareAsync(localUri, {
      mimeType: opts.mimeType ?? undefined,
      // Same rule as the save path: the content type is authoritative, and
      // the mapping lives in lib/mediaExtension — a shared video used to be
      // declared `public.jpeg` here by a substring test on the mime type.
      UTI: utiFor(opts.filename, opts.mimeType),
    });
    return { ok: true };
  } catch (err) {
    // Dismissing the share sheet is not an error worth reporting as one, but
    // we cannot tell dismissal from failure here — so report quietly and say
    // nothing alarming.
    captureHandledError(err, `shareFile:share:${opts.context}`);
    return { ok: false, kind: 'save', message: "Couldn't open the share sheet." };
  } finally {
    // Everything EXCEPT the file just handed over — the target app may still
    // be reading that one. It ages out on the next download.
    void sweepDownloadCache(localUri);
  }
}
