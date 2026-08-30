/**
 * Public, no-login MD Sales Tax filing view + acknowledge — the "share link"
 * destination linked from the Save & Send email. Same pattern as
 * publicEftpsDeposit.routes.ts: access gated entirely by knowing the opaque
 * share_token (24 random bytes), not by a portal account.
 *
 * The authenticated PDF route (GET /reports/pdf/sales-tax/:clientId) can't be
 * reused directly — it depends on req.user via loadClientInfo/canAccessClient.
 * The data/PDF functions underneath it don't need auth context, so this file
 * calls them directly with data looked up by token instead.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { decryptClientPii } from "../../common/encryption";
import { notifyStaffOfObligationConfirmed } from "../../common/obligationNotifications";
import { loadSalesTaxForPeriod, computeMdFilingForReport } from "./reports.routes";
import type { ReportClientInfo } from "../accounting/reportsPdf";

export const publicMdFilingRouter = Router();

/** A DATE column comes back from SELECT * as a JS Date — String(date) shifts UTC midnight back a day in local time, so it must go through toISOString() rather than straight into a "YYYY-MM-DD..." string. Matches the same fix already applied elsewhere (e.g. filingConfirmationEmail.ts's fmtDate). */
function toIsoDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
}

const mdFilingLimiter = rateLimit({ name: "public-md-filing", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_md_filing_payments WHERE share_token = $1`, [token]);
}

async function loadClient(clientId: string): Promise<ReportClientInfo | null> {
  const client = decryptClientPii(await queryOne<any>(`SELECT client_id, client_name, ein, address, state, sales_tax_frequency FROM altax.v3_clients WHERE client_id = $1`, [clientId]));
  if (!client) return null;
  return {
    clientId: client.client_id, clientName: client.client_name, ein: client.ein, address: client.address, state: client.state,
    salesTaxFrequency: client.sales_tax_frequency,
  };
}

function fmtPeriodLabel(start: unknown, end: unknown): string {
  const fmt = (v: unknown) => {
    const raw = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const d = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

publicMdFilingRouter.get("/:token", mdFilingLimiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  res.json({
    filing: {
      client_name: client?.client_name || "",
      period_start: filing.period_start, period_end: filing.period_end,
      filed_date: filing.filed_date, paid_date: filing.paid_date,
      tax_due: filing.tax_due, balance_due: filing.balance_due, on_time: filing.on_time,
      acknowledged_at: filing.acknowledged_at,
    },
  });
}));

/** Click-to-acknowledge — atomic claim so two concurrent opens can't race, same pattern as publicEftpsDeposit.routes.ts. */
publicMdFilingRouter.post("/:token/acknowledge", mdFilingLimiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ client_id: string }>(
    `UPDATE altax.v3_md_filing_payments SET acknowledged_at = now(), acknowledged_ip = $2
      WHERE share_token = $1 AND acknowledged_at IS NULL
      RETURNING client_id`,
    [req.params.token, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  const acknowledgedAt = new Date().toISOString();
  await logAudit("Accounting", "MD_FILING_ACKNOWLEDGED", filing.client_id, "acknowledged_at", "", acknowledgedAt,
    `MD sales tax filing (${filing.period_start} - ${filing.period_end}) acknowledged by the client from IP ${ip || "unknown"}.`, "Client");

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  await notifyStaffOfObligationConfirmed({
    clientId: filing.client_id, clientName: client?.client_name || filing.client_id,
    filingType: "Maryland Sales & Use Tax", periodLabel: fmtPeriodLabel(filing.period_start, filing.period_end),
    amount: Number(filing.tax_due), acknowledgedAt, acknowledgedIp: ip, req,
  });

  res.json({ ok: true, alreadyAcknowledged: false });
}));

/** Same document the staff-authed route (GET /reports/pdf/sales-tax/:clientId) generates, no login required, gated by the same opaque token as the view/acknowledge routes above. */
publicMdFilingRouter.get("/:token/pdf", mdFilingLimiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await loadClient(filing.client_id);
  if (!client) return res.status(404).json({ error: "This link is invalid or has expired." });

  const from = toIsoDate(filing.period_start)!;
  const to = toIsoDate(filing.period_end)!;
  const filedDate = toIsoDate(filing.filed_date);
  const paidDate = toIsoDate(filing.paid_date);

  const data = await loadSalesTaxForPeriod(client.clientId, from, to);
  const mdFiling = await computeMdFilingForReport(client, from, to, filedDate, paidDate);
  const { generateSalesTaxPdf } = await import("../accounting/reportsPdf");
  const pdfBytes = await generateSalesTaxPdf({ client, from, to, ...data, mdFiling });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="SalesTax_${client.clientId}_${from}_${to}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));
