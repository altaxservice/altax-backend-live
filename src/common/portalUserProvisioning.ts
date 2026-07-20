import crypto from "crypto";
import type { Request } from "express";
import { query, queryOne } from "../config/db";

function newInviteToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + String(Math.floor(100000 + Math.random() * 900000));
}

/** Mirrors inviteLink() in users.routes.ts — kept in sync manually since both build the same /accept-invite URL shape. */
function inviteLink(req: Request, role: string, token: string, email?: string): string {
  const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (email) params.set("email", email);
  if (token) params.set("invite", token);
  if (role) params.set("portal", role);
  return `${base}/accept-invite?${params.toString()}`;
}

/**
 * Auto-provisions an "employee" role portal user when an employee profile is
 * saved with grantPortalAccess=true, so an admin doesn't have to separately
 * visit Portal Access and create a matching v3_users row by hand — mirrors
 * how a client's PortalEnabled flag already drives portal access from the
 * client profile itself. Upserts by a deterministic userId (emp_<employeeId>)
 * so re-saving the same employee with the flag on doesn't create duplicates,
 * and reuses the same 7-day invite-token convention as the Portal Access
 * "create staff user" flow (users.routes.ts) so both paths behave identically
 * from the invited employee's perspective.
 */
export async function provisionEmployeePortalUser(req: Request, params: {
  employeeId: string;
  employeeName: string;
  email: string;
  clientId: string;
}): Promise<{ userId: string; inviteToken?: string; inviteLink?: string; inviteEmailed?: boolean } | null> {
  const email = String(params.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return null;

  const userId = `emp_${params.employeeId}`;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_users WHERE user_id = $1`, [userId]);

  const duplicate = await queryOne<any>(
    `SELECT user_id FROM altax.v3_users WHERE lower(email) = $1 AND lower(role) = 'employee' AND user_id <> $2`,
    [email, userId]
  );
  if (duplicate) return null;

  let issuedInviteToken = "";
  let inviteTokenToStore: string | null = existing?.invite_token ?? null;
  let inviteExpiresToStore: Date | null = existing?.invite_expires ?? null;

  if (!existing || (!existing.password_hash && !existing.invite_token)) {
    issuedInviteToken = newInviteToken();
    inviteTokenToStore = issuedInviteToken;
    inviteExpiresToStore = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  if (existing) {
    await query(
      `UPDATE altax.v3_users SET email=$2, name=$3, role='Employee', assigned_client_id=$4, assigned_employee_id=$5,
         active=true, invite_token=$6, invite_expires=$7, updated_at=now()
       WHERE user_id = $1`,
      [userId, email, params.employeeName, params.clientId, params.employeeId, inviteTokenToStore, inviteExpiresToStore]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_users
         (user_id, email, name, role, assigned_client_id, assigned_employee_id, reminder_preference, active,
          invite_token, invite_expires, must_reset_password, source_system, source_record_id)
       VALUES ($1,$2,$3,'Employee',$4,$5,'Email',true,$6,$7,true,'Node Web App',$1)`,
      [userId, email, params.employeeName, params.clientId, params.employeeId, inviteTokenToStore, inviteExpiresToStore]
    );
  }

  const issuedLink = issuedInviteToken ? inviteLink(req, "employee", issuedInviteToken, email) : undefined;
  let inviteEmailed = false;
  if (issuedLink) {
    try {
      const { sendEmail } = await import("./notifications");
      await sendEmail({
        to: email, subject: "You've been invited to the AL Tax Service portal",
        html: `<p>Hi ${params.employeeName || ""},</p><p>You've been invited to the AL Tax Service portal. Click the link below to set up your account:</p><p><a href="${issuedLink}">${issuedLink}</a></p>`,
      });
      inviteEmailed = true;
    } catch {
      // Not configured or delivery failed — inviteLink below still lets the admin hand it over manually.
    }
  }

  return {
    userId,
    inviteToken: issuedInviteToken || undefined,
    inviteLink: issuedLink,
    inviteEmailed,
  };
}
