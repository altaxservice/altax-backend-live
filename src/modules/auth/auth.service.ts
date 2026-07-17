import { pool } from "../../config/db";
import { verifyPassword, createPasswordHashFields, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_MINUTES } from "./password";
import { logAudit } from "../../common/audit";

export type PortalRole = "admin" | "staff" | "client" | "employee" | "general";

export function normalizePortalRole(role: string | undefined | null): PortalRole {
  const key = String(role || "").toLowerCase().trim();
  if (key === "admin" || key === "staff" || key === "client" || key === "employee") return key;
  return "general";
}

function isActive(value: unknown): boolean {
  const text = String(value ?? "yes").toLowerCase().trim();
  return text !== "no" && text !== "false" && text !== "inactive" && text !== "archived";
}

export interface AuthSuccess {
  role: PortalRole;
  email: string;
  name: string;
  userId: string;
  clientId: string;
  clientName: string;
  preferredLanguage: string;
  employeeId: string;
  employeeName: string;
  authMode: "password" | "email";
  mustResetPassword: boolean;
  totpEnabled: boolean;
}

export interface AuthError {
  error: string;
}

/**
 * Ported from alTaxV3AuthenticateUser(email, requestedRole, password, options) in Code.gs.
 * Preserves: per-role active-user matching, 5-attempt/15-minute lockout (v3_Users
 * FailedLoginCount/LockedUntil), legacy-hash upgrade on successful login, and
 * client/employee resolution + inactive-company checks for those roles.
 */
export async function authenticateUser(
  emailRaw: string,
  requestedRoleRaw: string,
  password: string
): Promise<AuthSuccess | AuthError> {
  const email = String(emailRaw || "").trim().toLowerCase();
  const requestedRole = normalizePortalRole(requestedRoleRaw);

  if (!email || !email.includes("@")) {
    return { error: "Please enter a valid email address." };
  }

  const client = await pool.connect();
  try {
    const { rows: users } = await client.query(
      `SELECT * FROM altax.v3_users WHERE lower(email) = $1`,
      [email]
    );

    let selectedUser: any = null;
    let foundMatchingEmail = false;
    let foundActiveMatch = false;
    let foundInactiveMatch = false;
    let foundPasswordRow = false;
    let failedPasswordRow: any = null;
    let lockedUntilMs = 0;

    for (const row of users) {
      foundMatchingEmail = true;
      const rowRole = normalizePortalRole(row.role || "staff") || "staff";

      if (!isActive(row.active)) {
        if (!requestedRole || requestedRole === "general" || rowRole === requestedRole) foundInactiveMatch = true;
        continue;
      }
      if (requestedRole !== "general" && rowRole !== requestedRole) continue;

      const storedHash = String(row.password_hash || "").trim();
      foundActiveMatch = true;
      if (storedHash) foundPasswordRow = true;

      if (storedHash) {
        const rowLockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
        if (rowLockedUntil && rowLockedUntil > Date.now()) {
          lockedUntilMs = rowLockedUntil;
          continue;
        }
        if (!failedPasswordRow) failedPasswordRow = row;

        const check = verifyPassword(password || "", storedHash);
        if (check.valid) {
          selectedUser = row;
          if (check.needsUpgrade) {
            const upgraded = createPasswordHashFields(password || "");
            await client.query(
              `UPDATE altax.v3_users
                 SET password_hash = $1, password_salt = $2, password_hash_version = 2,
                     last_password_change_at = $3, failed_login_count = NULL, locked_until = NULL
               WHERE user_id = $4`,
              [upgraded.PasswordHash, upgraded.PasswordSalt, upgraded.LastPasswordChangeAt, row.user_id]
            );
            await logAudit(
              "Security", "PASSWORD_HASH_UPGRADED", row.user_id || row.email || "",
              "PasswordHashVersion", "legacy", "v2",
              "Legacy portal password hash upgraded after successful login."
            );
          } else {
            await client.query(
              `UPDATE altax.v3_users SET failed_login_count = NULL, locked_until = NULL WHERE user_id = $1`,
              [row.user_id]
            );
          }
          break;
        }
      }
    }

    if (!selectedUser) {
      if (lockedUntilMs && lockedUntilMs > Date.now()) {
        return { error: `Too many incorrect attempts. This account is locked until ${new Date(lockedUntilMs).toLocaleString()}.` };
      }
      if (foundMatchingEmail && !foundActiveMatch && foundInactiveMatch) {
        return { error: "This user is inactive." };
      }
      if (foundMatchingEmail && requestedRole !== "general" && !foundActiveMatch) {
        return {
          error: `This email exists, but not as an active ${requestedRole} portal user. Choose the correct portal or ask Admin to add that role.`,
        };
      }
      if (foundMatchingEmail) {
        if (foundPasswordRow) {
          const failure = await recordFailedLogin(client, failedPasswordRow);
          if (failure.lockedUntil) {
            return { error: `Too many incorrect attempts. This account is locked until ${new Date(failure.lockedUntil).toLocaleString()}.` };
          }
          return { error: `Password is required or incorrect for this ${requestedRole !== "general" ? requestedRole : "portal"} account.` };
        }
        return {
          error:
            "This account does not have a password yet. Ask an Admin to set a temporary password or resend the invitation.",
        };
      }
      return { error: "No matching portal user or client email was found." };
    }

    const result = await buildAuthSuccess(client, selectedUser, email);
    if (isErrorResult(result)) return result;

    await client.query(`UPDATE altax.v3_users SET last_login = now() WHERE user_id = $1`, [selectedUser.user_id]);
    return result;
  } finally {
    client.release();
  }
}

function isErrorResult(result: AuthSuccess | AuthError): result is AuthError {
  return (result as AuthError).error !== undefined;
}

/**
 * Resolves a matched v3_users row into the AuthSuccess shape (role,
 * client/employee resolution). Shared by password login and the TOTP
 * verify-code step, which both end with the same "known-good user row" ->
 * session-payload conversion but reach that row via different checks.
 */
export async function buildAuthSuccess(client: any, selectedUser: any, emailOverride?: string): Promise<AuthSuccess | AuthError> {
  const email = emailOverride || String(selectedUser.email || "").trim().toLowerCase();
  const role = normalizePortalRole(selectedUser.role || "staff") || "staff";
  let clientId = String(selectedUser.assigned_client_id || "").trim();
  let clientName = "";
  let preferredLanguage = "";
  let employeeId = String(selectedUser.assigned_employee_id || "").trim();
  let employeeName = "";

  if (role === "client") {
    const c = await findClientById(client, clientId);
    if (!c) return { error: "Assigned client company was not found." };
    if (!isActive(c.status)) return { error: "Assigned client company is inactive." };
    clientName = c.client_name || clientId;
    preferredLanguage = String(c.preferred_language || "Both").trim() || "Both";
  }

  if (role === "employee") {
    const emp = employeeId
      ? await findEmployeeById(client, employeeId)
      : await findEmployeeByEmail(client, email);
    if (!emp) return { error: "Employee profile was not found for this portal account." };
    employeeId = String(emp.employee_id || employeeId || "").trim();
    employeeName = String(emp.employee_name || selectedUser.name || "").trim();
    clientId = String(emp.client_id || clientId || "").trim();
    const empClient = await findClientById(client, clientId);
    clientName = empClient ? String(empClient.client_name || clientId).trim() : clientId;
  }

  return {
    role,
    email,
    name: String(selectedUser.name || selectedUser.email || "").trim(),
    userId: String(selectedUser.user_id || "").trim(),
    clientId,
    clientName,
    preferredLanguage,
    employeeId,
    employeeName,
    authMode: selectedUser.password_hash ? "password" : "email",
    mustResetPassword: String(selectedUser.must_reset_password || "").toLowerCase() === "true",
    totpEnabled: Boolean(selectedUser.totp_enabled),
  };
}

async function findClientById(client: any, clientId: string) {
  if (!clientId) return null;
  const { rows } = await client.query(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  return rows[0] || null;
}

async function findEmployeeById(client: any, employeeId: string) {
  const { rows } = await client.query(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  return rows[0] || null;
}

async function findEmployeeByEmail(client: any, email: string) {
  const { rows } = await client.query(`SELECT * FROM altax.v3_employees WHERE lower(email) = $1`, [email]);
  return rows[0] || null;
}

/** Ported from alTaxV5RecordFailedLogin_: increments FailedLoginCount, locks after LOGIN_FAILURE_LIMIT. */
async function recordFailedLogin(client: any, userRow: any): Promise<{ count: number; lockedUntil: number }> {
  if (!userRow) return { count: 0, lockedUntil: 0 };
  let count = Number(userRow.failed_login_count || 0);
  if (Number.isNaN(count) || count < 0) count = 0;
  count += 1;

  let lockedUntil = 0;
  let lockedUntilDate: Date | null = null;
  if (count >= LOGIN_FAILURE_LIMIT) {
    lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
    lockedUntilDate = new Date(lockedUntil);
  }

  await client.query(
    `UPDATE altax.v3_users SET failed_login_count = $1, locked_until = $2 WHERE user_id = $3`,
    [count, lockedUntilDate, userRow.user_id]
  );

  await logAudit(
    "Security",
    lockedUntil ? "LOGIN_LOCKED" : "LOGIN_FAILED",
    userRow.user_id || userRow.email || "",
    "FailedLoginCount",
    String(count - 1),
    String(count),
    lockedUntil ? "Portal user locked after repeated failed sign-ins." : "Incorrect portal password."
  );

  return { count, lockedUntil };
}
