import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptTolerant } from "../../common/accountingHelpers";
import { decryptClientPii } from "../../common/encryption";
import {
  generateGovForm, CLIENT_GOV_FORM_TYPES, EMPLOYEE_GOV_FORM_TYPES,
  FORM2553_TAX_YEAR_TYPES, W9_TAX_CLASSIFICATIONS, W4_FILING_STATUSES,
  SS4_ENTITY_TYPES, SS4_REASONS, SS4_ACTIVITIES,
  CRA_REASONS, CRA_TAX_TYPES, CRA_OWNERSHIP_TYPES,
} from "./govForms.service";

/**
 * Tools → government forms: Form SS-4 (EIN application), Form 2553 (S-Corp
 * election), Form W-9 (TIN request), Form 8332 (release of dependency
 * exemption), Form W-4 (employee withholding certificate), and Maryland
 * Form CRA (Combined Registration Application) — fills the agency's own
 * real fillable PDF, never a firm-drawn substitute (see the individual
 * generator files under this module for how every field was verified).
 *
 * SS4/2553/W9/8332/CRA are client-level (v3_gov_form_filings.client_id); W4
 * is employee-level (v3_gov_form_filings.employee_id) since a withholding
 * election belongs to one employee at one employer, not to the client
 * business itself. Both share the same filing lifecycle (Draft → Signed →
 * Submitted, or Void) and the same physical-signature-only rule as the POA
 * forms — none of these are ever e-signed inside this app.
 */
export const govFormsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const FORM_LABELS: Record<string, string> = {
  SS4: "IRS Form SS-4 — Application for Employer Identification Number",
  "2553": "IRS Form 2553 — Election by a Small Business Corporation",
  W9: "IRS Form W-9 — Request for Taxpayer Identification Number",
  "8332": "IRS Form 8332 — Release of Claim to Exemption for Child",
  W4: "IRS Form W-4 — Employee's Withholding Certificate",
  CRA: "Maryland Form CRA — Combined Registration Application",
};

govFormsRouter.get("/meta", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({
    clientFormTypes: CLIENT_GOV_FORM_TYPES.map((t) => ({ value: t, label: FORM_LABELS[t] })),
    employeeFormTypes: EMPLOYEE_GOV_FORM_TYPES.map((t) => ({ value: t, label: FORM_LABELS[t] })),
    form2553TaxYearTypes: FORM2553_TAX_YEAR_TYPES,
    w9TaxClassifications: W9_TAX_CLASSIFICATIONS,
    w4FilingStatuses: W4_FILING_STATUSES,
    ss4EntityTypes: SS4_ENTITY_TYPES,
    ss4Reasons: SS4_REASONS,
    ss4Activities: SS4_ACTIVITIES,
    craReasons: CRA_REASONS,
    craTaxTypes: CRA_TAX_TYPES,
    craOwnershipTypes: CRA_OWNERSHIP_TYPES,
  });
}));

/**
 * Unmasked identity fields for pre-filling a new filing's form — the client
 * list/detail API masks SSN/EIN for on-screen display (see clients.routes.ts's
 * maskTail), but a real filled-out government form needs the real number, so
 * this decrypts (individual_ssn/ein/company_contact_ssn/state_tax_id are now
 * encrypted at rest, same reasoning poaForms.routes.ts's loadClientTaxpayerData
 * already established for that module). Whatever the user submits when
 * creating the filing is a snapshot in form_data from then on — a later
 * change to the client record never rewrites an already-generated filing.
 */
govFormsRouter.get("/client/:clientId/identity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = decryptClientPii(await queryOne<any>(
    `SELECT client_id, client_name, entity_type, ein, individual_ssn, street_address, city, state, zip_code,
            company_contact_name, company_contact_title, company_contact_ssn, company_contact_email, company_contact_phone,
            secretary_of_state_id, phone, email
       FROM altax.v3_clients WHERE client_id = $1`,
    [clientId]
  ));
  if (!client) return res.status(404).json({ error: "Client not found." });
  res.json({ client });
}));

govFormsRouter.get("/employee/:employeeId/identity", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) return res.status(403).json({ error: "You do not have access to this employee." });
  const client = decryptClientPii(await queryOne<any>(`SELECT client_name, ein, street_address, city, state, zip_code FROM altax.v3_clients WHERE client_id = $1`, [employee.client_id]));
  res.json({
    employee: {
      employee_id: employee.employee_id,
      employee_name: employee.employee_name,
      ssn: employee.ssn ? decryptTolerant(employee.ssn) : null,
      street_address: employee.street_address, city: employee.city, state: employee.state, zip_code: employee.zip_code,
      federal_filing_status: employee.federal_filing_status,
    },
    employer: client ? { client_name: client.client_name, ein: client.ein, street_address: client.street_address, city: client.city, state: client.state, zip_code: client.zip_code } : null,
  });
}));

govFormsRouter.get("/client/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rows = await query<any>(
    `SELECT filing_id, client_id, form_type, form_data, status, signed_at, signer_name, signer_title,
            submitted_via, submitted_at, submitted_note, created_at
       FROM altax.v3_gov_form_filings WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  res.json({ filings: rows });
}));

govFormsRouter.post("/client/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const formType = String(req.body?.formType || "").trim();
  if (!(CLIENT_GOV_FORM_TYPES as readonly string[]).includes(formType)) return res.status(400).json({ error: "Choose a form to generate." });
  const formData = req.body?.formData;
  if (!formData || typeof formData !== "object") return res.status(400).json({ error: "Form data is required." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  // Fail fast on a broken field map rather than saving a filing whose PDF can never be generated.
  try {
    await generateGovForm(formType, formData);
  } catch (err: any) {
    return res.status(400).json({ error: `Could not generate this form: ${err?.message || "invalid data."}` });
  }

  const filingId = `GOV-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_gov_form_filings (filing_id, client_id, form_type, form_data, status, created_by)
     VALUES ($1,$2,$3,$4,'Draft',$5)`,
    [filingId, clientId, formType, JSON.stringify(formData), req.user!.email]
  );
  await logAudit("Tools", "CREATE_GOV_FORM", filingId, "form_type", "", formType,
    `${FORM_LABELS[formType]} drafted for ${client.client_name} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, filingId });
}));

govFormsRouter.get("/employee/:employeeId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT client_id FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) return res.status(403).json({ error: "You do not have access to this employee." });
  const rows = await query<any>(
    `SELECT filing_id, employee_id, form_type, form_data, status, signed_at, signer_name, signer_title,
            submitted_via, submitted_at, submitted_note, created_at
       FROM altax.v3_gov_form_filings WHERE employee_id = $1 ORDER BY created_at DESC`,
    [employeeId]
  );
  res.json({ filings: rows });
}));

govFormsRouter.post("/employee/:employeeId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT client_id, employee_name FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) return res.status(403).json({ error: "You do not have access to this employee." });

  const formType = String(req.body?.formType || "W4").trim();
  if (!(EMPLOYEE_GOV_FORM_TYPES as readonly string[]).includes(formType)) return res.status(400).json({ error: "Choose a form to generate." });
  const formData = req.body?.formData;
  if (!formData || typeof formData !== "object") return res.status(400).json({ error: "Form data is required." });

  try {
    await generateGovForm(formType, formData);
  } catch (err: any) {
    return res.status(400).json({ error: `Could not generate this form: ${err?.message || "invalid data."}` });
  }

  const filingId = `GOV-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_gov_form_filings (filing_id, employee_id, form_type, form_data, status, created_by)
     VALUES ($1,$2,$3,$4,'Draft',$5)`,
    [filingId, employeeId, formType, JSON.stringify(formData), req.user!.email]
  );
  await logAudit("Tools", "CREATE_GOV_FORM", filingId, "form_type", "", formType,
    `${FORM_LABELS[formType]} drafted for ${employee.employee_name} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, filingId });
}));

async function loadFiling(req: AuthedRequest, filingId: string) {
  const filing = await queryOne<any>(`SELECT * FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [filingId]);
  if (!filing) return null;
  if (filing.client_id) {
    if (!(await canAccessClient(req.user!, filing.client_id))) return "forbidden";
  } else if (filing.employee_id) {
    const employee = await queryOne<any>(`SELECT client_id FROM altax.v3_employees WHERE employee_id = $1`, [filing.employee_id]);
    if (!employee || !(await canAccessClient(req.user!, employee.client_id))) return "forbidden";
  }
  return filing;
}

govFormsRouter.get("/:filingId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  res.json({ filing });
}));

govFormsRouter.get("/:filingId/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });

  const bytes = await generateGovForm(filing.form_type, filing.form_data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/** Records a physical/wet-ink signature — same shape as contracts' and POA's sign-in-person. */
govFormsRouter.post("/:filingId/sign", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") return res.status(400).json({ error: `This filing is already ${filing.status}.` });

  const signerName = String(req.body?.signerName || "").trim();
  if (!signerName) return res.status(400).json({ error: "The signer's full legal name is required." });
  const signerTitle = String(req.body?.signerTitle || "").trim() || null;

  await query(
    `UPDATE altax.v3_gov_form_filings SET status='Signed', signed_at=now(), signer_name=$2, signer_title=$3, recorded_by=$4, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, signerName, signerTitle, req.user!.email]
  );
  await logAudit("Tools", "SIGN_GOV_FORM", filing.filing_id, "status", "Draft", "Signed",
    `Recorded as signed in person by "${signerName}", logged by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** The firm's own record of the manual step this app can't automate — mailing, faxing, hand-delivering, uploading online (SS-4), or simply kept on file (W-4/W-9/8332 never go to an agency). */
govFormsRouter.post("/:filingId/submit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Signed") return res.status(400).json({ error: "Record the signature before marking this submitted." });

  const via = String(req.body?.submittedVia || "").trim();
  if (!via) return res.status(400).json({ error: "Choose how this was sent." });
  const note = String(req.body?.note || "").trim() || null;

  await query(
    `UPDATE altax.v3_gov_form_filings SET status='Submitted', submitted_via=$2, submitted_at=now(), submitted_note=$3, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, via, note]
  );
  await logAudit("Tools", "SUBMIT_GOV_FORM", filing.filing_id, "status", "Signed", "Submitted",
    `Marked submitted via ${via} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

govFormsRouter.post("/:filingId/void", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });

  const reason = String(req.body?.reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required to void a filing." });

  await query(
    `UPDATE altax.v3_gov_form_filings SET status='Void', voided_at=now(), voided_reason=$2, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, reason]
  );
  await logAudit("Tools", "VOID_GOV_FORM", filing.filing_id, "status", filing.status, "Void",
    `Voided by ${req.user!.email}: ${reason}`, req.user!.email);
  res.json({ ok: true });
}));

/** Hard delete — admin only, only while still Draft. Same rule as contracts/POA: once physically signed it's a real record, not a mistake to erase. */
govFormsRouter.post("/:filingId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") {
    return res.status(400).json({ error: "Only a Draft filing can be deleted — this one has been signed, so void it instead." });
  }

  await query(`DELETE FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [filing.filing_id]);
  await logAudit("Tools", "DELETE_GOV_FORM", filing.filing_id, "", filing.form_type, "",
    `Draft filing deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
