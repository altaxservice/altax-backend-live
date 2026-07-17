/**
 * Ported directly from AL TAX Code.gs:
 *   alTaxV5HashPassword_        (legacy single-round SHA-256, no salt)
 *   alTaxV5DigestHex_ / alTaxV5NewPasswordSalt_ / alTaxV5IteratedPasswordHash_
 *   alTaxV5CreatePasswordHash_  (current format: "v2$<iterations>$<salt>$<hash>")
 *   alTaxV5VerifyPassword_      (verifies either format; flags legacy hashes for upgrade)
 *
 * Ported as-is (same algorithm, same iteration count, same string format) so that
 * every PasswordHash value already stored in v3_Users after migration continues to
 * authenticate without forcing a mass password reset. This is intentionally NOT
 * switched to bcrypt/argon2 yet — see migration plan Section 6, Phase 1 gate.
 * A stronger KDF can be introduced later behind the same "needsUpgrade" path that
 * already exists for the legacy SHA-256 format.
 */
import crypto from "crypto";

export const PASSWORD_HASH_VERSION = "v2";
export const PASSWORD_HASH_ITERATIONS = 12000;
export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_LOCK_MINUTES = 15;

function digestHex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

/** Legacy format: unsalted single SHA-256 pass (matches alTaxV5HashPassword_). */
function legacyHash(password: string): string {
  if (!password) return "";
  return digestHex(password);
}

function newSalt(): string {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "").slice(0, 16)
  );
}

function iteratedHash(password: string, salt: string, iterations: number): string {
  let hash = digestHex(`${salt}:${password}`);
  for (let i = 1; i < iterations; i++) {
    hash = digestHex(`${salt}:${hash}:${password}`);
  }
  return hash;
}

export interface PasswordHashFields {
  PasswordHash: string;
  PasswordSalt: string;
  PasswordHashVersion: string;
  LastPasswordChangeAt: Date;
  FailedLoginCount: null;
  LockedUntil: null;
}

/** Creates a new "v2$iterations$salt$hash" password hash, same shape as alTaxV5PasswordHashFields_. */
export function createPasswordHashFields(password: string): PasswordHashFields {
  const salt = newSalt();
  const hash = iteratedHash(password, salt, PASSWORD_HASH_ITERATIONS);
  const passwordHash = [PASSWORD_HASH_VERSION, PASSWORD_HASH_ITERATIONS, salt, hash].join("$");
  return {
    PasswordHash: passwordHash,
    PasswordSalt: salt,
    PasswordHashVersion: PASSWORD_HASH_VERSION,
    LastPasswordChangeAt: new Date(),
    FailedLoginCount: null,
    LockedUntil: null,
  };
}

export interface VerifyResult {
  valid: boolean;
  needsUpgrade: boolean;
}

/**
 * Verifies a password against a stored hash that may be in either the current
 * "v2$iterations$salt$hash" format or the legacy unsalted single-SHA-256 format.
 * A successful legacy match is flagged needsUpgrade=true so the caller can
 * re-hash and persist the new format (matches alTaxV5VerifyPassword_ + the
 * upgrade branch inside alTaxV3AuthenticateUser).
 */
export function verifyPassword(password: string, storedHash: string | null | undefined): VerifyResult {
  const stored = String(storedHash || "").trim();
  if (!password || !stored) return { valid: false, needsUpgrade: false };

  const parts = stored.split("$");
  if (parts.length === 4 && parts[0] === PASSWORD_HASH_VERSION) {
    const iterations = Number(parts[1] || 0);
    const salt = parts[2] || "";
    const expected = parts[3] || "";
    const actual = iteratedHash(password, salt, iterations);
    return { valid: actual === expected, needsUpgrade: false };
  }

  const legacy = legacyHash(password);
  const matches = !!legacy && legacy === stored;
  return { valid: matches, needsUpgrade: matches };
}
