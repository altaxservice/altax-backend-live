import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 (S3-compatible) client for document/file bytes — replaces storing
 * them directly in Postgres (v3_document_uploads.file_data). R2 has zero egress
 * fees and is built for this; a database row column is not. See
 * src/common/uploadBlobStorage.ts for the encrypt-then-store wrapper every upload
 * route actually calls — this module is the thin, low-level R2 client only.
 *
 * All four env vars must be set together or none at all; isObjectStorageConfigured()
 * is the one place callers check before assuming R2 is usable, so a half-configured
 * environment (e.g. local dev before R2 is set up) fails the same clear way as
 * every other optional integration in this app (Resend, Twilio) rather than
 * throwing a confusing error deep inside an upload.
 */
function getConfig() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint };
}

export function isObjectStorageConfigured(): boolean {
  return getConfig() !== null;
}

let cachedClient: { client: S3Client; bucket: string } | null = null;
function getClient(): { client: S3Client; bucket: string } {
  const config = getConfig();
  if (!config) throw new Error("R2 object storage is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET_NAME).");
  if (cachedClient) return cachedClient;
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  cachedClient = { client, bucket: config.bucket };
  return cachedClient;
}

/** Uploads bytes to R2 under `key`. Callers pass already-encrypted bytes — this module has no opinion on plaintext vs ciphertext. */
export async function putObject(key: string, body: Buffer, contentType?: string): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType || "application/octet-stream" }));
}

/** Fetches an object's full bytes back out of R2. Throws if the key doesn't exist. */
export async function getObject(key: string): Promise<Buffer> {
  const { client, bucket } = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks: Buffer[] = [];
  // @ts-expect-error - Body is a Node Readable in the Node runtime, which is all this backend ever runs in.
  for await (const chunk of res.Body) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
