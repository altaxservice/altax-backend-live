import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler, ValidationError } from "../../common/asyncHandler";
import { resolveActiveClientId, canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { computeClientBooksPl } from "../accounting/accounting.routes";
import { accumulatedDepreciation, createFixedAssetRecord } from "../accounting/fixedAssets.routes";
import { computeClientComplianceTimeline } from "../clients/complianceTimeline";
import { buildSummaryForClients, isMonthlySummaryEnabled } from "../../common/monthlyClientSummary";
import { sendChannel } from "../../common/sendChannel";

/**
 * Client-portal Reports overview and Assets. Clients see their own business only (resolveActiveClientId re-checks the
 * login's links on every call). Assets a client reports are drafts: staff review each one and record it with the right
 * accounts and depreciation — nothing posts to the ledger from a client's entry.
 */
export const clientPortalRouter = Router();

const money2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const CATEGORIES = ["Equipment", "Furniture & Fixtures", "Vehicle", "Computer / Electronics", "Leasehold Improvements", "Other"];

async function activeClient(req: AuthedRequest, res: Response): Promise<{ clientId: string; clientName: string } | null> {
  const clientId = await resolveActiveClientId(req.user!, req.query.clientId ?? req.body?.clientId);
  if (!clientId) { res.status(403).json({ error: "You do not have access to this business." }); return null; }
  const c = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!c) { res.status(404).json({ error: "Business not found." }); return null; }
  return { clientId, clientName: c.client_name };
}

/** What this business can see under Reports, plus a 12-month picture for the top of the page. */
clientPortalRouter.get("/reports/overview", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await activeClient(req, res);
  if (!c) return;
  const row = await queryOne<any>(`SELECT sales_tax_frequency, payroll_enabled, state FROM altax.v3_clients WHERE client_id = $1`, [c.clientId]);
  let financial = false;
  try {
    const f = await queryOne<any>(`SELECT portal_financial_reports_enabled AS v FROM altax.v3_clients WHERE client_id = $1`, [c.clientId]);
    financial = f?.v === true;
  } catch { /* column not migrated yet */ }
  const freq = String(row?.sales_tax_frequency || "").trim().toLowerCase();

  const now = new Date();
  const months: { label: string; from: string; to: string }[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    months.push({ label: start.toLocaleDateString("en-US", { month: "short" }), from: ymd(start), to: ymd(end) });
  }
  const yStart = `${now.getFullYear()}-01-01`;
  const [trend, ytd, taxPaid] = await Promise.all([
    Promise.all(months.map(async (m) => {
      const pl = await computeClientBooksPl(c.clientId, m.from, m.to).catch(() => null);
      return { label: m.label, from: m.from, income: pl ? money2(pl.totalIncome) : 0, expenses: pl ? money2(pl.totalExpenses) : 0 };
    })),
    computeClientBooksPl(c.clientId, yStart, ymd(now)).catch(() => null),
    query<any>(`SELECT COALESCE(SUM(tax_due),0) AS paid, COUNT(*) AS n FROM altax.v3_md_filing_payments WHERE client_id = $1 AND paid_date IS NOT NULL AND paid_date >= $2::date`, [c.clientId, yStart]).catch(() => [{ paid: 0, n: 0 }]),
  ]);
  res.json({
    clientId: c.clientId,
    available: { financialStatements: financial, salesTax: !!freq && freq !== "n/a", payroll: row?.payroll_enabled === true },
    trend,
    ytd: ytd ? { income: money2(ytd.totalIncome), expenses: money2(ytd.totalExpenses), net: money2(ytd.netIncome), topExpenses: (ytd.expensesByAccount || []).slice().sort((a: any, b: any) => b.amount - a.amount).slice(0, 6) } : null,
    salesTaxPaidYtd: money2(taxPaid[0]?.paid), salesTaxFilingsYtd: Number(taxPaid[0]?.n || 0),
  });
}));

/** The business's assets with depreciation to date, plus any the owner has reported that staff haven't recorded yet. */
clientPortalRouter.get("/assets", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await activeClient(req, res);
  if (!c) return;
  const rows = await query<any>(`SELECT * FROM altax.v3_fixed_assets WHERE client_id = $1 ORDER BY purchase_date DESC, created_at DESC`, [c.clientId]);
  const assets = await Promise.all(rows.map(async (a) => {
    const accumulated = await accumulatedDepreciation(a.asset_id);
    const cost = Number(a.cost);
    return {
      assetId: a.asset_id, name: a.asset_name, category: a.account_name, assetClass: a.asset_class,
      purchaseDate: a.purchase_date instanceof Date ? ymd(a.purchase_date) : String(a.purchase_date).slice(0, 10),
      cost, salvageValue: Number(a.salvage_value), usefulLifeYears: a.useful_life_years !== null ? Number(a.useful_life_years) : null,
      method: a.depreciation_method, status: a.status || "Active", disposedDate: a.disposed_date ? String(a.disposed_date).slice(0, 10) : null,
      accumulatedDepreciation: money2(accumulated), bookValue: money2(Math.max(Number(a.salvage_value), cost - accumulated)),
    };
  }));
  let drafts: any[] = [];
  try {
    drafts = await query<any>(
      `SELECT draft_id, asset_name, category, purchase_date, cost, vendor_name, notes, status, submitted_at, dismissed_reason
         FROM altax.v3_client_asset_drafts WHERE client_id = $1 AND (status = 'Pending' OR (status = 'Dismissed' AND dismissed_at > now() - interval '60 days'))
        ORDER BY submitted_at DESC LIMIT 50`, [c.clientId]);
  } catch { /* table not migrated yet */ }
  res.json({
    assets, categories: CATEGORIES,
    drafts: drafts.map((d) => ({ draftId: d.draft_id, name: d.asset_name, category: d.category, purchaseDate: d.purchase_date instanceof Date ? ymd(d.purchase_date) : String(d.purchase_date).slice(0, 10), cost: Number(d.cost), vendor: d.vendor_name, notes: d.notes, status: d.status, submittedAt: d.submitted_at, dismissedReason: d.dismissed_reason })),
    totals: {
      cost: money2(assets.filter((a) => a.status !== "Disposed").reduce((s, a) => s + a.cost, 0)),
      accumulatedDepreciation: money2(assets.filter((a) => a.status !== "Disposed").reduce((s, a) => s + a.accumulatedDepreciation, 0)),
      bookValue: money2(assets.filter((a) => a.status !== "Disposed").reduce((s, a) => s + a.bookValue, 0)),
      count: assets.filter((a) => a.status !== "Disposed").length,
    },
  });
}));

clientPortalRouter.post("/assets/drafts", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await activeClient(req, res);
  if (!c) return;
  const body = req.body || {};
  const name = String(body.assetName || "").trim().slice(0, 200);
  const purchaseDate = String(body.purchaseDate || "").trim();
  const cost = money2(body.cost);
  if (!name) return res.status(400).json({ error: "Tell us what the asset is." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return res.status(400).json({ error: "Enter the purchase date." });
  if (!(cost > 0)) return res.status(400).json({ error: "Enter the cost." });
  const category = CATEGORIES.includes(String(body.category)) ? String(body.category) : "Other";
  const draftId = `CAD-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.floor(100 + Math.random() * 900)}`;
  await query(
    `INSERT INTO altax.v3_client_asset_drafts (draft_id, client_id, client_name, asset_name, category, purchase_date, cost, vendor_name, notes, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [draftId, c.clientId, c.clientName, name, category, purchaseDate, cost, String(body.vendorName || "").trim().slice(0, 200) || null, String(body.notes || "").trim().slice(0, 1000) || null, req.user!.email]);
  await logAudit("Accounting", "CLIENT_ASSET_DRAFT_SUBMITTED", draftId, "", "", String(cost), `Asset "${name}" reported via client portal by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, draftId });
}));

clientPortalRouter.post("/assets/drafts/:draftId/delete", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const d = await queryOne<any>(`SELECT client_id, status FROM altax.v3_client_asset_drafts WHERE draft_id = $1`, [req.params.draftId]);
  if (!d || !(await canAccessClient(req.user!, d.client_id))) return res.status(404).json({ error: "Not found." });
  if (d.status !== "Pending") return res.status(400).json({ error: "This entry has already been reviewed." });
  await query(`DELETE FROM altax.v3_client_asset_drafts WHERE draft_id = $1 AND status = 'Pending'`, [req.params.draftId]);
  res.json({ ok: true });
}));

/** Staff: record a client-reported asset (full accounting details supplied by the reviewer), then close the draft. */
clientPortalRouter.post("/assets/drafts/:draftId/approve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const d = await queryOne<any>(`SELECT * FROM altax.v3_client_asset_drafts WHERE draft_id = $1`, [req.params.draftId]);
  if (!d) return res.status(404).json({ error: "Not found." });
  if (!(await canAccessClient(req.user!, d.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  const claimed = await queryOne<any>(`UPDATE altax.v3_client_asset_drafts SET status = 'Approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE draft_id = $1 AND status = 'Pending' RETURNING draft_id`, [d.draft_id, req.user!.email]);
  if (!claimed) return res.status(400).json({ error: "This entry is no longer pending." });
  try {
    const body = req.body || {};
    const draftDate = d.purchase_date instanceof Date ? ymd(d.purchase_date) : String(d.purchase_date).slice(0, 10);
    const assetId = await createFixedAssetRecord({ clientId: d.client_id, clientName: d.client_name }, {
      ...body,
      assetName: String(body.assetName || d.asset_name), purchaseDate: String(body.purchaseDate || draftDate),
      cost: body.cost ?? d.cost, notes: body.notes ?? d.notes,
    }, req.user!.email);
    await query(`UPDATE altax.v3_client_asset_drafts SET resulting_asset_id = $2 WHERE draft_id = $1`, [d.draft_id, assetId]);
    res.json({ ok: true, assetId });
  } catch (err) {
    await query(`UPDATE altax.v3_client_asset_drafts SET status = 'Pending', approved_by = NULL, approved_at = NULL WHERE draft_id = $1`, [d.draft_id]);
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

clientPortalRouter.post("/assets/drafts/:draftId/dismiss", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const d = await queryOne<any>(`SELECT client_id FROM altax.v3_client_asset_drafts WHERE draft_id = $1`, [req.params.draftId]);
  if (!d) return res.status(404).json({ error: "Not found." });
  if (!(await canAccessClient(req.user!, d.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  const claimed = await queryOne<any>(
    `UPDATE altax.v3_client_asset_drafts SET status = 'Dismissed', dismissed_by = $2, dismissed_at = now(), dismissed_reason = $3, updated_at = now() WHERE draft_id = $1 AND status = 'Pending' RETURNING draft_id`,
    [req.params.draftId, req.user!.email, String(req.body?.reason || "").trim() || null]);
  if (!claimed) return res.status(400).json({ error: "This entry is no longer pending." });
  res.json({ ok: true });
}));

/**
 * Key dates ahead — the filing and payment calendar for this business, in plain terms: what's overdue, what's coming up,
 * and what was filed recently. Same compliance timeline the firm's own client page uses.
 */
clientPortalRouter.get("/key-dates", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await activeClient(req, res);
  if (!c) return;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [c.clientId]);
  const lanes = await computeClientComplianceTimeline(c.clientId, row).catch(() => []);
  const upcoming: any[] = [], overdue: any[] = [], filed: any[] = [];
  for (const lane of lanes) {
    for (const p of lane.periods) {
      const item = { title: lane.title || lane.obligationType, period: p.periodLabel, dueDate: p.dueDate, filedDate: p.filedDate || null };
      if (p.status === "missing") overdue.push(item);
      else if (p.status === "notYetDue") upcoming.push(item);
      else filed.push(item);
    }
  }
  const byDate = (a: any, b: any) => String(a.dueDate).localeCompare(String(b.dueDate));
  // Internal "missing filing" flags are deliberately not shown here — clients see those only as account notices the firm chose to share.
  void overdue;
  res.json({
    upcoming: upcoming.sort(byDate).slice(0, 8),
    filed: filed.sort((a, b) => String(b.dueDate).localeCompare(String(a.dueDate))).slice(0, 6),
  });
}));

/** Staff preview of the monthly summary email a business owner would get (nothing is sent). */
clientPortalRouter.get("/monthly-summary/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const c = await queryOne<any>(`SELECT client_id, client_name, lower(email) AS email FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!c) return res.status(404).json({ error: "Client not found." });
  const same = c.email ? await query<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE lower(email) = $1 AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived')) ORDER BY client_name`, [c.email]) : [c];
  const built = await buildSummaryForClients(same.map((x: any) => ({ clientId: x.client_id, clientName: x.client_name })));
  res.json({ to: c.email, ...built });
}));

clientPortalRouter.get("/monthly-summary/settings", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const eligible = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_clients WHERE email IS NOT NULL AND email <> '' AND email_allowed = true AND COALESCE(portal_enabled, true) = true AND monthly_summary_enabled = true AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))`);
  res.json({ enabled: await isMonthlySummaryEnabled(), eligibleClients: eligible?.n || 0 });
}));

clientPortalRouter.post("/monthly-summary/settings", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const enabled = req.body?.enabled === true;
  await query(`UPDATE altax.v3_firm_settings SET monthly_client_summary_enabled = $1 WHERE id = 'FIRM-1'`, [enabled]);
  await logAudit("Settings", "MONTHLY_CLIENT_SUMMARY_SWITCH", "FIRM-1", "monthly_client_summary_enabled", String(!enabled), String(enabled), `Monthly client summary email turned ${enabled ? "ON" : "OFF"} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, enabled });
}));

/** Sends the real monthly summary for one client, but only to the admin asking — to see exactly what clients will get. */
clientPortalRouter.post("/monthly-summary/test", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.body?.clientId || "").trim();
  const c = await queryOne<any>(`SELECT client_id, client_name, lower(email) AS email FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!c) return res.status(404).json({ error: "Client not found." });
  const same = c.email ? await query<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE lower(email) = $1 AND (status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived')) ORDER BY client_name`, [c.email]) : [c];
  const built = await buildSummaryForClients(same.map((x: any) => ({ clientId: x.client_id, clientName: x.client_name })));
  if (built.skipped) return res.status(400).json({ error: "That client has nothing to report this month, so no summary would be sent." });
  const result = await sendChannel("email", req.user!.email, `[TEST] ${built.subject}`, `(Test copy — this is what ${c.client_name} would receive.)\n\n${built.body}`, {});
  res.json({ ok: result.sent, sentTo: req.user!.email, error: result.error });
}));
