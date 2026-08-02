/**
 * Email one-time login codes — the second factor for the Client and Employee
 * portals.
 *
 * Chosen over authenticator apps for these two portals only, and deliberately:
 * clients are small-business owners and employees are hourly staff, and
 * requiring every one of them to install and configure an authenticator app is
 * real friction for accounts that can only ever see their own data. Admin and
 * Staff — which can reach every client's records — stay on TOTP, which is the
 * stronger factor and worth the setup cost there.
 *
 * The honest trade-off: an email code is weaker than TOTP, because anyone who
 * already controls the mailbox can receive it, and email is also the
 * password-reset channel. It is still a large improvement over a password
 * alone — it defeats reused/leaked passwords, which is how these accounts
 * actually get compromised in practice.
 *
 * Codes are stored HASHED with a short expiry and a hard attempt cap, so the
 * database never holds a usable login code and a code cannot be brute-forced
 * within its lifetime.
 */
import crypto from "crypto";
import { escapeHtml } from "../../common/html";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** Six digits, uniformly distributed — rejection sampling avoids the modulo bias of `% 1000000`. */
export function generateEmailOtp(): string {
  while (true) {
    const n = crypto.randomBytes(4).readUInt32BE(0);
    // 4294967295 is not a multiple of 1e6; discard the short final bucket.
    if (n < 4_294_000_000) return String(n % 1_000_000).padStart(6, "0");
  }
}

export function hashEmailOtp(code: string): string {
  return crypto.createHash("sha256").update(String(code).trim(), "utf8").digest("hex");
}

/** Constant-time compare so a wrong code leaks nothing through response timing. */
export function emailOtpMatches(storedHash: string | null | undefined, submitted: string): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(String(storedHash), "utf8");
  const b = Buffer.from(hashEmailOtp(submitted), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function otpExpiryFromNow(): Date {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

export function isOtpExpired(expiresAt: unknown): boolean {
  if (!expiresAt) return true;
  return new Date(String(expiresAt)).getTime() < Date.now();
}

export function loginCodeEmailBody(code: string, firmName: string): string {
  return `
    <p>Here is your sign-in code for ${escapeHtml(firmName)}:</p>
    <p style="font-size:30px;font-weight:800;letter-spacing:7px;margin:18px 0;font-family:ui-monospace,Menlo,monospace;">${code}</p>
    <p>It expires in ${OTP_TTL_MINUTES} minutes and can be used once.</p>
    <p style="color:#666;font-size:13px;">
      If you did not just try to sign in, you can ignore this email — but please change your password,
      because someone else may know it.
    </p>
  `;
}
