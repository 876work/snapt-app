import Fastify from 'fastify';
import { env, stripeConfigured } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerPaymentRoutes } from './routes/payments.js';

const app = Fastify({ logger: true });

// Stripe webhooks need the raw body for signature verification; keep JSON
// parsing for everything else.
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (request, body, done) => {
    if (request.routeOptions.config && (request.routeOptions.config as { rawBody?: boolean }).rawBody) {
      done(null, body);
      return;
    }
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (err) {
      done(err as Error);
    }
  },
);

registerAuth(app);

app.get('/v1/health', async () => ({
  ok: true,
  stripe_configured: stripeConfigured,
}));

registerConfigRoutes(app);
registerPaymentRoutes(app);

app.listen({ port: env.port, host: env.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
