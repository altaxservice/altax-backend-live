import { Router, Response } from "express";
import { pool, query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { computeTotals, feeItemsFor, linesFromFeeItems, resolveLineAmounts, type EstimateLine } from "./estimates.service";
import { generateEstimatePdf, type EstimatePdfLine } from "./estimatePdf";

/**
 * Tools → Fee Schedule + Estimates.
 *
 * Quotes a new company formation (or any other job) from a catalog the firm
 * maintains itself, then turns an approved quote into a real client: client
 * record, invoice, setup tasks and document requests, in one action. Before
 * this, estimates lived in a copied Google Sheet and nothing downstream knew
 * they existed.
 */
export const estimatesRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ------------------------------------------------------------------ */
/* Fee catalog                                                         */
/* ------------------------------------------------------------------ */

estimatesRouter.get("/fee-items", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const items = await query(`SELECT * FROM altax.v3_fee_items ORDER BY active DESC, sort_order ASC, name ASC`);
  // Distinct values power the pickers, so adding a county is just adding a fee
  // row — no code change, no deploy.
  const jurisdictions = await query<{ jurisdiction: string }>(
    `SELECT DISTINCT jurisdiction FROM altax.v3_fee_items WHERE active = TRUE AND jurisdiction <> 'Any' ORDER BY 1`
  );
  res.json({ feeItems: items, jurisdictions: jurisdictions.map((j) => j.jurisdiction) });
}));

estimatesRouter.post("/fee-items", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const feeItemId = String(b.feeItemId || "").trim() || `FEE-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT fee_item_id FROM altax.v3_fee_items WHERE fee_item_id = $1`, [feeItemId]);
  const params = [
    feeItemId, name,
    String(b.category || "Government"),
    String(b.agency || "").trim() || null,
    String(b.jurisdiction || "Maryland").trim(),
    JSON.stringify(Array.isArray(b.entityTypes) ? b.entityTypes : []),
    JSON.stringify(Array.isArray(b.businessTypes) ? b.businessTypes : []),
    String(b.speed || "").trim() || null,
    String(b.amountKind || "fixed"),
    num(b.percentRate),
    num(b.unitCost),
    num(b.unitPrice),
    num(b.defaultQty) || 1,
    Boolean(b.included),
    Boolean(b.optional),
    Boolean(b.statewide),
    Boolean(b.createsTask),
    String(b.turnaroundDays || "").trim() || null,
    String(b.notes || "").trim() || null,
    b.active === undefined ? true : Boolean(b.active),
    Number(b.sortOrder) || 0,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_fee_items SET name=$2, category=$3, agency=$4, jurisdiction=$5, entity_types=$6::jsonb,
              business_types=$7::jsonb, speed=$8, amount_kind=$9, percent_rate=$10, unit_cost=$11, unit_price=$12,
              default_qty=$13, included=$14, optional=$15, statewide=$16, creates_task=$17, turnaround_days=$18, notes=$19, active=$20,
              sort_order=$21, updated_at=now()
        WHERE fee_item_id=$1`, params
    );
    await logAudit("Tools", "EDIT_FEE_ITEM", feeItemId, "", "", name, `Fee item edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_fee_items
         (fee_item_id, name, category, agency, jurisdiction, entity_types, business_types, speed, amount_kind,
          percent_rate, unit_cost, unit_price, default_qty, included, optional, statewide, creates_task, turnaround_days, notes, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, params
    );
    await logAudit("Tools", "CREATE_FEE_ITEM", feeItemId, "", "", name, `Fee item created by ${req.user!.email}.`, req.user!.email);
  }
  res.status(existing ? 200 : 201).json({ ok: true, feeItemId });
}));

estimatesRouter.post("/fee-items/:feeItemId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { feeItemId } = req.params;
  // Deactivated, not deleted: estimates already sent reference these by id for
  // their audit trail, and a fee that existed last year is a historical fact.
  await query(`UPDATE altax.v3_fee_items SET active = FALSE, updated_at = now() WHERE fee_item_id = $1`, [feeItemId]);
  await logAudit("Tools", "DEACTIVATE_FEE_ITEM", feeItemId, "active", "true", "false", `Fee item deactivated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Preview which fees a job would attract, before an estimate exists. */
estimatesRouter.get("/preview", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const items = await feeItemsFor({
    entityType: String(req.query.entityType || "") || null,
    businessType: String(req.query.businessType || "") || null,
    jurisdiction: String(req.query.jurisdiction || "") || null,
    speed: String(req.query.speed || "Standard"),
  });
  const lines = linesFromFeeItems(items);
  res.json({ lines, totals: computeTotals(lines, {}) });
}));

/* ------------------------------------------------------------------ */
/* Estimates                                                           */
/* ------------------------------------------------------------------ */

async function loadLines(estimateId: string): Promise<EstimateLine[]> {
  const rows = await query<any>(
    `SELECT * FROM altax.v3_estimate_lines WHERE estimate_id = $1 ORDER BY sort_order ASC, created_at ASC`,
    [estimateId]
  );
  return rows.map((r) => ({
    ...r,
    qty: Number(r.qty),
    unit_cost: Number(r.unit_cost),
    unit_price: Number(r.unit_price),
    percent_rate: Number(r.percent_rate),
  }));
}

estimatesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(`SELECT * FROM altax.v3_estimates ORDER BY created_at DESC`);
  const withTotals = [];
  for (const est of rows) {
    const lines = await loadLines(est.estimate_id);
    withTotals.push({
      ...est,
      totals: computeTotals(lines, { discount: est.discount_amount, taxRate: est.tax_rate, deposit: est.deposit_amount }),
      line_count: lines.length,
    });
  }
  res.json({ estimates: withTotals });
}));

estimatesRouter.get("/:estimateId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [req.params.estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });
  const lines = await loadLines(est.estimate_id);
  res.json({
    estimate: est,
    lines,
    totals: computeTotals(lines, { discount: est.discount_amount, taxRate: est.tax_rate, deposit: est.deposit_amount }),
  });
}));

/** Builds the exact PDF payload from a stored estimate — shared by the preview/download route and the manual email send, so both always render the identical document. */
async function buildEstimatePdfBytes(est: any, lines: EstimateLine[]) {
  const totals = computeTotals(lines, { discount: est.discount_amount, taxRate: est.tax_rate, deposit: est.deposit_amount });
  const pdfLines: EstimatePdfLine[] = resolveLineAmounts(lines).map((l) => ({
    description: l.description,
    category: l.category as "Government" | "Service",
    agency: l.agency,
    qty: l.qty,
    amount: l.resolvedAmount,
    included: Boolean(l.included),
    payer: (l.payer || "Firm") as "Firm" | "Client",
  }));
  const address = [est.street, [est.city, est.state, est.zip].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null;
  const bytes = await generateEstimatePdf({
    estimateId: est.estimate_id,
    estimateNumber: est.estimate_number,
    status: est.status,
    estimateDate: est.estimate_date,
    validUntil: est.valid_until,
    businessName: est.business_name,
    contactName: est.contact_name,
    address,
    entityType: est.entity_type,
    businessType: est.business_type,
    jurisdiction: est.jurisdiction,
    speed: est.speed,
    lines: pdfLines,
    serviceTotal: totals.serviceTotal,
    governmentTotal: totals.governmentTotal,
    clientDirectTotal: totals.clientDirectTotal,
    discount: totals.discount,
    taxRate: totals.taxRate,
    tax: totals.tax,
    total: totals.total,
    deposit: totals.deposit,
    balanceDue: totals.balanceDue,
    terms: est.terms,
    preparedBy: est.prepared_by,
  });
  return { bytes, totals };
}

/** Preview/download the estimate as a PDF — always available regardless of status, so staff can check it before ever sending anything. */
estimatesRouter.get("/:estimateId/print", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [req.params.estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });
  const lines = await loadLines(est.estimate_id);
  const { bytes } = await buildEstimatePdfBytes(est, lines);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Estimate_${est.estimate_number}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/**
 * Email the estimate to the client — ALWAYS a deliberate staff action, never
 * triggered by approving, converting, or any other step. Mirrors billing's
 * invoice /send route exactly (same PDF-attached-to-a-branded-email pattern,
 * same manual-only philosophy) so staff already familiar with sending an
 * invoice need to learn nothing new here. Email only, matching every other
 * send path in this app — SMS/WhatsApp have no provider configured.
 */
estimatesRouter.post("/:estimateId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [req.params.estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });

  const to = String(req.body?.email || "").trim();
  if (!to) return res.status(400).json({ error: "Enter the email address to send to." });

  const lines = await loadLines(est.estimate_id);
  const { bytes, totals } = await buildEstimatePdfBytes(est, lines);

  const subject = String(req.body?.subject || `Estimate ${est.estimate_number} from AL Tax Service`).trim();
  const message = String(req.body?.message
    || `Please find your estimate attached for ${est.business_name}. Total estimated: $${totals.total.toFixed(2)}.`).trim();

  const { sendEmail } = await import("../../common/notifications");
  const { wrapEmailHtml } = await import("../../common/emailTemplate");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let sent = false;
  let error: string | undefined;
  try {
    await sendEmail({
      to, subject,
      html: await wrapEmailHtml(
        `<p>${esc(message).replace(/\n/g, "<br/>")}</p>
         <p style="color:#6b7280; font-size:12.5px; margin-top:18px;">The full estimate is attached to this email as a PDF.</p>`,
        req
      ),
      attachments: [{ filename: `Estimate_${est.estimate_number}.pdf`, content: Buffer.from(bytes) }],
    });
    sent = true;
  } catch (err: any) {
    error = err?.message || "Send failed.";
  }

  if (sent) {
    // Sent moves a Draft estimate off the "still being built" bucket; it never
    // downgrades an estimate already Approved or further along.
    if (est.status === "Draft") {
      await query(`UPDATE altax.v3_estimates SET status = 'Sent', updated_at = now() WHERE estimate_id = $1`, [est.estimate_id]);
    }
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, direction, channel, subject, message_english, sent_to, sent_by, sent_at, status, source_system, source_record_id)
       VALUES ($1,$2,$3,'Outbound','Email',$4,$5,$6,$7, now(), 'Sent','Estimate',$8)`,
      [`COM-${idSuffix()}`, est.client_id, est.business_name, subject, message, to, req.user!.email, est.estimate_id]
    );
  }

  await logAudit("Tools", "SEND_ESTIMATE", est.estimate_id, "", "", sent ? `Sent to ${to}` : `Failed: ${error}`,
    `Estimate ${sent ? "sent" : "send attempted"} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: sent, error });
}));

/**
 * Create an estimate. When the caller supplies entity/business/jurisdiction/speed
 * the priced checklist is assembled from the catalog immediately, which is the
 * entire point — staff pick four things and the right lines appear.
 */
estimatesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  const businessName = String(b.businessName || "").trim();
  if (!businessName) return res.status(400).json({ error: "Business name is required." });

  const estimateId = `EST-${idSuffix()}`;
  const count = await queryOne<{ n: string }>(`SELECT COUNT(*)::int AS n FROM altax.v3_estimates`);
  const estimateNumber = `EST-${String(Number(count?.n || 0) + 1).padStart(4, "0")}`;

  const validUntil = b.validUntil
    ? String(b.validUntil)
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await query(
    `INSERT INTO altax.v3_estimates
       (estimate_id, estimate_number, status, business_name, contact_name, email, phone, street, city, state, zip,
        entity_type, business_type, jurisdiction, speed, estimate_date, valid_until, prepared_by,
        discount_amount, tax_rate, deposit_amount, terms, internal_note, created_by)
     VALUES ($1,$2,'Draft',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::date, CURRENT_DATE),$16::date,$17,$18,$19,$20,$21,$22,$23)`,
    [
      estimateId, estimateNumber, businessName,
      String(b.contactName || "").trim() || null, String(b.email || "").trim() || null, String(b.phone || "").trim() || null,
      String(b.street || "").trim() || null, String(b.city || "").trim() || null, String(b.state || "MD").trim() || null,
      String(b.zip || "").trim() || null,
      String(b.entityType || "").trim() || null, String(b.businessType || "").trim() || null,
      String(b.jurisdiction || "").trim() || null, String(b.speed || "Standard"),
      b.estimateDate || null, validUntil,
      String(b.preparedBy || req.user!.email),
      num(b.discountAmount), num(b.taxRate), num(b.depositAmount),
      String(b.terms || "").trim() || null, String(b.internalNote || "").trim() || null,
      req.user!.email,
    ]
  );

  if (b.entityType || b.businessType || b.jurisdiction) {
    const items = await feeItemsFor({
      entityType: b.entityType, businessType: b.businessType,
      jurisdiction: b.jurisdiction, speed: b.speed || "Standard",
    });
    const lines = linesFromFeeItems(items);
    for (const line of lines) {
      await query(
        `INSERT INTO altax.v3_estimate_lines
           (line_id, estimate_id, fee_item_id, sort_order, description, category, agency, qty, unit_cost, unit_price,
            amount_kind, percent_rate, included, creates_task, payer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Firm')`,
        [`ELN-${idSuffix()}`, estimateId, line.fee_item_id, line.sort_order, line.description, line.category,
         line.agency, line.qty, line.unit_cost, line.unit_price, line.amount_kind, line.percent_rate, line.included,
         Boolean(line.creates_task)]
      );
    }
  }

  await logAudit("Tools", "CREATE_ESTIMATE", estimateId, "", "", businessName, `Estimate created by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, estimateId, estimateNumber });
}));

estimatesRouter.patch("/:estimateId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  const b = req.body || {};
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });

  const map: Record<string, string> = {
    businessName: "business_name", contactName: "contact_name", email: "email", phone: "phone",
    street: "street", city: "city", state: "state", zip: "zip",
    entityType: "entity_type", businessType: "business_type", jurisdiction: "jurisdiction", speed: "speed",
    estimateDate: "estimate_date", validUntil: "valid_until", preparedBy: "prepared_by",
    discountAmount: "discount_amount", taxRate: "tax_rate", depositAmount: "deposit_amount",
    depositDate: "deposit_date", terms: "terms", internalNote: "internal_note", status: "status",
  };
  const sets: string[] = [];
  const params: any[] = [estimateId];
  for (const [key, col] of Object.entries(map)) {
    if (b[key] === undefined) continue;
    params.push(b[key] === "" ? null : b[key]);
    sets.push(`${col} = $${params.length}`);
  }
  if (!sets.length) return res.json({ ok: true });

  await query(`UPDATE altax.v3_estimates SET ${sets.join(", ")}, updated_at = now() WHERE estimate_id = $1`, params);
  res.json({ ok: true });
}));

/** Replace all lines — used by the builder, which owns the whole grid. */
estimatesRouter.put("/:estimateId/lines", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  const lines: any[] = Array.isArray(req.body?.lines) ? req.body.lines : [];
  const est = await queryOne<any>(`SELECT estimate_id FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM altax.v3_estimate_lines WHERE estimate_id = $1`, [estimateId]);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      await client.query(
        `INSERT INTO altax.v3_estimate_lines
           (line_id, estimate_id, fee_item_id, sort_order, description, category, agency, qty, unit_cost, unit_price,
            amount_kind, percent_rate, included, creates_task, payer, remitted_at, remitted_amount, remittance_ref, remittance_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          String(l.line_id || `ELN-${idSuffix()}`), estimateId, l.fee_item_id || null, i,
          String(l.description || "").trim() || "Item", String(l.category || "Government"),
          l.agency || null, num(l.qty) || 0, num(l.unit_cost), num(l.unit_price),
          String(l.amount_kind || "fixed"), num(l.percent_rate), Boolean(l.included),
          Boolean(l.creates_task), String(l.payer || "Firm"), l.remitted_at || null,
          l.remitted_amount === undefined || l.remitted_amount === null ? null : num(l.remitted_amount),
          l.remittance_ref || null, l.remittance_note || null,
        ]
      );
    }
    await client.query(`UPDATE altax.v3_estimates SET updated_at = now() WHERE estimate_id = $1`, [estimateId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const saved = await loadLines(estimateId);
  const e = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  res.json({ ok: true, lines: saved, totals: computeTotals(saved, { discount: e.discount_amount, taxRate: e.tax_rate, deposit: e.deposit_amount }) });
}));

/** Rebuild lines from the catalog after the job details change. */
estimatesRouter.post("/:estimateId/rebuild", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [req.params.estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });

  const items = await feeItemsFor({
    entityType: est.entity_type, businessType: est.business_type,
    jurisdiction: est.jurisdiction, speed: est.speed,
  });
  const lines = linesFromFeeItems(items);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM altax.v3_estimate_lines WHERE estimate_id = $1`, [est.estimate_id]);
    for (const line of lines) {
      await client.query(
        `INSERT INTO altax.v3_estimate_lines
           (line_id, estimate_id, fee_item_id, sort_order, description, category, agency, qty, unit_cost, unit_price,
            amount_kind, percent_rate, included, creates_task, payer)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Firm')`,
        [`ELN-${idSuffix()}`, est.estimate_id, line.fee_item_id, line.sort_order, line.description, line.category,
         line.agency, line.qty, line.unit_cost, line.unit_price, line.amount_kind, line.percent_rate, line.included,
         Boolean(line.creates_task)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const saved = await loadLines(est.estimate_id);
  res.json({ ok: true, lines: saved, totals: computeTotals(saved, { discount: est.discount_amount, taxRate: est.tax_rate, deposit: est.deposit_amount }) });
}));

/** Staff/admin record the client's decision — approval happens by phone or in person. */
estimatesRouter.post("/:estimateId/approve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  const method = String(req.body?.method || "").trim() || "Verbal";
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });

  await query(
    `UPDATE altax.v3_estimates SET status='Approved', approved_at=now(), approved_by=$2, approval_method=$3, updated_at=now()
      WHERE estimate_id=$1`,
    [estimateId, req.user!.email, method]
  );
  await logAudit("Tools", "APPROVE_ESTIMATE", estimateId, "status", est.status, "Approved",
    `Estimate approved (${method}) by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

estimatesRouter.post("/:estimateId/decline", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  await query(
    `UPDATE altax.v3_estimates SET status='Declined', declined_reason=$2, updated_at=now() WHERE estimate_id=$1`,
    [estimateId, String(req.body?.reason || "").trim() || null]
  );
  await logAudit("Tools", "DECLINE_ESTIMATE", estimateId, "status", "", "Declined", `Estimate declined by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

estimatesRouter.post("/:estimateId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });
  if (est.client_id) return res.status(400).json({ error: "This estimate has been converted to a client and can't be deleted." });
  await query(`DELETE FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  await logAudit("Tools", "DELETE_ESTIMATE", estimateId, "", est.business_name, "", `Estimate deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * Approved → a real client, in one action.
 *
 * Creates the client record, an invoice carrying the estimate's lines (deposit
 * applied), and a task per government filing so the work that was just sold is
 * actually tracked. This is the join the Google Sheet could never make: there,
 * an accepted estimate was a PDF someone had to re-key three times.
 */
estimatesRouter.post("/:estimateId/convert", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { estimateId } = req.params;
  const est = await queryOne<any>(`SELECT * FROM altax.v3_estimates WHERE estimate_id = $1`, [estimateId]);
  if (!est) return res.status(404).json({ error: "Estimate not found." });
  if (est.client_id) return res.status(400).json({ error: "This estimate has already been converted." });
  if (est.status !== "Approved") return res.status(400).json({ error: "Approve the estimate before converting it." });

  const lines = await loadLines(estimateId);
  const totals = computeTotals(lines, { discount: est.discount_amount, taxRate: est.tax_rate, deposit: est.deposit_amount });

  const createTasks = req.body?.createTasks !== false;
  const createInvoice = req.body?.createInvoice !== false;

  const clientId = `C-${idSuffix()}`;
  const invoiceId = createInvoice ? `INV-${idSuffix()}` : null;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    await db.query(
      `INSERT INTO altax.v3_clients
         (client_id, client_name, client_type, entity_type, status, email, phone,
          street_address, city, state, zip_code, assigned_to, portal_enabled,
          source_system, source_record_id, created_at, updated_at)
       VALUES ($1,$2,'Business',$3,'Active',$4,$5,$6,$7,$8,$9,$10,FALSE,'Estimate',$11, now(), now())`,
      [clientId, est.business_name, est.entity_type || null, est.email || null, est.phone || null,
       est.street || null, est.city || null, est.state || null, est.zip || null,
       req.user!.email, estimateId]
    );

    if (createInvoice && invoiceId) {
      await db.query(
        `INSERT INTO altax.v3_invoices
           (invoice_id, client_id, invoice_date, due_date, description, subtotal_amount, discount_amount,
            sales_tax_rate, sales_tax_amount, total_amount, amount_paid, balance_due, deposit_amount, status,
            terms, client_note, source_system, source_record_id, bill_to, created_at, updated_at)
         VALUES ($1,$2,CURRENT_DATE,CURRENT_DATE + 30,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'Estimate',$15,$16, now(), now())`,
        [
          invoiceId, clientId,
          `Company formation — ${est.business_name}`,
          totals.subtotal, totals.discount, totals.taxRate, totals.tax, totals.total,
          totals.deposit, totals.balanceDue, totals.deposit,
          totals.balanceDue > 0 ? "Open" : "Paid",
          est.terms || null, `Converted from estimate ${est.estimate_number}.`,
          estimateId, est.business_name,
        ]
      );
      // Lines carry across so the invoice itemizes exactly what was quoted — no
      // re-keying, and the client sees the same breakdown twice. resolveLineAmounts
      // is the same helper the PDF and manual send use, so a percentage line (the
      // state's technology fee) always shows the identical dollar figure everywhere.
      const resolved = resolveLineAmounts(lines);
      let i = 0;
      for (const line of resolved) {
        if (line.payer === "Client") continue;
        await db.query(
          `INSERT INTO altax.v3_invoice_line_items
             (line_item_id, invoice_id, line_no, description, quantity, rate, amount, taxable, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
          [`ILI-${idSuffix()}`, invoiceId, ++i, line.description, line.qty,
           line.amount_kind === "percent" ? line.resolvedAmount : line.unit_price, line.resolvedAmount, false]
        );
      }
    }

    if (createTasks) {
      // One task per government filing — the actual work sold. Service lines are
      // the firm's own labour and don't need their own agency deadline.
      for (const line of lines) {
        // Only lines the firm marked as real work. A technology fee or a copy
        // surcharge is part of one filing, not a job of its own — creating a
        // task for each would bury the actual filings in noise.
        if (!line.creates_task) continue;
        await db.query(
          `INSERT INTO altax.v3_tasks
             (task_id, client_id, client_name, task_name, service_line, status, assigned_to, agency_due_date,
              notes, source_system, source_record_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'Business Compliance','Not Started',$5, CURRENT_DATE + 14, $6,'Estimate',$7, now(), now())`,
          [`T-${idSuffix()}`, clientId, est.business_name, line.description, req.user!.email,
           `From estimate ${est.estimate_number}. ${line.agency || ""}`.trim(), estimateId]
        );
      }
    }

    await db.query(
      `UPDATE altax.v3_estimates SET client_id=$2, invoice_id=$3, converted_at=now(), status='Approved', updated_at=now()
        WHERE estimate_id=$1`,
      [estimateId, clientId, invoiceId]
    );

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }

  await logAudit("Tools", "CONVERT_ESTIMATE", estimateId, "client_id", "", clientId,
    `Estimate converted to client ${clientId} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, clientId, invoiceId });
}));

/**
 * Agency ledger — money collected for agencies versus money proven remitted.
 * The unremitted figure is the one that matters operationally: it is a permit
 * the client has paid for that the firm has not yet bought.
 */
estimatesRouter.get("/reports/agency-ledger", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT e.estimate_id, e.estimate_number, e.business_name, e.status, e.client_id,
            l.line_id, l.description, l.agency, l.qty, l.unit_cost, l.unit_price, l.amount_kind, l.percent_rate,
            l.included, l.payer, l.remitted_at, l.remitted_amount, l.remittance_ref
       FROM altax.v3_estimates e
       JOIN altax.v3_estimate_lines l ON l.estimate_id = e.estimate_id
      WHERE l.category = 'Government' AND l.payer = 'Firm' AND l.included = FALSE
        AND e.status IN ('Approved','Sent')
      ORDER BY e.created_at DESC, l.sort_order ASC`
  );
  const items = rows.map((r) => ({
    ...r,
    charged: Number((Number(r.qty) * Number(r.unit_price)).toFixed(2)),
    cost: Number((Number(r.qty) * Number(r.unit_cost)).toFixed(2)),
  }));
  const outstanding = items.filter((i) => !i.remitted_at);
  res.json({
    items,
    summary: {
      collected: Number(items.reduce((s, i) => s + i.charged, 0).toFixed(2)),
      cost: Number(items.reduce((s, i) => s + i.cost, 0).toFixed(2)),
      remitted: Number(items.filter((i) => i.remitted_at).reduce((s, i) => s + i.cost, 0).toFixed(2)),
      outstanding: Number(outstanding.reduce((s, i) => s + i.cost, 0).toFixed(2)),
      outstandingCount: outstanding.length,
    },
  });
}));
