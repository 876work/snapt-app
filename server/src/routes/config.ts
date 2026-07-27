import type { FastifyInstance } from 'fastify';
import { supabaseAdmin } from '../supabase.js';

/**
 * Public business config (handoff §5/§6). The app reads fee rates, cancel
 * tiers, grace periods etc. from here instead of hard-coding them — §0's
 * "configurable, admin-editable later" requirement.
 */
export function registerConfigRoutes(app: FastifyInstance) {
  app.get('/v1/config', async (_request, reply) => {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('key, value, confirmed');
    if (error) return reply.code(500).send({ error: error.message });

    const config: Record<string, unknown> = {};
    const unconfirmedKeys: string[] = [];
    for (const row of data) {
      config[row.key] = row.value;
      if (!row.confirmed) unconfirmedKeys.push(row.key);
    }
    // unconfirmed_keys lets the app (and developers) see which §6 values are
    // still working defaults awaiting Don's confirmation.
    return { config, unconfirmed_keys: unconfirmedKeys };
  });
}
