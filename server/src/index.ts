import Fastify from 'fastify';
import { env, stripeConfigured } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerCreatorRoutes } from './routes/creators.js';
import { registerBookingRoutes } from './routes/bookings.js';
import { registerBookingActionRoutes } from './routes/booking-actions.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerEarningsRoutes } from './routes/earnings.js';
import { registerSafetyRoutes } from './routes/safety.js';
import { registerDisputeRoutes } from './routes/disputes.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAdminPortalRoutes } from './routes/admin-portal.js';
import { registerAdminTeamRoutes } from './routes/admin-team.js';
import { registerAdminUi } from './admin-ui.js';
import { registerRevisionRoutes } from './routes/revisions.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerModerationRoutes } from './routes/moderation.js';
import { registerPushRoutes } from './routes/push.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { startScheduler } from './scheduler.js';

// trustProxy: Render terminates TLS at its proxy — without this every
// request.ip is the proxy's address and per-IP throttling is meaningless.
const app = Fastify({ logger: true, trustProxy: true });

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
registerCreatorRoutes(app);
registerBookingRoutes(app);
registerBookingActionRoutes(app);
registerSessionRoutes(app);
registerMediaRoutes(app);
registerEarningsRoutes(app);
registerSafetyRoutes(app);
registerDisputeRoutes(app);
registerAdminRoutes(app);
registerAdminPortalRoutes(app);
registerAdminTeamRoutes(app);
registerAdminUi(app);
registerRevisionRoutes(app);
registerPolicyRoutes(app);
registerModerationRoutes(app);
registerPushRoutes(app);
registerReviewRoutes(app);
startScheduler();

app.listen({ port: env.port, host: env.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
