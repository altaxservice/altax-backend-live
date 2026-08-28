import { encryptValue, decryptTolerant } from "./encryption";
import { putObject, getObject, isObjectStorageConfigured } from "./objectStorage";

/**
 * Where a v3_document_uploads row's actual file bytes live — see
 * sql/118_document_uploads_blob_backend.sql. Every upload route funnels through
 * writeUploadBlob() below instead of calling encryptValue() + building the INSERT's
 * file_data param directly, so the postgres/R2 choice lives in exactly one place.
 */
export type BlobBackend = "postgres" | "r2";

/**
 * Encrypts a newly-uploaded file's base64 content and stores it — in R2 if
 * configured (the default going forward), falling back to the file_data column
 * if not (e.g. local dev before R2 is set up, matching how Resend/Twilio degrade
 * gracefully rather than hard-failing when unconfigured). Returns exactly what the
 * caller's INSERT needs for its file_data and blob_backend columns.
 */
export async function writeUploadBlob(uploadId: string, base64Plaintext: string): Promise<{ fileData: string | null; blobBackend: BlobBackend }> {
  const encrypted = encryptValue(base64Plaintext);
  if (!isObjectStorageConfigured()) {
    return { fileData: encrypted, blobBackend: "postgres" };
  }
  await putObject(uploadId, Buffer.from(encrypted, "utf8"));
  return { fileData: null, blobBackend: "r2" };
}

/**
 * Reverses writeUploadBlob() — reads whichever backend the row actually used and
 * returns the decrypted base64 file content. `fileDataColumn`/`blobBackend` are
 * whatever the caller already SELECTed off the row (upload_id, file_data,
 * blob_backend); this never queries the database itself.
 */
export async function readUploadBlob(uploadId: string, fileDataColumn: string | null, blobBackend: string | null): Promise<string> {
  if (blobBackend === "r2") {
    const bytes = await getObject(uploadId);
    return decryptTolerant(bytes.toString("utf8"));
  }
  if (!fileDataColumn) throw new Error(`No file content on upload ${uploadId} (blob_backend=${blobBackend || "postgres"}, file_data is empty).`);
  return decryptTolerant(fileDataColumn);
}
