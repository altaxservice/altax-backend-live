/**
 * Fills the Maryland Department of Labor's own fillable PDF, "Employer Power of Attorney Authorization Form Designating Agent"
 * (Division of Unemployment Insurance), saved to src/assets/tax-forms/mduipoa.pdf. The Division asks for the completed form to be
 * submitted in BEACON (the employer portal), so this is the official form, not a firm-drawn substitute.
 *
 * Field verification: the PDF has 35 AcroForm fields. Names were matched to the printed rows by comparing each widget's rectangle with
 * the rendered page: the employer block (UI employer number, FEIN, name, address, telephone, email), the reporting-agent block (agent
 * number, name, address, telephone, email), eight checkboxes top to bottom — Check Box1 wage reports, 2 payments, 3 account
 * maintenance, 4 benefit charges, 5 wage and separation requests, 6 adjudication and appeals, 7 "All of the above", 8 "Revoke a
 * previous Power of Attorney" — and, for rows 3–7 only, a communication-preference dropdown (US Mail / Email / Text) with a details
 * box beside it. Rows 1 and 2 are printed "BEACON Inbox / See inbox for correspondence" and have no fields. The employer's signature
 * is a signature field and is never filled in by this app.
 */
import { PDFCheckBox, PDFDropdown, PDFTextField } from "pdf-lib";
import { loadTemplate, extractFlattenedPages } from "../../common/pdfForms";

export const MD_UI_POA_COMMS = ["US Mail", "Email", "Text"] as const;

export interface MdUiPoaData {
  employerUiNumber?: string; ein?: string; employerName: string; employerAddress?: string; employerPhone?: string; employerEmail?: string;
  agentNumber?: string; agentName: string; agentAddress?: string; agentPhone?: string; agentEmail?: string;
  wageReports?: boolean; payments?: boolean; accountMaintenance?: boolean; benefitCharges?: boolean; wageSeparation?: boolean; adjudication?: boolean; all?: boolean; revoke?: boolean;
  commAccountMaintenance?: string; detailAccountMaintenance?: string; commBenefitCharges?: string; detailBenefitCharges?: string;
  commWageSeparation?: string; detailWageSeparation?: string; commAdjudication?: string; detailAdjudication?: string; commAll?: string; detailAll?: string;
  signerName?: string; signerTitle?: string; signDate?: string; effectiveDate?: string; endDate?: string;
}

const usDate = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? "").trim()); return m ? `${m[2]}/${m[3]}/${m[1]}` : String(v ?? "").trim(); };

export async function generateMdUiPoa(data: MdUiPoaData): Promise<Uint8Array> {
  const doc = await loadTemplate("mduipoa.pdf");
  const form = doc.getForm();
  const find = (part: string) => form.getFields().find((f) => f.getName().includes(part));
  const text = (part: string, value: string) => { const f = find(part); if (f instanceof PDFTextField && value) { const max = f.getMaxLength(); f.setText(max ? value.slice(0, max) : value); } };
  const check = (name: string, on?: boolean) => { if (!on) return; const f = form.getFields().find((x) => x.getName() === name); if (f instanceof PDFCheckBox) f.check(); };
  const pick = (name: string, value?: string) => { if (!value) return; const f = form.getFields().find((x) => x.getName() === name); if (f instanceof PDFDropdown && f.getOptions().includes(value)) f.select(value); };

  // Employer block and reporting-agent block (the printed numbers 1–5 repeat, so the agent's fields carry a "_2" or "Agent" name).
  text("Maryland Unemployment Insurance Employer Number", data.employerUiNumber || "");
  text("Federal Employer Identification Number", String(data.ein || "").trim());
  text("Name of EmployerTaxpayer", data.employerName || "");
  const exact = (name: string, value: string) => { const f = form.getFields().find((x) => x.getName() === name); if (f instanceof PDFTextField && value) f.setText(value); };
  exact("Address", data.employerAddress || "");
  exact("Telephone Number", String(data.employerPhone || "").trim());
  exact("Email address", data.employerEmail || "");
  text("Maryland Unemployment Insurance Agent Number", data.agentNumber || "");
  text("Name of Reporting Agent", data.agentName || "");
  exact("Address_2", data.agentAddress || "");
  exact("Telephone Number_2", String(data.agentPhone || "").trim());
  exact("Email address_2", data.agentEmail || "");

  check("Check Box1", data.wageReports); check("Check Box2", data.payments); check("Check Box3", data.accountMaintenance); check("Check Box4", data.benefitCharges);
  check("Check Box5", data.wageSeparation); check("Check Box6", data.adjudication); check("Check Box7", data.all); check("Check Box8", data.revoke);

  const rows: [string, string, string | undefined, string | undefined][] = [
    ["Dropdown11", "Make account maintenance updates", data.commAccountMaintenance, data.detailAccountMaintenance],
    ["Dropdown12", "Access benefit charges", data.commBenefitCharges, data.detailBenefitCharges],
    ["Dropdown13", "Manage wage and separation requests", data.commWageSeparation, data.detailWageSeparation],
    ["Dropdown14", "File and participate in any adjudication", data.commAdjudication, data.detailAdjudication],
    ["Dropdown15", "All of the above", data.commAll, data.detailAll],
  ];
  for (const [dd, part, comm, detail] of rows) { pick(dd, comm); text(`Phone number${part}`, detail || ""); }

  exact("Full Name on behalf of Employer Printed", data.signerName || "");
  exact("Title", data.signerTitle || "");
  exact("Date", usDate(data.signDate));
  exact("Authorization Date", usDate(data.effectiveDate));
  exact("Authorization End Date", usDate(data.endDate));
  return extractFlattenedPages(doc, [0, 1]);
}
