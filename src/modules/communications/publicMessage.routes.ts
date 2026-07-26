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

export const publicMessageRouter = Router();

publicMessageRouter.get("/:token", asyncHandler(async (req: Request, res: Response) => {
  const row = await queryOne<any>(
    `SELECT subject, message_english, message_arabic, client_name, sent_at, channel
       FROM altax.v3_communications WHERE share_token = $1`,
    [req.params.token]
  );
  if (!row) return res.status(404).json({ error: "This link is invalid or has expired." });

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
