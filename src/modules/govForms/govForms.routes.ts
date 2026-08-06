import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptTolerant } from "../../common/accountingHelpers";
import { decryptClientPii, decryptValue, encryptValue } from "../../common/encryption";
import { applySignatureOverlay, type SignableFormType } from "./signOverlay";
import {
  generateGovForm, CLIENT_GOV_FORM_TYPES, EMPLOYEE_GOV_FORM_TYPES,
  FORM2553_TAX_YEAR_TYPES, W9_TAX_CLASSIFICATIONS, W4_FILING_STATUSES,
  SS4_ENTITY_TYPES, SS4_REASONS, SS4_ACTIVITIES,
  CRA_REASONS, CRA_TAX_TYPES, CRA_OWNERSHIP_TYPES,
  FORM8832_TYPE_OF_ELECTION, FORM8832_ENTITY_TYPES,
} from "./govForms.service";

/**
 * Tools → government forms: Form SS-4 (EIN application), Form 2553 (S-Corp
 * election), Form W-9 (TIN request), Form 8832 (entity classification
 * election), Form W-4 (employee withholding certificate), Form 8822-B
 * (change of business address/responsible party), and Maryland Form CRA
 * (Combined Registration Application) — fills the agency's own real
 * fillable PDF, never a firm-drawn substitute (see the individual generator
 * files under this module for how every field was verified).
 *
 * SS4/2553/W9/8832/CRA/8822B are client-level (v3_gov_form_filings.client_id);
 * W4 and (when collected from a contractor rather than the client's own
 * business) W9 are employee-level (v3_gov_form_filings.employee_id), since a
 * withholding election or a contractor's own TIN certification belongs to
 * one person, not the client business itself. All share the same filing
 * lifecycle (Draft → Signed → Submitted, or Void).
 *
 * Physical-signature-only applies to SS-4/2553/8832/CRA/8822B and to a
 * client-level W-9 — same rule as the POA forms (2848/8821/548): those either go straight
 * to a government agency, whose own e-signature rules this app doesn't
 * implement, or (W-9 for the client's own business) are just as easily
 * handled the same conservative way. Employee-level W-4 and W-9 are
 * different: both are submitted to the EMPLOYER/PAYER (this firm or its
 * client), never to the IRS directly, so this app's own electronic-signature
 * system governs them — see esign.ts for the typed-name-attestation flow and
 * signOverlay.ts for how the signature is burned onto the generated PDF.
 * Employees can still be asked to sign a printed copy by hand instead
 * (the existing POST /:filingId/sign route below covers that path too).
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
  "8832": "IRS Form 8832 — Entity Classification Election",
  W4: "IRS Form W-4 — Employee's Withholding Certificate",
  CRA: "Maryland Form CRA — Combined Registration Application",
  "8822B": "IRS Form 8822-B — Change of Address or Responsible Party — Business",
};

/**
 * Mirrors GenerateGovFormModal.tsx's buildFormData client-side checks — the
 * "fail fast on a broken field map" try/catch around generateGovForm below
 * only catches missing pdf-lib FIELD NAMES, not missing DATA; pdf-lib just
 * writes an empty string into a text field that's present but blank, so a
 * malformed direct API call (or a future frontend regression) could
 * otherwise create/edit a Draft filing with, say, no legal name at all and
 * nothing here would object. Same field names, same messages as the
 * frontend, so a caller who bypasses the UI sees the identical requirement.
 */
/**
 * form_data can carry a Responsible Party SSN/ITIN/EIN (SS-4), a contractor's
 * SSN (W-9), or an employee's SSN (W-4 prefill) — typed straight into these
 * forms, same category of PII as v3_clients' own individual_ssn/ein columns,
 * which are already encrypted at rest (see encryption.ts's decryptClientPii).
 * This column stayed plaintext JSONB until now purely because it's a JSON
 * blob rather than a single VARCHAR. The whole object is serialized, run
 * through the same envelope cipher as everything else in this app, and
 * wrapped back into valid JSON as { __enc: "<ciphertext>" } — a shape none of
 * this module's real form_data payloads (all flat field names, see the
 * generators under this module) could ever produce by accident, so it also
 * doubles as the "is this row encrypted yet" check. decryptFormData falls
 * back to returning the row's plaintext object unchanged when that key isn't
 * present, so a row that predates this change (or a migration that hasn't
 * run yet) still reads correctly.
 */
function encryptFormDataForStorage(formData: any): string {
  return JSON.stringify({ __enc: encryptValue(JSON.stringify(formData ?? {})) });
}

function decryptFormData(raw: any): any {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.__enc === "string") {
    try {
      return JSON.parse(decryptValue(raw.__enc));
    } catch {
      return raw;
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

function validateGovFormRequiredFields(formType: string, formData: any): string | null {
  const s = (v: unknown) => String(v ?? "").trim();
  if (formType === "SS4") {
    if (!s(formData.legalName)) return "Legal name is required.";
    if (!s(formData.responsiblePartyName)) return "Responsible party name is required.";
  } else if (formType === "2553") {
    if (!s(formData.corporationName)) return "Corporation name is required.";
    if (!Array.isArray(formData.shareholders) || !formData.shareholders.some((sh: any) => s(sh?.name))) return "Add at least one shareholder.";
  } else if (formType === "W9") {
    if (!s(formData.name)) return "Name is required.";
  } else if (formType === "CRA") {
    if (!s(formData.legalFirstName)) return "Legal name is required.";
    if (!s(formData.street1) || !s(formData.city) || !s(formData.zip)) return "Physical business address is required.";
    if (!Array.isArray(formData.taxTypes) || formData.taxTypes.length === 0) return "Select at least one tax account being requested.";
  } else if (formType === "8822B") {
    if (!s(formData.businessName)) return "Business name is required.";
    if (!formData.affectsEmploymentReturns && !formData.affectsEmployeePlanReturns && !formData.affectsBusinessLocation) {
      return "Check at least one box for what this change affects.";
    }
  } else if (formType === "8832") {
    if (!s(formData.legalName)) return "Name of the eligible entity is required.";
    if (!s(formData.street) || !s(formData.cityStateZip)) return "Mailing address is required.";
    if (formData.moreThanOneOwner && s(formData.entityType).includes("single owner")) {
      return "Line 6's entity type says single owner, but line 3 says more than one owner — pick one.";
    }
    if (formData.lateReliefUnder200941 && !s(formData.lateReliefExplanation)) {
      return "Explain why the election wasn't filed on time (Part II, line 11) — required when late relief is checked.";
    }
  } else if (formType === "W4") {
    if (!s(formData.firstName) || !s(formData.lastName)) return "First and last name are required.";
  }
  return null;
}

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
    form8832TypeOfElection: FORM8832_TYPE_OF_ELECTION,
    form8832EntityTypes: FORM8832_ENTITY_TYPES,
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
      ein: employee.ein ? decryptTolerant(employee.ein) : null,
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
  res.json({ filings: rows.map((r) => ({ ...r, form_data: decryptFormData(r.form_data) })) });
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

  const requiredFieldError = validateGovFormRequiredFields(formType, formData);
  if (requiredFieldError) return res.status(400).json({ error: requiredFieldError });

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
    [filingId, clientId, formType, encryptFormDataForStorage(formData), req.user!.email]
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
            sent_to_employee_at, attached_upload_id, submitted_via, submitted_at, submitted_note, created_at
       FROM altax.v3_gov_form_filings WHERE employee_id = $1 ORDER BY created_at DESC`,
    [employeeId]
  );
  res.json({ filings: rows.map((r) => ({ ...r, form_data: decryptFormData(r.form_data) })) });
}));

/**
 * Staff-initiated request for the EMPLOYEE to fill in and electronically sign
 * their own W-4/W-9 from the portal, instead of staff filling it out for
 * them. Pre-fills only what's already on file (name/address/SSN/EIN) — the
 * form-specific elections (filing status, dependents, tax classification,
 * etc.) are deliberately left blank for the employee to supply themselves,
 * same as handing someone a paper form with their name pre-printed on it.
 * No generateGovForm validation here (unlike the plain create route above) —
 * the draft is intentionally incomplete until the employee finishes it.
 */
govFormsRouter.post("/employee/:employeeId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { employeeId } = req.params;
  const employee = await queryOne<any>(`SELECT * FROM altax.v3_employees WHERE employee_id = $1`, [employeeId]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });
  if (!(await canAccessClient(req.user!, employee.client_id))) return res.status(403).json({ error: "You do not have access to this employee." });
  if (!employee.email) return res.status(400).json({ error: "This person has no email on file — grant portal access with an email first." });
  const portalUser = await queryOne<any>(`SELECT user_id FROM altax.v3_users WHERE assigned_employee_id = $1 AND active = true`, [employeeId]);
  if (!portalUser) return res.status(400).json({ error: "This person has no active employee-portal account yet — grant portal access first." });

  const formType = String(req.body?.formType || "W4").trim();
  if (!(EMPLOYEE_GOV_FORM_TYPES as readonly string[]).includes(formType)) return res.status(400).json({ error: "Choose a form to send." });

  const [first, ...rest] = String(employee.employee_name || "").trim().split(/\s+/);
  let prefill: Record<string, string> =
    formType === "W9"
      ? { name: employee.employee_name || "", ssn: employee.ssn ? decryptTolerant(employee.ssn) : "", ein: employee.ein ? decryptTolerant(employee.ein) : "", address: employee.street_address || "", city: employee.city || "", state: employee.state || "", zip: employee.zip_code || "" }
      : { firstName: first || "", lastName: rest.join(" "), ssn: employee.ssn ? decryptTolerant(employee.ssn) : "", address: employee.street_address || "", city: employee.city || "", state: employee.state || "", zip: employee.zip_code || "" };

  // The employer/payer side is never the employee's to fill in — pre-fill it
  // from the client record now, same as GenerateW4Modal's own identity prefill,
  // so the employee's own fill-in form only ever asks about themselves.
  if (formType === "W4") {
    const client = decryptClientPii(await queryOne<any>(`SELECT client_name, ein, street_address, city, state, zip_code FROM altax.v3_clients WHERE client_id = $1`, [employee.client_id]));
    if (client) {
      prefill = {
        ...prefill,
        employerName: client.client_name || "",
        employerAddress: [client.street_address, [client.city, client.state, client.zip_code].filter(Boolean).join(", ")].filter(Boolean).join(", "),
        employerEin: client.ein || "",
      };
    }
  }

  const filingId = `GOV-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_gov_form_filings (filing_id, employee_id, form_type, form_data, status, sent_to_employee_at, created_by)
     VALUES ($1,$2,$3,$4,'Draft',now(),$5)`,
    [filingId, employeeId, formType, encryptFormDataForStorage(prefill), req.user!.email]
  );
  await logAudit("Tools", "SEND_GOV_FORM_TO_EMPLOYEE", filingId, "form_type", "", formType,
    `${FORM_LABELS[formType]} sent to ${employee.employee_name}'s portal to complete and sign, by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, filingId });
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

  const requiredFieldError = validateGovFormRequiredFields(formType, formData);
  if (requiredFieldError) return res.status(400).json({ error: requiredFieldError });

  try {
    await generateGovForm(formType, formData);
  } catch (err: any) {
    return res.status(400).json({ error: `Could not generate this form: ${err?.message || "invalid data."}` });
  }

  const filingId = `GOV-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_gov_form_filings (filing_id, employee_id, form_type, form_data, status, created_by)
     VALUES ($1,$2,$3,$4,'Draft',$5)`,
    [filingId, employeeId, formType, encryptFormDataForStorage(formData), req.user!.email]
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
  return { ...filing, form_data: decryptFormData(filing.form_data) };
}

// ---------------------------------------------------------------------------
// Employee self-service (portal) routes — an employee/contractor viewing and
// completing their OWN W-4/W-9, never anyone else's. Ownership is enforced by
// matching req.user.employeeId (carried on the employee-portal JWT, see
// requireAuth.ts) against the filing's employee_id — the same pattern
// documents.routes.ts's employee-portal routes already use, no requireRole
// call since any authenticated employee may reach these, only for their own
// filings. Only filings staff explicitly sent (sent_to_employee_at set) are
// visible here — a filing staff is still drafting for themselves never shows.
// Registered ABOVE the generic /:filingId route below so "/my" isn't matched
// as a filing ID.
// ---------------------------------------------------------------------------

govFormsRouter.get("/my", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!req.user!.employeeId) return res.json({ filings: [] });
  const rows = await query<any>(
    `SELECT filing_id, form_type, form_data, status, signed_at, sent_to_employee_at, attached_upload_id,
            submitted_via, submitted_at, created_at
       FROM altax.v3_gov_form_filings
      WHERE employee_id = $1 AND sent_to_employee_at IS NOT NULL
      ORDER BY created_at DESC`,
    [req.user!.employeeId]
  );
  res.json({ filings: rows.map((r) => ({ ...r, form_data: decryptFormData(r.form_data) })) });
}));

govFormsRouter.get("/my/:filingId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await queryOne<any>(
    `SELECT filing_id, employee_id, form_type, form_data, status, signed_at, sent_to_employee_at, created_at
       FROM altax.v3_gov_form_filings WHERE filing_id = $1`,
    [req.params.filingId]
  );
  if (!filing || !filing.sent_to_employee_at || filing.employee_id !== req.user!.employeeId) {
    return res.status(404).json({ error: "Form not found." });
  }
  res.json({ filing: { ...filing, form_data: decryptFormData(filing.form_data) }, formTypes: { w9TaxClassifications: W9_TAX_CLASSIFICATIONS, w4FilingStatuses: W4_FILING_STATUSES } });
}));

/**
 * The employee fills in their remaining fields and types their full legal
 * name to sign. Generates the real PDF from the merged data, burns the typed
 * signature onto it (see signOverlay.ts), auto-attaches the signed PDF to
 * their own Documents (same INSERT shape as documents.routes.ts's
 * directEmployeeId branch), and records the filing as Signed with an IP/
 * timestamp audit trail — this app's own electronic signature, valid for
 * these two forms since both go to the employer/payer, never the IRS
 * directly (see this module's doc comment above).
 */
govFormsRouter.post("/my/:filingId/sign", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await queryOne<any>(`SELECT * FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [req.params.filingId]);
  if (!filing || !filing.sent_to_employee_at || filing.employee_id !== req.user!.employeeId) {
    return res.status(404).json({ error: "Form not found." });
  }
  if (filing.status !== "Draft") return res.status(400).json({ error: `This form is already ${filing.status}.` });

  const employee = await queryOne<any>(`SELECT employee_id, employee_name, client_id, client_name FROM altax.v3_employees WHERE employee_id = $1`, [filing.employee_id]);
  if (!employee) return res.status(404).json({ error: "Employee not found." });

  const signerName = String(req.body?.signerName || "").trim();
  if (!signerName) return res.status(400).json({ error: "Type your full legal name to sign." });
  if (!req.body?.agree) return res.status(400).json({ error: "You must check the box confirming this is your electronic signature." });
  // The employer/payer side (see /employee/:employeeId/send above) is never
  // the employee's to fill in or change — without stripping these first, an
  // employee signing could submit a falsified employerName/EIN and have this
  // route generate + electronically sign a PDF asserting a fake employer
  // identity as if the firm itself had prefilled it.
  const EMPLOYER_ONLY_FIELDS = ["employerName", "employerAddress", "employerEin", "firstDateOfEmployment"];
  const submittedFormData = { ...(req.body?.formData || {}) };
  for (const field of EMPLOYER_ONLY_FIELDS) delete submittedFormData[field];
  const formData = { ...decryptFormData(filing.form_data), ...submittedFormData };

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateGovForm(filing.form_type, formData);
  } catch (err: any) {
    return res.status(400).json({ error: `Could not generate this form: ${err?.message || "check the required fields."}` });
  }
  const signedAt = new Date();
  const signedPdf = await applySignatureOverlay(filing.form_type as SignableFormType, pdfBytes, signerName, signedAt);
  const signerIp = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;

  const uploadId = `DOC-${idSuffix()}`;
  const downloadToken = crypto.randomBytes(24).toString("hex");
  const fileName = `${FORM_LABELS[filing.form_type] || filing.form_type} - Signed.pdf`;
  const fileData = encryptValue(Buffer.from(signedPdf).toString("base64"));
  await query(
    `INSERT INTO altax.v3_document_uploads
       (upload_id, request_id, task_id, client_id, client_name, employee_id, file_name, file_url, file_data, mime_type, file_size,
        uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id, download_token)
     VALUES ($1,NULL,NULL,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9,now(),'Employee to Firm','Generated',$10,false,'Node Web App',$1,$11)`,
    [
      uploadId, employee.client_id, employee.client_name, employee.employee_id, fileName,
      `/documents/uploads/${uploadId}/download?t=${downloadToken}`, fileData, signedPdf.byteLength,
      req.user!.email, `Electronically signed and submitted by ${employee.employee_name} via the employee portal.`, downloadToken,
    ]
  );

  await query(
    `UPDATE altax.v3_gov_form_filings
        SET form_data=$2, status='Signed', signed_at=now(), signer_name=$3, signer_ip=$4, attached_upload_id=$5, recorded_by=$6, updated_at=now()
      WHERE filing_id=$1`,
    [filing.filing_id, encryptFormDataForStorage(formData), signerName, signerIp, uploadId, req.user!.email]
  );
  await logAudit("Tools", "EMPLOYEE_SIGN_GOV_FORM", filing.filing_id, "status", "Draft", "Signed",
    `${FORM_LABELS[filing.form_type]} electronically signed by ${employee.employee_name} via the employee portal (IP ${signerIp || "unknown"}).`, req.user!.email);

  res.json({ ok: true, uploadId });
}));

govFormsRouter.get("/:filingId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  res.json({ filing });
}));

/** Edits a Draft filing's data in place — same Draft-only rule as delete below (once signed it's a real record, not a mistake to correct by silently rewriting). Re-validates via generateGovForm first, same fail-fast-before-saving rule the create routes already use. */
govFormsRouter.patch("/:filingId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") return res.status(400).json({ error: "Only a Draft filing can be edited — this one has been signed." });

  const formData = req.body?.formData;
  if (!formData || typeof formData !== "object") return res.status(400).json({ error: "Form data is required." });

  const requiredFieldError = validateGovFormRequiredFields(filing.form_type, formData);
  if (requiredFieldError) return res.status(400).json({ error: requiredFieldError });

  try {
    await generateGovForm(filing.form_type, formData);
  } catch (err: any) {
    return res.status(400).json({ error: `Could not generate this form: ${err?.message || "invalid data."}` });
  }

  await query(`UPDATE altax.v3_gov_form_filings SET form_data=$2, updated_at=now() WHERE filing_id=$1`, [filing.filing_id, encryptFormDataForStorage(formData)]);
  await logAudit("Tools", "UPDATE_GOV_FORM", filing.filing_id, "", "", filing.form_type,
    `${FORM_LABELS[filing.form_type] || filing.form_type} draft edited by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
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

/** The firm's own record of the manual step this app can't automate — mailing, faxing, hand-delivering, uploading online (SS-4), or simply kept on file (W-4/W-9 never go to an agency). */
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
