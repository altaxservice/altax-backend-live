import crypto from "crypto";
import zlib from "zlib";
import { query } from "../config/db";
import { logAudit } from "./audit";
import { sendEmail } from "./notifications";
import { getFirmProfile } from "./firmProfile";

/**
 * Daily automatic backup, encrypted and emailed to the firm's admins. Was
 * weekly (up to 6 days of data-loss exposure combined with the DB provider's
 * short point-in-time-recovery window) — the job itself is cheap, so there
 * was no real reason not to run it every day instead.
 *
 * The manual Download Full Backup button only helps if someone remembers to
 * click it; this removes the remembering. The mailbox becomes the offsite copy,
 * so the attachment is encrypted — a compromised inbox yields ciphertext, not
 * every client's tax records.
 *
 * Key choice: BACKUP_PASSPHRASE if set, otherwise VAULT_MASTER_KEY. Defaulting
 * to the vault key is deliberate — it is already the one secret the firm must
 * never lose (the vault dies with it), so backups inherit an existing
 * obligation instead of inventing a second passphrase that could quietly rot.
 * Restore decrypts server-side with the same env var, so day-to-day nobody
 * types a password at all.
 *
 * File format (text-safe on purpose, so the existing text/plain restore upload
 * path handles it unchanged):
 *   line 1: ALTAXBK1
 *   line 2: base64( salt[16] | iv[12] | authTag[16] | aes-256-gcm(gzip(json)) )
 */

export const BACKUP_MAGIC = "ALTAXBK1";

function backupKey(salt: Buffer): Buffer {
  const passphrase = process.env.BACKUP_PASSPHRASE || process.env.VAULT_MASTER_KEY;
  if (!passphrase) {
    throw new Error("Backup encryption needs BACKUP_PASSPHRASE or VAULT_MASTER_KEY to be set.");
  }
  return crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
}

/** Reads every altax table into one export object — shared by the download route and the weekly email. */
export async function buildBackupObject(exportedBy: string): Promise<{ backup: Record<string, unknown>; tableCount: number; totalRows: number }> {
  const tables = await query<any>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'altax' ORDER BY tablename`
  );
  const data: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const name = String(t.tablename);
    // Identifier can't be parameterised; it comes from pg_tables, not user input.
    const rows = await query<any>(`SELECT * FROM altax."${name}"`);
    data[name] = rows;
    counts[name] = rows.length;
  }
  const totalRows = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return {
    backup: {
      exportedAt: new Date().toISOString(),
      exportedBy,
      schema: "altax",
      tableCount: tables.length,
      rowCounts: counts,
      totalRows,
      data,
    },
    tableCount: tables.length,
    totalRows,
  };
}

export function encryptBackup(json: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backupKey(salt), iv);
  const compressed = zlib.gzipSync(Buffer.from(json, "utf8"));
  const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${BACKUP_MAGIC}\n${Buffer.concat([salt, iv, tag, encrypted]).toString("base64")}`;
}

export function isEncryptedBackup(text: string): boolean {
  return String(text || "").startsWith(BACKUP_MAGIC);
}

/** Reverses encryptBackup. Throws on a wrong key or a tampered/corrupt file. */
export function decryptBackup(text: string): string {
  const lines = String(text).split("\n");
  if (lines[0] !== BACKUP_MAGIC || !lines[1]) throw new Error("Not an encrypted AL TAX Nexus backup.");
  const blob = Buffer.from(lines[1].trim(), "base64");
  const salt = blob.subarray(0, 16);
  const iv = blob.subarray(16, 28);
  const tag = blob.subarray(28, 44);
  const encrypted = blob.subarray(44);
  const decipher = crypto.createDecipheriv("aes-256-gcm", backupKey(salt), iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return zlib.gunzipSync(compressed).toString("utf8");
}

/** Active admin inboxes, falling back to the firm's own email so the job never silently has nowhere to send. */
async function backupRecipients(): Promise<string[]> {
  const admins = await query<any>(
    `SELECT email FROM altax.v3_users
      WHERE lower(role) = 'admin' AND coalesce(active, true) AND email IS NOT NULL`
  );
  const emails = admins.map((a) => String(a.email)).filter(Boolean);
  if (emails.length > 0) return emails;
  const firm = await getFirmProfile().catch(() => null);
  return firm?.email ? [String(firm.email)] : [];
}

export async function runDailyBackupEmail(trigger: string): Promise<{ sentTo: string[]; totalRows: number; sizeKb: number }> {
  const recipients = await backupRecipients();
  if (recipients.length === 0) throw new Error("No admin email on file to send the backup to.");

  const { backup, tableCount, totalRows } = await buildBackupObject(trigger);
  const encrypted = encryptBackup(JSON.stringify(backup));
  const sizeKb = Math.round(Buffer.byteLength(encrypted, "utf8") / 1024);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `altax-nexus-backup-${stamp}.enc`;

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `AL TAX Nexus daily backup — ${stamp}`,
      html: `
        <p>Attached is today's encrypted backup of AL TAX Nexus: <strong>${totalRows.toLocaleString()} records across ${tableCount} tables</strong> (${sizeKb} KB).</p>
        <p>To restore it, open <strong>Security &rarr; Backup &amp; Restore</strong>, choose this file, and type RESTORE. The server decrypts it automatically — no password to enter.</p>
        <p style="color:#888;font-size:12px">The attachment is AES-256 encrypted; it cannot be read without the server's backup key. Keep a copy of that key (BACKUP_PASSPHRASE or VAULT_MASTER_KEY from the server settings) somewhere safe offline — it is what makes every backup readable.</p>`,
      attachments: [{ filename, content: Buffer.from(encrypted, "utf8"), contentType: "application/octet-stream" }],
    });
  }

  await logAudit("System", "AUTO_BACKUP_EMAILED", "", "", "", String(totalRows),
    `Encrypted daily backup (${totalRows} rows, ${sizeKb} KB) emailed to ${recipients.join(", ")} — ${trigger}.`,
    trigger);
  return { sentTo: recipients, totalRows, sizeKb };
}
