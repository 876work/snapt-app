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
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (request) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return;
    request.user = await userFromToken(header.slice('Bearer '.length));
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
