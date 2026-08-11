/**
 * WHAT EACH CONFIG KEY ACTUALLY IS.
 *
 * The Config screen used to edit every setting the same way: a browser
 * prompt containing raw JSON, whatever the value's real type. Editing
 * strike_tiers meant hand-typing a JSON array; one missing quote broke it.
 * This table is what replaces that — the type, the unit, the bounds and the
 * legal options for each key, so the screen can render a control that makes
 * the wrong value hard to enter rather than merely rejected afterwards.
 *
 * A key absent from here still renders — as read-only JSON with a note —
 * rather than disappearing. A config screen that silently hides a setting is
 * worse than one that admits it does not understand it.
 */

export type Danger = 'normal' | 'high' | 'destructive';

export interface NumberSpec {
  kind: 'number';
  /** Shown beside the input: "days", "hours", "USD". */
  unit: string;
  min: number;
  max: number;
  /** Whole numbers only (days, counts) vs decimals (rates, hours like 1.5). */
  integer?: boolean;
  step?: number;
}

export interface PercentSpec {
  /**
   * Stored as a decimal (0.08), shown and typed as a percent (8%).
   * This conversion is the whole point: a plain number field invites
   * someone to type 8 for 8% and set an 800% fee.
   */
  kind: 'percent';
  min: number; // percent, not decimal
  max: number;
  step?: number;
}

export interface BooleanSpec {
  kind: 'boolean';
  /** Wording for the on/off states, so a toggle reads as English. */
  onLabel?: string;
  offLabel?: string;
}

export interface StringListSpec {
  kind: 'string-list';
  /** The known-good values. Offered as a menu — never typed from memory. */
  options: { value: string; label: string }[];
  /** Does position carry meaning? strike_tiers[0] is the 1st-strike result. */
  ordered: boolean;
  /** How to describe position N, when ordered. */
  positionLabel?: (i: number) => string;
  max?: number;
}

/** A fixed set of named numeric fields — addons, cancel tiers, windows. */
export interface FieldsSpec {
  kind: 'fields';
  fields: {
    name: string;
    label: string;
    unit: string;
    min: number;
    max: number;
    integer?: boolean;
    percent?: boolean;
  }[];
}

/** type × tier grid: pricing_table, remote_pricing_table. */
export interface MatrixSpec {
  kind: 'matrix';
  rowLabel: string;
  colLabel: string;
  unit: string;
  min: number;
  max: number;
}

/** Array of uniform records: social_pricing_table. */
export interface RecordsSpec {
  kind: 'records';
  columns: {
    name: string;
    label: string;
    type: 'text' | 'number';
    unit?: string;
    min?: number;
    max?: number;
    integer?: boolean;
    readOnly?: boolean;
  }[];
}

/** Free-form map of name → number, where the names are data not schema. */
export interface NumberMapSpec {
  kind: 'number-map';
  unit: string;
  min: number;
  max: number;
  keyLabel: string;
}

export interface ReadOnlySpec {
  kind: 'read-only';
  why: string;
}

/** Handled by a different, already-verified endpoint. */
export interface ElsewhereSpec {
  kind: 'elsewhere';
  where: string;
  why: string;
}

export type ControlSpec =
  | NumberSpec
  | PercentSpec
  | BooleanSpec
  | StringListSpec
  | FieldsSpec
  | MatrixSpec
  | RecordsSpec
  | NumberMapSpec
  | ReadOnlySpec
  | ElsewhereSpec;

export type GroupId = 'pricing' | 'timing' | 'retention' | 'safety' | 'payouts' | 'geography';

export const GROUPS: { id: GroupId; title: string; blurb: string }[] = [
  { id: 'pricing', title: 'Pricing & money', blurb: 'What clients pay, what creators keep, and the rate between them.' },
  { id: 'timing', title: 'Timing & windows', blurb: 'How long everyone has — to accept, to cancel, to deliver, to dispute.' },
  { id: 'retention', title: 'Retention & data', blurb: 'When files are deleted. Read this group twice before changing it.' },
  { id: 'safety', title: 'Safety & creator standing', blurb: 'Strikes, suspensions and vetting thresholds.' },
  { id: 'payouts', title: 'Payouts', blurb: 'Which ways a creator can be paid.' },
  { id: 'geography', title: 'Geography', blurb: 'Where Snapt operates.' },
];

export interface KeySpec {
  group: GroupId;
  /** Plain-language name. The key itself is shown too, but small. */
  title: string;
  control: ControlSpec;
  danger?: Danger;
  /** Shown as a warning above the editor for high/destructive keys. */
  warning?: string;
  /** Explains a coupling the row itself cannot show. */
  coupledWith?: string;
}

const DAYS = (min: number, max: number): NumberSpec => ({ kind: 'number', unit: 'days', min, max, integer: true, step: 1 });
const HOURS = (min: number, max: number): NumberSpec => ({ kind: 'number', unit: 'hours', min, max, integer: true, step: 1 });
const MINUTES = (min: number, max: number): NumberSpec => ({ kind: 'number', unit: 'minutes', min, max, integer: true, step: 1 });
const MONTHS = (min: number, max: number): NumberSpec => ({ kind: 'number', unit: 'months', min, max, integer: true, step: 1 });
const COUNT = (unit: string, min: number, max: number): NumberSpec => ({ kind: 'number', unit, min, max, integer: true, step: 1 });

const SERVICE_TYPES = 'photo / video / both';

export const CONFIG_SCHEMA: Record<string, KeySpec> = {
  // ---- Pricing & money ----------------------------------------------------
  client_service_fee_rate: {
    group: 'pricing',
    title: 'Client service fee',
    control: { kind: 'percent', min: 0, max: 50, step: 0.5 },
    danger: 'high',
    warning: 'Charged on top of every booking, for every client.',
  },
  creator_platform_fee_rate: {
    group: 'pricing',
    title: 'Creator platform fee (standard)',
    control: { kind: 'percent', min: 0, max: 90, step: 0.5 },
    danger: 'high',
    warning: 'Taken out of every creator payout at the standard rate.',
  },
  creator_promo_fee_rate: {
    group: 'pricing',
    title: 'Creator platform fee (promo)',
    control: { kind: 'percent', min: 0, max: 90, step: 0.5 },
    danger: 'high',
    warning: 'The reduced rate for promo creators. Should stay below the standard fee.',
  },
  xcd_per_usd: {
    group: 'pricing',
    title: 'XCD per 1 USD',
    control: { kind: 'number', unit: 'XCD per USD', min: 0.01, max: 100, step: 0.01 },
    danger: 'high',
    warning: 'A fixed peg. Every price shown in XCD, everywhere in the app, is USD × this number.',
  },
  cancel_tiers: {
    group: 'pricing',
    title: 'Cancellation charge by notice',
    control: {
      kind: 'fields',
      fields: [
        { name: 'over48h', label: 'More than 48 hours notice', unit: '%', min: 0, max: 100, percent: true },
        { name: 'between24and48h', label: '24–48 hours notice', unit: '%', min: 0, max: 100, percent: true },
        { name: 'under24h', label: 'Under 24 hours notice', unit: '%', min: 0, max: 100, percent: true },
      ],
    },
    danger: 'high',
    warning: 'How much of the session price a client is charged when they cancel.',
  },
  pricing_table: {
    group: 'pricing',
    title: 'In-person session pricing',
    control: { kind: 'matrix', rowLabel: SERVICE_TYPES, colLabel: 'duration (hours)', unit: 'USD', min: 0, max: 10000 },
    danger: 'high',
    warning: 'The price of every in-person booking.',
  },
  remote_pricing_table: {
    group: 'pricing',
    title: 'Remote edit pricing',
    control: { kind: 'matrix', rowLabel: SERVICE_TYPES, colLabel: 'package tier', unit: 'USD', min: 0, max: 10000 },
    danger: 'high',
    warning: 'The price of every remote edit order.',
  },
  remote_addons: {
    group: 'pricing',
    title: 'Remote order add-ons',
    control: {
      kind: 'fields',
      fields: [
        { name: 'rush', label: 'Rush delivery', unit: 'USD', min: 0, max: 1000 },
        { name: 'extra_revision', label: 'Extra revision round', unit: 'USD', min: 0, max: 1000 },
      ],
    },
    coupledWith: 'extra_revision is locked to the same price in in_person_addons.',
  },
  in_person_addons: {
    group: 'pricing',
    title: 'In-person add-ons',
    control: {
      kind: 'fields',
      fields: [
        { name: 'rush', label: 'Rush delivery', unit: 'USD', min: 0, max: 1000 },
        { name: 'extra_photos', label: 'Extra edited photos', unit: 'USD', min: 0, max: 1000 },
        { name: 'extra_revision', label: 'Extra revision round', unit: 'USD', min: 0, max: 1000 },
      ],
    },
    coupledWith: 'extra_revision is locked to the same price in remote_addons.',
  },
  social_pricing_table: {
    group: 'pricing',
    title: 'Social bundle tiers',
    control: {
      kind: 'records',
      columns: [
        { name: 'id', label: 'ID', type: 'text', readOnly: true },
        { name: 'label', label: 'Name', type: 'text' },
        { name: 'duration_hours', label: 'Session', type: 'number', unit: 'hours', min: 0.5, max: 12 },
        { name: 'photos', label: 'Photos', type: 'number', unit: 'included', min: 0, max: 200, integer: true },
        { name: 'videos', label: 'Videos', type: 'number', unit: 'included', min: 0, max: 50, integer: true },
        { name: 'price_usd', label: 'Price', type: 'number', unit: 'USD', min: 0, max: 10000 },
      ],
    },
    danger: 'high',
    warning: 'The price and contents of every Social bundle.',
  },
  social_addons: {
    group: 'pricing',
    title: 'Social extras (per unit)',
    control: {
      kind: 'fields',
      fields: [
        { name: 'extra_photo_usd', label: 'Extra photo', unit: 'USD', min: 0, max: 1000 },
        { name: 'extra_video_usd', label: 'Extra video', unit: 'USD', min: 0, max: 1000 },
      ],
    },
  },

  // ---- Timing & windows ---------------------------------------------------
  advance_booking_window_days: { group: 'timing', title: 'How far ahead a session can be booked', control: DAYS(1, 365) },
  free_revisions_per_order: { group: 'timing', title: 'Free revision rounds per order', control: COUNT('rounds', 0, 10) },
  reschedule_free_count: { group: 'timing', title: 'Free reschedules per booking', control: COUNT('reschedules', 0, 10) },
  reschedule_disabled_under_hours: { group: 'timing', title: 'Reschedule disabled under', control: HOURS(0, 168) },
  no_show_grace_minutes: { group: 'timing', title: 'No-show grace period', control: MINUTES(0, 120) },
  offer_window_minutes: { group: 'timing', title: 'Creator accept/decline window', control: MINUTES(1, 120) },
  min_lead_minutes_in_person: {
    group: 'timing',
    title: 'Minimum notice — in-person',
    control: MINUTES(0, 10080),
  },
  min_lead_minutes_remote: {
    group: 'timing',
    title: 'Minimum notice — remote edit',
    control: MINUTES(0, 10080),
  },
  dispute_filing_window_days: {
    group: 'timing',
    title: 'Dispute filing window',
    control: DAYS(1, 90),
    danger: 'high',
    coupledWith: 'The payout hold must be at least this long, or money leaves before a client can dispute it.',
  },
  payout_hold_days: {
    group: 'timing',
    title: 'Creator payout hold',
    control: DAYS(0, 90),
    danger: 'high',
    coupledWith: 'Must be greater than or equal to the dispute filing window.',
  },
  dispute_evidence_window_hours: { group: 'timing', title: 'Dispute evidence window', control: HOURS(1, 336) },
  dispute_appeal_window_days: { group: 'timing', title: 'Dispute appeal window', control: DAYS(1, 90) },
  social_selection_window_hours: { group: 'timing', title: 'Client proof-selection window', control: HOURS(1, 336) },
  delivery_windows: {
    group: 'timing',
    title: 'Delivery commitments',
    control: {
      kind: 'fields',
      fields: [
        { name: 'standard_hours', label: 'Standard delivery', unit: 'hours', min: 1, max: 336, integer: true },
        { name: 'rush_hours', label: 'Rush delivery', unit: 'hours', min: 1, max: 336, integer: true },
        { name: 'warn_fraction', label: 'Warn admin after', unit: '% of window', min: 1, max: 100, percent: true },
      ],
    },
  },
  occasion_default_duration_hours: {
    group: 'timing',
    title: 'Default session length by occasion',
    control: { kind: 'number-map', unit: 'hours', min: 0.5, max: 12, keyLabel: 'Occasion' },
    warning: 'Only Events (2h) is a confirmed value. Do not add occasions without a decision behind them.',
  },

  // ---- Retention & data ---------------------------------------------------
  retention_dry_run: {
    group: 'retention',
    title: 'Retention job: dry run',
    control: { kind: 'boolean', onLabel: 'Dry run — logs only, deletes nothing', offLabel: 'LIVE — permanently deletes files' },
    danger: 'destructive',
    warning:
      'While this is on, the retention job has never deleted a single file. Turning it off arms permanent deletion of client deliverables and creator footage across the whole platform, on the next scheduled run. There is no undo and no recycle bin.',
  },
  retention_raw_days: { group: 'retention', title: 'Delete raw footage after delivery', control: DAYS(1, 3650), danger: 'high' },
  retention_deliverable_days: {
    group: 'retention',
    title: 'Delete paid deliverables after delivery',
    control: DAYS(1, 3650),
    danger: 'high',
    warning: "This is the client's finished work. Lowering it deletes what they paid for, sooner.",
  },
  retention_cancelled_days: { group: 'retention', title: 'Delete files after cancellation', control: DAYS(1, 3650), danger: 'high' },
  retention_abandoned_days: { group: 'retention', title: 'Delete files on abandoned orders', control: DAYS(1, 3650), danger: 'high' },
  retention_account_deleted_days: { group: 'retention', title: 'Delete files after account deletion', control: DAYS(1, 3650), danger: 'high' },
  retention_hold_release_days: { group: 'retention', title: 'Files eligible after a legal hold lifts', control: DAYS(1, 3650), danger: 'high' },
  raw_footage_retention_days: {
    group: 'retention',
    title: 'Raw footage retention (legacy key)',
    control: DAYS(1, 3650),
    warning:
      'Not read by the retention job — retention_raw_days is. This key only sets the re-edit ordering window. Two similarly named keys is a trap; see the note on the Config page.',
  },
  retention_last_run_day: {
    group: 'retention',
    title: 'Retention job last run',
    control: { kind: 'read-only', why: 'Written by the scheduler after each run. Not a setting.' },
  },

  // ---- Safety & creator standing -----------------------------------------
  strike_tiers: {
    group: 'safety',
    title: 'Consequence at each strike count',
    control: {
      kind: 'string-list',
      ordered: true,
      max: 8,
      positionLabel: (i) => `${i + 1}${['st', 'nd', 'rd'][i] ?? 'th'} strike`,
      options: [
        { value: 'warning', label: 'Warning' },
        { value: 'deprioritization_2w', label: 'Deprioritised in matching (2 weeks)' },
        { value: 'suspension_1w', label: 'Suspended (1 week)' },
        { value: 'admin_review', label: 'Sent to admin review' },
      ],
    },
    danger: 'high',
    warning: 'Position is the strike count. Reordering changes what happens to creators at each step.',
  },
  strike_window_days: { group: 'safety', title: 'Rolling strike window', control: DAYS(1, 365) },
  late_cancel_strike_weight: { group: 'safety', title: 'Strikes for a late cancellation', control: COUNT('strikes', 1, 5) },
  strike_deprioritize_days: { group: 'safety', title: 'Deprioritisation length', control: DAYS(1, 365) },
  strike_suspension_days: { group: 'safety', title: 'Suspension length', control: DAYS(1, 365) },
  portfolio_preapproval_count: { group: 'safety', title: 'Portfolio items needing approval', control: COUNT('submissions', 0, 20) },
  background_check_recheck_months: { group: 'safety', title: 'Background re-check interval', control: MONTHS(1, 120) },
  creator_non_circumvention_months: { group: 'safety', title: 'Non-circumvention period', control: MONTHS(1, 120) },

  // ---- Payouts ------------------------------------------------------------
  payout_methods_enabled: {
    group: 'payouts',
    title: 'Payout methods a creator can choose',
    control: {
      kind: 'elsewhere',
      where: '/payouts',
      why: 'Edited on the Payouts screen, which verifies the write stuck and tells you how many creators already have the method saved. Writing it here would be a second, weaker path to the same row.',
    },
  },
  payout_methods_notes: {
    group: 'payouts',
    title: 'Payout method outage notes',
    control: {
      kind: 'elsewhere',
      where: '/payouts',
      why: 'Set automatically when a method is disabled with a note, and cleared when it is re-enabled.',
    },
  },

  // ---- Geography ----------------------------------------------------------
  service_area_polygon: {
    group: 'geography',
    title: 'Service area boundary',
    control: {
      kind: 'read-only',
      why: 'A 26-point coordinate ring. Editing it safely needs a map with draggable vertices, self-intersection checking, and a preview of which existing bookings would fall outside. Scoped separately — not hand-editable here.',
    },
    danger: 'high',
  },
};

/** Percent helpers, in one place so the decimal↔percent conversion is never
 *  re-derived by hand at a call site. */
export const toPercent = (decimal: number): number => Math.round(decimal * 1000) / 10;
export const fromPercent = (percent: number): number => Math.round((percent / 100) * 10000) / 10000;
