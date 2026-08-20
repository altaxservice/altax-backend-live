/**
 * Tax Return Production tracking (Firm Command Center gap analysis, item
 * #8). Confirmed directly with the user (2026-08-20) this workflow has
 * never been tracked in this system — a genuinely new operational
 * capability, not a report layered over existing data. Status pipeline is
 * exactly the one from the spec: Not Started -> Documents Requested ->
 * Documents Received -> In Preparation -> Missing Information -> Review ->
 * Client Approval -> E-file Ready -> Filed -> Accepted / Rejected ->
 * Completed. Mounted at /clients, same pattern as ownershipTransfer.routes.ts
 * and notices.routes.ts — a focused router for one client sub-feature.
 * GET /tax-returns (firm-wide) registered before GET /:clientId/tax-returns
 * for the same reason notices.routes.ts documents (route-order collision a
 * literal segment can hit under a :clientId-wildcard-mounting router).
 */
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";

export const taxReturnsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

export const TAX_RETURN_STATUSES = [
  "Not Started", "Documents Requested", "Documents Received", "In Preparation", "Missing Information",
  "Review", "Client Approval", "E-file Ready", "Filed", "Accepted", "Rejected", "Completed",
];
/** Firm-wide production board — every active (non-terminal, unless ?includeCompleted=1) return, role-scoped like every other cross-client list. */
taxReturnsRouter.get("/tax-returns", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const includeCompleted = String(req.query.includeCompleted || "") === "1";
  const taxYear = req.query.taxYear ? Number(req.query.taxYear) : null;
  const isAdmin = req.user!.role === "admin";
  const conditions: string[] = [];
  const params: any[] = [];
  if (!includeCompleted) conditions.push(`r.status NOT IN ('Accepted', 'Completed')`);
  if (taxYear) { params.push(taxYear); conditions.push(`r.tax_year = $${params.length}`); }
  if (!isAdmin) {
    params.push(req.user!.email);
    conditions.push(`(lower(r.preparer) = lower($${params.length}) OR lower(r.reviewer) = lower($${params.length}))`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<any>(
    `SELECT r.*, c.client_name FROM altax.v3_tax_returns r
       JOIN altax.v3_clients c ON c.client_id = r.client_id
       ${where}
      ORDER BY (r.due_date IS NULL), r.due_date ASC, c.client_name`,
    params
  );
  res.json({ taxReturns: rows });
}));

/** Status counts for the production-board summary strip — same scope rules as the list route above. */
taxReturnsRouter.get("/tax-returns/summary", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const taxYear = req.query.taxYear ? Number(req.query.taxYear) : null;
  const isAdmin = req.user!.role === "admin";
  const conditions: string[] = [];
  const params: any[] = [];
  if (taxYear) { params.push(taxYear); conditions.push(`tax_year = $${params.length}`); }
  if (!isAdmin) {
    params.push(req.user!.email);
    conditions.push(`(lower(preparer) = lower($${params.length}) OR lower(reviewer) = lower($${params.length}))`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<any>(`SELECT status, COUNT(*)::int AS count FROM altax.v3_tax_returns ${where} GROUP BY status`, params);
  const counts: Record<string, number> = Object.fromEntries(TAX_RETURN_STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[r.status] = r.count;
  res.json({ counts, statuses: TAX_RETURN_STATUSES });
}));

taxReturnsRouter.get("/:clientId/tax-returns", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(`SELECT * FROM altax.v3_tax_returns WHERE client_id = $1 ORDER BY tax_year DESC`, [clientId]);
  res.json({ taxReturns: rows });
}));

taxReturnsRouter.post("/:clientId/tax-returns", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const body = req.body || {};
  const taxYear = Number(body.taxYear);
  const returnType = String(body.returnType || "").trim();
  if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) return res.status(400).json({ error: "A valid tax year is required." });
  if (!returnType) return res.status(400).json({ error: "Return type is required." });

  const existing = await queryOne<any>(`SELECT tax_return_id FROM altax.v3_tax_returns WHERE client_id = $1 AND tax_year = $2`, [clientId, taxYear]);
  if (existing) return res.status(400).json({ error: `A ${taxYear} return already exists for this client.` });

  const taxReturnId = `TAXRTN-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_tax_returns
       (tax_return_id, client_id, tax_year, return_type, status, preparer, reviewer, extension_filed, due_date, notes, created_by)
     VALUES ($1,$2,$3,$4,'Not Started',$5,$6,$7,$8,$9,$10)`,
    [
      taxReturnId, clientId, taxYear, returnType,
      String(body.preparer || "").trim() || null,
      String(body.reviewer || "").trim() || null,
      Boolean(body.extensionFiled),
      String(body.dueDate || "").trim() || null,
      String(body.notes || "").trim() || null,
      req.user!.email,
    ]
  );
  await logAudit("TaxReturns", "CREATE", taxReturnId, "", "", `${taxYear} ${returnType}`, `Tax return tracking started for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, taxReturnId });
}));

taxReturnsRouter.patch("/:clientId/tax-returns/:taxReturnId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, taxReturnId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_tax_returns WHERE tax_return_id = $1 AND client_id = $2`, [taxReturnId, clientId]);
  if (!existing) return res.status(404).json({ error: "Tax return not found." });

  const body = req.body || {};
  const status = body.status !== undefined ? String(body.status).trim() : existing.status;
  if (!TAX_RETURN_STATUSES.includes(status)) return res.status(400).json({ error: `Status must be one of: ${TAX_RETURN_STATUSES.join(", ")}.` });
  if (status === "Rejected" && !String(body.rejectionReason ?? existing.rejection_reason ?? "").trim()) {
    return res.status(400).json({ error: "A rejection reason is required to mark a return Rejected." });
  }

  const next = {
    returnType: body.returnType !== undefined ? String(body.returnType).trim() : existing.return_type,
    preparer: body.preparer !== undefined ? (String(body.preparer).trim() || null) : existing.preparer,
    reviewer: body.reviewer !== undefined ? (String(body.reviewer).trim() || null) : existing.reviewer,
    extensionFiled: body.extensionFiled !== undefined ? Boolean(body.extensionFiled) : existing.extension_filed,
    dueDate: body.dueDate !== undefined ? (String(body.dueDate).trim() || null) : existing.due_date,
    filedDate: body.filedDate !== undefined ? (String(body.filedDate).trim() || null) : existing.filed_date,
    acceptedDate: body.acceptedDate !== undefined ? (String(body.acceptedDate).trim() || null) : existing.accepted_date,
    rejectionReason: body.rejectionReason !== undefined ? (String(body.rejectionReason).trim() || null) : existing.rejection_reason,
    notes: body.notes !== undefined ? (String(body.notes).trim() || null) : existing.notes,
  };
  // Filed/Accepted dates auto-fill from today the first time status crosses into
  // that stage if the caller didn't explicitly supply one — staff flipping the
  // dropdown shouldn't also have to remember to backfill the date by hand.
  if (status === "Filed" && !next.filedDate) next.filedDate = new Date().toISOString().slice(0, 10);
  if (status === "Accepted" && !next.acceptedDate) next.acceptedDate = new Date().toISOString().slice(0, 10);

  await query(
    `UPDATE altax.v3_tax_returns SET
       return_type=$3, status=$4, preparer=$5, reviewer=$6, extension_filed=$7, due_date=$8,
       filed_date=$9, accepted_date=$10, rejection_reason=$11, notes=$12, updated_at=now()
     WHERE tax_return_id = $1 AND client_id = $2`,
    [taxReturnId, clientId, next.returnType, status, next.preparer, next.reviewer, next.extensionFiled, next.dueDate,
     next.filedDate, next.acceptedDate, next.rejectionReason, next.notes]
  );
  await logAudit("TaxReturns", "EDIT", taxReturnId, "Status", existing.status || "", status, `Tax return updated for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, taxReturnId, status });
}));

taxReturnsRouter.post("/:clientId/tax-returns/:taxReturnId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, taxReturnId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_tax_returns WHERE tax_return_id = $1 AND client_id = $2`, [taxReturnId, clientId]);
  if (!existing) return res.status(404).json({ error: "Tax return not found." });
  await query(`DELETE FROM altax.v3_tax_returns WHERE tax_return_id = $1`, [taxReturnId]);
  await logAudit("TaxReturns", "DELETE", taxReturnId, "", "", "", `Tax return tracking deleted for ${clientId} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
