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

  // Email via Resend (Snapt uses NO SMS anywhere). Optional until Phase 7;
  // emails are simulated (logged) without a key.
  resendApiKey: process.env.RESEND_API_KEY ?? null,
  resendFrom: process.env.RESEND_FROM ?? 'Snapt <notifications@snapt.example>',

  // Didit identity verification (hosted sessions). Without a key the
  // verification step degrades to manual review — it never blocks signup.
  diditApiKey: process.env.DIDIT_API_KEY ?? null,
  diditWorkflowId: process.env.DIDIT_WORKFLOW_ID ?? null,
  diditWebhookSecret: process.env.DIDIT_WEBHOOK_SECRET ?? null,

  // Absolute origin used in emailed links (set-password invites). Falls back
  // to the local dev server; MUST be set to the Render URL in production.
  portalBaseUrl: process.env.PORTAL_BASE_URL ?? `http://127.0.0.1:${Number(process.env.PORT ?? 4000)}`,
};

export const stripeConfigured = env.stripeSecretKey !== null;
