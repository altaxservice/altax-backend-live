/**
 * Public, no-login EFTPS deposit report view + acknowledge — the "share link"
 * destination linked from the Save & Send email. Same pattern as
 * publicContract.routes.ts: access gated entirely by knowing the opaque
 * share_token (24 random bytes), not by a portal account.
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";

export const publicEftpsDepositRouter = Router();

// Defense in depth alongside the token's own entropy (24 random bytes) — matches
// the dedicated limiters on the other public share-link routers.
const eftpsDepositLimiter = rateLimit({ name: "public-eftps-deposit", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_eftps_deposits WHERE share_token = $1`, [token]);
}

publicEftpsDepositRouter.get("/:token", eftpsDepositLimiter, asyncHandler(async (req: Request, res: Response) => {
  const deposit = await findByToken(req.params.token);
  if (!deposit) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [deposit.client_id]);
  const lines = await query<any>(`SELECT employee_name, federal_income_tax, social_security, medicare, subtotal FROM altax.v3_eftps_deposit_lines WHERE deposit_id = $1 ORDER BY employee_name`, [deposit.deposit_id]);

  res.json({
    deposit: {
      deposit_id: deposit.deposit_id, client_name: client?.client_name || "",
      period_start: deposit.period_start, period_end: deposit.period_end,
      filing_date: deposit.filing_date, payment_date: deposit.payment_date,
      federal_income_tax_total: deposit.federal_income_tax_total, social_security_total: deposit.social_security_total,
      medicare_total: deposit.medicare_total, total_amount: deposit.total_amount,
      acknowledged_at: deposit.acknowledged_at, employees: lines,
    },
  });
}));

/** Click-to-acknowledge — atomic claim so two concurrent opens (e.g. a forwarded link opened twice) can't race; the same class of bug already fixed once on the contract-sign flow, not reintroduced here. */
publicEftpsDepositRouter.post("/:token/acknowledge", eftpsDepositLimiter, asyncHandler(async (req: Request, res: Response) => {
  const deposit = await findByToken(req.params.token);
  if (!deposit) return res.status(404).json({ error: "This link is invalid or has expired." });

  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const claimed = await query<{ deposit_id: string }>(
    `UPDATE altax.v3_eftps_deposits SET acknowledged_at = now(), acknowledged_ip = $2, updated_at = now()
      WHERE deposit_id = $1 AND acknowledged_at IS NULL
      RETURNING deposit_id`,
    [deposit.deposit_id, ip]
  );
  if (claimed.length === 0) return res.json({ ok: true, alreadyAcknowledged: true });

  await logAudit("Clients", "EFTPS_DEPOSIT_ACKNOWLEDGED", deposit.client_id, "acknowledged_at", "", new Date().toISOString(),
    `EFTPS deposit report ${deposit.deposit_id} acknowledged by the client from IP ${ip || "unknown"}.`, "Client");

  res.json({ ok: true, alreadyAcknowledged: false });
}));
