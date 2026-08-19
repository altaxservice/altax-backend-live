/**
 * Real phone/desktop push notifications for admin — separate from
 * sendEmail/sendSms (notifications.ts). Those need the recipient to already
 * be looking at their inbox/messages; this fires straight from the browser's
 * push service to a device that has the installed PWA open, backgrounded, or
 * even fully closed. Gated on VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY exactly
 * like the other providers are gated on their own env vars — same
 * NotConfiguredError convention, so a caller can catch it the same way.
 *
 * Client-facing appointment reminders deliberately do NOT use this (see
 * publicAppointments.routes.ts) — push requires the recipient to install the
 * PWA and grant permission first, which is a real adoption cost worth paying
 * for staff who open this app daily, not for a client who visits once.
 */
import webpush from "web-push";
import { query } from "../config/db";
import { NotConfiguredError } from "./notifications";

let vapidConfigured = false;
function ensureConfigured(): void {
  if (vapidConfigured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new NotConfiguredError("Push notifications are not connected yet — add VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY to the backend .env to enable them.");
  }
  const subject = process.env.VAPID_SUBJECT || "mailto:altax@almabarigroup.com";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Sends one push notification to every device a given user (by email) has
 * subscribed. Best-effort per subscription: a 404/410 response means the
 * push service itself has expired that subscription (the user uninstalled
 * the PWA, revoked permission, or the browser rotated the endpoint) — that
 * row is deleted so it stops being retried forever; any other failure is
 * swallowed the same way every other send path in this app is (never block
 * the caller's real work over a best-effort notification).
 */
export async function sendPushToUser(email: string, payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;
  ensureConfigured();
  const subs = await query<any>(
    `SELECT subscription_id, endpoint, p256dh, auth FROM altax.v3_push_subscriptions WHERE lower(user_email) = lower($1)`,
    [email]
  );
  if (subs.length === 0) return;
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      await query(`UPDATE altax.v3_push_subscriptions SET last_used_at = now() WHERE subscription_id = $1`, [sub.subscription_id]);
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await query(`DELETE FROM altax.v3_push_subscriptions WHERE subscription_id = $1`, [sub.subscription_id]).catch(() => {});
      }
      // eslint-disable-next-line no-console
      else console.error(`sendPushToUser failed for ${email}:`, err?.message || err);
    }
  }
}

/** Same as sendPushToUser, but for every email in the list — used to notify all active admins at once, matching the admin booking email's own recipient loop. */
export async function sendPushToUsers(emails: string[], payload: PushPayload): Promise<void> {
  if (!isPushConfigured()) return;
  for (const email of emails) await sendPushToUser(email, payload);
}
