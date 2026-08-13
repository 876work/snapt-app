import type { FastifyInstance } from 'fastify';

/**
 * APPLE AND GOOGLE'S LINK-VERIFICATION FILES.
 *
 * Served as explicit ROUTES, not static files. Apple fetches
 * /.well-known/apple-app-site-association with no extension and refuses it
 * unless the response is application/json — @fastify/static would guess the
 * content type from an extension that is not there, and a redirect (even the
 * courteous http→https one) fails verification outright.
 *
 * These are public by design: both files are meant to be fetched anonymously
 * by Apple and Google, and neither contains a secret. The SHA-256 below is a
 * CERTIFICATE fingerprint — the public half of the signing key, published so
 * Android can confirm an app claiming this domain was signed by us.
 *
 * Scope note: the app's auth emails carry a TYPED CODE, never a link
 * (lib/auth.ts verifyOtp for both signup and recovery), so nothing here is
 * load-bearing for sign-in. These exist for shared booking links and
 * marketing URLs.
 */

const APPLE_TEAM_ID = 'N979WFK8N3';
const BUNDLE_ID = 'app.snaptcarib.snapt';
const ANDROID_PACKAGE = 'app.snaptcarib.snapt';
/** Upload-key certificate fingerprint from EAS credentials. */
const ANDROID_SHA256 =
  '02:5B:57:32:CE:B4:5E:C1:EF:BF:6E:B9:67:9D:4F:9D:2C:E5:B9:27:CE:0D:75:35:8F:B9:08:E2:19:54:C4:05';

const AASA = {
  applinks: {
    apps: [] as string[],
    details: [
      {
        appID: `${APPLE_TEAM_ID}.${BUNDLE_ID}`,
        // Everything except the two well-known files themselves, so Apple's
        // own verification fetches are never swallowed by the app.
        paths: ['NOT /.well-known/*', '*'],
      },
    ],
  },
};

const ASSETLINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: ANDROID_PACKAGE,
      sha256_cert_fingerprints: [ANDROID_SHA256],
    },
  },
];

export function registerWellKnownRoutes(app: FastifyInstance): void {
  app.get('/.well-known/apple-app-site-association', async (_request, reply) => {
    // No extension on the path, so the type must be stated outright.
    reply.type('application/json');
    return AASA;
  });

  // Apple historically also checked the root path; harmless to answer both.
  app.get('/apple-app-site-association', async (_request, reply) => {
    reply.type('application/json');
    return AASA;
  });

  app.get('/.well-known/assetlinks.json', async (_request, reply) => {
    reply.type('application/json');
    return ASSETLINKS;
  });
}
