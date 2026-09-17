import crypto from "crypto";
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";
import { verifyPassword } from "../auth/password";
import { closePunchAndRecordHours } from "../kiosk/kioskPunch";

export const publicKioskRouter = Router();

const PIN_FAILURE_LIMIT = 5;
const PIN_LOCK_MINUTES = 15;

// Generous window for the roster refresh (polled by the kiosk screen), tight
// window for punch attempts — this is the actual PIN brute-force defense
// alongside the per-user lockout below (an attacker spraying PINs across many
// users from one device hits this first).
const rosterLimiter = rateLimit({ name: "public-kiosk-roster", windowMs: 60 * 1000, max: 30 });
const punchLimiter = rateLimit({ name: "public-kiosk-punch", windowMs: 60 * 1000, max: 20 });

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Validates a device token against v3_kiosk_devices — active only, and touches last_used_at so an admin can see which physical kiosk is actually in use. */
async function requireDevice(req: Request, res: Response): Promise<{ device_id: string; label: string } | null> {
  const token = String(req.body?.token || req.query?.token || "").trim();
  if (!token) { res.status(401).json({ error: "This kiosk isn't set up yet." }); return null; }
  const device = await queryOne<any>(`SELECT device_id, label FROM altax.v3_kiosk_devices WHERE device_token = $1 AND active = true`, [token]);
  if (!device) { res.status(401).json({ error: "This kiosk's access was revoked. Ask an admin to reconnect it." }); return null; }
  query(`UPDATE altax.v3_kiosk_devices SET last_used_at = now() WHERE device_id = $1`, [device.device_id]).catch(() => {});
  return device;
}

/**
 * The roster the kiosk screen shows — every active Admin/Staff account, live
 * off v3_users, so a new hire appears here the moment their account is
 * created with no separate kiosk setup step. Never returns email/phone/etc,
 * only what a touchscreen needs to render name tiles.
 */
publicKioskRouter.get("/roster", rosterLimiter, asyncHandler(async (req: Request, res: Response) => {
  const device = await requireDevice(req, res);
  if (!device) return;

  const staff = await query<any>(
    `SELECT user_id, name, kiosk_pin_hash IS NOT NULL AS has_pin
       FROM altax.v3_users WHERE lower(role) IN ('admin','staff') AND active = true ORDER BY name ASC`
  );
  const open = await query<any>(`SELECT user_id FROM altax.v3_kiosk_punches WHERE clock_out_at IS NULL`);
  const openSet = new Set(open.map((o: any) => o.user_id));

  res.json({
    kioskLabel: device.label,
    staff: staff.map((s: any) => ({ userId: s.user_id, name: s.name, hasPin: s.has_pin, clockedIn: openSet.has(s.user_id) })),
  });
}));

/**
 * Clock in/out — toggles based on whether this person currently has an open
 * punch. PIN is verified with the same scrypt helper real passwords use, but
 * failures are tracked in kiosk_pin_failed_count/kiosk_pin_locked_until, a
 * SEPARATE counter from the real-login lockout — someone spraying PINs at
 * the kiosk can't also lock the person out of signing in to the real app.
 */
publicKioskRouter.post("/punch", punchLimiter, asyncHandler(async (req: Request, res: Response) => {
  const device = await requireDevice(req, res);
  if (!device) return;

  const userId = String(req.body?.userId || "").trim();
  const pin = String(req.body?.pin || "").trim();
  if (!userId || !pin) return res.status(400).json({ error: "Pick your name and enter your PIN." });

  const user = await queryOne<any>(
    `SELECT user_id, name, kiosk_pin_hash, kiosk_pin_failed_count, kiosk_pin_locked_until
       FROM altax.v3_users WHERE user_id = $1 AND lower(role) IN ('admin','staff') AND active = true`,
    [userId]
  );
  if (!user) return res.status(404).json({ error: "That account isn't available at this kiosk." });

  if (user.kiosk_pin_locked_until && new Date(user.kiosk_pin_locked_until).getTime() > Date.now()) {
    return res.status(423).json({ error: `Too many wrong PIN attempts. Try again in a few minutes, or ask an admin to reset your PIN.` });
  }
  if (!user.kiosk_pin_hash) {
    return res.status(400).json({ error: `${user.name} doesn't have a kiosk PIN set up yet. Ask an admin to set one.` });
  }

  const { valid } = verifyPassword(pin, user.kiosk_pin_hash);
  if (!valid) {
    const failedCount = Number(user.kiosk_pin_failed_count || 0) + 1;
    const lockedUntil = failedCount >= PIN_FAILURE_LIMIT ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000) : null;
    await query(`UPDATE altax.v3_users SET kiosk_pin_failed_count = $2, kiosk_pin_locked_until = $3 WHERE user_id = $1`, [userId, failedCount, lockedUntil]);
    if (lockedUntil) return res.status(423).json({ error: `Too many wrong PIN attempts. Locked for ${PIN_LOCK_MINUTES} minutes.` });
    return res.status(401).json({ error: "Wrong PIN." });
  }
  await query(`UPDATE altax.v3_users SET kiosk_pin_failed_count = NULL, kiosk_pin_locked_until = NULL WHERE user_id = $1`, [userId]);

  const openPunch = await queryOne<any>(
    `SELECT punch_id, clock_in_at FROM altax.v3_kiosk_punches WHERE user_id = $1 AND clock_out_at IS NULL ORDER BY clock_in_at DESC LIMIT 1`,
    [userId]
  );

  if (openPunch) {
    const { hoursAdded } = await closePunchAndRecordHours(
      { punch_id: openPunch.punch_id, user_id: userId, clock_in_at: openPunch.clock_in_at },
      new Date(),
      "Kiosk clock-out"
    );
    return res.json({ ok: true, action: "clock-out", name: user.name, hoursThisPunch: hoursAdded, at: new Date().toISOString() });
  }

  const punchId = `PUNCH-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_kiosk_punches (punch_id, user_id, device_id, clock_in_at) VALUES ($1,$2,$3, now())`,
    [punchId, userId, device.device_id]
  );
  res.json({ ok: true, action: "clock-in", name: user.name, at: new Date().toISOString() });
}));
