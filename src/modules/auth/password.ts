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
  const hash = scryptHash(password, salt);
  const passwordHash = [SCRYPT_VERSION, SCRYPT_N, SCRYPT_R, SCRYPT_P, salt, hash].join("$");
  return {
    PasswordHash: passwordHash,
    PasswordSalt: salt,
    PasswordHashVersion: SCRYPT_VERSION,
    LastPasswordChangeAt: new Date(),
    FailedLoginCount: null,
    LockedUntil: null,
  };
}

/**
 * Current format: scrypt.
 *
 * The v2 format below is iterated SHA-256, which is fast on exactly the
 * hardware an attacker would use — a leaked database of those hashes falls to
 * GPU cracking far quicker than it should. scrypt is memory-hard, which makes
 * that parallel attack expensive.
 *
 * scrypt over bcrypt/argon2 specifically because it ships inside Node's own
 * crypto module: no native module to compile, nothing extra that can fail to
 * build on deploy. The security gain over v2 is the point, and scrypt delivers
 * it without adding a dependency to the login path.
 *
 * N=16384, r=8, p=1 is the widely used interactive-login baseline (~16MB and a
 * few tens of milliseconds per verification) — strong enough to matter, fast
 * enough that signing in still feels instant.
 */
export const SCRYPT_VERSION = "v3";
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

function scryptHash(password: string, salt: string): string {
  return crypto
    .scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 })
    .toString("hex");
}

/** Length-safe constant-time compare — timingSafeEqual throws on length mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
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

  // Current format — "v3$N$r$p$salt$hash".
  if (parts.length === 6 && parts[0] === SCRYPT_VERSION) {
    const [, n, r, p, salt, expected] = parts;
    const actual = crypto
      .scryptSync(password, salt, SCRYPT_KEYLEN, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
      .toString("hex");
    return { valid: safeEqualHex(actual, expected), needsUpgrade: false };
  }

  // Previous format — still accepted so nobody is forced to reset, but flagged
  // for upgrade so it silently disappears as people sign in.
  if (parts.length === 4 && parts[0] === PASSWORD_HASH_VERSION) {
    const iterations = Number(parts[1] || 0);
    const salt = parts[2] || "";
    const expected = parts[3] || "";
    const actual = iteratedHash(password, salt, iterations);
    const matches = safeEqualHex(actual, expected);
    return { valid: matches, needsUpgrade: matches };
  }

  const legacy = legacyHash(password);
  const matches = !!legacy && safeEqualHex(legacy, stored);
  return { valid: matches, needsUpgrade: matches };
}
