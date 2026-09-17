import crypto from "crypto";
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { createPasswordHashFields } from "../auth/password";

export const kioskRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Admin-only device management — a device token is what the physical kiosk holds, never a real user login. */
kioskRouter.get("/devices", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const devices = await query<any>(
    `SELECT device_id, label, active, created_at, created_by, last_used_at FROM altax.v3_kiosk_devices ORDER BY created_at DESC`
  );
  res.json({ devices });
}));

/** Issues a brand-new device token — the token itself is only ever returned here, once, at creation. Losing it means creating a new device and re-pointing the kiosk (Reset below regenerates it deliberately). */
kioskRouter.post("/devices", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const label = String(req.body?.label || "").trim() || "Office Kiosk";
  const deviceId = `KIOSK-${idSuffix()}`;
  const deviceToken = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO altax.v3_kiosk_devices (device_id, device_token, label, active, created_by) VALUES ($1,$2,$3,true,$4)`,
    [deviceId, deviceToken, label, req.user!.email]
  );
  await logAudit("Kiosk", "CREATE", deviceId, "", "", label, `Kiosk device "${label}" created by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ deviceId, deviceToken, label });
}));

/** Revokes a device — the physical kiosk immediately loses access; nothing else on the account is affected. */
kioskRouter.post("/devices/:deviceId/revoke", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { deviceId } = req.params;
  const device = await queryOne<any>(`SELECT label FROM altax.v3_kiosk_devices WHERE device_id = $1`, [deviceId]);
  if (!device) return res.status(404).json({ error: "Kiosk device not found." });
  await query(`UPDATE altax.v3_kiosk_devices SET active = false WHERE device_id = $1`, [deviceId]);
  await logAudit("Kiosk", "REVOKE", deviceId, "Active", "true", "false", `Kiosk device "${device.label}" revoked by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Re-issues a fresh token for an existing device — same device_id/label, old token stops working immediately (e.g. the kiosk tablet was lost). */
kioskRouter.post("/devices/:deviceId/reset-token", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { deviceId } = req.params;
  const device = await queryOne<any>(`SELECT label FROM altax.v3_kiosk_devices WHERE device_id = $1`, [deviceId]);
  if (!device) return res.status(404).json({ error: "Kiosk device not found." });
  const deviceToken = crypto.randomBytes(32).toString("hex");
  await query(`UPDATE altax.v3_kiosk_devices SET device_token = $2, active = true WHERE device_id = $1`, [deviceId, deviceToken]);
  await logAudit("Kiosk", "RESET_TOKEN", deviceId, "", "", "", `Kiosk device "${device.label}" token reset by ${req.user!.email}.`, req.user!.email);
  res.json({ deviceId, deviceToken, label: device.label });
}));

/**
 * Sets (or resets) a Staff/Admin member's kiosk PIN — 4-6 digits, hashed with
 * the same scrypt helper real passwords use, stored in its own column so a
 * PIN can never be used to sign in to the real app. Also clears any kiosk
 * lockout, matching the "reset invite/reset 2FA" recovery pattern already
 * used elsewhere for this kind of account-recovery action.
 */
kioskRouter.post("/users/:userId/pin", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { userId } = req.params;
  const pin = String(req.body?.pin || "").trim();
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: "PIN must be 4 to 6 digits." });

  const user = await queryOne<any>(`SELECT name, role, active FROM altax.v3_users WHERE user_id = $1`, [userId]);
  if (!user) return res.status(404).json({ error: "Portal user not found." });
  if (!["admin", "staff"].includes(String(user.role).toLowerCase())) return res.status(400).json({ error: "Kiosk PINs are only for Admin/Staff accounts." });

  const { PasswordHash } = createPasswordHashFields(pin);
  await query(
    `UPDATE altax.v3_users SET kiosk_pin_hash = $2, kiosk_pin_failed_count = NULL, kiosk_pin_locked_until = NULL WHERE user_id = $1`,
    [userId, PasswordHash]
  );
  await logAudit("Kiosk", "SET_PIN", userId, "", "", "", `Kiosk PIN set for ${user.name} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Admin view of everyone currently clocked in, and how long — the "did someone forget to clock out" check. */
kioskRouter.get("/open-punches", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT p.punch_id, p.user_id, u.name, p.clock_in_at, p.device_id, d.label AS device_label
       FROM altax.v3_kiosk_punches p
       JOIN altax.v3_users u ON u.user_id = p.user_id
       LEFT JOIN altax.v3_kiosk_devices d ON d.device_id = p.device_id
      WHERE p.clock_out_at IS NULL
      ORDER BY p.clock_in_at ASC`
  );
  res.json({ punches: rows });
}));

/**
 * Admin manually closes a punch someone forgot to end — e.g. clocked in
 * Friday and never clocked out. Folds the worked time into v3_time_entries
 * the same way a normal kiosk clock-out does (see closePunchAndRecordHours
 * in publicKiosk.routes.ts, mirrored here since this path doesn't go
 * through the device-token flow).
 */
kioskRouter.post("/punches/:punchId/close", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { punchId } = req.params;
  const clockOutAt = String(req.body?.clockOutAt || "").trim();
  if (!clockOutAt) return res.status(400).json({ error: "clockOutAt is required." });

  const punch = await queryOne<any>(`SELECT * FROM altax.v3_kiosk_punches WHERE punch_id = $1 AND clock_out_at IS NULL`, [punchId]);
  if (!punch) return res.status(404).json({ error: "Open punch not found." });

  const { closePunchAndRecordHours } = await import("./kioskPunch");
  await closePunchAndRecordHours(punch, new Date(clockOutAt), `Manually closed by ${req.user!.email}`);
  await logAudit("Kiosk", "MANUAL_CLOSE", punchId, "", "", clockOutAt, `Open punch manually closed by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
