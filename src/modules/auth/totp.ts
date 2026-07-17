/**
 * TOTP (RFC 6238) two-factor auth — authenticator-app based (Google/Microsoft
 * Authenticator, 1Password, etc), not email-based. Chosen over legacy's
 * email-OTP flow (alTaxV5SendLoginCode_ / alTaxV5VerifyLoginChallenge_)
 * because it needs no email-sending infrastructure and is the more standard
 * approach for a real business tool.
 */
import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

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
