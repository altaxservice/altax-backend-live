/**
 * Period tables for state UI, the annual/biennial report, and federal Form 941
 * — the read side (periods + penalty/interest + status) and the exclude/restore
 * actions. Marking filed, recording payment, sending the confirmation, editing,
 * and deleting stay in each obligation's own routes (mdUiFilings, annualReport,
 * form941), which already close tasks, email the client, and schedule payment
 * reminders; this module is the table that drives them. See obligationSchedules.ts.
 */
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import {
  asObligationKind, computeObligationBreakdown, loadObligationClient, annualReportApplies, lateChargesBuilt,
  type ObligationKind, type ObligationClient,
} from "../../common/obligationSchedules";

export const obligationPeriodsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_LABEL: Record<ObligationKind, string> = { ui: "Unemployment insurance", "annual-report": "Annual report", form941: "Form 941" };

type Loaded = { error: string; status: number } | { kind: ObligationKind; client: ObligationClient & { clientName: string } };

async function load(req: AuthedRequest): Promise<Loaded> {
  const kind = asObligationKind(req.params.kind);
  if (!kind) return { error: "Unknown filing type.", status: 400 };
  if (!(await canAccessClient(req.user!, req.params.clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await loadObligationClient(req.params.clientId);
  if (!client) return { error: "Client not found.", status: 404 };
  return { kind, client };
}

/** Whether this filing can be tracked for the client at all, and what the table can/can't compute. */
function metaFor(kind: ObligationKind, client: ObligationClient) {
  const st = client.state;
  let applies = true;
  let reason: string | undefined;
  if (kind === "annual-report") {
    const a = annualReportApplies(client);
    applies = a.applies; reason = a.reason;
  } else if (kind === "ui" && !["MD", "DC", "VA", "PA", "DE"].includes(st)) {
    applies = false; reason = `State unemployment tracking isn't built for ${st || "this client's"} state yet — it covers MD, DC, VA, PA and DE.`;
  }
  return { kind, state: st, applies, reason, lateChargesBuilt: lateChargesBuilt(kind, client) };
}

obligationPeriodsRouter.get("/:kind/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await load(req);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const meta = metaFor(loaded.kind, loaded.client);
  if (!meta.applies) return res.json({ meta, breakdown: null });
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return res.status(400).json({ error: "from and to must be YYYY-MM-DD." });
  const today = new Date().toISOString().slice(0, 10);
  const filedDate = DATE_RE.test(String(req.query.filedDate || "")) ? String(req.query.filedDate) : today;
  const paidDate = DATE_RE.test(String(req.query.paidDate || "")) ? String(req.query.paidDate) : today;
  res.json({ meta, breakdown: await computeObligationBreakdown(loaded.kind, loaded.client, from, to, filedDate, paidDate) });
}));

const TABLE: Record<ObligationKind, string> = { ui: "v3_md_ui_filings", "annual-report": "v3_annual_report_filings", form941: "v3_form941_filings" };

obligationPeriodsRouter.get("/:kind/:clientId/history", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await load(req);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const range = await queryOne<{ s: string | null; e: string | null }>(
    `SELECT MIN(period_start)::date::text AS s, MAX(period_end)::date::text AS e FROM altax.${TABLE[loaded.kind]} WHERE client_id = $1`, [loaded.client.clientId]
  );
  if (!range?.s || !range.e) return res.json({ periods: [] });
  const today = new Date().toISOString().slice(0, 10);
  const breakdown = await computeObligationBreakdown(loaded.kind, loaded.client, range.s, range.e, today, today);
  res.json({ periods: breakdown.periods.filter((p) => p.markedFiledDate !== null) });
}));

obligationPeriodsRouter.get("/:kind/:clientId/excluded-periods", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await load(req);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const rows = await query<any>(
    `SELECT period_start::date::text AS period_start, period_end::date::text AS period_end, reason, excluded_by, excluded_at
       FROM altax.v3_obligation_period_exclusions WHERE client_id = $1 AND kind = $2 ORDER BY period_end DESC`,
    [loaded.client.clientId, loaded.kind]
  );
  res.json({ excluded: rows.map((r) => ({ start: r.period_start, end: r.period_end, reason: r.reason, excludedBy: r.excluded_by, excludedAt: r.excluded_at })) });
}));

obligationPeriodsRouter.post("/:kind/:clientId/exclude-period", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await load(req);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodStart = String((req.body || {}).periodStart || "").trim();
  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  const reason = String((req.body || {}).reason || "").trim() || null;
  if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodStart and periodEnd must be YYYY-MM-DD." });
  const filed = await queryOne<any>(`SELECT 1 FROM altax.${TABLE[loaded.kind]} WHERE client_id = $1 AND period_end = $2::date`, [loaded.client.clientId, periodEnd]);
  if (filed) return res.status(400).json({ error: "This period has already been filed — delete that filing first if you need to exclude it instead." });
  await query(
    `INSERT INTO altax.v3_obligation_period_exclusions (client_id, kind, period_start, period_end, reason, excluded_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (client_id, kind, period_end) DO NOTHING`,
    [loaded.client.clientId, loaded.kind, periodStart, periodEnd, reason, req.user!.email]
  );
  await logAudit("Accounting", "OBLIGATION_PERIOD_EXCLUDED", loaded.client.clientId, "Period", "", periodEnd,
    `${KIND_LABEL[loaded.kind]} period ${periodStart} - ${periodEnd} excluded (no filing obligation)${reason ? `: ${reason}` : ""}, by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

obligationPeriodsRouter.post("/:kind/:clientId/restore-period", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const loaded = await load(req);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const periodEnd = String((req.body || {}).periodEnd || "").trim();
  if (!DATE_RE.test(periodEnd)) return res.status(400).json({ error: "periodEnd must be YYYY-MM-DD." });
  await query(`DELETE FROM altax.v3_obligation_period_exclusions WHERE client_id = $1 AND kind = $2 AND period_end = $3::date`, [loaded.client.clientId, loaded.kind, periodEnd]);
  await logAudit("Accounting", "OBLIGATION_PERIOD_RESTORED", loaded.client.clientId, "Period", "", periodEnd,
    `${KIND_LABEL[loaded.kind]} period ending ${periodEnd} restored by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
