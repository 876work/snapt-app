import Fastify from 'fastify';
import { env, stripeConfigured } from './env.js';
import { registerAuth } from './plugins/auth.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerNotificationRoutes } from './routes/notifications.js';
import { registerPaymentRoutes } from './routes/payments.js';
import { registerCreatorRoutes } from './routes/creators.js';
import { registerBookingRoutes } from './routes/bookings.js';
import { registerBookingActionRoutes } from './routes/booking-actions.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerAccountRoutes } from './routes/account.js';
import { registerSocialRoutes } from './routes/social.js';
import { registerEarningsRoutes } from './routes/earnings.js';
import { registerSafetyRoutes } from './routes/safety.js';
import { registerDisputeRoutes } from './routes/disputes.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAdminPortalRoutes } from './routes/admin-portal.js';
import { registerAdminTeamRoutes } from './routes/admin-team.js';
import { registerVerificationRoutes } from './routes/verification.js';
import { registerAdminUi } from './admin-ui.js';
import { registerRevisionRoutes } from './routes/revisions.js';
import { registerPolicyRoutes } from './routes/policies.js';
import { registerModerationRoutes } from './routes/moderation.js';
import { registerPushRoutes } from './routes/push.js';
import { registerReviewRoutes } from './routes/reviews.js';
import { registerMessageRoutes } from './routes/messages.js';
import { startScheduler } from './scheduler.js';

// trustProxy: Render terminates TLS at its proxy — without this every
// request.ip is the proxy's address and per-IP throttling is meaningless.
const app = Fastify({ logger: true, trustProxy: true });

// Stripe AND Didit webhooks need the raw body for signature verification;
// keep JSON parsing for everything else.
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
  // Which storage backend is actually live. No secrets — just whether R2
  // credentials resolved or we fell back to Supabase Storage. Without this
  // "did the file land in R2?" is unanswerable from outside.
  storage_driver: process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET ? 'r2' : 'supabase',
}));

registerConfigRoutes(app);

registerNotificationRoutes(app);
registerMessageRoutes(app);
registerPaymentRoutes(app);
registerCreatorRoutes(app);
registerBookingRoutes(app);
registerBookingActionRoutes(app);
registerSessionRoutes(app);
registerMediaRoutes(app);
registerAccountRoutes(app);
registerSocialRoutes(app);
registerEarningsRoutes(app);
registerSafetyRoutes(app);
registerDisputeRoutes(app);
registerAdminRoutes(app);
registerAdminPortalRoutes(app);
registerAdminTeamRoutes(app);
registerVerificationRoutes(app);
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
