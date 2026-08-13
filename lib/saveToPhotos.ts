import { Alert, Linking } from 'react-native';
import { captureHandledError } from './sentry';

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

export type SaveFailure = 'permission' | 'permission_blocked' | 'download' | 'save';

export type SaveResult = { ok: true } | { ok: false; kind: SaveFailure; message: string };

/** Extensions the photo library can actually make sense of. */
function extensionFor(name: string, contentType?: string | null): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(name)?.[1]?.toLowerCase();
  if (fromName && fromName !== 'jpeg') return fromName;
  if (fromName === 'jpeg') return 'jpg';
  const t = (contentType ?? '').toLowerCase();
  if (t.includes('png')) return 'png';
  if (t.includes('heic')) return 'heic';
  if (t.includes('mp4')) return 'mp4';
  if (t.includes('mov') || t.includes('quicktime')) return 'mov';
  return 'jpg';
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

/** Offered only once the OS will no longer ask — same rule as camera capture. */
export function offerSettings(result: SaveResult): void {
  if (result.ok || result.kind !== 'permission_blocked') return;
  Alert.alert('Photo access is off', result.message, [
    { text: 'Not now', style: 'cancel' },
    { text: 'Open Settings', onPress: () => void Linking.openSettings() },
  ]);
}

async function downloadTo(url: string, filename: string): Promise<string> {
  const FS = (await import('expo-file-system')) as Record<string, any>;
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
    const MediaLibrary = await import('expo-media-library');
    await MediaLibrary.saveToLibraryAsync(localUri);
    return { ok: true };
  } catch (err) {
    // The write itself failed — a genuinely different problem from a failed
    // download, and one that used to wear the same message.
    captureHandledError(err, `saveToPhotos:write:${opts.context}`);
    return {
      ok: false,
      kind: 'save',
      message: "Downloaded, but your photo library refused it. Check you have storage space free.",
    };
  }
}
