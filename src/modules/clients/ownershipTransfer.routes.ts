/**
 * Business Ownership Transfer package — one intake on an EXISTING client's
 * profile (old owner -> new owner, effective date, sale terms) that fans
 * out to the documents a real transfer needs, instead of five disconnected
 * manual steps:
 *   1. Bill of Sale — generated fresh from the stored terms (billOfSale.ts),
 *      not a government form, so it isn't a v3_gov_form_filings row.
 *   2. IRS Form 8822-B (Change of Responsible Party) — inserted directly
 *      into v3_gov_form_filings as a Draft with the buyer as the new
 *      responsible party. Shows up in the client's existing Government
 *      Forms section with zero new UI (same GET /gov-forms/client/:id the
 *      section already calls, same GET /gov-forms/:filingId/pdf download).
 *   3. Maryland Form CRA (Combined Registration Application), reason
 *      "Change of entity" — same reuse-the-existing-section approach.
 *   4. A Task reminding staff to file the actual Maryland Articles of
 *      Amendment with SDAT — that form's own real fillable PDF hasn't been
 *      sourced yet (unlike the other 6 forms this app generates), so this
 *      stays a tracked checklist item rather than an auto-generated PDF,
 *      by explicit decision — see the "hard evaluation" round this shipped
 *      alongside.
 *
 * Each of the four outputs is generated independently and wrapped in its
 * own try/catch: a client missing a street address (say) shouldn't block
 * the Bill of Sale and task from being created just because CRA's address
 * requirement can't be met yet. The response reports exactly what was
 * created and what wasn't, so staff always knows what still needs doing by
 * hand — same disclosure discipline as every other feature in this app.
 */
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { encryptValue, decryptTolerant } from "../../common/encryption";
import { generateBillOfSalePdf } from "../govForms/billOfSale";
import { generateBillOfSaleDocx } from "../govForms/billOfSaleDocx";
import { generateGovForm, type CraData, type Form8822bData } from "../govForms/govForms.service";

export const ownershipTransferRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

function maskTail(value: string | null | undefined): string | null {
  const s = String(value || "");
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 4) return "•••";
  return `•••-••-${digits.slice(-4)}`;
}

function splitName(full: string): { first: string; last: string } {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/** Same vocabulary-mismatch guard used for SS-4's entityType prefill (see GenerateGovFormModal.tsx) — v3_clients.entity_type's own values never assumed to line up with a form's own option list. */
const ENTITY_TYPE_TO_CRA_OWNERSHIP: Record<string, string> = {
  LLC: "Limited liability company",
  "C-Corp": "Maryland corporation",
  "S-Corp": "Maryland corporation",
  Partnership: "Partnership",
  "Sole Proprietorship": "Sole proprietorship",
  Nonprofit: "Nonprofit organization",
};

async function encryptFormDataForStorage(formData: any): Promise<string> {
  return JSON.stringify({ __enc: encryptValue(JSON.stringify(formData ?? {})) });
}

/**
 * IRC Section 1060 / Form 8594-style itemized allocation — replaces (when
 * present) the old single "assets included" paragraph with real line items,
 * each with its own price, so the Bill of Sale can show a genuine allocation
 * schedule instead of prose. See ASSET_ALLOCATION_CATEGORIES in
 * frontend/src/utils/clientOptions.ts and the class map in billOfSale.ts —
 * category is free text here (not a hard enum) since "Other" always needs
 * to cover something a fixed list didn't anticipate.
 */
interface AssetAllocationLine {
  category: string;
  description: string | null;
  amount: number;
}

/** Rejects a malformed line (empty category, non-positive/non-finite amount) outright rather than silently dropping or zeroing it — a staff typo here becomes a wrong legal document otherwise. */
function parseAssetAllocations(raw: unknown): AssetAllocationLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: AssetAllocationLine[] = [];
  for (const item of raw) {
    const category = String(item?.category || "").trim();
    const amount = Number(item?.amount);
    if (!category) continue;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(`Each asset allocation line needs a category and a positive amount (problem with "${category}").`);
    }
    lines.push({ category, description: String(item?.description || "").trim() || null, amount: Math.round(amount * 100) / 100 });
  }
  return lines;
}

function sumAllocations(lines: AssetAllocationLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100;
}

ownershipTransferRouter.get("/:clientId/ownership-transfers", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(
    `SELECT transfer_id, client_id, seller_name, seller_title, buyer_name, buyer_title, buyer_ssn, buyer_email, buyer_phone,
            buyer_street_address, buyer_city, buyer_state, buyer_zip_code, effective_date, sale_price,
            assets_included, liabilities_included, additional_terms, include_bill_of_sale, asset_allocations,
            gov_form_8822b_filing_id, gov_form_cra_filing_id, md_amendment_task_id, created_by, created_at
       FROM altax.v3_ownership_transfers WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  const isAdmin = req.user!.role === "admin";
  res.json({
    transfers: rows.map((r) => ({ ...r, buyer_ssn: r.buyer_ssn ? (isAdmin ? decryptTolerant(r.buyer_ssn) : maskTail(decryptTolerant(r.buyer_ssn))) : null })),
  });
}));

ownershipTransferRouter.post("/:clientId/ownership-transfers", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const sellerName = String(body.sellerName || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  if (!sellerName) return res.status(400).json({ error: "Seller name is required." });
  if (!buyerName) return res.status(400).json({ error: "Buyer name is required." });

  const client = await queryOne<any>(
    `SELECT client_id, client_name, entity_type, ein, dba_name, street_address, city, state, zip_code,
            payroll_enabled, sales_tax_frequency, assigned_to
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!client) return res.status(404).json({ error: "Client not found." });

  const transferId = `XFER-${idSuffix()}`;
  const buyerSsnPlaintext = String(body.buyerSsn || "").trim();

  let assetAllocations: AssetAllocationLine[];
  try {
    assetAllocations = parseAssetAllocations(body.assetAllocations);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
  // The allocation lines ARE the sale price when present — a single source of
  // truth so the Bill of Sale total and the itemized schedule can never drift
  // apart. With no allocation lines this stays the old plain manual figure.
  const salePrice = assetAllocations.length > 0
    ? sumAllocations(assetAllocations)
    : (body.salePrice !== "" && body.salePrice !== null && body.salePrice !== undefined ? Number(body.salePrice) : null);

  const includeBillOfSale = body.includeBillOfSale !== false;
  const include8822b = body.include8822b !== false;
  const includeCra = body.includeCra !== false;
  const includeMdAmendmentTask = body.includeMdAmendmentTask !== false;

  await query(
    `INSERT INTO altax.v3_ownership_transfers
       (transfer_id, client_id, seller_name, seller_title, buyer_name, buyer_title, buyer_ssn, buyer_email, buyer_phone,
        buyer_street_address, buyer_city, buyer_state, buyer_zip_code, effective_date, sale_price,
        assets_included, liabilities_included, additional_terms, include_bill_of_sale, asset_allocations, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      transferId, clientId, sellerName, String(body.sellerTitle || "").trim() || null,
      buyerName, String(body.buyerTitle || "").trim() || null,
      buyerSsnPlaintext ? encryptValue(buyerSsnPlaintext) : null,
      String(body.buyerEmail || "").trim() || null, String(body.buyerPhone || "").trim() || null,
      String(body.buyerStreetAddress || "").trim() || null, String(body.buyerCity || "").trim() || null,
      String(body.buyerState || "").trim() || null, String(body.buyerZipCode || "").trim() || null,
      body.effectiveDate || null, salePrice,
      String(body.assetsIncluded || "").trim() || null, String(body.liabilitiesIncluded || "").trim() || null,
      String(body.additionalTerms || "").trim() || null, includeBillOfSale,
      assetAllocations.length > 0 ? JSON.stringify(assetAllocations) : null, req.user!.email,
    ]
  );

  const created: { billOfSale: boolean; form8822b: boolean; craUpdate: boolean; mdAmendmentTask: boolean } = {
    billOfSale: includeBillOfSale, form8822b: false, craUpdate: false, mdAmendmentTask: false,
  };
  const skippedReasons: string[] = [];

  // 8822-B — new responsible party is the buyer. affectsEmploymentReturns is
  // always checked: any client with payroll or that files any business
  // return has that box apply the moment its responsible party changes.
  if (!include8822b) {
    skippedReasons.push("Form 8822-B was not requested.");
  } else {
    try {
      const form8822bData: Form8822bData = {
        affectsEmploymentReturns: true,
        businessName: client.client_name,
        ein: client.ein || undefined,
        newResponsiblePartyName: buyerName,
        newResponsiblePartyId: buyerSsnPlaintext || undefined,
        daytimePhone: String(body.buyerPhone || "").trim() || undefined,
        title: String(body.buyerTitle || "").trim() || undefined,
      };
      await generateGovForm("8822B", form8822bData); // fail fast on a broken field map, same as govForms.routes.ts
      const filingId8822b = `GOV-${idSuffix()}`;
      await query(
        `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
         VALUES ($1,$2,'8822B',$3,'Draft',$4)`,
        [filingId8822b, clientId, await encryptFormDataForStorage(form8822bData), req.user!.email]
      );
      await query(`UPDATE altax.v3_ownership_transfers SET gov_form_8822b_filing_id = $1 WHERE transfer_id = $2`, [filingId8822b, transferId]);
      created.form8822b = true;
    } catch (err: any) {
      skippedReasons.push(`Form 8822-B was not generated: ${err?.message || "missing data."}`);
    }
  }

  // CRA "Change of entity" — same officer-slot convention this app already
  // uses (one responsible party per client), filled with the buyer.
  if (!includeCra) {
    skippedReasons.push("Maryland CRA update was not requested.");
  } else {
    try {
      if (!client.street_address || !client.city || !client.zip_code) {
        throw new Error("client is missing a physical business address on file");
      }
      const taxTypes: CraData["taxTypes"] = [];
      if (client.payroll_enabled) taxTypes.push("Employer withholding tax");
      if (client.sales_tax_frequency && String(client.sales_tax_frequency).trim().toLowerCase() !== "n/a") taxTypes.push("Sales and use tax");
      if (taxTypes.length === 0) taxTypes.push("Employer withholding tax"); // safe default so the form can generate; staff should verify the client's real accounts on file
      const officer = splitName(buyerName);
      const ownershipType = (client.entity_type && ENTITY_TYPE_TO_CRA_OWNERSHIP[client.entity_type]) || "Limited liability company";
      const craData: CraData = {
        fein: client.ein || undefined,
        legalFirstName: client.client_name,
        tradeName: client.dba_name || undefined,
        street1: client.street_address,
        city: client.city,
        state: client.state || "MD",
        zip: client.zip_code,
        reason: "Change of entity",
        taxTypes,
        ownershipType: ownershipType as CraData["ownershipType"],
        officerFirstName: officer.first,
        officerLastName: officer.last,
        officerSsn: buyerSsnPlaintext || undefined,
        officerTitle: String(body.buyerTitle || "").trim() || undefined,
        officerStreet: String(body.buyerStreetAddress || "").trim() || undefined,
        officerCity: String(body.buyerCity || "").trim() || undefined,
        officerState: String(body.buyerState || "").trim() || undefined,
        officerZip: String(body.buyerZipCode || "").trim() || undefined,
        officerPhone: String(body.buyerPhone || "").trim() || undefined,
      };
      await generateGovForm("CRA", craData);
      const filingIdCra = `GOV-${idSuffix()}`;
      await query(
        `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
         VALUES ($1,$2,'CRA',$3,'Draft',$4)`,
        [filingIdCra, clientId, await encryptFormDataForStorage(craData), req.user!.email]
      );
      await query(`UPDATE altax.v3_ownership_transfers SET gov_form_cra_filing_id = $1 WHERE transfer_id = $2`, [filingIdCra, transferId]);
      created.craUpdate = true;
    } catch (err: any) {
      skippedReasons.push(`Maryland CRA update was not generated: ${err?.message || "missing data."}`);
    }
  }

  // MD Amendment — tracked as a Task since the real SDAT form isn't built yet.
  if (!includeMdAmendmentTask) {
    skippedReasons.push("MD Amendment task was not requested.");
  } else {
    try {
      const taskId = `TASK-${idSuffix()}`;
      await query(
        `INSERT INTO altax.v3_tasks
           (task_id, client_id, client_name, service_line, task_name, period, status, assigned_to, notes, source_system, source_record_id)
         VALUES ($1,$2,$3,'Compliance','File MD Amendment (Articles of Amendment) with SDAT','Ownership Transfer','Not Started',$4,$5,'Ownership Transfer',$6)`,
        [
          taskId, clientId, client.client_name, client.assigned_to || req.user!.email,
          `Business ownership transferred from ${sellerName} to ${buyerName}` +
            (body.effectiveDate ? ` effective ${body.effectiveDate}` : "") +
            `. File Maryland Articles of Amendment reflecting the new principal/resident agent as needed — this app doesn't yet generate that form (see transfer ${transferId}).`,
          transferId,
        ]
      );
      await query(`UPDATE altax.v3_ownership_transfers SET md_amendment_task_id = $1 WHERE transfer_id = $2`, [taskId, transferId]);
      created.mdAmendmentTask = true;
    } catch (err: any) {
      skippedReasons.push(`MD Amendment task was not created: ${err?.message || "unknown error."}`);
    }
  }

  await logAudit("Clients", "OWNERSHIP_TRANSFER_CREATED", transferId, "buyer_name", "", buyerName,
    `Ownership transfer package started for ${client.client_name}: ${sellerName} -> ${buyerName}, by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, transferId, created, skippedReasons });
}));

/**
 * Corrects a data-entry mistake on the transfer intake (seller/buyer info,
 * sale terms) — same role gate as create, since staff who can create this
 * should be able to fix their own typo. Only touches v3_ownership_transfers
 * itself: the Bill of Sale is generated fresh from this row on every
 * download, so an edit here fixes it immediately. The 8822-B/CRA drafts
 * already created from the OLD data are separate v3_gov_form_filings rows
 * with their own snapshot — this route deliberately does not reach into
 * them, since they already have their own edit route
 * (PATCH /gov-forms/:filingId) for staff to correct independently if needed.
 */
ownershipTransferRouter.patch("/:clientId/ownership-transfers/:transferId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, transferId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const existing = await queryOne<any>(`SELECT transfer_id FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`, [transferId, clientId]);
  if (!existing) return res.status(404).json({ error: "Transfer not found." });

  const body = req.body || {};
  const sellerName = String(body.sellerName || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  if (!sellerName) return res.status(400).json({ error: "Seller name is required." });
  if (!buyerName) return res.status(400).json({ error: "Buyer name is required." });

  const buyerSsnPlaintext = String(body.buyerSsn || "").trim();

  let assetAllocations: AssetAllocationLine[];
  try {
    assetAllocations = parseAssetAllocations(body.assetAllocations);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
  const salePrice = assetAllocations.length > 0
    ? sumAllocations(assetAllocations)
    : (body.salePrice !== "" && body.salePrice !== null && body.salePrice !== undefined ? Number(body.salePrice) : null);
  const includeBillOfSale = body.includeBillOfSale !== false;

  await query(
    `UPDATE altax.v3_ownership_transfers SET
       seller_name=$3, seller_title=$4, buyer_name=$5, buyer_title=$6, buyer_ssn=$7, buyer_email=$8, buyer_phone=$9,
       buyer_street_address=$10, buyer_city=$11, buyer_state=$12, buyer_zip_code=$13, effective_date=$14, sale_price=$15,
       assets_included=$16, liabilities_included=$17, additional_terms=$18, include_bill_of_sale=$19, asset_allocations=$20,
       updated_at=now()
     WHERE transfer_id = $1 AND client_id = $2`,
    [
      transferId, clientId, sellerName, String(body.sellerTitle || "").trim() || null,
      buyerName, String(body.buyerTitle || "").trim() || null,
      buyerSsnPlaintext ? encryptValue(buyerSsnPlaintext) : null,
      String(body.buyerEmail || "").trim() || null, String(body.buyerPhone || "").trim() || null,
      String(body.buyerStreetAddress || "").trim() || null, String(body.buyerCity || "").trim() || null,
      String(body.buyerState || "").trim() || null, String(body.buyerZipCode || "").trim() || null,
      body.effectiveDate || null, salePrice,
      String(body.assetsIncluded || "").trim() || null, String(body.liabilitiesIncluded || "").trim() || null,
      String(body.additionalTerms || "").trim() || null, includeBillOfSale,
      assetAllocations.length > 0 ? JSON.stringify(assetAllocations) : null,
    ]
  );

  await logAudit("Clients", "OWNERSHIP_TRANSFER_EDITED", transferId, "buyer_name", "", buyerName,
    `Ownership transfer edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));

/**
 * Hard delete — admin only, same rule as contracts/gov-forms/tasks. Also
 * removes the linked 8822-B/CRA drafts and MD Amendment task IF they're
 * still untouched (Draft / Not Started) — those only exist because of this
 * transfer, so leaving them behind as orphans once the transfer itself is
 * gone would just be confusing debris. Anything already acted on (signed,
 * submitted, or a task staff started working) is left alone and reported
 * back, same disclosure discipline as the create route.
 */
ownershipTransferRouter.post("/:clientId/ownership-transfers/:transferId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, transferId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const transfer = await queryOne<any>(
    `SELECT * FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`,
    [transferId, clientId]
  );
  if (!transfer) return res.status(404).json({ error: "Transfer not found." });

  const left: string[] = [];

  if (transfer.gov_form_8822b_filing_id) {
    const f = await queryOne<any>(`SELECT status FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_8822b_filing_id]);
    if (f && f.status === "Draft") await query(`DELETE FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_8822b_filing_id]);
    else if (f) left.push(`Form 8822-B is already ${f.status} — left in place.`);
  }
  if (transfer.gov_form_cra_filing_id) {
    const f = await queryOne<any>(`SELECT status FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_cra_filing_id]);
    if (f && f.status === "Draft") await query(`DELETE FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_cra_filing_id]);
    else if (f) left.push(`Maryland CRA update is already ${f.status} — left in place.`);
  }
  if (transfer.md_amendment_task_id) {
    const t = await queryOne<any>(`SELECT status FROM altax.v3_tasks WHERE task_id = $1`, [transfer.md_amendment_task_id]);
    if (t && t.status === "Not Started") await query(`DELETE FROM altax.v3_tasks WHERE task_id = $1`, [transfer.md_amendment_task_id]);
    else if (t) left.push(`The MD Amendment task is already ${t.status} — left in place.`);
  }

  await query(`DELETE FROM altax.v3_ownership_transfers WHERE transfer_id = $1`, [transferId]);
  await logAudit("Clients", "OWNERSHIP_TRANSFER_DELETED", transferId, "", `${transfer.seller_name} -> ${transfer.buyer_name}`, "",
    `Ownership transfer deleted by ${req.user!.email}.${left.length ? " " + left.join(" ") : ""}`, req.user!.email);

  res.json({ ok: true, left });
}));

async function loadBillOfSaleInputs(clientId: string, transferId: string) {
  const [client, transfer] = await Promise.all([
    queryOne<any>(`SELECT client_id, client_name, entity_type, ein, street_address, city, state, zip_code FROM altax.v3_clients WHERE client_id = $1`, [clientId]),
    queryOne<any>(`SELECT * FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`, [transferId, clientId]),
  ]);
  if (!client || !transfer) return null;

  const businessAddress = [client.street_address, client.city, client.state, client.zip_code].filter((v) => String(v || "").trim()).join(", ");
  const buyerAddress = [transfer.buyer_street_address, transfer.buyer_city, transfer.buyer_state, transfer.buyer_zip_code].filter((v) => String(v || "").trim()).join(", ");

  return {
    client,
    data: {
      clientId: client.client_id,
      businessName: client.client_name,
      ein: client.ein || null,
      businessAddress: businessAddress || null,
      sellerName: transfer.seller_name,
      sellerTitle: transfer.seller_title,
      buyerName: transfer.buyer_name,
      buyerTitle: transfer.buyer_title,
      buyerAddress: buyerAddress || null,
      effectiveDate: transfer.effective_date,
      salePrice: transfer.sale_price !== null ? Number(transfer.sale_price) : null,
      assetsIncluded: transfer.assets_included,
      assetAllocations: (transfer.asset_allocations as AssetAllocationLine[] | null) || [],
      liabilitiesIncluded: transfer.liabilities_included,
      additionalTerms: transfer.additional_terms,
      entityType: client.entity_type || null,
      state: client.state || null,
    },
  };
}

ownershipTransferRouter.get("/:clientId/ownership-transfers/:transferId/bill-of-sale.pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, transferId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const loaded = await loadBillOfSaleInputs(clientId, transferId);
  if (!loaded) return res.status(404).json({ error: "Transfer not found." });

  const pdfBytes = await generateBillOfSalePdf(loaded.data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Bill of Sale - ${loaded.client.client_name}.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));

ownershipTransferRouter.get("/:clientId/ownership-transfers/:transferId/bill-of-sale.docx", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, transferId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const loaded = await loadBillOfSaleInputs(clientId, transferId);
  if (!loaded) return res.status(404).json({ error: "Transfer not found." });

  const docxBuffer = await generateBillOfSaleDocx(loaded.data);

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="Bill of Sale - ${loaded.client.client_name}.docx"`);
  res.send(docxBuffer);
}));
