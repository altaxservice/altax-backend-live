import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import {
  generatePoaForm, F2848_DESIGNATIONS, MD548_DESIGNATIONS,
  type PoaFilingData, type PoaRepresentative, type PoaTaxMatter,
} from "./poaForms.service";

/**
 * Tools → IRS/MD authorization filings (Form 2848, Form 8821, Maryland
 * Form 548) — fills the agency's own real fillable PDF, never a firm-drawn
 * substitute (see poaForms.service.ts for how every field was verified).
 *
 * Physical signature only, same reasoning as the general Authorization to
 * Act/Release of Information (v3_client_contracts, service_key='poa_release'):
 * an e-signature is only valid on 2848/8821 if the form is then submitted
 * through the IRS's own online portal, and Maryland has no e-file path for
 * Form 548 at all. There is deliberately no "send for electronic signature"
 * route here — only generate, preview/download, record a physical
 * signature, and record how the firm actually sent it (mail/fax/portal/
 * in-person), since this app cannot submit directly to either agency.
 */
export const poaFormsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const FORM_TYPES = ["2848", "8821", "548"];
const FORM_LABELS: Record<string, string> = {
  "2848": "IRS Form 2848 — Power of Attorney and Declaration of Representative",
  "8821": "IRS Form 8821 — Tax Information Authorization",
  "548": "Maryland Form 548 — Power of Attorney",
};

/** Which service selections make which form relevant — mirrors the reasoning in contractContent.ts's POA_COVERED_SERVICE_KEYS, just for a different document family. */
const SUGGESTED_FORMS_FOR_SERVICE: Record<string, string[]> = {
  personal_tax_prep: ["8821", "2848"],
  business_tax_prep: ["8821", "2848"],
  tax_prep: ["8821", "2848"],
  sales_tax: ["548"],
};

poaFormsRouter.get("/meta", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({
    formTypes: FORM_TYPES.map((t) => ({ value: t, label: FORM_LABELS[t] })),
    designations: { "2848": F2848_DESIGNATIONS, "548": MD548_DESIGNATIONS, "8821": [] },
    suggestedFormsForService: SUGGESTED_FORMS_FOR_SERVICE,
  });
}));

/** Representative picker — admin/staff with their own PTIN/CAF (see /auth/preparer-info), so a filing never has to be typed from scratch. */
poaFormsRouter.get("/representatives", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT user_id, name, email, phone, ptin, caf_number FROM altax.v3_users
      WHERE lower(role) IN ('admin','staff') AND active = TRUE ORDER BY name ASC`
  );
  res.json({ representatives: rows });
}));

async function loadClientTaxpayerData(clientId: string) {
  return queryOne<any>(
    `SELECT client_id, client_name, phone, street_address, city, state, zip_code,
            individual_ssn, ein, company_contact_ssn, company_contact_name, client_type
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  );
}

function buildTaxpayerSnapshot(client: any) {
  const address = [client.street_address, [client.city, client.state, client.zip_code].filter(Boolean).join(", ")]
    .filter(Boolean).join(", ");
  return {
    name: client.client_name,
    address,
    ssn: client.individual_ssn || "",
    ein: client.ein || "",
    itin: "",
    phone: client.phone || "",
    spouseName: "",
    spouseSsn: "",
  };
}

function toFilingData(taxpayer: any, representatives: PoaRepresentative[], taxMatters: PoaTaxMatter[], retainPrior: boolean, notes: string | null): PoaFilingData {
  return {
    taxpayerName: taxpayer.name, taxpayerAddress: taxpayer.address,
    taxpayerSsn: taxpayer.ssn, taxpayerEin: taxpayer.ein, taxpayerItin: taxpayer.itin,
    taxpayerPhone: taxpayer.phone, spouseName: taxpayer.spouseName, spouseSsn: taxpayer.spouseSsn,
    representatives, taxMatters, retainPrior, notes: notes || undefined,
  };
}

poaFormsRouter.get("/client/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(
    `SELECT filing_id, client_id, form_type, representatives, tax_matters, status,
            signed_at, signer_name, signer_title, submitted_via, submitted_at, submitted_note, created_at
       FROM altax.v3_poa_filings WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  res.json({ filings: rows });
}));

poaFormsRouter.post("/client/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const formType = String(body.formType || "").trim();
  if (!FORM_TYPES.includes(formType)) return res.status(400).json({ error: "Choose a form to generate." });

  const representatives: PoaRepresentative[] = Array.isArray(body.representatives) ? body.representatives : [];
  if (!representatives.length) return res.status(400).json({ error: "Add at least one representative." });
  const maxReps = formType === "548" || formType === "8821" ? 2 : 4;
  if (representatives.length > maxReps) return res.status(400).json({ error: `${FORM_LABELS[formType]} supports at most ${maxReps} representatives.` });

  const taxMatters: PoaTaxMatter[] = (Array.isArray(body.taxMatters) ? body.taxMatters : []).filter((m: any) => m?.description);
  if (!taxMatters.length) return res.status(400).json({ error: "Add at least one tax matter (type of tax)." });

  const client = await loadClientTaxpayerData(clientId);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const taxpayerSnapshot = buildTaxpayerSnapshot(client);
  const filingId = `POA-${idSuffix()}`;

  await query(
    `INSERT INTO altax.v3_poa_filings
       (filing_id, client_id, form_type, taxpayer_snapshot, representatives, tax_matters, retain_prior, notes, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9)`,
    [
      filingId, clientId, formType, JSON.stringify(taxpayerSnapshot),
      JSON.stringify(representatives), JSON.stringify(taxMatters),
      Boolean(body.retainPrior), String(body.notes || "").trim() || null,
      req.user!.email,
    ]
  );
  await logAudit("Tools", "CREATE_POA_FILING", filingId, "form_type", "", formType,
    `${FORM_LABELS[formType]} drafted for ${client.client_name} by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, filingId });
}));

async function loadFiling(req: AuthedRequest, filingId: string) {
  const filing = await queryOne<any>(`SELECT * FROM altax.v3_poa_filings WHERE filing_id = $1`, [filingId]);
  if (!filing) return null;
  if (!(await canAccessClient(req.user!, filing.client_id))) return "forbidden";
  return filing;
}

poaFormsRouter.get("/:filingId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  res.json({ filing });
}));

poaFormsRouter.get("/:filingId/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });

  const data = toFilingData(filing.taxpayer_snapshot, filing.representatives, filing.tax_matters, filing.retain_prior, filing.notes);
  const bytes = await generatePoaForm(filing.form_type, data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/** Records a physical/wet-ink signature — same shape as contracts' sign-in-person (signer name/title, staff who witnessed it, no IP/device trail since there isn't one for paper). */
poaFormsRouter.post("/:filingId/sign", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") return res.status(400).json({ error: `This filing is already ${filing.status}.` });

  const signerName = String(req.body?.signerName || "").trim();
  if (!signerName) return res.status(400).json({ error: "The signer's full legal name is required." });
  const signerTitle = String(req.body?.signerTitle || "").trim() || null;

  await query(
    `UPDATE altax.v3_poa_filings SET status='Signed', signed_at=now(), signer_name=$2, signer_title=$3, recorded_by=$4, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, signerName, signerTitle, req.user!.email]
  );
  await logAudit("Tools", "SIGN_POA_FILING", filing.filing_id, "status", "Draft", "Signed",
    `Recorded as signed in person by "${signerName}", logged by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** The firm's own record of the manual step this app can't automate — mailing, faxing, hand-delivering, or (2848/8821 only) uploading through the IRS's own online portal. */
poaFormsRouter.post("/:filingId/submit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Signed") return res.status(400).json({ error: "Record the signature before marking this submitted." });

  const via = String(req.body?.submittedVia || "").trim();
  if (!via) return res.status(400).json({ error: "Choose how this was sent." });
  const note = String(req.body?.note || "").trim() || null;

  await query(
    `UPDATE altax.v3_poa_filings SET status='Submitted', submitted_via=$2, submitted_at=now(), submitted_note=$3, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, via, note]
  );
  await logAudit("Tools", "SUBMIT_POA_FILING", filing.filing_id, "status", "Signed", "Submitted",
    `Marked submitted via ${via} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

poaFormsRouter.post("/:filingId/void", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });

  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required to void a filing." });

  await query(
    `UPDATE altax.v3_poa_filings SET status='Void', voided_at=now(), voided_reason=$2, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, reason]
  );
  await logAudit("Tools", "VOID_POA_FILING", filing.filing_id, "status", filing.status, "Void",
    `Voided by ${req.user!.email}: ${reason}`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * Hard delete — admin only, and only while still a Draft, same rule as
 * contracts.routes.ts's delete route: once a filing has been physically
 * signed it's a record of a real signature, not a mistake to erase — Void
 * (above) is how that gets retracted.
 */
poaFormsRouter.post("/:filingId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") {
    return res.status(400).json({ error: "Only a Draft filing can be deleted — this one has been signed, so void it instead." });
  }

  await query(`DELETE FROM altax.v3_poa_filings WHERE filing_id = $1`, [filing.filing_id]);
  await logAudit("Tools", "DELETE_POA_FILING", filing.filing_id, "", filing.form_type, "",
    `Draft filing deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
