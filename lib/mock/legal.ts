/**
 * FOUR DOCUMENTS, NOT THIRTEEN.
 *
 * Thirteen separate policies meant nobody read any of them, and the same rule
 * appeared in three places with the risk of drifting apart. The nine absorbed
 * documents are archived in the CMS rather than deleted — consent records
 * point at those rows — and every old slug still resolves, because a link in
 * someone's email or a screenshot of an old screen must not 404.
 *
 * Content is served versioned from the CMS (policy_documents). All four are
 * working drafts pending attorney review.
 */
export const LEGAL_DOCS: { slug: string; title: string }[] = [
  { slug: 'terms', title: 'Terms of Service' },
  { slug: 'privacy', title: 'Privacy Policy' },
  { slug: 'creator-agreement', title: 'Creator Agreement' },
  { slug: 'trust-safety', title: 'Trust & Safety Policy' },
];

/**
 * Where each retired slug now lives. Used by the legal screen to redirect
 * rather than 404 — an old link lands on the document that absorbed it.
 */
export const LEGAL_REDIRECTS: Record<string, string> = {
  cancellation: 'terms',
  'content-usage': 'terms',
  'dispute-resolution': 'terms',
  'minor-safety': 'terms',
  'data-retention': 'privacy',
  notifications: 'privacy',
  'payment-payout': 'creator-agreement',
  'background-check': 'creator-agreement',
  accessibility: 'trust-safety',
};

/** The live slug for any slug, current or retired. */
export function resolveLegalSlug(slug: string): string {
  return LEGAL_REDIRECTS[slug] ?? slug;
}

/**
 * Titles for retired slugs, so a redirect can say WHICH document it landed
 * you on and why — a silent redirect from "Payment & Payout Policy" to
 * "Creator Agreement" reads as a broken link.
 */
export const RETIRED_TITLES: Record<string, string> = {
  cancellation: 'Cancellation & Refund Policy',
  'content-usage': 'Content & Usage Policy',
  'dispute-resolution': 'Dispute Resolution Policy',
  'minor-safety': 'Minor Safety & Age Policy',
  'data-retention': 'Data Retention Policy',
  notifications: 'Notification Policy',
  'payment-payout': 'Payment & Payout Policy',
  'background-check': 'Background Check & Vetting Disclosure',
  accessibility: 'Accessibility Statement',
};
