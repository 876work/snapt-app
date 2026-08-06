import type { FastifyInstance, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY_ADMIN_HTML } from './legacy-admin-html.js';

// Serves the admin portal SPA (server/admin-ui, built by `npm run build`) at
// /admin, with the pre-rebuild page kept at /admin/legacy during the
// migration. If the SPA build is missing (e.g. a deploy that skipped the UI
// build), /admin falls back to the legacy page instead of a 404 — the portal
// must never go dark because of a build-pipeline mistake.

const here = dirname(fileURLToPath(import.meta.url));
// src/ in dev (tsx), dist/ in production — admin-ui/dist is ../admin-ui/dist
// from both.
const uiDist = join(here, '..', 'admin-ui', 'dist');

// no-store: the shell changes with every deploy; hashed assets carry the
// long-term caching instead.
function sendHtml(reply: FastifyReply, html: string) {
  return reply.header('Cache-Control', 'no-store').type('text/html').send(html);
}

export function registerAdminUi(app: FastifyInstance) {
  app.get('/admin/legacy', async (_request, reply) => {
    sendHtml(reply, LEGACY_ADMIN_HTML);
  });

  const indexPath = join(uiDist, 'index.html');
  if (!existsSync(indexPath)) {
    app.log.warn('admin-ui/dist not found — /admin serves the legacy portal');
    app.get('/admin', async (_request, reply) => {
      sendHtml(reply, LEGACY_ADMIN_HTML);
    });
    return;
  }

  app.register(fastifyStatic, {
    root: uiDist,
    prefix: '/admin/',
    index: false,
    wildcard: true,
  });
  const spaIndex = () => readFileSync(indexPath, 'utf8');
  app.get('/admin', async (_request, reply) => {
    sendHtml(reply, spaIndex());
  });
  // Client-side routes (/admin/today, /admin/users/…) land here on refresh.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === 'GET' && request.url.startsWith('/admin')) {
      sendHtml(reply, spaIndex());
      return;
    }
    reply.code(404).send({ error: 'Not found' });
  });
}
