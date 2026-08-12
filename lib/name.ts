/**
 * NAME SPLIT — one implementation, used by every screen that captures a name.
 *
 * `profiles.full_name` stays the stored field. It is read in 122 places across
 * the app, server and admin portal, it backs the admin search (a single-column
 * ilike) and it feeds the Didit name reconciliation as the `signup_name`
 * candidate, so splitting it into columns would cost far more than it buys.
 * The two inputs are a capture concern only: they are joined on the way in and
 * split on the way out.
 *
 * The round trip is lossless by construction. `joinName(splitName(x)) === x`
 * for any already-normalised x, including three-part names and mononyms:
 *
 *   "Mary Jane Watson" → { first: "Mary", last: "Jane Watson" } → "Mary Jane Watson"
 *   "Kailani Jn. Baptiste" → { first: "Kailani", last: "Jn. Baptiste" } → same
 *   "Madonna"          → { first: "Madonna", last: "" }          → "Madonna"
 *
 * A single-word name therefore survives an Edit Profile save untouched, which
 * is why the Last name field is optional there when the stored name had no
 * second token — nobody is made to invent a surname to save an unrelated edit.
 *
 * Particles are not special-cased: "van der Berg" → { "van", "der Berg" }.
 * That round-trips correctly, and every first-name display in the app and
 * server already does `split(' ')[0]` on the same string, so it is exactly
 * today's behaviour rather than a regression.
 */

/** First token to `first`, everything after it to `last`. */
export function splitName(full: string | null | undefined): { first: string; last: string } {
  const norm = (full ?? '').trim().replace(/\s+/g, ' ');
  if (!norm) return { first: '', last: '' };
  const gap = norm.indexOf(' ');
  if (gap === -1) return { first: norm, last: '' };
  return { first: norm.slice(0, gap), last: norm.slice(gap + 1) };
}

/** Rebuild the stored name. An empty half never leaves a stray space. */
export function joinName(first: string | null | undefined, last: string | null | undefined): string {
  return [(first ?? '').trim(), (last ?? '').trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** Did this stored name ever have a surname? Drives whether Last is required. */
export function hasLastName(full: string | null | undefined): boolean {
  return splitName(full).last.length > 0;
}
