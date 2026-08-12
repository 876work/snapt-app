import type { ImageSource } from 'expo-image';

/**
 * A CACHE KEY THAT OUTLIVES THE URL.
 *
 * Every remote image in this app is a short-lived signed link to a private
 * bucket. Both storage drivers put the signature in the QUERY STRING and both
 * expire in an hour (see createDownloadUrl in server/src/storage.ts):
 *
 *   R2        …/portfolio/headshots/<id>/<ts>-x.jpg?X-Amz-Signature=…
 *   Supabase  …/object/sign/portfolio/headshots/<id>/<ts>-x.jpg?token=…
 *
 * Cached by URL — which is what expo-image does by default — the same face is
 * a brand new object to the cache every time the server re-signs it. Zero
 * hits, and the disk quietly fills with copies of one headshot.
 *
 * The PATH is the identity, so that is the key. This is only safe because
 * paths are never reused: all four upload sites build their key as
 * `<scope>/<Date.now()>-<name>` (creators.ts, media.ts, moderation.ts,
 * upload-drafts.ts), so replacing a headshot writes a new path and therefore
 * a new cache entry. A cached image cannot shadow a newer one.
 *
 * LOCAL FILES ARE LEFT ALONE deliberately. A picked image lives at an
 * OS-assigned temp path that the OS is free to reuse for a different file
 * later — pinning a cache key to it would be the one way to make this cache
 * show the wrong photo.
 */
export function signedImageSource(uri: string): ImageSource {
  if (!/^https?:/i.test(uri)) return { uri };
  const q = uri.indexOf('?');
  return { uri, cacheKey: q === -1 ? uri : uri.slice(0, q) };
}
