import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { FREQUENCIES, TIMELINE_START, filedConflicts, loadTimeline, normalizeTimeline, previewPeriods, saveTimeline, type SegmentInput } from "../../common/salesTaxFrequencyTimeline";

/**
 * The sales-tax filing-frequency timeline editor API: read the timeline, preview what a proposed timeline does to the
 * filing periods (and whether it would disturb periods already marked filed), and save it. Admin and staff.
 */
export const salesTaxFrequencyRouter = Router();

async function gate(req: AuthedRequest, res: Response): Promise<{ clientId: string; clientName: string } | null> {
  const clientId = String(req.params.clientId || "").trim();
  if (!(await canAccessClient(req.user!, clientId))) { res.status(403).json({ error: "You do not have access to this client." }); return null; }
  const c = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!c) { res.status(404).json({ error: "Client not found." }); return null; }
  return { clientId, clientName: c.client_name };
}

/** Periods shown in the editor: from the start of last year through the end of next year. */
function previewRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y - 1}-01-01`, to: `${y + 1}-12-31` };
}

salesTaxFrequencyRouter.get("/:clientId/sales-tax-frequency", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await gate(req, res);
  if (!c) return;
  const segments = await loadTimeline(c.clientId);
  const { from, to } = previewRange();
  res.json({ segments, frequencies: FREQUENCIES, timelineStart: TIMELINE_START, periods: previewPeriods(segments, from, to) });
}));

salesTaxFrequencyRouter.post("/:clientId/sales-tax-frequency/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await gate(req, res);
  if (!c) return;
  const { segments, errors } = normalizeTimeline((req.body?.segments || []) as SegmentInput[]);
  if (errors.length) return res.json({ ok: false, errors, periods: [], conflicts: [] });
  const { from, to } = previewRange();
  res.json({ ok: true, errors: [], segments, periods: previewPeriods(segments, from, to), conflicts: await filedConflicts(c.clientId, segments) });
}));

salesTaxFrequencyRouter.put("/:clientId/sales-tax-frequency", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const c = await gate(req, res);
  if (!c) return;
  const { segments, errors } = normalizeTimeline((req.body?.segments || []) as SegmentInput[]);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  const conflicts = await filedConflicts(c.clientId, segments);
  if (conflicts.length && req.body?.confirmFiled !== true) {
    return res.status(409).json({ error: "This change would reshape periods that are already marked filed.", conflicts, needsConfirm: true });
  }
  const before = await loadTimeline(c.clientId);
  await saveTimeline(c.clientId, segments, req.user!.email);
  const fmt = (list: { frequency: string; effectiveFrom: string }[]) => list.map((s) => `${s.frequency} from ${s.effectiveFrom}`).join("; ") || "(none)";
  await logAudit("Clients", "SALES_TAX_FREQUENCY_CHANGE", c.clientId, "sales_tax_frequency_timeline", fmt(before), fmt(segments),
    `Sales tax frequency timeline edited by ${req.user!.email}: was [${fmt(before)}], now [${fmt(segments)}].${conflicts.length ? ` Reshaped ${conflicts.length} already-filed period(s) with confirmation.` : ""}`,
    req.user!.email);
  res.json({ ok: true, segments });
}));
