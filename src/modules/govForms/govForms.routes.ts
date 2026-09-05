import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { decryptTolerant } from "../../common/accountingHelpers";
import { decryptClientPii, decryptValue, encryptValue } from "../../common/encryption";
import { writeUploadBlob, readUploadBlob } from "../../common/uploadBlobStorage";
import { applySignatureOverlay, type SignableFormType } from "./signOverlay";
import { sendEmail, recordNotificationFailure } from "../../common/notifications";
import { escapeHtml } from "../../common/html";
import { publicBaseUrl } from "../../common/publicUrl";
import {
  generateGovForm, CLIENT_GOV_FORM_TYPES, EMPLOYEE_GOV_FORM_TYPES,
  FORM2553_TAX_YEAR_TYPES, W9_TAX_CLASSIFICATIONS, W4_FILING_STATUSES,
  SS4_ENTITY_TYPES, SS4_REASONS, SS4_ACTIVITIES,
  CRA_REASONS, CRA_TAX_TYPES, CRA_OWNERSHIP_TYPES,
  FORM8832_TYPE_OF_ELECTION, FORM8832_ENTITY_TYPES,
  MD_AMEND_CORP_TYPES, MD_AMEND_CORP_APPROVAL_METHODS, MD_DISSOLUTION_APPROVAL_MANNERS,
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
  MD_AMEND_LLC: "Maryland Articles of Amendment — Limited Liability Company",
  MD_AMEND_CORP: "Maryland Articles of Amendment — Corporation",
  MD_DISSOLUTION: "Maryland Articles of Dissolution",
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
  } else if (formType === "MD_AMEND_LLC") {
    if (!s(formData.llcName)) return "LLC name is required.";
    if (!s(formData.amendmentText)) return "The amendment text is required.";
  } else if (formType === "MD_AMEND_CORP") {
    if (!s(formData.corpTypeBefore)) return "Corporation type is required.";
    if (!s(formData.corpName)) return "Corporation name is required.";
    if (!s(formData.amendmentText)) return "The amendment text is required.";
    if (!s(formData.approvalMethod)) return "Select how this amendment was approved.";
  } else if (formType === "MD_DISSOLUTION") {
    if (!s(formData.corpName)) return "Corporation name is required.";
    if (!s(formData.principalOfficeAddress)) return "Principal office address is required.";
    if (!s(formData.residentAgentName) || !s(formData.residentAgentAddress)) return "Resident agent name and address are required.";
    if (!Array.isArray(formData.directors) || !formData.directors.some((d: any) => s(d?.name))) return "Add at least one director or trustee.";
    if (!s(formData.approvalManner)) return "Select the manner of approval (SEVENTH).";
    if (!s(formData.creditorNotice)) return "Select the creditor notice option (EIGHTH).";
    if (!s(formData.effectiveDate)) return "Select an effective date (NINTH).";
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
    mdAmendCorpTypes: MD_AMEND_CORP_TYPES,
    mdAmendCorpApprovalMethods: MD_AMEND_CORP_APPROVAL_METHODS,
    mdDissolutionApprovalManners: MD_DISSOLUTION_APPROVAL_MANNERS,
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
            company_contact_street_address, company_contact_city, company_contact_state, company_contact_zip_code,
            secretary_of_state_id, phone, email, date_of_formation, dba_name, industry_category, payroll_enabled,
            cra_registration_number, md_ui_employer_id, md_ui_tax_rate, referral_source, sales_tax_frequency
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
            submitted_via, submitted_at, submitted_note, created_at,
            review_status, review_requested_by, review_requested_at, reviewed_by, reviewed_at, review_note
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
            sent_to_employee_at, attached_upload_id, submitted_via, submitted_at, submitted_note, created_at,
            review_status, review_requested_by, review_requested_at, reviewed_by, reviewed_at, review_note
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
  // Previously nothing told the employee a form was waiting — they'd only
  // discover it by logging into the portal on their own. Best-effort: the
  // filing is already created and usable even if this email fails.
  try {
    const base = publicBaseUrl(req);
    const html = `
      <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
        <div style="background:#0f5132;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Action Needed</div>
          <div style="font-size:19px;font-weight:800;margin-top:4px;">${escapeHtml(FORM_LABELS[formType])} to complete</div>
        </div>
        <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
          <p style="margin:0 0 14px;">Hi ${escapeHtml(employee.employee_name || "there")}, a ${escapeHtml(FORM_LABELS[formType])} is waiting for you to fill out and sign in your employee portal.</p>
          ${base ? `<p style="margin:0;"><a href="${base}/my-tax-forms" style="display:inline-block;background:#0f5132;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:700;">Open My Tax Forms</a></p>` : ""}
        </div>
      </div>`;
    await sendEmail({ to: employee.email, subject: `${FORM_LABELS[formType]} — please complete and sign`, html });
  } catch (err) {
    await recordNotificationFailure(`govForms:portal-send:${filingId}`, err);
  }
  if (employee.sms_allowed && employee.phone) {
    try {
      const { sendSms } = await import("../../common/notifications");
      await sendSms({ to: employee.phone, body: `AL TAX SERVICE: A ${FORM_LABELS[formType]} is waiting for you to complete and sign in your employee portal.` });
    } catch (err) {
      await recordNotificationFailure(`govForms:portal-send-sms:${filingId}`, err);
    }
  }
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

/** Best-effort display name for a filing's subject — used only in notification text, never as a security check. */
async function filingSubjectName(filing: any): Promise<string> {
  if (filing.client_id) {
    const c = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [filing.client_id]);
    if (c?.client_name) return c.client_name;
  }
  if (filing.employee_id) {
    const e = await queryOne<any>(`SELECT employee_name FROM altax.v3_employees WHERE employee_id = $1`, [filing.employee_id]);
    if (e?.employee_name) return e.employee_name;
  }
  return filing.filing_id;
}

/**
 * TAX-004 maker-checker had no notification on either end — the reviewing
 * admin never found out something was waiting on them, and the preparer
 * never found out their filing was approved/rejected, except by checking
 * manually. Same simple internal-notification shape as the public-booking
 * admin email elsewhere in this app: plain HTML, per-recipient try/catch so
 * one bad address doesn't block the rest, NotConfiguredError swallowed
 * quietly (no Resend key configured just means no email, not an error to
 * surface to the user who took the action).
 */
async function notifyGovFormReviewRequested(filing: any, requestedBy: string): Promise<void> {
  const admins = await query<any>(`SELECT email FROM altax.v3_users WHERE active = true AND lower(role) = 'admin' AND email IS NOT NULL AND email <> ''`);
  const subject = await filingSubjectName(filing);
  const label = FORM_LABELS[filing.form_type] || filing.form_type;
  const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="background:#1f2937;color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Review Requested</div>
        <div style="font-size:19px;font-weight:800;margin-top:4px;">${escapeHtml(label)} — ${escapeHtml(subject)}</div>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
        <p style="margin:0 0 10px;">${escapeHtml(requestedBy)} sent this filing for review before submitting it.</p>
        <p style="color:#999;font-size:11.5px;margin:14px 0 0;">Filing ${escapeHtml(filing.filing_id)}</p>
      </div>
    </div>`;
  for (const admin of admins) {
    try {
      await sendEmail({ to: admin.email, subject: `Review requested — ${label} for ${subject}`, html });
    } catch (err) {
      await recordNotificationFailure(`govForms:review-requested:${filing.filing_id}`, err);
    }
  }
}

async function notifyGovFormReviewDecision(filing: any, decision: "approved" | "rejected", note: string | null, reviewedBy: string): Promise<void> {
  if (!filing.review_requested_by) return;
  const preparer = await queryOne<any>(`SELECT email FROM altax.v3_users WHERE email = $1 AND active = true`, [filing.review_requested_by]);
  if (!preparer?.email) return;
  const subject = await filingSubjectName(filing);
  const label = FORM_LABELS[filing.form_type] || filing.form_type;
  const color = decision === "approved" ? "#0f5132" : "#7a1f1f";
  const html = `
    <div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
      <div style="background:${color};color:#ffffff;padding:16px 20px;border-radius:10px 10px 0 0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;opacity:0.85;">Filing ${decision === "approved" ? "Approved" : "Rejected"}</div>
        <div style="font-size:19px;font-weight:800;margin-top:4px;">${escapeHtml(label)} — ${escapeHtml(subject)}</div>
      </div>
      <div style="border:1px solid #e0e0e0;border-top:none;border-radius:0 0 10px 10px;padding:18px 20px;font-size:14px;">
        <p style="margin:0 0 10px;">${escapeHtml(reviewedBy)} ${decision} this filing.${decision === "approved" ? " It can now be submitted." : ""}</p>
        ${note ? `<div style="margin-top:10px;padding:10px 12px;background:#f7f7f5;border-radius:8px;font-size:13.5px;"><strong>Note:</strong><br>${escapeHtml(note).replace(/\n/g, "<br>")}</div>` : ""}
        <p style="color:#999;font-size:11.5px;margin:14px 0 0;">Filing ${escapeHtml(filing.filing_id)}</p>
      </div>
    </div>`;
  try {
    await sendEmail({ to: preparer.email, subject: `${decision === "approved" ? "Approved" : "Rejected"} — ${label} for ${subject}`, html });
  } catch (err) {
    await recordNotificationFailure(`govForms:review-decision:${filing.filing_id}`, err);
  }
}

// ---------------------------------------------------------------------------
// Client self-service (portal) — UX-012 (Hard Audit, 2026-08-13): a client had
// no way to see the SS-4/2553/W-9/8832/CRA/8822-B filings the firm generated
// and signed on their behalf, other than asking staff to email a copy. This
// mirrors AgreementsPage's read-only pattern exactly: only finalized
// (non-Draft) filings for the caller's own client_id, no edit/sign/void
// actions — signing still only happens through the staff-facing routes above.
// A Draft is intentionally excluded: it's a work-in-progress the firm hasn't
// finished preparing yet, nothing a client should be shown as "on file."
// Registered ABOVE the generic /:filingId route below so "/mine" isn't
// matched as a filing ID.
// ---------------------------------------------------------------------------

govFormsRouter.get("/mine", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role !== "client" || !req.user!.clientId) return res.json({ filings: [] });
  const rows = await query<any>(
    `SELECT filing_id, form_type, status, signed_at, submitted_via, submitted_at, created_at
       FROM altax.v3_gov_form_filings
      WHERE client_id = $1 AND status <> 'Draft'
      ORDER BY created_at DESC`,
    [req.user!.clientId]
  );
  res.json({ filings: rows });
}));

govFormsRouter.get("/mine/:filingId/pdf", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role !== "client" || !req.user!.clientId) return res.status(404).json({ error: "Filing not found." });
  const filing = await queryOne<any>(`SELECT * FROM altax.v3_gov_form_filings WHERE filing_id = $1`, [req.params.filingId]);
  if (!filing || filing.client_id !== req.user!.clientId || filing.status === "Draft") {
    return res.status(404).json({ error: "Filing not found." });
  }

  if (filing.attached_upload_id) {
    const upload = await queryOne<any>(`SELECT file_data, blob_backend, mime_type FROM altax.v3_document_uploads WHERE upload_id = $1`, [filing.attached_upload_id]);
    if (upload && (upload.blob_backend === "r2" || upload.file_data)) {
      const bytes = Buffer.from(await readUploadBlob(filing.attached_upload_id, upload.file_data, upload.blob_backend), "base64");
      res.setHeader("Content-Type", upload.mime_type || "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
      return res.send(bytes);
    }
  }

  const bytes = await generateGovForm(filing.form_type, decryptFormData(filing.form_data));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

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
  const { fileData, blobBackend } = await writeUploadBlob(uploadId, Buffer.from(signedPdf).toString("base64"));
  await query(
    `INSERT INTO altax.v3_document_uploads
       (upload_id, request_id, task_id, client_id, client_name, employee_id, file_name, file_url, file_data, mime_type, file_size,
        uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id, download_token, blob_backend)
     VALUES ($1,NULL,NULL,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9,now(),'Employee to Firm','Generated',$10,false,'Node Web App',$1,$11,$12)`,
    [
      uploadId, employee.client_id, employee.client_name, employee.employee_id, fileName,
      `/documents/uploads/${uploadId}/download?t=${downloadToken}`, fileData, signedPdf.byteLength,
      req.user!.email, `Electronically signed and submitted by ${employee.employee_name} via the employee portal.`, downloadToken, blobBackend,
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

/**
 * TAX-004 — admin-only queue of filings sent for review, across every
 * client/employee (an admin has no other way to discover these otherwise
 * than opening each client one by one). Registered above GET /:filingId so
 * "pending-review" isn't matched as a filing id.
 */
govFormsRouter.get("/pending-review", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT f.filing_id, f.form_type, f.review_requested_by, f.review_requested_at,
            f.client_id, c.client_name, f.employee_id, e.employee_name
       FROM altax.v3_gov_form_filings f
       LEFT JOIN altax.v3_clients c ON c.client_id = f.client_id
       LEFT JOIN altax.v3_employees e ON e.employee_id = f.employee_id
      WHERE f.review_status = 'pending_review'
      ORDER BY f.review_requested_at ASC`
  );
  res.json({ filings: rows });
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

/**
 * A Draft has nothing "historical" yet, so it's always regenerated live —
 * that's the correct behavior while someone is still previewing/editing it.
 * Once a filing is Signed/Submitted it becomes a record: TAX-012 (hard audit,
 * 2026-08-13) persists the exact bytes shown/signed at that moment
 * (attached_upload_id) so a later change to the PDF template can never
 * silently alter what an already-signed filing looks like on re-download.
 * Older filings signed before this fix have no attached_upload_id yet — those
 * fall back to live regeneration, same as a Draft.
 */
govFormsRouter.get("/:filingId/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });

  if (filing.status !== "Draft" && filing.attached_upload_id) {
    const upload = await queryOne<any>(`SELECT file_data, blob_backend, mime_type FROM altax.v3_document_uploads WHERE upload_id = $1`, [filing.attached_upload_id]);
    if (upload && (upload.blob_backend === "r2" || upload.file_data)) {
      const bytes = Buffer.from(await readUploadBlob(filing.attached_upload_id, upload.file_data, upload.blob_backend), "base64");
      res.setHeader("Content-Type", upload.mime_type || "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
      return res.send(bytes);
    }
  }

  const bytes = await generateGovForm(filing.form_type, filing.form_data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Form_${filing.form_type}_${filing.filing_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/**
 * Records a physical/wet-ink signature — same shape as contracts' and POA's
 * sign-in-person. Also persists the as-signed PDF into Documents (TAX-012,
 * hard audit 2026-08-13), same pattern as the employee e-sign route above,
 * so this filing has a durable historical snapshot rather than only ever
 * being regenerated live from mutable form_data + a mutable PDF template.
 * PDF persistence is best-effort: if it fails, the signature is still
 * recorded (a firm needs the wet-ink signature logged even if the snapshot
 * step has a problem) and the filing simply falls back to live regeneration
 * on download, same as a filing signed before this fix existed.
 */
govFormsRouter.post("/:filingId/sign", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Draft") return res.status(400).json({ error: `This filing is already ${filing.status}.` });

  const signerName = String(req.body?.signerName || "").trim();
  if (!signerName) return res.status(400).json({ error: "The signer's full legal name is required." });
  const signerTitle = String(req.body?.signerTitle || "").trim() || null;

  let uploadId: string | null = null;
  try {
    const pdfBytes = await generateGovForm(filing.form_type, filing.form_data);
    let clientId: string | null = filing.client_id || null;
    let clientName: string | null = null;
    if (clientId) {
      const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
      clientName = client?.client_name || null;
    } else if (filing.employee_id) {
      const employee = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_employees WHERE employee_id = $1`, [filing.employee_id]);
      clientId = employee?.client_id || null;
      clientName = employee?.client_name || null;
    }

    uploadId = `DOC-${idSuffix()}`;
    const downloadToken = crypto.randomBytes(24).toString("hex");
    const fileName = `${FORM_LABELS[filing.form_type] || filing.form_type} - Signed.pdf`;
    const { fileData, blobBackend } = await writeUploadBlob(uploadId, Buffer.from(pdfBytes).toString("base64"));
    await query(
      `INSERT INTO altax.v3_document_uploads
         (upload_id, request_id, task_id, client_id, client_name, employee_id, file_name, file_url, file_data, mime_type, file_size,
          uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id, download_token, blob_backend)
       VALUES ($1,NULL,NULL,$2,$3,$4,$5,$6,$7,'application/pdf',$8,$9,now(),'Firm to Client','Generated',$10,false,'Node Web App',$1,$11,$12)`,
      [
        uploadId, clientId, clientName, filing.employee_id || null, fileName,
        `/documents/uploads/${uploadId}/download?t=${downloadToken}`, fileData, pdfBytes.byteLength,
        req.user!.email, `Recorded as signed in person by "${signerName}", logged by ${req.user!.email}.`, downloadToken, blobBackend,
      ]
    );
  } catch (err: any) {
    uploadId = null;
  }

  await query(
    `UPDATE altax.v3_gov_form_filings SET status='Signed', signed_at=now(), signer_name=$2, signer_title=$3, recorded_by=$4, attached_upload_id=COALESCE($5, attached_upload_id), updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, signerName, signerTitle, req.user!.email, uploadId]
  );
  await logAudit("Tools", "SIGN_GOV_FORM", filing.filing_id, "status", "Draft", "Signed",
    `Recorded as signed in person by "${signerName}", logged by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * TAX-004 (Hard Audit, 2026-08-13) — optional maker-checker: a filer who wants
 * a second set of eyes before submission can route it to an admin instead of
 * submitting solo. Nothing changes for anyone who doesn't use this — the
 * plain Submit path below still works unless review is actually pending.
 */
govFormsRouter.post("/:filingId/request-review", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Signed") return res.status(400).json({ error: "Record the signature before sending this for review." });
  if (filing.review_status === "pending_review") return res.status(400).json({ error: "This filing is already pending review." });

  await query(
    `UPDATE altax.v3_gov_form_filings
        SET review_status='pending_review', review_requested_by=$2, review_requested_at=now(),
            reviewed_by=NULL, reviewed_at=NULL, review_note=NULL, updated_at=now()
      WHERE filing_id=$1`,
    [filing.filing_id, req.user!.email]
  );
  await logAudit("Tools", "REQUEST_GOV_FORM_REVIEW", filing.filing_id, "review_status", filing.review_status || "", "pending_review",
    `${FORM_LABELS[filing.form_type] || filing.form_type} sent for admin review by ${req.user!.email} before submission.`, req.user!.email);
  try {
    await notifyGovFormReviewRequested(filing, req.user!.email);
  } catch (err) {
    await recordNotificationFailure(`govForms:review-requested-wrapper:${filing.filing_id}`, err);
  }
  res.json({ ok: true });
}));

/** Admin-only approve/reject of a filing sent for review — see request-review above. */
govFormsRouter.post("/:filingId/review", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.review_status !== "pending_review") return res.status(400).json({ error: "This filing is not awaiting review." });

  const decision = String(req.body?.decision || "").trim();
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ error: "Decision must be approved or rejected." });
  const note = String(req.body?.note || "").trim() || null;
  if (decision === "rejected" && !note) return res.status(400).json({ error: "A note is required when rejecting a filing, so the preparer knows what to fix." });

  await query(
    `UPDATE altax.v3_gov_form_filings SET review_status=$2, reviewed_by=$3, reviewed_at=now(), review_note=$4, updated_at=now() WHERE filing_id=$1`,
    [filing.filing_id, decision, req.user!.email, note]
  );
  await logAudit("Tools", "REVIEW_GOV_FORM", filing.filing_id, "review_status", "pending_review", decision,
    `${FORM_LABELS[filing.form_type] || filing.form_type} review ${decision} by ${req.user!.email}${note ? `: ${note}` : "."}`, req.user!.email);
  try {
    await notifyGovFormReviewDecision(filing, decision as "approved" | "rejected", note, req.user!.email);
  } catch (err) {
    await recordNotificationFailure(`govForms:review-decision-wrapper:${filing.filing_id}`, err);
  }
  res.json({ ok: true });
}));

/** The firm's own record of the manual step this app can't automate — mailing, faxing, hand-delivering, uploading online (SS-4), or simply kept on file (W-4/W-9 never go to an agency). */
govFormsRouter.post("/:filingId/submit", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const filing = await loadFiling(req, req.params.filingId);
  if (filing === null) return res.status(404).json({ error: "Filing not found." });
  if (filing === "forbidden") return res.status(403).json({ error: "You do not have access to this filing." });
  if (filing.status !== "Signed") return res.status(400).json({ error: "Record the signature before marking this submitted." });
  if (filing.review_status === "pending_review" && req.user!.role !== "admin") {
    return res.status(403).json({ error: "This filing was sent for review and needs admin approval before it can be submitted." });
  }
  if (filing.review_status === "rejected") {
    return res.status(400).json({ error: "This filing's review was rejected — fix the issue and send it for review again before submitting." });
  }

  const via = String(req.body?.submittedVia || "").trim();
  if (!via) return res.status(400).json({ error: "Choose how this was sent." });
  const note = String(req.body?.note || "").trim() || null;

  // An admin submitting a still-pending review auto-resolves it as approved,
  // rather than forcing a separate "approve, then submit" round trip.
  const autoApprove = filing.review_status === "pending_review";
  await query(
    `UPDATE altax.v3_gov_form_filings
        SET status='Submitted', submitted_via=$2, submitted_at=now(), submitted_note=$3, updated_at=now()
            ${autoApprove ? ", review_status='approved', reviewed_by=$4, reviewed_at=now()" : ""}
      WHERE filing_id=$1`,
    autoApprove ? [filing.filing_id, via, note, req.user!.email] : [filing.filing_id, via, note]
  );
  await logAudit("Tools", "SUBMIT_GOV_FORM", filing.filing_id, "status", "Signed", "Submitted",
    `Marked submitted via ${via} by ${req.user!.email}.${autoApprove ? " (Also approved the pending review.)" : ""}`, req.user!.email);
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
