// One-time backfill: move existing v3_document_uploads rows off the file_data
// Postgres column and into Cloudflare R2 (sql/118_document_uploads_blob_backend.sql
// added blob_backend; every upload written after that migration already goes
// straight to R2 via writeUploadBlob — this script only touches the rows that
// predate it). Never overwrites a row before confirming the bytes read back out
// of R2 exactly match what was in Postgres; only then does it null file_data and
// flip blob_backend, so a failure partway through leaves every untouched row
// exactly as safe as it was before this ran.
//
// Uses db.ts's normal DATABASE_URL_DEV routing — run locally against the dev
// branch first, then intentionally against production once verified (see the
// README note this script prints at the top).
import "dotenv/config";
import { query } from "../src/config/db";
import { putObject, getObject } from "../src/common/objectStorage";

async function main() {
  const rows = await query<{ upload_id: string; file_data: string }>(
    `SELECT upload_id, file_data FROM altax.v3_document_uploads WHERE blob_backend = 'postgres' AND file_data IS NOT NULL ORDER BY uploaded_at`
  );
  console.log(`[backfill] ${rows.length} row(s) to migrate to R2.`);

  let migrated = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await putObject(row.upload_id, Buffer.from(row.file_data, "utf8"));
      const readBack = await getObject(row.upload_id);
      if (readBack.toString("utf8") !== row.file_data) {
        throw new Error("read-back mismatch after upload — refusing to touch this row");
      }
      await query(`UPDATE altax.v3_document_uploads SET file_data = NULL, blob_backend = 'r2', updated_at = now() WHERE upload_id = $1`, [row.upload_id]);
      migrated++;
      console.log(`[backfill] ${row.upload_id}: OK`);
    } catch (err: any) {
      failed++;
      console.error(`[backfill] ${row.upload_id}: FAILED — ${err?.message || err}`);
    }
  }

  console.log(`[backfill] done. migrated=${migrated} failed=${failed} total=${rows.length}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("[backfill] fatal error:", err);
  process.exit(1);
});
