import { supabaseAdmin } from './supabase.js';

// Storage driver for the media pipeline. Production target is Cloudflare R2
// (S3-compatible, presigned URLs) — activated when R2_* env vars exist.
// Locally, Supabase Storage private buckets provide the same signed-URL
// shape so the pipeline is exercisable end-to-end before Phase 7.
// Buckets/prefixes: 'raw-footage' (creator/editor side only),
// 'deliverables' (client-visible after delivery), 'portfolio'
// (creator portfolio images, public only after moderation approval), and
// 'voice' (chat voice notes, participants only, small .m4a files).
//
// NOTE for retention: 'voice' keys are referenced by messages.audio_path,
// not booking_media, so retention.ts and the draft sweep never touch them.
// Voice notes currently have no retention window — a deliberate open
// decision, not an accident (see the voice-notes report, 2026-08-15).

export type MediaBucket = 'raw-footage' | 'deliverables' | 'portfolio' | 'voice';

export interface UploadTarget {
  /** Where the client should PUT/POST the file. */
  upload_url: string;
  /** For the Supabase driver: token consumed by uploadToSignedUrl. */
  token?: string;
  storage_path: string;
  driver: 'r2' | 'supabase';
}

const r2Configured = Boolean(
  process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET,
);

async function r2Client() {
  // Lazy import so local dev without the AWS SDK installed still boots is
  // not needed — the dependency is present; lazy keeps cold start lean.
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
    },
  });
}

export async function createUploadTarget(
  bucket: MediaBucket,
  path: string,
  contentType: string,
  /**
   * When provided, the EXACT byte count AND the content type are folded
   * into the signature (SignedHeaders: content-length;content-type;host —
   * verified against the SDK, which marks content-type unsignable by
   * default; the explicit signableHeaders below overrides that). A PUT
   * with any other length or type fails at R2 with 403, so a declared cap
   * (e.g. voice notes' 20 MB / audio-only) is enforced by storage, not by
   * trusting the client twice. The three original call sites pass no
   * length and keep their exact previous behavior (type advisory only).
   * The Supabase local driver cannot sign either; that gap is local-only.
   */
  contentLength?: number,
): Promise<UploadTarget> {
  if (r2Configured) {
    const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const client = await r2Client();
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET as string,
        Key: `${bucket}/${path}`,
        ContentType: contentType,
        ...(contentLength != null ? { ContentLength: contentLength } : {}),
      }),
      {
        expiresIn: 3600,
        ...(contentLength != null
          ? { signableHeaders: new Set(['content-type', 'content-length']) }
          : {}),
      },
    );
    return { upload_url: url, storage_path: path, driver: 'r2' };
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUploadUrl(path);
  if (error) throw new Error(`createUploadTarget: ${error.message}`);
  return {
    upload_url: data.signedUrl,
    token: data.token,
    storage_path: path,
    driver: 'supabase',
  };
}

/**
 * Permanently remove one object. Idempotent on both drivers (deleting a
 * missing key is not an error), so a retention run interrupted between the
 * storage delete and the DB mark can safely retry.
 */
export async function deleteObject(bucket: MediaBucket, path: string): Promise<void> {
  if (r2Configured) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await r2Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET as string,
        Key: `${bucket}/${path}`,
      }),
    );
    return;
  }
  const { error } = await supabaseAdmin.storage.from(bucket).remove([path]);
  // Supabase returns success with an empty list for missing paths; a real
  // error (auth, network) must surface so the DB is never marked deleted
  // for a file that may still exist.
  if (error) throw new Error(`deleteObject: ${error.message}`);
}

/**
 * HOW BIG IS THE STORED OBJECT, ACCORDING TO STORAGE ITSELF?
 *
 * Asks the bucket rather than believing the uploader. The size a client
 * declares at presign is a cap check made BEFORE the bytes move; it records
 * what a phone intended to send. The question this answers — did the
 * on-device video compressor actually shrink the file — is a question about
 * what arrived, so a self-reported number would beg it.
 *
 * Returns null when storage answers but says nothing useful about length.
 * THROWS on a real failure (missing key, auth, network): the caller decides
 * what a missing size costs, and for the register routes the answer is
 * "nothing" — a file that uploaded fine must never fail to register because
 * a metadata read did.
 */
export async function objectSize(bucket: MediaBucket, path: string): Promise<number | null> {
  if (r2Configured) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await r2Client();
    const head = await client.send(
      new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET as string,
        Key: `${bucket}/${path}`,
      }),
    );
    return typeof head.ContentLength === 'number' ? head.ContentLength : null;
  }
  // Supabase driver: size lives in the object row's metadata, and `list` is
  // the only API that exposes it. `search` is a substring match scoped to the
  // folder rather than an exact lookup, so the name is re-checked here — the
  // wrong row's size would be worse than no size.
  const cut = path.lastIndexOf('/');
  const folder = cut === -1 ? '' : path.slice(0, cut);
  const name = cut === -1 ? path : path.slice(cut + 1);
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, { search: name });
  if (error) throw new Error(`objectSize: ${error.message}`);
  const size = (data ?? []).find((o) => o.name === name)?.metadata?.size;
  return typeof size === 'number' ? size : null;
}

export async function createDownloadUrl(bucket: MediaBucket, path: string): Promise<string> {
  if (r2Configured) {
    const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
      import('@aws-sdk/client-s3'),
      import('@aws-sdk/s3-request-presigner'),
    ]);
    const client = await r2Client();
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET as string,
        Key: `${bucket}/${path}`,
      }),
      { expiresIn: 3600 },
    );
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 3600);
  if (error) throw new Error(`createDownloadUrl: ${error.message}`);
  return data.signedUrl;
}
