import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin, userFromToken } from './supabase.js';
import { env } from './env.js';

// Per-admin authentication (§15): a normal Supabase login whose user id is
// in admin_users. The shared ADMIN_API_TOKEN remains ONLY as a bootstrap
// fallback (audited as 'bootstrap-token') — remove it once real admins are
// provisioned in production.

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const user = await userFromToken(header.slice(7));
    if (user) {
      const { data } = await supabaseAdmin
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) return user.id;
    }
  }
  if (env.adminApiToken && request.headers['x-admin-token'] === env.adminApiToken) {
    return 'bootstrap-token';
  }
  reply.code(403).send({ error: 'Admin access required' });
  return null;
}

/** Audit trail: who did what to which target. */
export async function audit(
  adminId: string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await supabaseAdmin.from('admin_actions').insert({
    admin_id: adminId === 'bootstrap-token' ? '00000000-0000-4000-8000-00000000000a' : adminId,
    action,
    target: target ?? null,
    detail: { ...(detail ?? {}), ...(adminId === 'bootstrap-token' ? { via: 'bootstrap-token' } : {}) },
  });
}
