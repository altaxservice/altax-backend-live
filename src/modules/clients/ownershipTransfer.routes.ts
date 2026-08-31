/**
 * Business Ownership Transfer package — one intake on an EXISTING client's
 * profile (old owner -> new owner, effective date, sale terms), driven by
 * the step-by-step wizard in frontend/src/components/OwnershipTransferSection.tsx,
 * that fans out to the documents a real transfer needs, instead of several
 * disconnected manual steps:
 *   1. Bill of Sale — generated fresh from the stored terms (billOfSale.ts),
 *      not a government form, so it isn't a v3_gov_form_filings row.
 *   2. IRS Form 8822-B (Change of Responsible Party) — inserted directly
 *      into v3_gov_form_filings as a Draft with the buyer as the new
 *      responsible party. Shows up in the client's existing Government
 *      Forms section with zero new UI (same GET /gov-forms/client/:id the
 *      section already calls, same GET /gov-forms/:filingId/pdf download).
 *   3. Maryland Form CRA (Combined Registration Application), reason
 *      "Purchased going business" — same reuse-the-existing-section approach, and
 *      existing-number-aware: a client that already has a CRA registration
 *      number on file gets `registrationAction: "update"` prefilled instead
 *      of silently drafting a brand-new-registration form.
 *   4. MD Articles of Amendment — a REAL generated Draft filing via the
 *      Phase 4 generators (mdAmendLlc.ts / mdAmendCorp.ts), auto-picked from
 *      the client's entity_type (see ENTITY_TYPE_TO_AMENDMENT_KIND below).
 *      Falls back to the old plain reminder Task when entity_type isn't
 *      LLC or corp-like (no MD SDAT amendment form applies).
 *   5. MD Articles of Dissolution (mdDissolution.ts) — only drafted when
 *      the wizard's step-3 "is the old entity being dissolved?" toggle was
 *      on; director/officer data comes entirely from what staff typed on
 *      that step, since there's no client-profile column to source it from.
 *
 * Each output is generated independently and wrapped in its own try/catch:
 * a client missing a street address (say) shouldn't block the Bill of Sale
 * from being created just because CRA's address requirement can't be met
 * yet. The response reports exactly what was created and what wasn't (plus
 * every created filing_id, for the wizard's Step 4 deep links), so staff
 * always know what still needs doing by hand — same disclosure discipline
 * as every other feature in this app.
 */
import { Router, Response } from "express";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole, invalidateActiveCache } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { encryptValue, decryptTolerant } from "../../common/encryption";
import { composeAddress } from "../../common/address";
import { getFirmProfile } from "../../common/firmProfile";
import { generateBillOfSalePdf } from "../govForms/billOfSale";
import { generateBillOfSaleDocx } from "../govForms/billOfSaleDocx";
import {
  generateGovForm, type CraData, type Form8822bData,
  type MdAmendLlcData, type MdAmendCorpData, type MdDissolutionData, type MdDissolutionPerson,
} from "../govForms/govForms.service";
// Reused, not reinvented, for "Apply New Owner to Client Profile" below —
// same invite-token format, invite-link shape, and best-effort send-email
// helper POST /users already uses when it issues a fresh portal invite.
import { newInviteToken, inviteLink, sendInviteEmail } from "../users/users.routes";

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
  Individual: "Sole proprietorship",
  Nonprofit: "Nonprofit organization",
};

/**
 * Which real MD Articles of Amendment generator (Phase 4) applies to a
 * given `v3_clients.entity_type` value, if any. Same vocabulary-mismatch
 * guard as ENTITY_TYPE_TO_CRA_OWNERSHIP above — entity_type's own values
 * (ENTITY_TYPES in frontend/src/utils/clientOptions.ts) never assumed to
 * line up with a form's own option list. Partnership/Sole Proprietorship/
 * Individual (and anything unrecognized) have no matching MD corporate-
 * charter amendment form — those fall back to the old reminder-task
 * behavior rather than guessing wrong.
 */
const ENTITY_TYPE_TO_AMENDMENT_KIND: Record<string, "LLC" | "CORP"> = {
  LLC: "LLC",
  "C-Corp": "CORP",
  "S-Corp": "CORP",
  Nonprofit: "CORP",
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
            gov_form_8822b_filing_id, gov_form_cra_filing_id, md_amendment_task_id,
            gov_form_amendment_filing_id, gov_form_dissolution_filing_id, created_by, created_at,
            applied_to_profile_at, applied_by
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
            payroll_enabled, sales_tax_frequency, assigned_to, secretary_of_state_id, cra_registration_number, phone, email, individual_ssn
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
  if (!client) return res.status(404).json({ error: "Client not found." });
  // cra_registration_number is encrypted at rest (UPDATABLE_FIELDS in
  // clients.routes.ts) — decrypt before using it to decide new-vs-update
  // below, same as every other encrypted client column read outside the
  // masked list/detail responses.
  const clientCraRegistrationNumber = client.cra_registration_number ? decryptTolerant(client.cra_registration_number) : null;
  // ein is encrypted at rest too (same UPDATABLE_FIELDS list) — confirmed live, an
  // undecrypted read here put raw ciphertext straight into the generated Bill of
  // Sale/8822-B/CRA update PDFs, overflowing the EIN field with a base64-looking
  // blob instead of the real 9-digit number.
  const clientEin = client.ein ? decryptTolerant(client.ein) : null;
  // individual_ssn — the filer's own SSN, for a Sole Proprietorship/Individual
  // client that has no EIN. Same UPDATABLE_FIELDS encrypted list.
  const clientIndividualSsn = client.individual_ssn ? decryptTolerant(client.individual_ssn) : null;

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
  // includeAmendment replaces the old includeMdAmendmentTask flag now that a
  // real Amendment PDF can usually be generated instead of just a reminder
  // task — still accepts the old field name too, in case anything upstream
  // hasn't moved to the new wizard yet.
  const includeAmendment = body.includeAmendment !== false && body.includeMdAmendmentTask !== false;
  // Dissolution is only ever attempted when staff explicitly flagged this
  // transfer as the old entity closing (not just amending) on the wizard's
  // step 3 toggle — a missing/false isDissolving means the dissolution
  // block below is skipped entirely, no skippedReasons noise either, since
  // it was never something this transfer was trying to do.
  const isDissolving = body.isDissolving === true;
  const includeDissolution = isDissolving && body.includeDissolution !== false;
  const amendmentInput = body.amendment || {};
  const dissolutionInput = body.dissolution || {};

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

  const created: { billOfSale: boolean; form8822b: boolean; craUpdate: boolean; mdAmendmentTask: boolean; amendment: boolean; dissolution: boolean } = {
    billOfSale: includeBillOfSale, form8822b: false, craUpdate: false, mdAmendmentTask: false, amendment: false, dissolution: false,
  };
  // Every filing_id this create actually generated — reported back so the
  // frontend wizard's Step 4 can deep-link straight into each one's own
  // existing view/sign/submit flow in the Government Forms section, instead
  // of leaving staff to hunt for what just got created.
  const createdFilingIds: string[] = [];
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
        ein: clientEin || undefined,
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
      createdFilingIds.push(filingId8822b);
    } catch (err: any) {
      skippedReasons.push(`Form 8822-B was not generated: ${err?.message || "missing data."}`);
    }
  }

  // CRA "Purchased going business" — an ownership transfer is a sale of an
  // existing operating business to a new owner, which is exactly what this
  // reason represents on the real form; "Change of entity" is a different
  // scenario (e.g. an entity-type conversion) and was wrong here — confirmed
  // live, flagged as a real filing-accuracy bug. Same officer-slot convention
  // this app already uses (one responsible party per client), filled with
  // the buyer.
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
      // No silent fallback to "Limited liability company" for an entity_type
      // this map doesn't cover (e.g. unset) — that's the exact same bug class
      // as the "Change of entity" hardcode above: a guessed value landing on
      // a real government filing instead of reflecting the client's actual
      // situation. Fail into skippedReasons like every other CRA precondition
      // in this block, so staff see it needs a decision instead of getting a
      // silently wrong filing.
      if (client.entity_type && !ENTITY_TYPE_TO_CRA_OWNERSHIP[client.entity_type]) {
        throw new Error(`no CRA ownership-type mapping for entity type "${client.entity_type}"`);
      }
      if (!client.entity_type) throw new Error("client has no entity type on file");
      const ownershipType = ENTITY_TYPE_TO_CRA_OWNERSHIP[client.entity_type];
      const craData: CraData = {
        fein: clientEin || undefined,
        ssn: clientIndividualSsn || undefined,
        datEntityId: client.secretary_of_state_id || undefined,
        preparerName: (await getFirmProfile()).firmName || undefined,
        legalFirstName: client.client_name,
        tradeName: client.dba_name || undefined,
        street1: client.street_address,
        city: client.city,
        state: client.state || "MD",
        zip: client.zip_code,
        // Business-level contact (Section A #4 on the real form) — never wired to
        // anything before, even though the client profile already has both.
        phone: client.phone || undefined,
        email: client.email || undefined,
        reason: "Purchased going business",
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
        // Existing-number-aware, same as the Phase 1 fix to
        // GenerateGovFormModal.tsx's own CRA prefill: a CRA number already
        // on the client profile means Maryland already assigned one, so
        // this auto-draft defaults to "update" instead of silently filing
        // as a brand-new registration.
        existingCraNumber: clientCraRegistrationNumber || undefined,
        registrationAction: clientCraRegistrationNumber ? "update" : "new",
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
      createdFilingIds.push(filingIdCra);
    } catch (err: any) {
      skippedReasons.push(`Maryland CRA update was not generated: ${err?.message || "missing data."}`);
    }
  }

  // MD Articles of Amendment — a real generated Draft filing (Phase 4) for
  // clients whose entity_type is LLC or corp-like; a plain reminder task
  // (the pre-Phase-4 behavior) for anything else, since no MD SDAT
  // amendment generator applies to a Partnership/Sole Proprietorship/etc.
  if (!includeAmendment) {
    skippedReasons.push("MD Articles of Amendment was not requested.");
  } else {
    const amendmentKind = client.entity_type ? ENTITY_TYPE_TO_AMENDMENT_KIND[client.entity_type] : undefined;
    if (amendmentKind === "LLC") {
      try {
        const amendmentText = String(amendmentInput.amendmentText || "").trim();
        if (!amendmentText) throw new Error("amendment text is required");
        const mdAmendLlcData: MdAmendLlcData = {
          llcName: client.client_name,
          amendmentText,
          newResidentAgentName: String(amendmentInput.newResidentAgentName || "").trim() || undefined,
        };
        await generateGovForm("MD_AMEND_LLC", mdAmendLlcData);
        const filingIdAmendment = `GOV-${idSuffix()}`;
        await query(
          `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
           VALUES ($1,$2,'MD_AMEND_LLC',$3,'Draft',$4)`,
          [filingIdAmendment, clientId, await encryptFormDataForStorage(mdAmendLlcData), req.user!.email]
        );
        await query(`UPDATE altax.v3_ownership_transfers SET gov_form_amendment_filing_id = $1 WHERE transfer_id = $2`, [filingIdAmendment, transferId]);
        created.amendment = true;
        createdFilingIds.push(filingIdAmendment);
      } catch (err: any) {
        skippedReasons.push(`MD Articles of Amendment (LLC) was not generated: ${err?.message || "missing data."}`);
      }
    } else if (amendmentKind === "CORP") {
      try {
        const amendmentText = String(amendmentInput.amendmentText || "").trim();
        const approvalMethod = String(amendmentInput.approvalMethod || "").trim();
        if (!amendmentText) throw new Error("amendment text is required");
        if (!approvalMethod) throw new Error("approval method (how this amendment was approved) is required");
        const corpTypeBefore = (String(amendmentInput.corpTypeBefore || "").trim() ||
          (client.entity_type === "Nonprofit" ? "Nonstock" : "Stock")) as MdAmendCorpData["corpTypeBefore"];
        const mdAmendCorpData: MdAmendCorpData = {
          corpTypeBefore,
          corpName: client.client_name,
          amendmentText,
          approvalMethod: approvalMethod as MdAmendCorpData["approvalMethod"],
          attestedByName: String(amendmentInput.attestedByName || "").trim() || undefined,
          attestedByTitle: String(amendmentInput.attestedByTitle || "").trim() || undefined,
          signedByName: String(amendmentInput.signedByName || "").trim() || undefined,
          signedByTitle: String(amendmentInput.signedByTitle || "").trim() || undefined,
          returnAddressLine1: String(amendmentInput.returnAddressLine1 || "").trim() || undefined,
          returnAddressLine2: String(amendmentInput.returnAddressLine2 || "").trim() || undefined,
          returnAddressLine3: String(amendmentInput.returnAddressLine3 || "").trim() || undefined,
        };
        await generateGovForm("MD_AMEND_CORP", mdAmendCorpData);
        const filingIdAmendment = `GOV-${idSuffix()}`;
        await query(
          `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
           VALUES ($1,$2,'MD_AMEND_CORP',$3,'Draft',$4)`,
          [filingIdAmendment, clientId, await encryptFormDataForStorage(mdAmendCorpData), req.user!.email]
        );
        await query(`UPDATE altax.v3_ownership_transfers SET gov_form_amendment_filing_id = $1 WHERE transfer_id = $2`, [filingIdAmendment, transferId]);
        created.amendment = true;
        createdFilingIds.push(filingIdAmendment);
      } catch (err: any) {
        skippedReasons.push(`MD Articles of Amendment (Corporation) was not generated: ${err?.message || "missing data."}`);
      }
    } else {
      // Fallback — pre-Phase-4 behavior. No MD SDAT amendment generator
      // covers this client's entity_type (Partnership, Sole Proprietorship,
      // Individual, or unset), so a task keeps the requirement tracked
      // instead of silently dropping it.
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
              `. File Maryland Articles of Amendment reflecting the new principal/resident agent as needed — no MD SDAT Amendment generator applies to this client's entity type ("${client.entity_type || "not set"}"), so this is tracked as a manual task instead (see transfer ${transferId}).`,
            transferId,
          ]
        );
        await query(`UPDATE altax.v3_ownership_transfers SET md_amendment_task_id = $1 WHERE transfer_id = $2`, [taskId, transferId]);
        created.mdAmendmentTask = true;
        skippedReasons.push(`MD Articles of Amendment isn't auto-generated for entity type "${client.entity_type || "not set"}" — a reminder task was created instead.`);
      } catch (err: any) {
        skippedReasons.push(`MD Amendment task was not created: ${err?.message || "unknown error."}`);
      }
    }
  }

  // MD Articles of Dissolution — only attempted when the wizard's step-3
  // "is the old entity being dissolved?" toggle was on. Director/officer
  // data comes entirely from what staff typed on that same step (there's no
  // client-profile column to prefill a director list from), except sdatId/
  // principalOfficeAddress which the wizard itself already prefills from the
  // client's own secretary_of_state_id / address before it ever reaches here.
  if (isDissolving && includeDissolution) {
    try {
      const principalOfficeAddress = String(dissolutionInput.principalOfficeAddress || "").trim();
      const residentAgentName = String(dissolutionInput.residentAgentName || "").trim();
      const residentAgentAddress = String(dissolutionInput.residentAgentAddress || "").trim();
      if (!principalOfficeAddress) throw new Error("principal office address is required");
      if (!residentAgentName || !residentAgentAddress) throw new Error("resident agent name and address are required");
      const directors: MdDissolutionPerson[] = Array.isArray(dissolutionInput.directors)
        ? dissolutionInput.directors
          .map((d: any) => ({ name: String(d?.name || "").trim(), address: String(d?.address || "").trim() }))
          .filter((d: MdDissolutionPerson) => d.name)
        : [];
      if (!directors.length) throw new Error("add at least one director or trustee");
      const approvalManner = String(dissolutionInput.approvalManner || "").trim();
      if (!approvalManner) throw new Error("manner of approval (SEVENTH) is required");
      const creditorNotice = dissolutionInput.creditorNotice === "Mailed to known creditors" ? "Mailed to known creditors" : "No known creditors";
      const effectiveDate = dissolutionInput.effectiveDate === "immediate" || !dissolutionInput.effectiveDate
        ? "immediate"
        : String(dissolutionInput.effectiveDate).trim();

      const officersInput = dissolutionInput.officers || {};
      const officers: MdDissolutionData["officers"] = {};
      (["president", "treasurer", "secretary", "other"] as const).forEach((role) => {
        const person = officersInput[role];
        if (person && String(person.name || "").trim()) {
          officers[role] = { name: String(person.name).trim(), address: String(person.address || "").trim() };
        }
      });

      const mdDissolutionData: MdDissolutionData = {
        corpName: client.client_name,
        sdatId: String(dissolutionInput.sdatId || "").trim() || undefined,
        principalOfficeAddress, residentAgentName, residentAgentAddress,
        directors, officers,
        approvalManner: approvalManner as MdDissolutionData["approvalManner"],
        otherMannerText: String(dissolutionInput.otherMannerText || "").trim() || undefined,
        creditorNotice,
        creditorNoticeMailedDate: creditorNotice === "Mailed to known creditors" ? String(dissolutionInput.creditorNoticeMailedDate || "").trim() || undefined : undefined,
        effectiveDate,
        additionalProvisions: String(dissolutionInput.additionalProvisions || "").trim() || undefined,
        attestedByName: String(dissolutionInput.attestedByName || "").trim() || undefined,
        attestedByTitle: String(dissolutionInput.attestedByTitle || "").trim() || undefined,
        signedByName: String(dissolutionInput.signedByName || "").trim() || undefined,
        signedByTitle: String(dissolutionInput.signedByTitle || "").trim() || undefined,
        residentAgentConsentSignerName: String(dissolutionInput.residentAgentConsentSignerName || "").trim() || undefined,
      };
      await generateGovForm("MD_DISSOLUTION", mdDissolutionData);
      const filingIdDissolution = `GOV-${idSuffix()}`;
      await query(
        `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
         VALUES ($1,$2,'MD_DISSOLUTION',$3,'Draft',$4)`,
        [filingIdDissolution, clientId, await encryptFormDataForStorage(mdDissolutionData), req.user!.email]
      );
      await query(`UPDATE altax.v3_ownership_transfers SET gov_form_dissolution_filing_id = $1 WHERE transfer_id = $2`, [filingIdDissolution, transferId]);
      created.dissolution = true;
      createdFilingIds.push(filingIdDissolution);

      // Closes the same "capture missing data while you're in the process"
      // loop as the CRA number save action in GovFormsSection — a SDAT ID
      // typed in on the wizard's step 3, when the client profile doesn't
      // have one yet, is worth keeping for next time.
      if (dissolutionInput.saveSdatIdToProfile && mdDissolutionData.sdatId && !client.secretary_of_state_id) {
        await query(`UPDATE altax.v3_clients SET secretary_of_state_id = $1 WHERE client_id = $2`, [mdDissolutionData.sdatId, clientId]);
      }
    } catch (err: any) {
      skippedReasons.push(`MD Articles of Dissolution was not generated: ${err?.message || "missing data."}`);
    }
  }

  await logAudit("Clients", "OWNERSHIP_TRANSFER_CREATED", transferId, "buyer_name", "", buyerName,
    `Ownership transfer package started for ${client.client_name}: ${sellerName} -> ${buyerName}, by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, transferId, created, skippedReasons, createdFilingIds });
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

  const existing = await queryOne<any>(`SELECT transfer_id, applied_to_profile_at, buyer_ssn FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`, [transferId, clientId]);
  if (!existing) return res.status(404).json({ error: "Transfer not found." });
  // Hard Audit finding, 2026-08-27: nothing stopped editing seller/buyer/
  // sale-term fields after apply-new-owner had already reassigned the
  // client profile and portal login using the PRE-edit values — the
  // transfer record could silently diverge from what was actually applied
  // and what the buyer's invite email said, with no re-sync or flag.
  if (existing.applied_to_profile_at) {
    return res.status(400).json({ error: "This transfer has already been applied to the client profile and can no longer be edited." });
  }

  const body = req.body || {};
  const sellerName = String(body.sellerName || "").trim();
  const buyerName = String(body.buyerName || "").trim();
  if (!sellerName) return res.status(400).json({ error: "Seller name is required." });
  if (!buyerName) return res.status(400).json({ error: "Buyer name is required." });

  const buyerSsnRaw = String(body.buyerSsn || "").trim();
  // The Edit form never pre-fills this field with the real SSN (typing-only,
  // by design — see OwnershipTransferSection.tsx) — a blank submission means
  // "leave the SSN on file unchanged," not "clear it." Also guard against a
  // masked placeholder ("•••-••-1234", still shown to non-admin staff on the
  // transfer list) ever getting encrypted and stored as if it were the real
  // value — that would silently corrupt the stored SSN with an unusable
  // placeholder string.
  const buyerSsnIsMasked = buyerSsnRaw.includes("•");
  const buyerSsnToStore = buyerSsnRaw && !buyerSsnIsMasked ? encryptValue(buyerSsnRaw) : existing.buyer_ssn;

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
      buyerSsnToStore,
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
  // Hard Audit finding, 2026-08-27: hard-delete never checked whether this
  // transfer had already been applied — an admin could permanently destroy
  // the seller/buyer/sale-price/asset-allocation record for a COMPLETED,
  // irreversible ownership change after the client profile and portal
  // login had already been switched to the new owner, wiping the legal
  // source-of-truth for a real business sale.
  if (transfer.applied_to_profile_at) {
    return res.status(400).json({ error: "This transfer has already been applied to the client profile and can no longer be deleted." });
  }

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
  if (transfer.gov_form_amendment_filing_id) {
    const f = await queryOne<any>(`SELECT status FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_amendment_filing_id]);
    if (f && f.status === "Draft") await query(`DELETE FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_amendment_filing_id]);
    else if (f) left.push(`The MD Articles of Amendment is already ${f.status} — left in place.`);
  }
  if (transfer.gov_form_dissolution_filing_id) {
    const f = await queryOne<any>(`SELECT status FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_dissolution_filing_id]);
    if (f && f.status === "Draft") await query(`DELETE FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [transfer.gov_form_dissolution_filing_id]);
    else if (f) left.push(`The MD Articles of Dissolution is already ${f.status} — left in place.`);
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
      // ein is encrypted at rest — undecrypted here put raw ciphertext into the
      // generated Bill of Sale PDF, overflowing the field with a base64-looking
      // blob instead of the real EIN. Same fix as the create-transfer route above.
      ein: client.ein ? decryptTolerant(client.ein) : null,
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

/**
 * "Apply New Owner to Client Profile" — the step that finally makes an
 * Ownership Transfer touch the client's own record and portal login, which
 * nothing before this route ever did (Generate & Review only creates the
 * 8822-B/CRA/Amendment/Dissolution/Bill of Sale documents themselves).
 * Admin-only, same gate this app already uses for other destructive/
 * security-sensitive actions (Void, hard-delete, etc.).
 *
 * Gate — enforced here too, never trusted from the frontend's disabled
 * button alone: every NON-NULL linked filing id (8822-B/CRA/Amendment/
 * Dissolution) must point to a v3_gov_form_filings row with
 * status = 'Submitted'. Bill of Sale has no sign/submit workflow, so it's
 * never part of the gate. md_amendment_task_id (the pre-Phase-4 plain-task
 * fallback used when a client's entity_type has no real MD SDAT Amendment
 * generator) isn't gov-form-backed, so a transfer that only produced that
 * task is never blocked on it — the response instead calls this out via
 * `amendmentWasTaskOnly` so the confirm dialog can say so.
 *
 * What it does, in one DB transaction (see withTransaction in config/db.ts):
 *  1. Copies the transfer's buyer_* fields onto v3_clients' own Responsible
 *     Party fields (company_contact_name/title/email/phone/address parts).
 *     company_contact_ssn is deliberately left untouched — buyer_ssn is
 *     already separately-encrypted PII on the transfer row, and copying it
 *     into a different encrypted column without being sure that's wanted is
 *     exactly the kind of guess-wrong-on-sensitive-data mistake worth
 *     avoiding; staff can copy it by hand into the Owner SS No. field if
 *     that's actually intended for a given transfer.
 *  2. Old owner's portal login (this app's canonical one-row-per-client
 *     scheme, looked up the same way the rest of this app queries it —
 *     assigned_client_id + role — rather than assuming a raw
 *     user_id = 'usr_'||clientId string match, since role is stored
 *     inconsistently-cased and a client's row could in principle have been
 *     created before that convention existed): password_hash/password_salt/
 *     totp_secret/totp_enabled/totp_backup_codes/login_otp_hash/expires/attempts/
 *     failed_login_count/locked_until are all cleared, closing the "old
 *     password still authenticates against a relabeled account" gap — not
 *     just flipping active off and on.
 *  3. That same row (or a brand-new one, if this client never had a portal
 *     login) is reprovisioned for the new owner: email/name from buyer_*,
 *     active = true, a fresh 7-day invite_token/invite_expires,
 *     must_reset_password = true, and a real invite email sent via the same
 *     sendInviteEmail()/inviteLink() helpers POST /users already uses.
 */
ownershipTransferRouter.post("/:clientId/ownership-transfers/:transferId/apply-new-owner", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, transferId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const transfer = await queryOne<any>(`SELECT * FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`, [transferId, clientId]);
  if (!transfer) return res.status(404).json({ error: "Transfer not found." });
  if (transfer.applied_to_profile_at) {
    return res.status(400).json({
      error: `This transfer's new owner was already applied to the client profile on ${new Date(transfer.applied_to_profile_at).toLocaleString()} by ${transfer.applied_by || "an admin"}.`,
    });
  }
  if (!String(transfer.buyer_name || "").trim()) return res.status(400).json({ error: "This transfer has no buyer name on file." });

  // Gate — every non-null linked filing must be Submitted.
  const linkedFilings: { label: string; id: string | null }[] = [
    { label: "Form 8822-B", id: transfer.gov_form_8822b_filing_id },
    { label: "Maryland CRA", id: transfer.gov_form_cra_filing_id },
    { label: "MD Articles of Amendment", id: transfer.gov_form_amendment_filing_id },
    { label: "MD Articles of Dissolution", id: transfer.gov_form_dissolution_filing_id },
  ];
  const notReady: string[] = [];
  for (const f of linkedFilings) {
    if (!f.id) continue;
    const filing = await queryOne<{ status: string }>(`SELECT status FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [f.id]);
    if (!filing) notReady.push(`${f.label} filing is missing.`);
    else if (filing.status !== "Submitted") notReady.push(`${f.label} is still "${filing.status}", not Submitted.`);
  }
  if (notReady.length) {
    return res.status(400).json({ error: `Every generated filing must be Submitted before applying the new owner: ${notReady.join(" ")}` });
  }
  // Hard Audit finding, 2026-08-27, product decision: the gate above only
  // checks filings that were actually linked to this transfer — every
  // filing type is individually declinable on the wizard, so an admin who
  // declined all of them (or a transfer created before this app tracked
  // filings at all) can finalize with literally nothing filed with any
  // agency. A hard block would be wrong: a legitimate case is syncing this
  // app's client record to a sale that was already handled — filed
  // elsewhere, or by a prior accountant — with nothing left for this app
  // to file. What was missing was any signal that this is what's
  // happening, so it can't be finalized BY ACCIDENT. Require an explicit,
  // named acknowledgment specifically for the zero-filings case; any
  // transfer with at least one real linked filing needs no extra step.
  const hasAnyLinkedFiling = linkedFilings.some((f) => f.id);
  if (!hasAnyLinkedFiling && req.body?.acknowledgeNoFilings !== true) {
    return res.status(400).json({
      error: "This transfer has no government filings attached (8822-B, MD CRA, Amendment, or Dissolution). Confirm this ownership change was already filed elsewhere, or doesn't require any of these filings, before applying it to the client profile.",
      requiresAcknowledgeNoFilings: true,
    });
  }
  const amendmentWasTaskOnly = !transfer.gov_form_amendment_filing_id && !!transfer.md_amendment_task_id;

  const buyerEmail = String(transfer.buyer_email || "").trim() || null;
  const composedAddress = composeAddress({
    street: transfer.buyer_street_address, city: transfer.buyer_city, state: transfer.buyer_state, zip: transfer.buyer_zip_code,
  });

  const result = await withTransaction(async (db) => {
    // Hard Audit finding, 2026-08-27: the applied_to_profile_at check above
    // runs before this transaction even opens, so two concurrent calls
    // (double-click, a retried request) could both pass it before either
    // had written anything — both then ran the full reprovisioning flow,
    // generating two invite tokens and sending two invite emails, with
    // invite_token silently overwritten by whichever transaction committed
    // last (silently invalidating the first email's link) and the audit
    // log/portal reprovisioning both running twice. The lock + a fresh
    // re-check, both inside this one transaction, is what actually closes
    // the window — the outer check above is just a cheap early-reject for
    // the common case, not the real guard.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [transferId]);
    const recheck = await db.queryOne<any>(
      `SELECT applied_to_profile_at, applied_by FROM altax.v3_ownership_transfers WHERE transfer_id = $1 AND client_id = $2`,
      [transferId, clientId]
    );
    if (recheck?.applied_to_profile_at) {
      return { alreadyApplied: true, appliedAt: recheck.applied_to_profile_at, appliedBy: recheck.applied_by } as const;
    }

    await db.query(
      `UPDATE altax.v3_clients SET
         company_contact_name = $2, company_contact_title = $3, company_contact_email = $4, company_contact_phone = $5,
         company_contact_street_address = $6, company_contact_city = $7, company_contact_state = $8, company_contact_zip_code = $9,
         company_contact_address = $10, updated_at = now()
       WHERE client_id = $1`,
      [
        clientId, transfer.buyer_name, transfer.buyer_title, buyerEmail, transfer.buyer_phone,
        transfer.buyer_street_address, transfer.buyer_city, transfer.buyer_state, transfer.buyer_zip_code, composedAddress,
      ]
    );

    // Same lookup this app already uses elsewhere for "this client's portal
    // login row" (e.g. the Archive Client handler in clients.routes.ts) —
    // assigned_client_id + role, not an assumed usr_<clientId> id string,
    // since v3_users.role is stored inconsistently cased ("Client"/"client").
    const existingUser = await db.queryOne<any>(
      `SELECT * FROM altax.v3_users WHERE assigned_client_id = $1 AND lower(role) = 'client'`,
      [clientId]
    );

    const token = newInviteToken();
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    let portalUserId: string;
    let portalAction: "reprovisioned" | "created";

    if (existingUser) {
      portalUserId = existingUser.user_id;
      portalAction = "reprovisioned";
      // Hard Audit finding, 2026-08-27: this reused the SELLER's own
      // user_id for the buyer's reprovisioned login — clearing the password/
      // TOTP made the seller unable to log back IN, but any session token
      // they already held kept working against this same clientId, since
      // requireAuth never re-checked a token's baked-in claims against the
      // database. token_version = token_version + 1 kills every outstanding
      // token for this user_id immediately (see requireAuth.ts).
      await db.query(
        `UPDATE altax.v3_users SET
           email = $2, name = $3, active = true,
           password_hash = NULL, password_salt = NULL, password_hash_version = NULL,
           totp_secret = NULL, totp_enabled = false, totp_backup_codes = '[]'::jsonb,
           login_otp_hash = NULL, login_otp_expires = NULL, login_otp_attempts = 0,
           failed_login_count = 0, locked_until = NULL, last_password_change_at = NULL,
           invite_token = $4, invite_expires = $5, must_reset_password = true,
           token_version = token_version + 1, updated_at = now()
         WHERE user_id = $1`,
        [portalUserId, buyerEmail, transfer.buyer_name, token, expires]
      );
    } else {
      // No portal login exists yet for this client — provisioned fresh, same
      // deterministic usr_<clientId> id / shape POST /users would create.
      portalUserId = `usr_${clientId}`;
      portalAction = "created";
      await db.query(
        `INSERT INTO altax.v3_users
           (user_id, email, name, role, assigned_client_id, reminder_preference, active,
            invite_token, invite_expires, must_reset_password, source_system, source_record_id)
         VALUES ($1,$2,$3,'client',$4,'Email',true,$5,$6,true,'Node Web App',$7)`,
        [portalUserId, buyerEmail, transfer.buyer_name, clientId, token, expires, transferId]
      );
    }

    await db.query(
      `UPDATE altax.v3_ownership_transfers SET applied_to_profile_at = now(), applied_by = $2 WHERE transfer_id = $1 AND applied_to_profile_at IS NULL`,
      [transferId, req.user!.email]
    );

    return { alreadyApplied: false, portalUserId, portalAction, token } as const;
  });

  if (result.alreadyApplied) {
    return res.status(400).json({
      error: `This transfer's new owner was already applied to the client profile on ${new Date(result.appliedAt).toLocaleString()} by ${result.appliedBy || "an admin"}.`,
    });
  }

  // Cache is only ever a few minutes stale, but there's no reason to make the
  // new owner wait for it to expire — same call the deactivate route already
  // makes to make an active-flag change take effect on the very next request.
  invalidateActiveCache(result.portalUserId);

  let inviteEmailed = false;
  let inviteEmailError: string | undefined;
  let issuedLink: string | undefined;
  if (buyerEmail) {
    issuedLink = inviteLink(req, "client", result.token, buyerEmail);
    const sendResult = await sendInviteEmail(buyerEmail, transfer.buyer_name, issuedLink);
    inviteEmailed = sendResult.sent;
    inviteEmailError = sendResult.error;
  }

  await logAudit(
    "Clients", "OWNERSHIP_TRANSFER_APPLIED_TO_PROFILE", transferId, "buyer_name", "", transfer.buyer_name,
    `Applied new owner ${transfer.buyer_name} to client profile for ${clientId}; portal access transferred ` +
      `(${result.portalAction} portal login ${result.portalUserId}) by ${req.user!.email}.` +
      (amendmentWasTaskOnly ? " Note: MD Amendment on this transfer was only tracked as a reminder task, not a filed form." : "") +
      (!hasAnyLinkedFiling ? " Note: applied with no government filings attached — admin acknowledged this was intentional." : ""),
    req.user!.email
  );

  res.json({
    ok: true,
    transferId,
    portalUserId: result.portalUserId,
    portalAction: result.portalAction,
    inviteEmailed,
    inviteEmailError,
    inviteLink: issuedLink,
    amendmentWasTaskOnly,
  });
}));
