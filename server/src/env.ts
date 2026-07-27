// Environment configuration. Loaded once at boot; fail fast on missing
// required values, degrade gracefully on optional integrations (Stripe keys
// arrive at Phase 7 cutover — the server must boot without them for local dev).

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '127.0.0.1',

  supabaseUrl: required('SUPABASE_URL'),
  // Service role key: bypasses RLS. Server-only — never ship to the app.
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  // Optional until Stripe accounts exist (handoff §3 Phase 7).
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? null,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? null,

  // Stopgap guard for admin actions (creator approval) until the Admin
  // Portal exists (Phase 5). Unset = admin endpoints disabled.
  adminApiToken: process.env.ADMIN_API_TOKEN ?? null,
};

export const stripeConfigured = env.stripeSecretKey !== null;
