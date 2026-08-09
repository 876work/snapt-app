import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '@supabase/supabase-js';
import { userFromToken } from '../supabase.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

/**
 * Decorates every request with `request.user` (from the Supabase JWT in the
 * Authorization header). Routes that need auth call `requireUser(request)`.
 */
/** The `sub` claim, read WITHOUT verifying — only ever used to look up why an
 *  already-rejected token was rejected. Never to authorise anything. */
function subFromRejectedToken(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const sub = (JSON.parse(json) as { sub?: string }).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    const token = header.slice('Bearer '.length);
    const user = await userFromToken(token);
    if (user) {
      request.user = user;
      return;
    }

    /**
     * The token was rejected. Disabling an account applies a GoTrue ban, so
     * `getUser` fails for a disabled user on their VERY NEXT request — no
     * per-request status query on the happy path, and no waiting for the
     * token to expire.
     *
     * But a bare 401 is indistinguishable from an expired session, and the
     * app has to tell the user plainly that their account was disabled
     * rather than silently bouncing them to a login screen. So on the
     * FAILURE path only — rare, and already slow — we look up why.
     */
    const sub = subFromRejectedToken(token);
    if (!sub) return;
    const { supabaseAdmin } = await import('../supabase.js');
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('status')
      .eq('id', sub)
      .maybeSingle();
    if (data?.status === 'disabled') {
      return reply.code(403).send({
        error: 'Your Snapt account has been disabled. Contact hello@snaptcarib.app if you think this is a mistake.',
        code: 'account_disabled',
      });
    }
  });
}

export function requireUser(request: FastifyRequest): User {
  if (!request.user) {
    const err = new Error('Unauthorized') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  return request.user;
}
