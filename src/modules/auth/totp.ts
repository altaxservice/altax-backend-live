/**
 * TOTP (RFC 6238) two-factor auth — authenticator-app based (Google/Microsoft
 * Authenticator, 1Password, etc), not email-based. Chosen over legacy's
 * email-OTP flow (alTaxV5SendLoginCode_ / alTaxV5VerifyLoginChallenge_)
 * because it needs no email-sending infrastructure and is the more standard
 * approach for a real business tool.
 */
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";
import crypto from "crypto";

/**
 * One-time recovery codes — the escape hatch for a lost or replaced phone.
 *
 * Without these, mandatory 2FA turns a lost device into a lockout that only a
 * second admin (or direct database access) can undo, which is an unacceptable
 * single point of failure for a firm whose only admin is one person.
 *
 * Codes are stored HASHED, never in plaintext: the database should not contain
 * anything that can sign in on its own. They are shown to the user exactly once,
 * at enrollment, and each one is consumed the first time it is used.
 */
export const BACKUP_CODE_COUNT = 10;

/** Formatted as two 4-char groups ("a1b2-c3d4") — readable and easy to type off paper. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(4).toString("hex");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

/** Normalizes case/spacing/dashes so a code typed off paper still matches. */
function normalizeBackupCode(code: string): string {
  return String(code).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackupCode(code), "utf8").digest("hex");
}

export function hashBackupCodes(codes: string[]): string[] {
  return codes.map(hashBackupCode);
}

/**
 * Checks a submitted code against the stored hashes. Returns the remaining
 * hashes with the used one removed, or null when it doesn't match — so the
 * caller persists the consumption in the same update that grants the session.
 */
export function consumeBackupCode(storedHashes: unknown, submitted: string): string[] | null {
  const hashes: string[] = Array.isArray(storedHashes) ? storedHashes.map(String) : [];
  const candidate = hashBackupCode(submitted);
  const idx = hashes.indexOf(candidate);
  if (idx === -1) return null;
  return hashes.filter((_, i) => i !== idx);
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token: String(code).trim(), epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}

export async function totpQrCodeDataUrl(email: string, secret: string): Promise<string> {
  const otpauth = generateURI({ issuer: "AL TAX SERVICE", label: email, secret });
  return QRCode.toDataURL(otpauth);
}
