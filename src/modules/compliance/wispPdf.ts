/**
 * Written Information Security Plan (WISP) — hand-drawn PDF, same
 * self-contained local Cursor/newPage/wrapText approach as haccpPdf.ts/
 * invoicePdf.ts/reportsPdf.ts/paycheckPdf.ts. Unlike HACCP (a document
 * handed to a health department, deliberately unbranded), this one carries
 * the firm's own letterhead/logo — it's the firm's internal compliance
 * document, not client-facing correspondence.
 *
 * Structure follows the required elements of IRS Pub. 4557 ("Safeguarding
 * Taxpayer Data") and the FTC Safeguards Rule (16 CFR Part 314, applicable
 * to paid preparers as "financial institutions" under the Gramm-Leach-
 * Bliley Act): designated coordinator(s), data inventory, risk assessment,
 * administrative/technical/physical safeguards, service-provider oversight,
 * incident response, and periodic review — each section grounded in the
 * safeguards actually implemented in this app rather than generic
 * boilerplate, so the document reflects real practice.
 */
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { pdfSafeText } from "../../common/pdfText";
import { getFirmProfile, addressLines, type FirmProfile } from "../../common/firmProfile";
import { embedFirmLogo } from "../../common/pdfLogo";

const PAGE_W = 612;
const PAGE_H = 792;
const INK = rgb(0.09, 0.09, 0.09);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const TEAL = rgb(0.043, 0.42, 0.42);
const TEAL_TINT = rgb(0.93, 0.97, 0.97);

export interface WispPdfData {
  coordinatorNames: string;
  adoptedDate: string;
  lastReviewedDate: string;
}

class Cursor {
  constructor(private page: PDFPage, private font: PDFFont, private bold: PDFFont, private top: number) {}
  text(x: number, yFromTop: number, str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center" } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const safeStr = pdfSafeText(str);
    const width = font.widthOfTextAtSize(safeStr, size);
    const drawX = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.page.drawText(safeStr, { x: drawX, y: this.top - yFromTop, size, font, color: opts.color ?? INK });
  }
  line(x1: number, y1: number, x2: number, y2: number, color = LINE, thickness = 0.75) {
    this.page.drawLine({ start: { x: x1, y: this.top - y1 }, end: { x: x2, y: this.top - y2 }, thickness, color });
  }
  rect(x: number, y: number, w: number, h: number, color = TEAL) {
    this.page.drawRectangle({ x, y: this.top - y - h, width: w, height: h, color });
  }
  /** A drawn dot, not a "•" glyph — pdfSafeText() (see pdfText.ts) deliberately flattens "•" to "-" for WinAnsi safety, so a real bullet marker has to be a shape, not text. */
  bullet(x: number, yFromTop: number, radius = 1.6, color = TEAL) {
    this.page.drawCircle({ x, y: this.top - yFromTop, size: radius, color });
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = pdfSafeText(text).split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function fmtDate(v: string): string {
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

interface Section {
  title: string;
  body: string[];
  bullets?: string[];
}

function buildSections(firm: FirmProfile, data: WispPdfData): Section[] {
  const firmName = firm.firmName;
  return [
    {
      title: "1. PURPOSE AND SCOPE",
      body: [
        `This Written Information Security Plan ("WISP") describes the administrative, technical, and physical safeguards ${firmName} ("the Firm") uses to protect taxpayer and client data, in fulfillment of the requirement in IRS Publication 4557, "Safeguarding Taxpayer Data," that every paid tax return preparer maintain a written security plan, and of the FTC Safeguards Rule (16 CFR Part 314), which classifies tax preparation businesses as "financial institutions" subject to the data-security requirements of the Gramm-Leach-Bliley Act.`,
        `This WISP applies to all client and taxpayer data handled by the Firm in any form — electronic or paper — across every system the Firm uses to prepare, file, store, or transmit that data, including the Firm's own practice-management system, its e-file/preparation software, accounting platforms used on clients' behalf, government filing portals, and firm email.`,
      ],
    },
    {
      title: "2. DATA SECURITY COORDINATORS",
      body: [
        `The Firm designates the following individual(s) as its Data Security Coordinator(s), responsible for implementing, maintaining, and enforcing this WISP: ${data.coordinatorNames}.`,
        `The Data Security Coordinators are responsible for: keeping this WISP current; approving any new software, service, or vendor that will handle client data; responding to and directing the Firm's response to any suspected or actual data incident; and ensuring every staff member with access to client data has read this WISP and completed required security training before being granted that access.`,
      ],
    },
    {
      title: "3. INFORMATION INVENTORY",
      body: [
        `The Firm collects, transmits, and stores the following categories of sensitive personal and financial information in the ordinary course of tax preparation and related engagements: Social Security Numbers and ITINs; Employer Identification Numbers; bank account and routing numbers; driver's license and state ID numbers; dates of birth; wage, income, and payroll data (W-2s, 1099s, paystubs); prior-year tax returns and supporting schedules; and powers of attorney and other authorization records.`,
        `This data resides in: the Firm's practice-management application (encrypted database); the Firm's tax preparation software; the Firm's accounting/bookkeeping platforms used on behalf of clients; government e-file and deposit portals (including EFTPS and state tax portals); and firm email and document storage used for client correspondence.`,
      ],
    },
    {
      title: "4. RISK ASSESSMENT",
      body: [
        `The Firm has identified the following reasonably foreseeable internal and external risks to the security, confidentiality, and integrity of client data, and has designed the safeguards in this WISP to address them.`,
      ],
      bullets: [
        "Internal: unauthorized or careless staff access to client records beyond what a role requires; loss or theft of an unlocked or unencrypted device; use of weak, reused, or shared passwords; sending client data over an insecure or personal channel.",
        "External: phishing and other social-engineering attempts to obtain credentials or client data; credential theft or account takeover; malware or ransomware; exploitation of unpatched software; and a breach at a third-party service provider the Firm relies on.",
      ],
    },
    {
      title: "5. ADMINISTRATIVE SAFEGUARDS",
      body: [
        `The Firm limits access to client data to what each role actually requires, and requires every person with access to be trained, agreed to confidentiality, and accountable for their access.`,
      ],
      bullets: [
        "A signed confidentiality/non-disclosure agreement is required before any staff member is granted access to client data.",
        "Access is role-based: staff accounts are scoped to the clients assigned to them; only an Administrator has firm-wide visibility.",
        "New-hire onboarding and departure/offboarding follow a documented checklist covering account setup, device policy sign-off, and timely access revocation.",
        "Every staff member reviews this WISP and completes annual security-awareness training (phishing recognition, password hygiene, secure data handling), acknowledged and timestamped in the Firm's practice-management system.",
        "Violations of this WISP or the Firm's data-handling policies are grounds for disciplinary action, up to and including termination of access or employment.",
      ],
    },
    {
      title: "6. TECHNICAL SAFEGUARDS",
      body: [
        `The Firm's practice-management system implements the following technical controls over client data:`,
      ],
      bullets: [
        "Sensitive fields — including Social Security Numbers, EINs, and bank account details captured on government forms — are encrypted at rest, not stored as plain text.",
        "Two-factor authentication (time-based one-time codes) is mandatory for every user account before it can access client data.",
        "Passwords are stored only as salted cryptographic hashes; the Firm itself cannot read a user's password.",
        "Access is enforced by role at the application layer, with every material change to a user's role or assignment immediately invalidating that user's active session.",
        "All access to and changes affecting client records are recorded in an audit log, attributing each action to the individual who performed it.",
        "Credentials for government and firm-level portals (such as EFTPS and state tax-agency accounts) are held in a dedicated, encrypted credential vault separate from client-facing systems, limiting exposure if either is compromised.",
        "Client and system data is backed up on an automated, encrypted daily schedule.",
      ],
    },
    {
      title: "7. PHYSICAL SAFEGUARDS",
      body: [
        `Where client data exists in physical form, the Firm maintains the following controls:`,
      ],
      bullets: [
        "Office access is restricted to authorized personnel; areas where paper client records are stored are locked when unattended.",
        "A clean-desk practice is followed for any printed document containing Social Security Numbers, bank information, or other sensitive data.",
        "Paper records containing client data are cross-cut shredded, and retired electronic storage media are securely wiped or destroyed, once the applicable retention period has passed.",
      ],
    },
    {
      title: "8. DEVICE AND REMOTE ACCESS SAFEGUARDS",
      body: [
        `Every device used to access client data — whether firm-issued or personally owned — must meet the following minimum requirements before it is used for firm work:`,
      ],
      bullets: [
        "A passcode or biometric lock, with automatic screen lock after a short period of inactivity, and full-disk encryption enabled.",
        "Current antivirus/anti-malware protection and up-to-date operating system security patches.",
        "Remote-wipe capability, so the device can be remotely cleared of firm and client data if it is lost, stolen, or the employment relationship ends.",
        "No client data may be transmitted over personal, unencrypted, or non-firm-approved channels (personal email, unsecured messaging apps, unencrypted removable media, etc.).",
      ],
    },
    {
      title: "9. SERVICE PROVIDER OVERSIGHT",
      body: [
        `The Firm relies on the following categories of third-party service providers in delivering its services, and requires that each maintain safeguards appropriate to the sensitivity of the data it handles: tax preparation/e-file software; cloud accounting platforms used on behalf of clients; the government agencies operating EFTPS and state deposit/filing portals; the Firm's database hosting provider; and the Firm's transactional email provider.`,
        `Before engaging a new service provider that will handle client data, a Data Security Coordinator reviews and documents that provider's data-security practices, and engagement is limited to providers who can reasonably demonstrate adequate safeguards.`,
      ],
    },
    {
      title: "10. INCIDENT RESPONSE PLAN",
      body: [
        `If a Data Security Coordinator or any staff member suspects or confirms that client data has been accessed, disclosed, or acquired without authorization, the Firm follows this response sequence:`,
      ],
      bullets: [
        "Contain: immediately limit further exposure — revoke or reset affected credentials, isolate the affected system or account, and preserve evidence of the incident.",
        "Assess: determine what data was involved, how many clients are affected, and the likely cause, with a Data Security Coordinator directing the assessment.",
        "Notify the IRS: contact the local IRS Stakeholder Liaison and follow the reporting steps published at IRS.gov under \"Data Theft Information for Tax Professionals\"; report suspected e-file account compromise as instructed by the Firm's e-file provider.",
        "Notify affected states: report through the Federation of Tax Administrators' state-notification process for any state whose residents' data was involved.",
        "Notify affected individuals and, where required, state regulators: provide written notice to affected clients and comply with applicable state breach-notification law, including Maryland's Personal Information Protection Act for Maryland residents.",
        "Notify law enforcement where warranted: local police and/or the FBI Internet Crime Complaint Center (IC3) for suspected criminal activity.",
        "Remediate and document: rotate all potentially affected credentials, apply any necessary patches or configuration changes, and record what happened, what was done, and when — for the Firm's own records and for any regulator that later asks.",
        "Review: after any incident, the Data Security Coordinators review this WISP and update it to address the cause.",
      ],
    },
    {
      title: "11. PLAN ADMINISTRATION AND ANNUAL REVIEW",
      body: [
        `This WISP was adopted on ${fmtDate(data.adoptedDate)} and was last reviewed on ${fmtDate(data.lastReviewedDate)}. The Data Security Coordinators review this WISP at least annually, and additionally after any security incident, any material change to the systems or service providers described in this plan, or any relevant change in law.`,
        `Every staff member with access to client data is provided this WISP and must acknowledge having read and understood it — both when first granted access, and again each time the plan is materially updated. The Firm maintains a timestamped record of each acknowledgment.`,
      ],
    },
  ];
}

function newPage(doc: PDFDocument, font: PDFFont, bold: PDFFont, logo: Awaited<ReturnType<typeof embedFirmLogo>>, firm: FirmProfile): { page: PDFPage; c: Cursor } {
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const c = new Cursor(page, font, bold, PAGE_H);
  c.rect(0, 0, PAGE_W, 6, TEAL);
  return { page, c };
}

function drawFooter(c: Cursor, font: PDFFont, firmName: string, pageLabel: string) {
  c.text(48, PAGE_H - 28, `${firmName} — Written Information Security Plan (Confidential)`, { size: 7.5, color: MUTED });
  c.text(PAGE_W - 48, PAGE_H - 28, pageLabel, { size: 7.5, color: MUTED, align: "right" });
}

export async function generateWispPdf(data: WispPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const firm = await getFirmProfile();
  const logo = await embedFirmLogo(doc, firm);

  const L = 48, R = PAGE_W - 48;
  const maxWidth = R - L;
  let pageNum = 1;

  // ---- Cover page ----
  let { page, c } = newPage(doc, font, bold, logo, firm);
  let y = 56;
  let textL = L;
  if (logo) {
    const logoH = 50;
    const logoW = (logo.width / logo.height) * logoH;
    page.drawImage(logo, { x: L, y: PAGE_H - y - logoH + 10, width: logoW, height: logoH });
    textL = L + logoW + 12;
  }
  c.text(textL, y, firm.firmName.toUpperCase(), { size: 16, bold: true, color: TEAL });
  for (const line of addressLines(firm)) { y += 13; c.text(textL, y, line, { size: 9, color: MUTED }); }
  y += 13; c.text(textL, y, [firm.phone, firm.email].filter(Boolean).join("  •  "), { size: 9, color: MUTED });
  y += 30;
  c.line(L, y, R, y, LINE, 1);
  y += 50;

  c.rect(L, y, R - L, 88, TEAL_TINT);
  c.text(PAGE_W / 2, y + 34, "WRITTEN INFORMATION SECURITY PLAN", { size: 19, bold: true, align: "center" });
  c.text(PAGE_W / 2, y + 56, "Prepared under IRS Publication 4557 and the FTC Safeguards Rule (16 CFR Part 314)", { size: 9.5, color: MUTED, align: "center" });
  c.text(PAGE_W / 2, y + 72, "CONFIDENTIAL — FOR INTERNAL FIRM USE", { size: 8.5, bold: true, color: TEAL, align: "center" });
  y += 88 + 40;

  const metaRows: [string, string][] = [
    ["Data Security Coordinator(s)", data.coordinatorNames],
    ["Plan Adopted", fmtDate(data.adoptedDate)],
    ["Last Reviewed", fmtDate(data.lastReviewedDate)],
  ];
  for (const [label, value] of metaRows) {
    c.text(L, y, label, { size: 9.5, color: MUTED });
    c.text(R, y, value, { size: 10.5, bold: true, align: "right" });
    y += 20;
    c.line(L, y - 8, R, y - 8, LINE, 0.5);
  }

  drawFooter(c, font, firm.firmName, "Page 1");

  // ---- Body sections ----
  const sections = buildSections(firm, data);
  ({ page, c } = newPage(doc, font, bold, logo, firm));
  pageNum += 1;
  drawFooter(c, font, firm.firmName, `Page ${pageNum}`);
  y = 56;

  const ensureRoom = (needed: number) => {
    if (y + needed > PAGE_H - 48) {
      pageNum += 1;
      ({ page, c } = newPage(doc, font, bold, logo, firm));
      drawFooter(c, font, firm.firmName, `Page ${pageNum}`);
      y = 56;
    }
  };

  for (const section of sections) {
    ensureRoom(30);
    y += 8;
    c.text(L, y, section.title, { size: 12, bold: true, color: TEAL });
    y += 8;
    c.line(L, y, R, y, LINE, 0.75);
    y += 16;

    for (const para of section.body) {
      for (const line of wrapText(para, font, 9.5, maxWidth)) {
        ensureRoom(13);
        c.text(L, y, line, { size: 9.5 });
        y += 13;
      }
      y += 6;
    }

    if (section.bullets) {
      for (const bullet of section.bullets) {
        const wrapped = wrapText(bullet, font, 9.5, maxWidth - 14);
        ensureRoom(wrapped.length * 13 + 4);
        c.bullet(L + 3, y - 3);
        wrapped.forEach((line, i) => { c.text(L + 14, y, line, { size: 9.5 }); y += 13; });
        y += 4;
      }
    }
    y += 8;
  }

  // ---- Acknowledgment page ----
  pageNum += 1;
  ({ page, c } = newPage(doc, font, bold, logo, firm));
  drawFooter(c, font, firm.firmName, `Page ${pageNum}`);
  y = 56;
  c.text(L, y, "12. EMPLOYEE ACKNOWLEDGMENT", { size: 12, bold: true, color: TEAL });
  y += 8;
  c.line(L, y, R, y, LINE, 0.75);
  y += 16;
  for (const line of wrapText(
    `I acknowledge that I have read and understood this Written Information Security Plan, and I agree to comply with the safeguards it describes when handling client and taxpayer data on behalf of ${firm.firmName}. Staff of ${firm.firmName} acknowledge this plan electronically in the Firm's practice-management system; a timestamped acknowledgment record is maintained for each staff member in lieu of a handwritten signature below.`,
    font, 9.5, maxWidth
  )) { c.text(L, y, line, { size: 9.5 }); y += 13; }
  y += 40;

  c.line(L, y, L + 220, y, INK, 0.75);
  c.text(L, y + 14, "Signature — Data Security Coordinator", { size: 8.5, color: MUTED });
  c.line(R - 150, y, R, y, INK, 0.75);
  c.text(R - 150, y + 14, "Date", { size: 8.5, color: MUTED });

  return doc.save();
}
