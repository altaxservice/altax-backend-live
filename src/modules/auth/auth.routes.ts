import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { authenticateUser, buildAuthSuccess, AuthError, AuthSuccess } from "./auth.service";
import { asyncHandler } from "../../common/asyncHandler";
import { requireAuth, AuthedRequest } from "../../common/requireAuth";
import { verifyPassword, createPasswordHashFields } from "./password";
import { pool } from "../../config/db";
import { logAudit } from "../../common/audit";
import { generateTotpSecret, verifyTotpCode, totpQrCodeDataUrl } from "./totp";
import { wrapEmailHtml } from "../../common/emailTemplate";

export const authRouter = Router();

function newResetToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + String(Math.floor(100000 + Math.random() * 900000));
}

// Derives from the request's own protocol+host rather than FRONTEND_BASE_URL —
// same reasoning as contracts.routes.ts's link-building: a misconfigured or
// locally-scoped env var previously produced a password-reset link that only
// ever opened on the machine that sent it. server.ts always serves the
// frontend from the same origin as this API, so the request's own host is
// always right and needs no separate config to get wrong.
function resetLink(req: Request, portal: string, token: string, email: string): string {
  const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  const params = new URLSearchParams({ email, invite: token, portal });
  return `${base}/accept-invite?${params.toString()}`;
}

// In-memory per-email cooldown — this is a public, unauthenticated route that sends
// real email, so it needs *some* abuse throttle. A restart clearing this map is fine;
// the real security boundary is the token's randomness + 1-hour expiry, not this.
const forgotPasswordCooldown = new Map<string, number>();
const FORGOT_PASSWORD_COOLDOWN_MS = 60_000;

function isError(result: AuthSuccess | AuthError): result is AuthError {
  return (result as AuthError).error !== undefined;
}

function issueSessionToken(result: AuthSuccess): string {
  return jwt.sign(
    {
      sub: result.userId,
      role: result.role,
      email: result.email,
      clientId: result.clientId || undefined,
      employeeId: result.employeeId || undefined,
    },
    process.env.JWT_SECRET as string,
    { expiresIn: (process.env.JWT_EXPIRES_IN as any) || "8h" }
  );
}

/**
 * Mirrors the existing portal login call: { email, portal (role), password }.
 * Locked to a single role the same way Login_Admin/Login_Staff/Login_Client/
 * Login_Employee lock the role today — the frontend passes the role that
 * matches the portal the user is on.
 *
 * When the matched user has TOTP enabled, this does NOT issue a session
 * token. Instead it returns a short-lived challenge token (5 min,
 * purpose=2fa-challenge) that only /auth/login/verify-totp will accept — the
 * real session JWT is only minted after the 6-digit code is verified.
 */
authRouter.post("/login", asyncHandler(async (req: Request, res: Response) => {
  const { email, portal, password } = req.body || {};
  const result = await authenticateUser(email, portal, password);

  if (isError(result)) {
    return res.status(401).json({ error: result.error });
  }

  if (result.totpEnabled) {
    const challenge = jwt.sign(
      { sub: result.userId, purpose: "2fa-challenge" },
      process.env.JWT_SECRET as string,
      { expiresIn: "5m" }
    );
    return res.json({ totpRequired: true, challenge });
  }

  // 2FA is MANDATORY on every portal. A correct password alone never yields a
  // session token: a user without an authenticator gets an enrollment challenge
  // instead and must finish setup before they can reach anything. This is the
  // only path that creates the first authenticator for an account.
  const enrollment = jwt.sign(
    { sub: result.userId, purpose: "2fa-enroll" },
    process.env.JWT_SECRET as string,
    { expiresIn: "15m" }
  );
  return res.json({ enrollmentRequired: true, challenge: enrollment, email: result.email });
}));

/** Resolves a purpose-scoped challenge token to a user id, or null. */
function readChallenge(token: unknown, purpose: string): string | null {
  try {
    const payload: any = jwt.verify(String(token), process.env.JWT_SECRET as string);
    if (payload.purpose !== purpose || !payload.sub) return null;
    return String(payload.sub);
  } catch {
    return null;
  }
}

/**
 * Step 1 of mandatory enrollment: issue a fresh secret + QR for a user who has
 * authenticated with a password but has no authenticator yet. Deliberately NOT
 * behind requireAuth — the caller has no session token, that's the whole point.
 * The 15-minute enrollment challenge is the credential.
 */
authRouter.post("/enroll/2fa/start", asyncHandler(async (req: Request, res: Response) => {
  const userId = readChallenge(req.body?.challenge, "2fa-enroll");
  if (!userId) return res.status(401).json({ error: "Setup session expired. Please sign in again." });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT email, totp_enabled FROM altax.v3_users WHERE user_id = $1`, [userId]);
    if (!rows[0]) return res.status(404).json({ error: "User not found." });
    if (rows[0].totp_enabled) return res.status(400).json({ error: "Two-factor authentication is already set up." });

    const secret = generateTotpSecret();
    await client.query(`UPDATE altax.v3_users SET totp_secret = $1, totp_enabled = FALSE WHERE user_id = $2`, [secret, userId]);
    const qrCodeDataUrl = await totpQrCodeDataUrl(rows[0].email, secret);
    return res.json({ secret, qrCodeDataUrl });
  } finally {
    client.release();
  }
}));

/**
 * Step 2 of mandatory enrollment: verify the first code, mark 2FA enabled, and
 * only then mint the real session token — so enrollment and sign-in complete in
 * one go rather than bouncing the user back to the login form.
 */
authRouter.post("/enroll/2fa/confirm", asyncHandler(async (req: Request, res: Response) => {
  const userId = readChallenge(req.body?.challenge, "2fa-enroll");
  if (!userId) return res.status(401).json({ error: "Setup session expired. Please sign in again." });
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "Enter the 6-digit code from your authenticator app." });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
    const row = rows[0];
    if (!row?.totp_secret) return res.status(400).json({ error: "Start two-factor setup first." });
    if (!(await verifyTotpCode(row.totp_secret, code))) {
      return res.status(401).json({ error: "Incorrect code. Check your authenticator app and try again." });
    }

    await client.query(`UPDATE altax.v3_users SET totp_enabled = TRUE WHERE user_id = $1`, [userId]);
    const result = await buildAuthSuccess(client, { ...row, totp_enabled: true });
    if (isError(result)) return res.status(401).json({ error: result.error });

    await client.query(`UPDATE altax.v3_users SET last_login = now() WHERE user_id = $1`, [userId]);
    await logAudit("Security", "2FA_ENROLLED", userId, "TOTPEnabled", "false", "true",
      "Two-factor authentication enrolled (mandatory enrollment at sign-in).", row.email);

    const token = issueSessionToken(result);
    return res.json({ token, user: result });
  } finally {
    client.release();
  }
}));

/**
 * Second step of login when the user has TOTP enabled: exchanges the
 * short-lived challenge from /auth/login plus a 6-digit authenticator code
 * for the real session JWT.
 */
authRouter.post("/login/verify-totp", asyncHandler(async (req: Request, res: Response) => {
  const { challenge, code } = req.body || {};
  if (!challenge || !code) return res.status(400).json({ error: "Challenge and code are required." });

  let payload: any;
  try {
    payload = jwt.verify(String(challenge), process.env.JWT_SECRET as string);
  } catch {
    return res.status(401).json({ error: "Login session expired. Please sign in again." });
  }
  if (payload.purpose !== "2fa-challenge" || !payload.sub) {
    return res.status(401).json({ error: "Invalid login session." });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [payload.sub]);
    const row = rows[0];
    if (!row || !row.totp_enabled || !row.totp_secret) {
      return res.status(401).json({ error: "Invalid login session." });
    }
    if (!(await verifyTotpCode(row.totp_secret, String(code).trim()))) {
      return res.status(401).json({ error: "Incorrect authenticator code." });
    }

    const result = await buildAuthSuccess(client, row);
    if (isError(result)) return res.status(401).json({ error: result.error });

    await client.query(`UPDATE altax.v3_users SET last_login = now() WHERE user_id = $1`, [row.user_id]);
    const token = issueSessionToken(result);
    return res.json({ token, user: result });
  } finally {
    client.release();
  }
}));

/**
 * Enable/confirm/disable TOTP for the signed-in user (Header "Change
 * Password"-style self-service, not admin-managed). Setup returns a pending
 * secret + QR code but does NOT enable 2FA yet — confirm requires proving
 * the authenticator app actually works before locking the account to it.
 */
authRouter.post("/2fa/setup", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT email FROM altax.v3_users WHERE user_id = $1`, [req.user!.sub]);
    if (!rows[0]) return res.status(404).json({ error: "User not found." });

    const secret = generateTotpSecret();
    await client.query(`UPDATE altax.v3_users SET totp_secret = $1, totp_enabled = FALSE WHERE user_id = $2`, [secret, req.user!.sub]);
    const qrCodeDataUrl = await totpQrCodeDataUrl(rows[0].email, secret);
    return res.json({ secret, qrCodeDataUrl });
  } finally {
    client.release();
  }
}));

authRouter.post("/2fa/confirm", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "Code is required." });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT totp_secret FROM altax.v3_users WHERE user_id = $1`, [req.user!.sub]);
    const secret = rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: "Start 2FA setup first." });
    if (!(await verifyTotpCode(secret, code))) return res.status(401).json({ error: "Incorrect code. Check your authenticator app and try again." });

    await client.query(`UPDATE altax.v3_users SET totp_enabled = TRUE WHERE user_id = $1`, [req.user!.sub]);
    await logAudit("Security", "2FA_ENABLED", req.user!.sub, "TOTPEnabled", "false", "true", "Two-factor authentication enabled.", req.user!.email);
    return res.json({ ok: true });
  } finally {
    client.release();
  }
}));

/**
 * Self-service disable is gone: 2FA is mandatory on every portal, so letting a
 * user switch it off would just re-open the hole. A lost or replaced phone is
 * handled by an admin reset (POST /users/:userId/2fa/reset), which forces fresh
 * enrollment at the user's next sign-in instead of leaving the account bare.
 */
authRouter.post("/2fa/disable", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  await logAudit("Security", "2FA_DISABLE_REFUSED", req.user!.sub, "", "", "",
    "Attempt to disable mandatory two-factor authentication.", req.user!.email);
  return res.status(403).json({
    error: "Two-factor authentication is required for all portals and cannot be turned off. If you replaced your phone, ask an admin to reset your 2FA so you can set it up again.",
  });
}));

/**
 * Consume an invite token to set an initial password — ported from
 * alTaxPortalSetPassword. Public (no requireAuth): the whole point is that a
 * brand-new user has no session yet, only the emailed/handed-over token. Matches
 * legacy exactly: email+token must both match the same row, token must not be
 * expired, then password is set and the token is consumed (single-use).
 */
authRouter.post("/accept-invite", asyncHandler(async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email is required." });
  if (!token) return res.status(400).json({ error: "Setup token is required." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM altax.v3_users WHERE lower(email) = $1`, [email]);
    if (!rows.length) return res.status(404).json({ error: "No portal user found for this email." });
    const row = rows.find((r: any) => String(r.invite_token || "").trim() === token);
    if (!row) return res.status(400).json({ error: "Setup token does not match this email." });

    const expires = row.invite_expires ? new Date(row.invite_expires) : null;
    if (expires && !Number.isNaN(expires.getTime()) && expires.getTime() < Date.now()) {
      return res.status(400).json({ error: "Setup token expired. Ask an Admin to resend the invite." });
    }

    const fields = createPasswordHashFields(password);
    await client.query(
      `UPDATE altax.v3_users
         SET password_hash = $1, password_salt = $2, password_hash_version = 2, last_password_change_at = $3,
             invite_token = NULL, invite_expires = NULL, must_reset_password = FALSE, last_login = now()
       WHERE user_id = $4`,
      [fields.PasswordHash, fields.PasswordSalt, fields.LastPasswordChangeAt, row.user_id]
    );
    await logAudit("Security", "SET_PASSWORD", row.user_id || email, "PasswordHash", "", "Set", "Portal password created.", email);

    return res.json({ ok: true, email });
  } finally {
    client.release();
  }
}));

/**
 * Self-service "forgot password" — reuses the exact same invite_token/invite_expires
 * mechanism and /accept-invite page as admin-sent invites, just triggered by the user
 * instead of an admin. Always returns the same generic response whether or not the
 * email matches an account, so this can't be used to enumerate real user emails.
 */
authRouter.post("/forgot-password", asyncHandler(async (req: Request, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = { ok: true, message: "If an account exists for that email, a password reset link has been sent." };
  if (!email || !email.includes("@")) return res.json(generic);

  const last = forgotPasswordCooldown.get(email);
  if (last && Date.now() - last < FORGOT_PASSWORD_COOLDOWN_MS) return res.json(generic);
  forgotPasswordCooldown.set(email, Date.now());

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM altax.v3_users WHERE lower(email) = $1`, [email]);
    const row = rows[0];
    if (!row) return res.json(generic);

    const token = newResetToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await client.query(`UPDATE altax.v3_users SET invite_token = $1, invite_expires = $2 WHERE user_id = $3`, [token, expires, row.user_id]);

    const link = resetLink(req, String(row.role || "").toLowerCase(), token, email);
    const html = await wrapEmailHtml(`
      <p>Hi ${row.name || ""},</p>
      <p>We received a request to reset the password for your account. This link is valid for 1 hour.</p>
      <p><a href="${link}">Reset your password</a></p>
      <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>
    `, req);
    const { sendEmail } = await import("../../common/notifications");
    await sendEmail({ to: email, subject: "Reset your password", html }).catch(() => {});

    await logAudit("Security", "FORGOT_PASSWORD_REQUEST", row.user_id || email, "", "", "", "Password reset link requested.", email);
    return res.json(generic);
  } finally {
    client.release();
  }
}));

authRouter.post("/change-password", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [req.user!.sub]);
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "User not found." });

    if (row.password_hash) {
      const check = verifyPassword(currentPassword || "", row.password_hash);
      if (!check.valid) return res.status(401).json({ error: "Current password is incorrect." });
    }

    const updated = createPasswordHashFields(newPassword);
    await client.query(
      `UPDATE altax.v3_users
         SET password_hash = $1, password_salt = $2, password_hash_version = 2,
             last_password_change_at = $3, must_reset_password = FALSE,
             failed_login_count = NULL, locked_until = NULL
       WHERE user_id = $4`,
      [updated.PasswordHash, updated.PasswordSalt, updated.LastPasswordChangeAt, row.user_id]
    );

    return res.json({ ok: true });
  } finally {
    client.release();
  }
}));
