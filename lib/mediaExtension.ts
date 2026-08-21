/**
 * WHAT KIND OF FILE IS THIS, REALLY?
 *
 * One mime→extension table, imported by everything that has to name a media
 * file. It exists as its own module for a specific reason: the download path
 * (lib/saveToPhotos.ts) and the upload path (app/upload/index.tsx) both need
 * it, and this codebase has already been bitten once by the same media logic
 * living in two copies that drifted apart (see the header of saveToPhotos.ts).
 * A second copy of this table is exactly how the bug below comes back.
 *
 * THE BUG THIS EXISTS TO KILL
 *
 * iOS decides whether a file is a photo or a video from its EXTENSION, not
 * its bytes: expo-media-library's `assetType(for:)` reads
 * `UTType(filenameExtension:)`, and the image branch then does
 * `UIImage(data:)`, which returns nil for video bytes and rejects the save
 * with MissingFileException.
 *
 * So a .mov named .jpg can never be saved. And the uploader was producing
 * exactly that: when iOS returns a null `fileName` — routine for videos —
 * the fallback name was a hardcoded `.jpg` regardless of what the asset
 * actually was.
 *
 * The extension list matches the server's ACCEPTED_MIME allowlist
 * (server/src/routes/media.ts) — anything outside it is refused at presign
 * time, so these are the only types that can reach storage.
 */

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};

/**
 * The extension a content type implies, or null when it says nothing useful.
 *
 * Null is the honest answer for `application/octet-stream` — the fallback
 * lib/rawUpload.ts uses when the picker gave no mime type. Treating that as
 * authoritative would be swapping one guess for another.
 */
export function extensionForContentType(contentType?: string | null): string | null {
  const type = (contentType ?? '').toLowerCase().split(';')[0].trim();
  return MIME_EXTENSION[type] ?? null;
}

/** The extension already on a filename, normalised. Null when it has none. */
export function extensionFromName(name?: string | null): string | null {
  const found = /\.([a-z0-9]{2,5})$/i.exec(name ?? '')?.[1]?.toLowerCase();
  if (!found) return null;
  return found === 'jpeg' ? 'jpg' : found;
}

/**
 * THE ONE RULE: CONTENT TYPE WINS.
 *
 * When a recognised content type and a filename extension disagree, the
 * content type is believed. It is set from the picker's own reading of the
 * asset and is what the server validated against its allowlist, whereas the
 * name is frequently a fallback somebody invented — which is precisely how
 * videos ended up called .jpg.
 *
 * The name is used only when the content type is absent or unrecognised, and
 * 'jpg' is the last resort when neither source knows anything.
 */
export function resolveExtension(
  name?: string | null,
  contentType?: string | null,
): string {
  return extensionForContentType(contentType) ?? extensionFromName(name) ?? 'jpg';
}

/**
 * THE UTI iOS SHOULD BE TOLD, derived through the same table as everything
 * else in this module — not a third mime list.
 *
 * The share sheet used to hardcode `public.png`-or-`public.jpeg` from a
 * substring test on the mime type, so a shared VIDEO was declared a JPEG
 * still to every app on the sheet. Same defect family as the video named
 * .jpg: the label decided the media kind, and the label was invented.
 *
 * Keyed on the NORMALISED extension resolveExtension produces (content type
 * authoritative, name as fallback), so this map can only ever describe the
 * types the rest of the pipeline admits. public.jpeg is the last resort for
 * the same reason 'jpg' is in resolveExtension: when nothing is known, it
 * matches the existing fallback rather than inventing a new one.
 */
const EXTENSION_UTI: Record<string, string> = {
  jpg: 'public.jpeg',
  png: 'public.png',
  heic: 'public.heic',
  webp: 'org.webmproject.webp',
  mp4: 'public.mpeg-4',
  mov: 'com.apple.quicktime-movie',
  m4v: 'com.apple.m4v-video',
};

export function utiFor(name?: string | null, contentType?: string | null): string {
  return EXTENSION_UTI[resolveExtension(name, contentType)] ?? 'public.jpeg';
}

/**
 * THE SAME NAME, RE-SUFFIXED TO MATCH THE BYTES.
 *
 * For the case the rule above cannot cover on its own: a file whose BYTES
 * have been replaced while its name was not. The upload path re-encodes
 * client source video before sending it, and react-native-compressor always
 * writes MP4 — so a name still ending `.MOV`, and a content type still
 * saying `video/quicktime`, describe a file that no longer exists.
 *
 * That is the same defect this module was created to kill, arriving from the
 * other direction. Previously the NAME was invented and the content type was
 * trustworthy, so `resolveExtension` believes the content type. Here the
 * content type is itself stale, and correcting it is only half the job —
 * without this, the corrected type and the old `.MOV` name would disagree
 * and `resolveExtension` would quietly paper over it on the way back down.
 *
 * The stem is kept so a client still recognises their own file; only the
 * suffix moves. A nameless file becomes `upload.<ext>` — deliberately not
 * `upload.jpg`, which is the exact string that made videos unsaveable.
 */
export function renameForContentType(
  name?: string | null,
  contentType?: string | null,
): string {
  const ext = resolveExtension(name, contentType);
  const stem = (name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  return stem ? `${stem}.${ext}` : `upload.${ext}`;
}
