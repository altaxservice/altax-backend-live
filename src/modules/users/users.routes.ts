import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { normalizePortalRole } from "../auth/auth.service";
import { asyncHandler } from "../../common/asyncHandler";
import { createPasswordHashFields } from "../auth/password";
import { normalizeText, isAssignedToUser } from "../../common/assignment";

export const usersRouter = Router();

function newInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + String(Math.floor(100000 + Math.random() * 900000));
}

/** Mirrors alTaxV3NextId_("USR-"): prefix + yyyyMMddHHmmss + "-" + 3-digit random. */
function nextUserId(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `USR-${ts}-${rand}`;
}

/**
 * Mirrors alTaxV5PortalInviteLink_, adapted for this app's real accept-invite
 * page: points at /accept-invite (not the portal login) so the link is
 * immediately actionable — email + token pre-filled, matching what
 * POST /auth/accept-invite expects.
 */
// Derives from the request's own protocol+host — see contracts.routes.ts's
// link-building for why: a misconfigured/locally-scoped FRONTEND_BASE_URL
// silently produced invite links unreachable from anywhere but the sender's
// own machine, with no error to surface it.
function inviteLink(req: AuthedRequest, role: string, token: string, email?: string): string {
  const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (token) params.set("invite", token);
  if (role) params.set("portal", role);
  return `${base}/accept-invite?${params.toString()}`;
}

/**
 * Attempts a real invite email (see src/common/notifications.ts) now that this backend
 * has email infra; previously every invite route returned the link for the admin to
 * deliver manually with no attempt to send. Never throws — a missing RESEND_API_KEY or
 * a delivery failure falls back to that same manual-link behavior instead of blocking
 * user creation, so this is purely additive.
 */
async function sendInviteEmail(email: string, name: string, link: string): Promise<{ sent: boolean; error?: string }> {
  try {
    const { sendEmail } = await import("../../common/notifications");
    await sendEmail({
      to: email, subject: "You've been invited to the AL Tax Service portal",
      html: `<p>Hi ${name || ""},</p><p>You've been invited to the AL Tax Service portal. Click the link below to set up your account:</p><p><a href="${link}">${link}</a></p>`,
    });
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err?.message || "Send failed." };
  }
}

/**
 * List portal users — Admin only, matching how Portal Access management is gated in legacy
 * (every save/deactivate/delete call there requires alTaxV5RequirePortalUser_(email, true)).
 * Deliberately never returns password_hash/password_salt/invite_token — the frontend has no
 * legitimate use for those, so unlike the legacy Sheet (which returns full admin rows), this
 * substitutes a has_pending_invite boolean. Preserving unnecessary sensitive-field exposure
 * isn't "existing behavior" worth keeping — it's an avoidable data-exposure risk.
 */
usersRouter.get("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT user_id, email, name, role, phone, assigned_client_id, assigned_employee_id,
            reminder_preference, active, last_login, must_reset_password, invite_expires,
            (invite_token IS NOT NULL AND invite_token <> '') AS has_pending_invite
       FROM altax.v3_users
      ORDER BY name ASC`
  );

  const [clients, employees, openTasks] = await Promise.all([
    query<{ client_id: string; client_name: string }>(`SELECT client_id, client_name FROM altax.v3_clients`),
    query<{ employee_id: string; employee_name: string; client_id: string; client_name: string }>(
      `SELECT employee_id, employee_name, client_id, client_name FROM altax.v3_employees`
    ),
    query<{ client_id: string | null; assigned_to: string | null; agency_due_date: string | null }>(
      `SELECT client_id, assigned_to, agency_due_date FROM altax.v3_tasks WHERE lower(status) NOT IN ('completed','void','closed','archived')`
    ),
  ]);
  const clientNameById = new Map(clients.map((c) => [c.client_id, c.client_name]));
  const employeeById = new Map(employees.map((e) => [e.employee_id, e]));

  // Mirrors getUserAliases(email) but built once from the already-fetched user list, avoiding N+1 lookups.
  const aliasesByEmail = new Map<string, Set<string>>();
  for (const u of rows) {
    const email = normalizeText(u.email);
    if (!email) continue;
    const set = aliasesByEmail.get(email) || new Set<string>();
    for (const value of [u.email, u.name, u.user_id]) {
      const text = normalizeText(value);
      if (text) set.add(text);
    }
    aliasesByEmail.set(email, set);
  }

  const now = Date.now();
  const enriched = rows.map((u) => {
    const roleKey = normalizeText(u.role);
    let assignmentLabel = "Firm-wide";
    if (roleKey === "client" && u.assigned_client_id) {
      const name = clientNameById.get(u.assigned_client_id);
      assignmentLabel = name ? `${name} (${u.assigned_client_id})` : u.assigned_client_id;
    } else if (roleKey === "employee" && u.assigned_employee_id) {
      const emp = employeeById.get(u.assigned_employee_id);
      assignmentLabel = emp ? `${emp.employee_name} (${emp.employee_id}) - ${emp.client_name}` : u.assigned_employee_id;
    }

    let open = 0;
    let overdue = 0;
    if (roleKey === "client" && u.assigned_client_id) {
      for (const t of openTasks) {
        if (t.client_id !== u.assigned_client_id) continue;
        open += 1;
        if (t.agency_due_date && new Date(t.agency_due_date).getTime() < now) overdue += 1;
      }
    } else if (roleKey === "admin" || roleKey === "staff") {
      const aliases = aliasesByEmail.get(normalizeText(u.email)) || new Set<string>();
      for (const t of openTasks) {
        if (!isAssignedToUser(t.assigned_to, aliases)) continue;
        open += 1;
        if (t.agency_due_date && new Date(t.agency_due_date).getTime() < now) overdue += 1;
      }
    }

    return { ...u, assignment_label: assignmentLabel, open_count: open, overdue_count: overdue };
  });

  res.json({ users: enriched });
}));

/**
 * Create or update a staff/portal user — ported from alTaxPortalSaveStaffUser. Admin-only in
 * legacy. Upserts by userId when given, else by email+role match; blocks duplicate email+role
 * pairs the same way alTaxV5FindDuplicateUserForEmailRole_ does. On create — or on editing an
 * account that still has neither a password nor a pending invite — issues a fresh 7-day invite
 * token exactly like legacy. Mirrors alTaxV5TrySendInviteEmail_: attempts a real email via
 * sendInviteEmail() below (Resend, gated on RESEND_API_KEY same as invoice sending) and
 * reports the outcome as inviteEmailed/inviteEmailError; the invite link is always also
 * returned in the response so the admin can deliver it manually if email isn't connected
 * yet or delivery fails — this never blocks user creation either way.
 */
usersRouter.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "Staff email is required." });
  if (!name) return res.status(400).json({ error: "Staff name is required." });

  const requestedRole = String(body.role || "Staff").trim();
  const roleKey = normalizePortalRole(requestedRole);
  const assignedClientId = String(body.assignedClientId || "").trim();
  const assignedEmployeeId = String(body.assignedEmployeeId || "").trim();
  let userId = String(body.userId || "").trim();
  if (!userId && roleKey === "client" && assignedClientId) userId = `usr_${assignedClientId}`;
  if (!userId && roleKey === "employee" && assignedEmployeeId) userId = `emp_${assignedEmployeeId}`;

  const duplicate = await queryOne<any>(
    `SELECT user_id, name, email FROM altax.v3_users WHERE lower(email) = $1 AND lower(role) = $2 AND user_id <> $3`,
    [email, roleKey, userId || ""]
  );
  if (duplicate) {
    return res.status(409).json({
      error: `This email is already used for a ${roleKey} portal user: ${duplicate.name || duplicate.user_id}. Edit that user or use a different email.`,
    });
  }

  const existing = userId
    ? await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId])
    : await queryOne<any>(`SELECT * FROM altax.v3_users WHERE lower(email) = $1 AND lower(role) = $2`, [email, roleKey]);

  const finalUserId = existing?.user_id || userId || nextUserId();

  let issuedInviteToken = "";
  let inviteTokenToStore: string | null = existing?.invite_token ?? null;
  let inviteExpiresToStore: Date | null = existing?.invite_expires ?? null;
  let mustResetToStore: boolean = existing?.must_reset_password ?? true;

  if (!existing || (!existing.password_hash && !existing.invite_token)) {
    issuedInviteToken = newInviteToken();
    inviteTokenToStore = issuedInviteToken;
    inviteExpiresToStore = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    mustResetToStore = true;
  }

  const phone = String(body.phone || "").trim() || null;
  const reminderPreference = String(body.reminderPreference || "Email").trim();
  const active = body.active === undefined ? true : Boolean(body.active);
  const params = [
    finalUserId, email, name, requestedRole, phone, assignedClientId || null, assignedEmployeeId || null,
    reminderPreference, active, inviteTokenToStore, inviteExpiresToStore, mustResetToStore,
    "Node Web App", userId || email,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_users SET
         email = $2, name = $3, role = $4, phone = $5, assigned_client_id = $6, assigned_employee_id = $7,
         reminder_preference = $8, active = $9, invite_token = $10, invite_expires = $11,
         must_reset_password = $12, source_system = $13, source_record_id = $14, updated_at = now()
       WHERE user_id = $1`,
      params
    );
    await logAudit("Staff", "EDIT", finalUserId, "User", existing.email || "", email,
      `Staff user updated by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_users
         (user_id, email, name, role, phone, assigned_client_id, assigned_employee_id,
          reminder_preference, active, invite_token, invite_expires, must_reset_password,
          source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      params
    );
    await logAudit("Staff", "CREATE", finalUserId, "", "", email,
      `Staff user created by ${req.user!.email}.`, req.user!.email);
  }

  let inviteEmailed = false;
  let inviteEmailError: string | undefined;
  const issuedLink = issuedInviteToken ? inviteLink(req, roleKey, issuedInviteToken, email) : undefined;
  if (issuedLink) {
    const result = await sendInviteEmail(email, name, issuedLink);
    inviteEmailed = result.sent;
    inviteEmailError = result.error;
  }

  res.status(existing ? 200 : 201).json({
    ok: true,
    userId: finalUserId,
    inviteToken: issuedInviteToken || undefined,
    inviteLink: issuedLink,
    inviteEmailed,
    inviteEmailError,
  });
}));

/**
 * Deactivate a portal user — ported from alTaxPortalDeleteStaffUser, which despite its name
 * only flips Active=Inactive (soft delete). Admin-only.
 */
usersRouter.post("/:userId/deactivate", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!old) return res.status(404).json({ error: "Staff user not found." });

  await query(`UPDATE altax.v3_users SET active = false, updated_at = now() WHERE user_id = $1`, [userId]);
  await logAudit("Staff", "DEACTIVATE", userId, "Active", String(old.active), "Inactive",
    `Staff user deactivated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, userId });
}));

/**
 * Permanently delete a portal user — ported from alTaxPortalHardDeleteUser. Previously
 * skipped like every other hard-delete this session; now built at the user's explicit
 * request with a typed-confirmation gate added as extra safety beyond legacy's ungated
 * version (same pattern as Tasks/Documents hard-delete). Blocked from deleting your own
 * logged-in account, matching legacy's one guard rail.
 */
usersRouter.post("/:userId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE USER") {
    return res.status(400).json({ error: 'Type "DELETE USER" to confirm this permanent action.' });
  }
  if (userId === req.user!.sub) {
    return res.status(400).json({ error: "You cannot delete your own logged-in account." });
  }
  const old = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!old) return res.status(404).json({ error: "Portal user not found." });

  await query(`DELETE FROM altax.v3_users WHERE user_id = $1`, [userId]);
  await logAudit("Staff", "DELETE", userId, "User", old.email || "", "",
    `Portal user permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, userId });
}));

/**
 * Resend invite — ported from alTaxPortalResendUserInvite. Only issues a NEW
 * token if the existing one is missing/expired (matches legacy's needsNewToken
 * check); otherwise re-returns the still-valid token/link so the admin can
 * hand it over again without invalidating a link already sent.
 */
usersRouter.post("/:userId/resend-invite", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  const user = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!user) return res.status(404).json({ error: "Portal user not found." });
  if (!String(user.email || "").trim()) return res.status(400).json({ error: "Portal user email is missing." });

  const existingToken = String(user.invite_token || "").trim();
  const expires = user.invite_expires ? new Date(user.invite_expires) : null;
  const needsNewToken = !existingToken || !expires || Number.isNaN(expires.getTime()) || expires.getTime() < Date.now();

  let token = existingToken;
  if (needsNewToken) {
    token = newInviteToken();
    const fields: any = { invite_token: token, invite_expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) };
    if (!String(user.password_hash || "").trim()) fields.must_reset_password = true;
    await query(
      `UPDATE altax.v3_users SET invite_token = $2, invite_expires = $3, must_reset_password = COALESCE($4, must_reset_password), updated_at = now() WHERE user_id = $1`,
      [userId, fields.invite_token, fields.invite_expires, fields.must_reset_password ?? null]
    );
  }

  await logAudit("Security", "RESEND_INVITE", user.user_id || user.email, "InviteToken", "", needsNewToken ? "Created" : "Sent",
    `Invite resent by ${req.user!.email}.`, req.user!.email);

  const link = inviteLink(req, user.role || "Portal", token, user.email);
  const result = await sendInviteEmail(user.email, user.name || "", link);

  res.json({
    ok: true, email: user.email, userId: user.user_id, token, generatedNewToken: needsNewToken, inviteLink: link,
    inviteEmailed: result.sent, inviteEmailError: result.error,
  });
}));

/**
 * Reset invite — ported from alTaxPortalResetUserInvite. Unlike resend, this
 * unconditionally wipes the existing password and issues a fresh token,
 * forcing the user through setup again — the "this account is stuck" escape
 * hatch (lost password, compromised account, etc).
 */
usersRouter.post("/:userId/reset-invite", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  const user = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!user) return res.status(404).json({ error: "Portal user not found." });

  const token = newInviteToken();
  await query(
    `UPDATE altax.v3_users
       SET password_hash = NULL, password_salt = NULL, password_hash_version = NULL,
           invite_token = $2, invite_expires = $3, failed_login_count = NULL, locked_until = NULL,
           last_password_change_at = NULL, must_reset_password = TRUE, updated_at = now()
     WHERE user_id = $1`,
    [userId, token, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)]
  );

  await logAudit("Security", "RESET_INVITE", user.user_id || user.email, "InviteToken", "", "Created",
    `Invite reset by ${req.user!.email}.`, req.user!.email);

  const link = inviteLink(req, user.role || "Portal", token, user.email);
  const result = await sendInviteEmail(user.email, user.name || "", link);

  res.json({
    ok: true, email: user.email, userId: user.user_id, token, inviteLink: link,
    inviteEmailed: result.sent, inviteEmailError: result.error,
  });
}));

/**
 * Set a one-time temporary password — ported from alTaxPortalSetUserTemporaryPassword.
 * Returned in the response body only, deliberately never emailed — even now that email
 * infra exists (see sendInviteEmail above), sending a plaintext password over email is
 * worse practice than the invite-link flow, not merely unbuilt. Forces
 * MustResetPassword so the user is required to change it after their first login.
 */
usersRouter.post("/:userId/temporary-password", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  const user = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!user) return res.status(404).json({ error: "Portal user not found." });

  const tempPassword = "ALTAX-" + crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  const fields = createPasswordHashFields(tempPassword);
  await query(
    `UPDATE altax.v3_users
       SET password_hash = $2, password_salt = $3, password_hash_version = 2, last_password_change_at = $4,
           invite_token = NULL, invite_expires = NULL, must_reset_password = TRUE, updated_at = now()
     WHERE user_id = $1`,
    [userId, fields.PasswordHash, fields.PasswordSalt, fields.LastPasswordChangeAt]
  );

  await logAudit("Security", "TEMP_PASSWORD", user.user_id || user.email, "PasswordHash", "", "Set",
    `Temporary password set by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, email: user.email, userId: user.user_id, temporaryPassword: tempPassword });
}));
