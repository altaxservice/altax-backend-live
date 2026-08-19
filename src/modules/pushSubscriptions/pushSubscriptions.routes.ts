/**
 * Web Push subscription management — lets an admin opt this specific device
 * (phone or desktop, with the PWA installed) into real push notifications.
 * Admin-only for now: the one thing this currently powers (new-booking alerts,
 * publicAppointments.routes.ts) already only emails admins, so subscription
 * eligibility matches that same audience rather than opening it to staff too.
 */
import { Router, Response } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { query } from "../../config/db";
import { isPushConfigured } from "../../common/webPush";

export const pushSubscriptionsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

/** Whether push is even set up in this environment, plus whether the current user has this device already subscribed — the "Enable Notifications" button reads both to decide its label/state. */
pushSubscriptionsRouter.get("/status", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const count = await query<any>(`SELECT count(*)::int AS n FROM altax.v3_push_subscriptions WHERE lower(user_email) = lower($1)`, [req.user!.email]);
  res.json({ configured: isPushConfigured(), subscribedDeviceCount: count[0]?.n || 0, publicKey: isPushConfigured() ? process.env.VAPID_PUBLIC_KEY : null });
}));

pushSubscriptionsRouter.post("/subscribe", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!isPushConfigured()) return res.status(400).json({ error: "Push notifications are not connected yet." });
  const sub = (req.body || {}).subscription;
  const endpoint = String(sub?.endpoint || "").trim();
  const p256dh = String(sub?.keys?.p256dh || "").trim();
  const auth = String(sub?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: "Invalid subscription." });
  await query(
    `INSERT INTO altax.v3_push_subscriptions (subscription_id, user_email, endpoint, p256dh, auth, user_agent, created_at)
     VALUES ($1,$2,$3,$4,$5,$6, now())
     ON CONFLICT (endpoint) DO UPDATE SET user_email = $2, p256dh = $4, auth = $5, user_agent = $6`,
    [`PUSH-${idSuffix()}`, req.user!.email, endpoint, p256dh, auth, String(req.headers["user-agent"] || "").slice(0, 255)]
  );
  res.json({ ok: true });
}));

pushSubscriptionsRouter.post("/unsubscribe", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const endpoint = String((req.body || {}).endpoint || "").trim();
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint." });
  await query(`DELETE FROM altax.v3_push_subscriptions WHERE endpoint = $1 AND lower(user_email) = lower($2)`, [endpoint, req.user!.email]);
  res.json({ ok: true });
}));
