import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";

/**
 * Month-End Checklist — per-client, per-period (YYYY-MM) close checklist.
 * Standard item names are a code-level default set (same pattern as
 * templates.routes.ts's BUILT_IN templates), not seeded into the DB up
 * front: a period's checklist is computed on read by merging the standard
 * items with whatever rows already exist for that client+period, so
 * nothing is persisted until an item's status actually changes. Ported as
 * new functionality (no legacy equivalent found), scoped to admin/staff
 * like the rest of the Accounting module.
 */
export const monthEndRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

const STANDARD_ITEMS: { itemName: string; category: string }[] = [
  { itemName: "Reconcile Bank Accounts", category: "Cash" },
  { itemName: "Reconcile Credit Card Accounts", category: "Cash" },
  { itemName: "Review Accounts Receivable Aging", category: "Revenue" },
  { itemName: "Review Accounts Payable Aging", category: "Expenses" },
  { itemName: "Reconcile Payroll to GL", category: "Payroll" },
  { itemName: "File Sales Tax Return", category: "Compliance" },
  { itemName: "Post Adjusting Journal Entries", category: "General Ledger" },
  { itemName: "Review Profit & Loss vs. Prior Period", category: "Review" },
  { itemName: "Review Balance Sheet", category: "Review" },
  { itemName: "Close the Period", category: "Review" },
];

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** Merged view: standard items (virtual "Not Started" unless a row exists) + any custom items already saved for this period. */
monthEndRouter.get("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const period = String(req.query.period || "").trim() || currentPeriod();

  const existingRows = await query<any>(
    `SELECT * FROM altax.v3_month_end_items WHERE client_id = $1 AND period = $2 ORDER BY item_name ASC`,
    [clientId, period]
  );
  const byName = new Map(existingRows.map((r: any) => [r.item_name.toLowerCase(), r]));

  const items = STANDARD_ITEMS.map((s) => {
    const row = byName.get(s.itemName.toLowerCase());
    byName.delete(s.itemName.toLowerCase());
    if (row) return row;
    return {
      checklist_item_id: null, client_id: clientId, period, item_name: s.itemName, category: s.category,
      status: "Not Started", completed_at: null, completed_by: null, notes: null,
    };
  });
  for (const remaining of byName.values()) items.push(remaining);

  const doneCount = items.filter((i) => String(i.status).toLowerCase() === "done").length;
  res.json({ period, items, doneCount, totalCount: items.length });
}));

/**
 * Upsert one checklist item's status for a period — creates the row on
 * first status change (item was virtual until now), matching by
 * client+period+itemName so the same standard item is never duplicated.
 */
monthEndRouter.post("/:clientId/items", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) {
    return res.status(403).json({ error: "You do not have access to this client." });
  }
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const body = req.body || {};
  const period = String(body.period || "").trim() || currentPeriod();
  const itemName = String(body.itemName || "").trim();
  if (!itemName) return res.status(400).json({ error: "itemName is required." });
  const status = String(body.status || "Not Started").trim();
  const category = String(body.category || "").trim() || null;
  const notes = String(body.notes || "").trim() || null;
  const isDone = status.toLowerCase() === "done";

  const existing = await queryOne<any>(
    `SELECT * FROM altax.v3_month_end_items WHERE client_id = $1 AND period = $2 AND lower(item_name) = lower($3)`,
    [clientId, period, itemName]
  );

  if (existing) {
    await query(
      `UPDATE altax.v3_month_end_items SET status = $2, category = COALESCE($3, category), notes = $4,
         completed_at = CASE WHEN $5 THEN COALESCE(completed_at, now()) ELSE NULL END,
         completed_by = CASE WHEN $5 THEN COALESCE(completed_by, $6) ELSE NULL END,
         updated_at = now()
       WHERE checklist_item_id = $1`,
      [existing.checklist_item_id, status, category, notes, isDone, req.user!.email]
    );
  } else {
    const checklistItemId = `MEI-${idSuffix()}`;
    await query(
      `INSERT INTO altax.v3_month_end_items
         (checklist_item_id, client_id, client_name, period, item_name, category, status, completed_at, completed_by,
          notes, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Node Web App',$1)`,
      [checklistItemId, client.client_id, client.client_name, period, itemName, category, status,
        isDone ? new Date() : null, isDone ? req.user!.email : null, notes]
    );
  }

  await logAudit("Accounting", "MONTH_END_ITEM", `${clientId}:${period}`, "ItemName", "", `${itemName} -> ${status}`,
    `Month-end checklist item updated by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));
