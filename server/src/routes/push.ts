import type { FastifyInstance } from 'fastify';
import { requireUser } from '../plugins/auth.js';
import { supabaseAdmin } from '../supabase.js';

// Device push-token registry. Tokens are Expo push tokens (the app sends
// through Expo's push service — see notify.ts). Upsert semantics: a device
// re-registering under a different account moves the token to that account.
export function registerPushRoutes(app: FastifyInstance) {
  app.post<{ Body: { token?: string; platform?: string } }>('/v1/push-tokens', async (request, reply) => {
    const user = requireUser(request);
    const token = request.body?.token?.trim();
    const platform = request.body?.platform;
    if (!token || !token.startsWith('ExponentPushToken')) {
      return reply.code(400).send({ error: 'token (ExponentPushToken…) is required' });
    }
    if (platform !== 'ios' && platform !== 'android') {
      return reply.code(400).send({ error: 'platform must be ios or android' });
    }
    const { error } = await supabaseAdmin
      .from('push_tokens')
      .upsert({ token, user_id: user.id, platform, updated_at: new Date().toISOString() }, { onConflict: 'token' });
    if (error) return reply.code(500).send({ error: error.message });
    return reply.code(201).send({ registered: true });
  });

  // Delivery status for THIS device's token — the master push toggle shows
  // server truth, not a client-side guess (an app can't revoke its own OS
  // permission, so "off" is implemented as no registered token).
  app.get<{ Querystring: { token?: string } }>('/v1/push-tokens/status', async (request, reply) => {
    const user = requireUser(request);
    const token = request.query.token?.trim();
    if (!token) return reply.code(400).send({ error: 'token query param is required' });
    const { data } = await supabaseAdmin
      .from('push_tokens')
      .select('token')
      .eq('token', token)
      .eq('user_id', user.id)
      .maybeSingle();
    return { active: Boolean(data) };
  });

  // Permission outcome. Nothing ever wrote profiles.push_permission, so
  // "declined" and "never asked" were indistinguishable for every user —
  // which made diagnosing a missing token impossible. granted:null means the
  // priming screen was dismissed without ever reaching the OS prompt.
  app.post<{ Body: { granted?: boolean | null } }>('/v1/me/push-permission', async (request, reply) => {
    const user = requireUser(request);
    const granted = typeof request.body?.granted === 'boolean' ? request.body.granted : null;
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ push_permission: { primed: true, granted, answered_at: new Date().toISOString() } })
      .eq('id', user.id);
    if (error) return reply.code(500).send({ error: error.message });
    return { recorded: true };
  });

  // Sign-out hygiene: the app unregisters the device token so a shared
  // device doesn't keep receiving the previous account's notifications.
  app.delete<{ Body: { token?: string } }>('/v1/push-tokens', async (request, reply) => {
    const user = requireUser(request);
    const token = request.body?.token?.trim();
    if (!token) return reply.code(400).send({ error: 'token is required' });
    await supabaseAdmin.from('push_tokens').delete().eq('token', token).eq('user_id', user.id);
    return { unregistered: true };
  });
}
