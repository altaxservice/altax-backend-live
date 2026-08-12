/**
 * Public, no-login lead capture for the website tools (Business Health Check,
 * Entity Comparison, Document Checklist, and any future public calculator or
 * quiz). All calculation/scoring happens client-side in the tool pages
 * themselves — this endpoint only fires when a visitor opts to get an emailed
 * result, a personalized action plan, or a follow-up, i.e. when they're
 * actively asking to be contacted.
 *
 * HARD RULE: this file — and everything else under src/modules/publicTools —
 * must only ever import ../../config/publicToolsDb, never ../../config/db.
 * That's what makes the isolation from client data real: the database role
 * behind publicToolsDb has zero grants on the altax schema, so even a bug
 * here cannot reach client records. Do not "temporarily" import the main
 * pool to look something up — if a lookup against altax.* is ever genuinely
 * needed, it belongs in the authenticated app, not here.
 *
 * Admin notification uses a fixed env var (PUBLIC_TOOLS_NOTIFY_EMAIL) rather
 * than querying altax.v3_users for admin addresses, for the same reason —
 * that table lives in the walled-off schema this module cannot touch.
 */
import { Router, Request, Response } from "express";
import { publicToolsQueryOne } from "../../config/publicToolsDb";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { rateLimit } from "../../common/rateLimit";
import { escapeHtml } from "../../common/html";

export const publicToolsRouter = Router();

const TOOL_NAMES = new Set(["business-health-check", "entity-comparison", "document-checklist"]);

const toolsLeadLimiter = rateLimit({ name: "public-tools-lead", windowMs: 15 * 60 * 1000, max: 15 });

publicToolsRouter.post("/lead", toolsLeadLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { toolName, name, email, phone, payload, website } = req.body || {};

  // Honeypot — same convention as the contact form (common/publicContact.routes.ts):
  // "website" is a hidden field no real visitor can see or fill in.
  if (website) {
    return res.json({ ok: true });
  }

  if (typeof toolName !== "string" || !TOOL_NAMES.has(toolName)) {
    return res.status(400).json({ error: "Unknown tool." });
  }
  if (!email) {
    return res.status(400).json({ error: "An email address is required." });
  }
  // payload is intentionally unrestricted in shape (each tool's own answers/scores),
  // but must never contain anything resembling SSN/EIN/bank/account data — that
  // rule is enforced by what the tool pages are allowed to send, not by this route.

  const row = await publicToolsQueryOne<any>(
    `INSERT INTO altax_public.tool_leads (tool_name, name, email, phone, payload, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [toolName, name || null, email, phone || null, payload ? JSON.stringify(payload) : null, req.ip || null]
  );

  const notifyEmail = process.env.PUBLIC_TOOLS_NOTIFY_EMAIL;
  if (notifyEmail) {
    try {
      const html = `
        <h2>New website tool lead</h2>
        <p><strong>Tool:</strong> ${escapeHtml(toolName)}</p>
        ${name ? `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` : ""}
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}
        ${payload ? `<p><strong>Details:</strong><br><pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(JSON.stringify(payload, null, 2))}</pre></p>` : ""}
        <p style="color:#777;font-size:12px;">Submitted ${row.created_at} · Record #${row.id}</p>
      `;
      await sendEmail({ to: notifyEmail, subject: `New ${toolName} lead from the website`, html });
    } catch (err) {
      if (!(err instanceof NotConfiguredError)) {
        // eslint-disable-next-line no-console
        console.error("Public tool lead admin notification failed:", err);
      }
    }
  }

  res.json({ ok: true });
}));
