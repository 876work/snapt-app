import { supabaseAdmin } from './supabase.js';

// Storage driver for the media pipeline. Production target is Cloudflare R2
// (S3-compatible, presigned URLs) — activated when R2_* env vars exist.
// Locally, Supabase Storage private buckets provide the same signed-URL
// shape so the pipeline is exercisable end-to-end before Phase 7.
// Buckets/prefixes: 'raw-footage' (creator/editor side only),
// 'deliverables' (client-visible after delivery), and 'portfolio'
// (creator portfolio images, public only after moderation approval).

export type MediaBucket = 'raw-footage' | 'deliverables' | 'portfolio';

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
      }),
      { expiresIn: 3600 },
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
