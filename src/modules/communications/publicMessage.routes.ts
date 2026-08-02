/**
 * Public, no-login "view this message online" page — the destination of the link
 * appended to a long SMS/WhatsApp send in place of the full bilingual text (see
 * communications.routes.ts's sendChannel: SMS/WhatsApp can't carry a multi-page
 * report in a readable number of segments, so those channels get a short message
 * plus this link instead). Access is gated entirely by knowing the opaque
 * share_token (24 random bytes), same pattern as publicContract.routes.ts /
 * publicInvoice.routes.ts — no portal account needed.
 */
import { Router, Request, Response } from "express";
import { queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";

export const publicMessageRouter = Router();

// Defense in depth alongside the token's own entropy (24 random bytes) — matches
// the dedicated limiters on the other public share-link routers.
const messageLimiter = rateLimit({ name: "public-message", windowMs: 15 * 60 * 1000, max: 30 });

/**
 * A link this old is far more likely forwarded/leaked than still being actively
 * read by its original recipient — capping how long it works limits how long a
 * copy-pasted or accidentally-shared link stays useful. The underlying document
 * download link (a separate route) isn't capped the same way yet: it's shared
 * with the authenticated portal's own document viewing, and expiring it needs
 * more care so it doesn't also break a client's legitimate in-portal access to
 * their own file.
 */
const LINK_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

publicMessageRouter.get("/:token", messageLimiter, asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne<any>(
    `SELECT subject, message_english, message_arabic, client_name, sent_at, channel
       FROM altax.v3_communications WHERE share_token = $1`,
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (row.sent_at && Date.now() - new Date(row.sent_at).getTime() > LINK_MAX_AGE_MS) {
    return res.status(410).json({ error: "This link has expired. Please contact the firm for a current copy." });
  }

  res.json({
    message: {
      subject: row.subject,
      messageEnglish: row.message_english,
      messageArabic: row.message_arabic,
      clientName: row.client_name,
      sentAt: row.sent_at,
      channel: row.channel,
    },
  });
}));
