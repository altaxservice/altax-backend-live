/**
 * Public, no-login Form 941 filing view + acknowledge — same pattern as
 * publicEftpsDeposit.routes.ts/publicMdFiling.routes.ts. Unlike Annual
 * Report/MD UI, a real PDF generator already exists (form941.ts) — the PDF
 * route regenerates it from the filing's own stored snapshot (not a live
 * recompute), so what the client downloads always matches exactly what was
 * filed, even if paychecks are edited afterward.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { notifyStaffOfObligationConfirmed } from "../../common/obligationNotifications";

export const publicForm941FilingsRouter = Router();

const limiter = rateLimit({ name: "public-form941", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_form941_filings WHERE share_token = $1`, [token]);
}

publicForm941FilingsRouter.get("/:token", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  res.json({
    filing: {
      client_name: client?.client_name || "", period_start: filing.period_start, period_end: filing.period_end, quarter: filing.quarter,
      filed_date: filing.filed_date, paid_date: filing.paid_date,
      gross_liability: filing.gross_liability, eftps_deposits_applied: filing.eftps_deposits_applied, balance_due: filing.balance_due,
      acknowledged_at: filing.acknowledged_at,
    },
  });
}));

publicForm941FilingsRouter.post("/:token/acknowledge", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ client_id: string }>(
    `UPDATE altax.v3_form941_filings SET acknowledged_at = now(), acknowledged_ip = $2
      WHERE share_token = $1 AND acknowledged_at IS NULL
      RETURNING client_id`,
    [req.params.token, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  const acknowledgedAt = new Date().toISOString();
  await logAudit("Accounting", "FORM_941_ACKNOWLEDGED", filing.client_id, "acknowledged_at", "", acknowledgedAt,
    `Form 941 filing (Q${filing.quarter} ${filing.period_start}) acknowledged by the client from IP ${ip || "unknown"}.`, "Client");

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  await notifyStaffOfObligationConfirmed({
    clientId: filing.client_id, clientName: client?.client_name || filing.client_id,
    filingType: "Federal Payroll Tax (Form 941)", periodLabel: `Q${filing.quarter}`,
    amount: Number(filing.balance_due), acknowledgedAt, acknowledgedIp: ip, req,
  });

  res.json({ ok: true, alreadyAcknowledged: false });
}));

/** Regenerated from the filing's own stored snapshot — not a live recompute — so it always matches exactly what was filed. */
publicForm941FilingsRouter.get("/:token/pdf", limiter, asyncHandler(async (req: Request, res: Response) => {
  const filing = await findByToken(req.params.token);
  if (!filing) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_id, client_name, ein, address, state, company_contact_name, phone FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
  if (!client) return res.status(404).json({ error: "This link is invalid or has expired." });

  const { generateForm941 } = await import("../accounting/form941");
  const pdfBytes = await generateForm941({
    employerEin: client.ein, employerName: client.client_name, employerAddress: client.address, employerState: client.state,
    quarter: filing.quarter as 1 | 2 | 3 | 4,
    employeeCount: Number(filing.employee_count), wages: Number(filing.wages),
    federalWithholding: Number(filing.federal_withholding), socialSecurityWages: Number(filing.social_security_wages),
    medicareWages: Number(filing.medicare_wages), contactName: client.company_contact_name, contactPhone: client.phone,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="941_Q${filing.quarter}_${client.client_id}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));
