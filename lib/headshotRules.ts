/**
 * WHAT MAKES A HEADSHOT USABLE, CHECKED BEFORE IT IS UPLOADED.
 *
 * Human review stays the final gate. This only turns away the failures a
 * machine can be certain about — too small to render, cropped to the wrong
 * shape, absurdly large — so they cost someone one tap instead of a wait and
 * a rejection.
 *
 * THE SERVER ENFORCES THE SAME NUMBERS (server/src/headshot-image.ts). These
 * are duplicated rather than shared because the app and server are separate
 * packages with no common import, which is the existing convention here.
 * Change one, change the other; the server is the authority.
 *
 * Screenshot detection is deliberately absent. The picker's mandatory square
 * crop re-encodes to JPEG, which strips the camera metadata and changes the
 * dimensions that any cheap screenshot test relies on — so such a test would
 * mostly fire on legitimately edited photos. A false rejection of a good
 * headshot costs more than a screenshot reaching a queue a human reads.
 */

/** Largest place a headshot renders is 92pt; 512 leaves ~1.9x at 3x density. */
export const HEADSHOT_MIN_PX = 512;
/** The profile crops square, so anything far off square loses its edges. */
export const HEADSHOT_MIN_ASPECT = 0.8;
export const HEADSHOT_MAX_ASPECT = 1.25;
export const HEADSHOT_MAX_BYTES = 12 * 1024 * 1024;

export type HeadshotProblem = 'too_small' | 'wrong_shape' | 'too_large';

export interface HeadshotCandidate {
  width: number;
  height: number;
  /** expo-image-picker does not always provide this; absent skips the check. */
  fileSize?: number;
}

export type HeadshotCheck =
  | { ok: true }
  | { ok: false; problem: HeadshotProblem; message: string };

function mb(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * Every refusal names the actual measurement and one concrete thing to do.
 * "Invalid photo" tells someone they failed without telling them how not to.
 */
export function checkHeadshot(c: HeadshotCandidate): HeadshotCheck {
  // Zero or missing dimensions mean we could not measure it — not that it is
  // bad. Let it through; the server measures the real bytes anyway.
  if (!(c.width > 0) || !(c.height > 0)) return { ok: true };

  if (c.width < HEADSHOT_MIN_PX || c.height < HEADSHOT_MIN_PX) {
    return {
      ok: false,
      problem: 'too_small',
      message:
        `That photo is ${Math.round(c.width)} × ${Math.round(c.height)} pixels — too small to stay sharp ` +
        `on your profile. Pick one that is at least ${HEADSHOT_MIN_PX} × ${HEADSHOT_MIN_PX}, or take a new photo with your camera.`,
    };
  }

  const aspect = c.width / c.height;
  if (aspect < HEADSHOT_MIN_ASPECT || aspect > HEADSHOT_MAX_ASPECT) {
    return {
      ok: false,
      problem: 'wrong_shape',
      message:
        `That photo is much ${aspect > 1 ? 'wider than it is tall' : 'taller than it is wide'}. ` +
        `Your profile photo is cropped to a square, so the ${aspect > 1 ? 'sides' : 'top and bottom'} would be cut off. ` +
        `Crop it square first, or take a new photo.`,
    };
  }

  if (c.fileSize != null && c.fileSize > HEADSHOT_MAX_BYTES) {
    return {
      ok: false,
      problem: 'too_large',
      message:
        `That photo is ${mb(c.fileSize)} — larger than the ${mb(HEADSHOT_MAX_BYTES)} limit. ` +
        `Pick a different one, or take a new photo with your camera.`,
    };
  }

  return { ok: true };
}
