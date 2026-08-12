/**
 * WHAT WAS ACTUALLY UPLOADED — read from the bytes, not from the request.
 *
 * The presign endpoint takes `content_type` from the caller and checks only
 * that it starts with "image/". Nothing ever verified it, so a client could
 * declare image/jpeg and PUT anything at all into the portfolio bucket. That
 * is the security half of this file, and it matters more than the quality
 * half: the quality rules only stop a bad photo reaching a review queue a
 * human already reads.
 *
 * THE LIMITS MATCH lib/headshotRules.ts IN THE APP. They are duplicated
 * because the two are separate packages with no shared import, which is the
 * existing convention here. This side is the authority — a stale client must
 * not be able to register something the current one would refuse.
 *
 * Only JPEG, PNG and WebP are accepted. The app re-encodes every pick to JPEG
 * (expo-image-picker with `quality` set), so nothing legitimate arrives as
 * anything else, and accepting a format whose dimensions we cannot cheaply
 * read would mean waving through the check we are here to perform.
 */

export const HEADSHOT_MIN_PX = 512;
export const HEADSHOT_MIN_ASPECT = 0.8;
export const HEADSHOT_MAX_ASPECT = 1.25;
export const HEADSHOT_MAX_BYTES = 12 * 1024 * 1024;

export type HeadshotFormat = 'jpeg' | 'png' | 'webp';

export interface ImageHeader {
  format: HeadshotFormat;
  width: number;
  height: number;
}

/* ---------- magic bytes + dimensions, from the file header ---------- */

function readPng(b: Buffer): ImageHeader | null {
  // 89 50 4E 47 0D 0A 1A 0A, then an IHDR chunk whose first two fields are
  // width and height as big-endian uint32.
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function readJpeg(b: Buffer): ImageHeader | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++; // resync rather than give up — padding bytes are legal here
      continue;
    }
    const marker = b[i + 1];
    // Standalone markers carry no length.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 hold the frame size. C4 (DHT), C8 (JPG) and CC (DAC) sit in
    // the same numeric range and are NOT frame headers.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 >= b.length) return null;
      // Height precedes width in a SOF segment; the field order here matches
      // the other two parsers so callers see one consistent shape.
      return { format: 'jpeg', width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    }
    if (len < 2) return null; // malformed; refuse rather than loop
    i += 2 + len;
  }
  return null;
}

function readWebp(b: Buffer): ImageHeader | null {
  if (b.length < 30) return null;
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: 3-byte frame tag, 3-byte start code, then 14-bit w/h.
    return { format: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    // Lossless: 14-bit width-1 and height-1 packed after the 0x2f signature.
    const bits = b.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit canvas width-1 and height-1.
    const w = b[24] | (b[25] << 8) | (b[26] << 16);
    const h = b[27] | (b[28] << 8) | (b[29] << 16);
    return { format: 'webp', width: w + 1, height: h + 1 };
  }
  return null;
}

/** null when the bytes are not a format we accept. */
export function readImageHeader(b: Buffer): ImageHeader | null {
  return readPng(b) ?? readJpeg(b) ?? readWebp(b);
}

/* ---------- the verdict ---------- */

export type HeadshotReject =
  | 'unreadable'
  | 'not_an_image'
  | 'too_small'
  | 'wrong_shape'
  | 'too_large';

export interface HeadshotVerdict {
  ok: boolean;
  reason?: HeadshotReject;
  error?: string;
}

/**
 * `bytes` is the head of the object; `totalBytes` its full length, which for a
 * ranged read comes from Content-Range rather than what was read.
 */
export function validateHeadshotBytes(bytes: Buffer, totalBytes: number | null): HeadshotVerdict {
  if (totalBytes != null && totalBytes > HEADSHOT_MAX_BYTES) {
    const mb = Math.round((HEADSHOT_MAX_BYTES / (1024 * 1024)) * 10) / 10;
    return { ok: false, reason: 'too_large', error: `That photo is larger than the ${mb} MB limit.` };
  }
  const header = readImageHeader(bytes);
  if (!header) {
    return {
      ok: false,
      reason: 'not_an_image',
      error: "That file isn't a JPEG, PNG or WebP image. Save it as a photo and try again.",
    };
  }
  if (header.width < HEADSHOT_MIN_PX || header.height < HEADSHOT_MIN_PX) {
    return {
      ok: false,
      reason: 'too_small',
      error:
        `That photo is ${header.width} × ${header.height} pixels — too small to stay sharp on your ` +
        `profile. It needs to be at least ${HEADSHOT_MIN_PX} × ${HEADSHOT_MIN_PX}.`,
    };
  }
  const aspect = header.width / header.height;
  if (aspect < HEADSHOT_MIN_ASPECT || aspect > HEADSHOT_MAX_ASPECT) {
    return {
      ok: false,
      reason: 'wrong_shape',
      error:
        'Your profile photo is cropped to a square, and that photo is too far from square — ' +
        'crop it square first, or take a new photo.',
    };
  }
  return { ok: true };
}
