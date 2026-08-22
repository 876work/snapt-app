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
  } catch (err) {
    // No reading available — say nothing about storage rather than invent it.
    // Reported because it decides which message the person sees: without a
    // free-space reading a genuinely full phone is described as something else.
    captureHandledError(err, 'saveToPhotos:free_space_probe');
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

/**
 * WHICH CACHE PATHS AN OPERATION IS STILL USING.
 *
 * Saving and sharing the same delivered file produce the SAME cache path —
 * both name it through photoFilename with identical arguments — and nothing
 * coordinated them. Two consequences, both of which end with a file
 * disappearing from under whoever else was holding it:
 *
 *   - downloadTo writes with `idempotent: true`, so a share starting while a
 *     save is mid-write overwrites the destination the save is about to hand
 *     to the photo library.
 *   - saveToPhotos' finally discards its copy unconditionally, including one
 *     a share had just handed to another app.
 *
 * Share is the path with no in-flight guard of its own — the delivery
 * screen's useSaveStates covers saving only — so this is where the two are
 * reconciled. A claimed path is never overwritten, never swept, and never
 * discarded by anyone but its last holder.
 */
const inUse = new Map<string, number>();

function claimCached(uri: string): void {
  inUse.set(uri, (inUse.get(uri) ?? 0) + 1);
}

function releaseCached(uri: string | null): void {
  if (!uri) return;
  const next = (inUse.get(uri) ?? 0) - 1;
  if (next > 0) inUse.set(uri, next);
  else inUse.delete(uri);
}

function isClaimed(uri: string): boolean {
  return (inUse.get(uri) ?? 0) > 0;
}

/** Distinct destination when the wanted one is being read by someone else. */
let cacheSeq = 0;
function sidestepName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  return `${stem}-${Date.now()}-${cacheSeq++}${ext}`;
}

/** Delete one cache copy. Never throws: cleanup must not fail the operation. */
async function discardCached(uri: string): Promise<void> {
  // Someone else is still reading this exact file — deleting it here is the
  // bug this registry exists to stop.
  if (isClaimed(uri)) return;
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    const file = new FS.File(uri);
    if (file.exists) file.delete();
  } catch (err) {
    // A leftover temp file is a much smaller problem than turning someone's
    // successful save into an error — but it is not nothing, so it is
    // reported rather than swallowed.
    captureHandledError(err, 'saveToPhotos:discard_cached');
  }
}

/**
 * Does the cache copy still exist?
 *
 * Library/Caches is PURGEABLE BY THE OS: iOS may reclaim anything in it at
 * any moment, including between our download finishing and the photo library
 * opening the file. Nothing in this module can prevent that, so it has to be
 * survivable instead.
 *
 * Unknown answers true: a failed existence check must never invent a missing
 * file and turn a working save into an error.
 */
async function cacheFileExists(uri: string): Promise<boolean> {
  try {
    const FS = (await import('expo-file-system')) as Record<string, any>;
    return Boolean(new FS.File(uri).exists);
  } catch (err) {
    captureHandledError(err, 'saveToPhotos:exists_check');
    return true;
  }
}

/** The native side could not open the path we gave it. */
function looksMissing(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const text = `${String(e?.code ?? '')} ${String(e?.message ?? '')}`.toLowerCase();
  return /missingfile|couldn'?t open file|could not open file|no such file|enoent|does not exist/.test(
    text,
  );
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
      // Claimed by a save or share that has not finished with it.
      if (isClaimed(entry.uri)) continue;
      // Unknown age (null) counts as brand new: never delete what we cannot
      // date, or a file still being shared could vanish mid-read.
      if (now - (entry.lastModified ?? now) < CACHE_GRACE_MS) continue;
      try {
        entry.delete();
      } catch {
        // Busy or already gone — the next sweep gets it.
      }
    }
  } catch (err) {
    // A cache sweep must never break the download it runs before — but a
    // sweep that cannot run AT ALL means the cache grows without limit, and
    // that is worth knowing about. The per-file delete inside the loop is
    // deliberately NOT reported: "busy or already gone" is its ordinary
    // outcome and one event per file per sweep would be noise, not signal.
    captureHandledError(err, 'saveToPhotos:sweep');
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
  let target = new FS.File(FS.Paths.cache, filename);
  /**
   * NEVER WRITE OVER A FILE SOMEONE ELSE IS READING.
   *
   * `idempotent` overwrites the destination, which is right for a retry of
   * OUR OWN download and wrong when a different operation is mid-read of
   * that exact path — saving and sharing the same delivered file resolve to
   * the same name. That collision is one of the two ways the file handed to
   * saveToLibraryAsync could vanish. A sidestepped name costs one extra
   * cache copy, which the sweep collects; overwriting costs someone their
   * save.
   */
  if (isClaimed(target.uri)) {
    target = new FS.File(FS.Paths.cache, sidestepName(filename));
  }
  // idempotent: a second attempt overwrites instead of rejecting. Without it
  // the retry this screen invites is the one action guaranteed to fail.
  const file = await FS.File.downloadFileAsync(url, target, { idempotent: true });
  // Claimed for the CALLER, who must releaseCached() it — both callers do so
  // in a finally, so no path stays claimed past the operation that wanted it.
  claimCached(file.uri);
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
    } catch (err) {
      // A re-presign that throws is why the retry below cannot happen; the
      // caller only ever sees "couldn't download", so the actual reason has
      // to leave the device some other way.
      captureHandledError(err, `saveToPhotos:refresh_url:${opts.context}`);
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

  // Definitely a string by here: every path above either assigned it or
  // returned. `path` is what the rest of this function reads, because a
  // re-download replaces it.
  let path = localUri as string;

  /**
   * One re-download, at most, shared by both missing-file paths below.
   * Re-presigns first where the caller can: an hour-old signed URL is the
   * ordinary reason a second fetch would fail.
   */
  let redownloaded = false;
  const redownload = async (): Promise<boolean> => {
    if (redownloaded) return false;
    redownloaded = true;
    try {
      const fresh = (await opts.refreshUrl?.()) ?? null;
      releaseCached(path);
      path = await downloadTo(fresh ?? opts.url, opts.filename);
      return true;
    } catch (err) {
      captureHandledError(err, `saveToPhotos:redownload:${opts.context}`);
      return false;
    }
  };

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
    /**
     * THE FILE CAN BE GONE BY NOW, and used to fail as MissingFileException
     * with a message inventing a photo-library refusal. Two real causes, and
     * this survives both rather than guessing between them: iOS purging
     * Library/Caches (nothing here can prevent that), and a concurrent share
     * overwriting or discarding the same path (the claim registry above now
     * prevents that).
     *
     * Checked first because it is cheap, and retried on the native error too
     * because the check cannot close the gap between itself and the open.
     * ONE re-download only — a file that will not survive two attempts is a
     * real failure and gets said so.
     */
    if (!(await cacheFileExists(path))) {
      captureHandledError(
        new Error('cache copy was gone before the save'),
        `saveToPhotos:cache_missing:${opts.context}`,
      );
      if (!(await redownload())) {
        return {
          ok: false,
          kind: 'download',
          message: "Couldn't read the downloaded file — tap to try again.",
        };
      }
    }
    try {
      await saveToLibraryAsync(path);
    } catch (first) {
      if (!looksMissing(first)) throw first;
      captureHandledError(first, `saveToPhotos:write_missing:${opts.context}`);
      if (!(await redownload())) {
        return {
          ok: false,
          kind: 'download',
          message: "Couldn't read the downloaded file — tap to try again.",
        };
      }
      await saveToLibraryAsync(path);
    }
    return { ok: true };
  } catch (err) {
    // The write itself failed — a genuinely different problem from a failed
    // download, and one that used to wear the same message.
    captureHandledError(err, `saveToPhotos:write:${opts.context}`);
    if (looksMissing(err)) {
      // Survived a re-download and still could not be opened. Says exactly
      // that rather than blaming the photo library or the phone.
      return {
        ok: false,
        kind: 'save',
        message: "Couldn't read that file to save it — it may have been cleared. Tap to try again.",
      };
    }
    if (await outOfSpace(err, path)) {
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
    // Release BEFORE discarding: this operation is done with the file, and
    // discardCached refuses to delete anything another one still holds.
    releaseCached(path);
    // Either the library took its own copy or it refused the file. Ours is
    // dead weight in both cases — and on a refusal caused by a full phone,
    // keeping it would be actively making the reported problem worse.
    await discardCached(path);
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
    } catch (err) {
      captureHandledError(err, `shareFile:refresh_url:${opts.context}`);
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
    // The share sheet has closed, so this operation is done holding the file
    // — but it is NOT deleted here: the target app may still be reading it.
    // Released so a later save of the same file may reuse the path, and
    // swept-around so the copy ages out on a future download instead.
    releaseCached(localUri);
    void sweepDownloadCache(localUri);
  }
}
