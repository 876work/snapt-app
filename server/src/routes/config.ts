import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';

/**
 * Public business config (handoff §5/§6). The app reads fee rates, cancel
 * tiers, grace periods etc. from here instead of hard-coding them — §0's
 * "configurable, admin-editable later" requirement.
 *
 * THIS ENDPOINT TAKES NO AUTH. It returned the whole app_config table, so
 * every row was readable by anyone on the internet with one curl — and
 * app_config is not only business copy. It also holds what the platform
 * takes from creators, the exact thresholds of the strike system, which
 * payout rails are live, and whether the retention job is actually deleting
 * anything. Those are not public facts, and three of them are worse than
 * merely private: a take rate is commercial, strike thresholds are gameable
 * by anyone who knows them, and retention_dry_run states plainly that files
 * are not being deleted.
 *
 * So the response is now built from an ALLOWLIST rather than filtered by a
 * denylist. A denylist fails open — the next key someone adds is public
 * until a human remembers this file exists. An allowlist fails closed: a new
 * key is private until it is deliberately named here, and the cost of
 * getting that wrong is a fallback constant in the app rather than a leak.
 *
 * Adding a key here is a decision to publish it to the world. The admin
 * portal edits the FULL table through /v1/admin/config (admin-gated), so
 * nothing here limits what an admin can see or change.
 */
const PUBLIC_CONFIG_KEYS: ReadonlySet<string> = new Set([
  // --- read directly by the app; removing one breaks a screen -----------
  'pricing_table',
  'remote_pricing_table',
  'social_pricing_table',
  'in_person_addons',
  'remote_addons',
  'social_addons',
  'client_service_fee_rate', // charged TO clients and shown to them
  'delivery_windows',
  'xcd_per_usd',
  // --- not read by the app today, but published on purpose: these are the
  // rules a client or creator is entitled to know before they commit ----
  'advance_booking_window_days',
  'background_check_recheck_months',
  'cancel_tiers',
  'creator_non_circumvention_months',
  'dispute_appeal_window_days',
  'dispute_evidence_window_hours',
  'dispute_filing_window_days',
  'free_revisions_per_order',
  'min_lead_minutes_in_person',
  'min_lead_minutes_remote',
  'occasion_default_duration_hours',
  'offer_window_minutes',
  'payout_hold_days', // when a creator gets paid — theirs to know
  'portfolio_preapproval_count',
  'reschedule_disabled_under_hours',
  'reschedule_free_count',
  'service_area_polygon', // already public by design via /v1/service-areas
  'social_selection_window_hours',
  // Retention WINDOWS are a commitment worth publishing. The job's run
  // state (retention_dry_run, retention_last_run_day) is not — that is
  // operational, and deliberately absent from this list.
  'retention_abandoned_days',
  'retention_account_deleted_days',
  'retention_cancelled_days',
  'retention_deliverable_days',
  'retention_hold_release_days',
  'retention_raw_days',
]);

export function registerConfigRoutes(app: FastifyInstance) {
  // Named service areas with coordinates — drives the meeting-point map's
  // snap + inside-area validation and the area chips. Public.
  app.get('/v1/service-areas', async (_request, reply) => {
    try {
      const { getServiceAreas, getServicePolygon } = await import('../geo.js');
      return { areas: await getServiceAreas(), polygon: await getServicePolygon() };
    } catch (err) {
      return reply.code(500).send({ error: (err as Error).message });
    }
  });

  app.get('/v1/config', async (_request, reply) => {
    // Selected by key, so a gated value is never even read into memory here,
    // let alone serialised past a filter someone might later move.
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('key, value')
      .in('key', [...PUBLIC_CONFIG_KEYS]);
    if (error) return reply.code(500).send({ error: error.message });

    const config: Record<string, unknown> = {};
    for (const row of data) config[row.key] = row.value;
    // NO unconfirmed_keys. It listed every key whose value was still a
    // working default — including the gated ones — so it leaked the shape of
    // app_config independently of the values. Which §6 values are still
    // unconfirmed is an internal question; the admin portal answers it from
    // /v1/admin/config, which carries the `confirmed` column.
    return { config };
  });
}
