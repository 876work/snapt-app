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
