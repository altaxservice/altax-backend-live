import crypto from "crypto";

/**
 * Server-side envelope encryption for sensitive fields (Secure Vault secrets, bank
 * account/routing numbers). Replaces the legacy model, where the server stored
 * whatever ciphertext the browser sent with no server-side encryption or validation
 * at all — see AL_TAX_VAULT_ENCRYPTION_PROPOSAL_20260709.md for the full review.
 *
 * Design: each value gets its own random 32-byte data key (AES-256-GCM). The data
 * key encrypts the plaintext; the master key (VAULT_MASTER_KEY) encrypts the data
 * key. Everything needed to decrypt is packed into one self-contained string, so it
 * fits in a single existing VARCHAR/TEXT column with no schema change:
 *   v1:<wrapIv>.<wrappedDataKeyCiphertext>:<payloadIv>.<payloadCiphertext>
 * All binary components are base64. Losing VAULT_MASTER_KEY makes every encrypted
 * value permanently unrecoverable — that's inherent to real encryption, not a bug.
 */

const ALGO = "aes-256-gcm";
const VERSION = "v1";
const AUTH_TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const raw = process.env.VAULT_MASTER_KEY;
  if (!raw) {
    throw new Error("VAULT_MASTER_KEY is not set. The Secure Vault and encrypted payment fields cannot work without it.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("VAULT_MASTER_KEY must be a base64-encoded 32-byte (256-bit) key.");
  }
  return key;
}

export function isEncryptionConfigured(): boolean {
  return !!process.env.VAULT_MASTER_KEY;
}

/** Generates a fresh base64-encoded 32-byte key, for setting VAULT_MASTER_KEY. */
export function generateMasterKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

function encryptRaw(plaintext: Buffer, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${Buffer.concat([encrypted, authTag]).toString("base64")}`;
}

function decryptRaw(blob: string, key: Buffer): Buffer {
  const [ivB64, dataB64] = blob.split(".");
  if (!ivB64 || !dataB64) throw new Error("Corrupt encrypted value (malformed segment).");
  const iv = Buffer.from(ivB64, "base64");
  const combined = Buffer.from(dataB64, "base64");
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(0, combined.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/** Envelope-encrypts plaintext into one self-contained, storable string. */
export function encryptValue(plaintext: string): string {
  const masterKey = getMasterKey();
  const dataKey = crypto.randomBytes(32);
  const wrappedDataKey = encryptRaw(dataKey, masterKey);
  const payloadCiphertext = encryptRaw(Buffer.from(plaintext, "utf8"), dataKey);
  return [VERSION, wrappedDataKey, payloadCiphertext].join(":");
}

/** Reverses encryptValue. Throws if the value is corrupt, tampered with, or the master key doesn't match. */
export function decryptValue(serialized: string): string {
  const parts = String(serialized || "").split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Unrecognized or corrupt encrypted value.");
  }
  const [, wrappedDataKey, payloadCiphertext] = parts;
  const masterKey = getMasterKey();
  const dataKey = decryptRaw(wrappedDataKey, masterKey);
  return decryptRaw(payloadCiphertext, dataKey).toString("utf8");
}
