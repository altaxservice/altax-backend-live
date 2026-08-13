/**
 * Delivery-status webhooks from Resend (email) and Twilio (SMS/WhatsApp) — closes
 * the gap where "sent" in v3_communications only ever meant the provider's send API
 * call didn't throw, never whether the message actually reached anyone. Each
 * provider's own message id (captured at send time — see notifications.ts /
 * sendChannel.ts) is the join key back to the right row.
 *
 * Both routes must be mounted in server.ts BEFORE the global express.json()
 * middleware: Resend's signature is computed over the exact raw request body, and
 * express.json() would already have consumed and discarded those bytes by the time
 * a route handler runs. Each route brings its own narrowly-scoped body parser
 * instead (express.raw for Resend, express.urlencoded for Twilio's form POST).
 *
 * Neither route requires login — a webhook has no user session, only its own
 * signature to prove authenticity — so signature verification IS the auth check.
 * An unconfigured or invalid signature is rejected with 401/501 rather than
 * silently accepted, since accepting unverified delivery-status writes would let
 * anyone forge "delivered"/"bounced" status for any communication row.
 */
import express, { Router, Request, Response } from "express";
import crypto from "crypto";
import twilio from "twilio";
import { query } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";

export const webhooksRouter = Router();

/**
 * Resend signs webhooks the Svix way: headers svix-id/svix-timestamp/svix-signature,
 * signed content is "{id}.{timestamp}.{raw body}", secret is base64 after stripping
 * the "whsec_" prefix, HMAC-SHA256, base64-digest. svix-signature can carry multiple
 * space-separated "v1,<sig>" values across a secret rotation — any match is valid.
 * No svix npm package is installed, so this is implemented directly against their
 * documented algorithm rather than adding a new dependency for one HMAC check.
 */
export function verifyResendSignature(rawBody: Buffer, headers: Request["headers"], secret: string): boolean {
  const svixId = headers["svix-id"];
  const svixTimestamp = headers["svix-timestamp"];
  const svixSignature = headers["svix-signature"];
  if (typeof svixId !== "string" || typeof svixTimestamp !== "string" || typeof svixSignature !== "string") return false;

  // Reject stale/replayed deliveries — 5 minutes matches Svix's own documented tolerance.
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");

  return svixSignature
    .split(" ")
    .map((part) => part.split(",")[1])
    .filter(Boolean)
    .some((candidate) => {
      const a = Buffer.from(candidate);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
}

/**
 * Resend delivery-status events: email.delivered, email.bounced, email.complained,
 * email.delivery_delayed, etc. — see https://resend.com/docs/dashboard/webhooks/event-types.
 * data.email_id is the same id captured as provider_message_id at send time.
 */
webhooksRouter.post(
  "/resend",
  // Raw body needed for signature verification; re-parsed as JSON only after it passes.
  (req: Request, res: Response, next) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      (req as any).rawBody = Buffer.concat(chunks);
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    const secret = process.env.RESEND_WEBHOOK_SECRET;
    if (!secret) {
      // eslint-disable-next-line no-console
      console.error("[webhooks] RESEND_WEBHOOK_SECRET is not configured — rejecting Resend webhook delivery.");
      return res.status(501).json({ error: "Resend webhook is not configured." });
    }
    const rawBody: Buffer = (req as any).rawBody || Buffer.alloc(0);
    if (!verifyResendSignature(rawBody, req.headers, secret)) {
      return res.status(401).json({ error: "Invalid signature." });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON body." });
    }

    const eventType = String(payload?.type || "");
    const providerMessageId = payload?.data?.email_id ? String(payload.data.email_id) : null;
    if (!providerMessageId) return res.json({ ok: true }); // Nothing to correlate; ack anyway so Resend doesn't retry forever.

    if (eventType === "email.delivered") {
      await query(
        `UPDATE altax.v3_communications SET delivery_status = 'delivered', delivered_at = now() WHERE provider_message_id = $1`,
        [providerMessageId]
      );
    } else if (eventType === "email.bounced" || eventType === "email.complained") {
      await query(
        `UPDATE altax.v3_communications SET delivery_status = $2, bounced_at = now() WHERE provider_message_id = $1`,
        [providerMessageId, eventType === "email.bounced" ? "bounced" : "complained"]
      );
    } else if (eventType) {
      // Any other lifecycle event (sent, delivery_delayed, opened, clicked, etc.)
      // still updates the status field for visibility, just without a timestamp column of its own.
      await query(`UPDATE altax.v3_communications SET delivery_status = $2 WHERE provider_message_id = $1`, [providerMessageId, eventType.replace(/^email\./, "")]);
    }

    res.json({ ok: true });
  })
);

/**
 * Twilio delivery-status callback, registered per-message via the statusCallback
 * param on client.messages.create() (see notifications.ts sendSms/sendWhatsApp).
 * Twilio POSTs application/x-www-form-urlencoded — the twilio SDK's own
 * validateRequest() (already a dependency, no new package needed) verifies the
 * X-Twilio-Signature header against the exact URL + form params.
 */
webhooksRouter.post(
  "/twilio",
  // Scoped to this route only — the global express.json() this router is
  // mounted ahead of never sees Twilio's form-encoded body anyway.
  express.urlencoded({ extended: false }),
  asyncHandler(async (req: Request, res: Response) => {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) {
      // eslint-disable-next-line no-console
      console.error("[webhooks] TWILIO_AUTH_TOKEN is not configured — rejecting Twilio webhook delivery.");
      return res.status(501).json({ error: "Twilio webhook is not configured." });
    }
    const signature = req.headers["x-twilio-signature"];
    if (typeof signature !== "string") return res.status(401).json({ error: "Missing signature." });

    // Twilio signs the exact URL it POSTed to — reconstructed from the request
    // itself (this app runs behind Railway's proxy with `trust proxy` enabled,
    // so req.protocol/req.get("host") already reflect the real public origin).
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const valid = twilio.validateRequest(authToken, signature, fullUrl, req.body || {});
    if (!valid) return res.status(401).json({ error: "Invalid signature." });

    const providerMessageId = String(req.body?.MessageSid || "");
    const messageStatus = String(req.body?.MessageStatus || "").toLowerCase();
    if (!providerMessageId || !messageStatus) return res.json({ ok: true });

    if (messageStatus === "delivered") {
      await query(
        `UPDATE altax.v3_communications SET delivery_status = 'delivered', delivered_at = now() WHERE provider_message_id = $1`,
        [providerMessageId]
      );
    } else if (messageStatus === "undelivered" || messageStatus === "failed") {
      await query(
        `UPDATE altax.v3_communications SET delivery_status = $2, bounced_at = now() WHERE provider_message_id = $1`,
        [providerMessageId, messageStatus]
      );
    } else {
      // queued, sending, sent, etc.
      await query(`UPDATE altax.v3_communications SET delivery_status = $2 WHERE provider_message_id = $1`, [providerMessageId, messageStatus]);
    }

    res.json({ ok: true });
  })
);
