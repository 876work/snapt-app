import type { FastifyReply, FastifyRequest } from 'fastify';
import { supabaseAdmin, userFromToken } from './supabase.js';
import { env } from './env.js';

// Per-admin authentication (§15): a normal Supabase login whose user id is
// in admin_users, carrying a role that gates what each route may do:
//   admin     — everything, including payout release, config, and legal edits
//   support   — day-to-day ops: view, refunds, notes; no money release, no config
//   moderator — content-moderation queue only
// Routes default to admin-only; view/ops routes explicitly widen. The shared
// ADMIN_API_TOKEN remains ONLY as a bootstrap fallback (audited as
// 'bootstrap-token', role admin) — remove it once real admins are
// provisioned in production.

export type AdminRole = 'admin' | 'support' | 'moderator';

export interface AdminIdentity {
  id: string;
  role: AdminRole;
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: AdminRole[] = ['admin'],
): Promise<AdminIdentity | null> {
  let identity: AdminIdentity | null = null;
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const user = await userFromToken(header.slice(7));
    if (user) {
      const { data } = await supabaseAdmin
        .from('admin_users')
        .select('user_id, role, active')
        .eq('user_id', user.id)
        .maybeSingle();
      // Checked on EVERY request, so deactivation invalidates the session
      // immediately — not at next login.
      if (data && data.active !== false) identity = { id: user.id, role: data.role as AdminRole };
    }
  }
  if (!identity && env.adminApiToken && request.headers['x-admin-token'] === env.adminApiToken) {
    identity = { id: 'bootstrap-token', role: 'admin' };
  }
  if (!identity) {
    reply.code(403).send({ error: 'Admin access required' });
    return null;
  }
  if (!allowed.includes(identity.role)) {
    reply.code(403).send({
      error: `Your role (${identity.role}) does not permit this action`,
    });
    return null;
  }
  return identity;
}

/** Audit trail: who did what to which target. */
export async function audit(
  admin: AdminIdentity | string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  const adminId = typeof admin === 'string' ? admin : admin.id;
  await supabaseAdmin.from('admin_actions').insert({
    admin_id: adminId === 'bootstrap-token' ? '00000000-0000-4000-8000-00000000000a' : adminId,
    action,
    target: target ?? null,
    detail: { ...(detail ?? {}), ...(adminId === 'bootstrap-token' ? { via: 'bootstrap-token' } : {}) },
  });
}
