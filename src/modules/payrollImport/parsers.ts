/**
 * Parsers for the payroll/employee export formats QuickBooks Online and Drake
 * Accounting actually produce — reverse-engineered from real sample exports (not
 * guessed), since a wrong guess on a payroll import risks landing wrong dollar
 * amounts in someone's real paycheck. Every parser here takes the raw grid
 * `readWorkbookRows()` returns and normalizes into the shared ParsedEmployee /
 * ParsedPaycheck shapes the import routes work with, regardless of source.
 *
 * Deliberately NOT supported yet: Drake's "Employee Detailed Listing" — unlike
 * every other report here, its fields aren't in a real column grid; each value
 * sits at a seemingly arbitrary column offset from its label (a scattered
 * label/value layout, not a table). Drake's own "Employee Listing" already covers
 * the employee-import scope (name/SSN/phone/address/status); Detailed Listing
 * would only add pay rate/DOB/hire date/filing status on top, via a more defensive
 * label-scanning parser — left as a clearly-flagged future addition rather than a
 * silently-missing one.
 */

export type ImportSource = "qbo" | "drake";
export type ImportKind = "employees" | "paychecks";

export interface ParsedEmployee {
  employeeName: string;
  email?: string;
  phone?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  ssnMasked?: string; // last-4-only, as every export masks it — never a full SSN
  payType?: "Hourly" | "Salary";
  payRate?: number;
  federalFilingStatus?: string;
  stateFilingStatus?: string;
  status?: string;
  /** Free-text fields the export had (DOB, hire date, gender, deductions, ...) that don't have a real column in v3_employees — preserved as readable notes rather than silently dropped. */
  extraNotes: string[];
}

export interface ParsedPaycheck {
  employeeName: string;
  payDate: string; // YYYY-MM-DD
  payPeriodStart?: string;
  payPeriodEnd?: string;
  grossWages?: number;
  regularHours?: number;
  federalWithholding?: number;
  stateTax?: number;
  checkNumber?: string;
  /** The source's own net pay, kept only to show the user a sanity-check comparison in the preview — never sent to the create-paycheck endpoint (net pay is always recalculated). */
  sourceNetPay?: number;
}

export type DetectedFormat =
  | { source: "qbo"; kind: "employees" }
  | { source: "qbo"; kind: "paychecks" }
  | { source: "drake"; kind: "employees" }
  | { source: "drake"; kind: "paychecks" }
  | { source: "drake"; kind: "unsupported-employee-detailed-listing" }
  | null;

function cellText(row: string[] | undefined, index: number): string {
  return String(row?.[index] ?? "").trim();
}

function parseMoney(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned) return undefined;
  const negative = cleaned.startsWith("-") || cleaned.startsWith("(");
  const n = parseFloat(cleaned.replace(/[()-]/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** MM/DD/YYYY -> YYYY-MM-DD. Returns null for anything else (blank cells, "DateRange", etc). */
function parseUsDate(value: string | undefined): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value || "").trim());
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

/** "123 Main St, Rosedale, MD 21237" or "...MD 21237-1234" -> parts. Returns nulls if it doesn't match. */
function parseUsAddressLine(line: string): { street: string; city: string; state: string; zip: string } | null {
  const m = /^(.*),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{1,4})?)$/.exec(line.trim());
  if (!m) return null;
  return { street: m[1].trim(), city: m[2].trim(), state: m[3], zip: m[4] };
}

function findHeaderIndex(headerRow: string[], matcher: RegExp): number {
  return headerRow.findIndex((h) => matcher.test(String(h || "").trim()));
}

/**
 * Every Drake report stamps its own "Check Dates: M/D/YYYY to M/D/YYYY" (or a
 * bare "M/D/YYYY to M/D/YYYY" on the Tax Liability report) into one of the
 * first few rows — the actual date range Drake ran the report for, which is
 * NOT necessarily the period a caller intends to use the file for (e.g. a
 * report generated for the whole year, then uploaded against a single
 * month). Used by the EFTPS deposit workflow to catch that mismatch instead
 * of silently summing a differently-scoped file. Returns null if no such
 * line is found (report title row layouts vary; callers treat null as "could
 * not verify" rather than a hard failure).
 */
export function parseDrakeReportDateRange(rows: string[][]): { start: string; end: string } | null {
  const re = /(\d{1,2}\/\d{1,2}\/\d{4})\s+to\s+(\d{1,2}\/\d{1,2}\/\d{4})/i;
  for (const row of rows.slice(0, 4)) {
    const m = re.exec(cellText(row, 0));
    if (m) {
      const start = parseUsDate(m[1]);
      const end = parseUsDate(m[2]);
      if (start && end) return { start, end };
    }
  }
  return null;
}

/** Sniffs the file's format from its first few rows — every source stamps a real report title into row 1 or 2. */
export function detectFormat(rows: string[][]): DetectedFormat {
  const firstCell = cellText(rows[1], 0) || cellText(rows[0], 0);
  if (firstCell.includes("Employee details report")) return { source: "qbo", kind: "employees" };
  if (firstCell.includes("Payroll details report")) return { source: "qbo", kind: "paychecks" };

  const drakeHeader = cellText(rows[0], 0);
  if (drakeHeader.includes("Employee Detailed Listing")) return { source: "drake", kind: "unsupported-employee-detailed-listing" };
  if (drakeHeader.includes("Employee Listing")) return { source: "drake", kind: "employees" };
  if (drakeHeader.includes("Payroll Summary")) return { source: "drake", kind: "paychecks" };

  return null;
}

// ---------------------------------------------------------------------------
// QuickBooks Online — Employee Details
// ---------------------------------------------------------------------------
export function parseQboEmployeeDetails(rows: string[][]): ParsedEmployee[] {
  const headerIdx = rows.findIndex((r) => cellText(r, 0) === "Personal info");
  if (headerIdx === -1) return [];
  const out: ParsedEmployee[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const personalInfo = cellText(row, 0);
    if (!personalInfo) continue;

    const personalParts = personalInfo.split("\n\n").map((s) => s.trim()).filter(Boolean);
    const employeeName = (personalParts[0] || "").trim();
    if (!employeeName) continue;

    const extraNotes: string[] = [];
    const employee: ParsedEmployee = { employeeName, extraNotes };

    // personalParts[1] is the employee's home address; [2] "DOB: ..."; [3] "Gender: ...".
    if (personalParts[1]) {
      const addr = parseUsAddressLine(personalParts[1]);
      if (addr) {
        employee.streetAddress = addr.street;
        employee.city = addr.city;
        employee.state = addr.state;
        employee.zipCode = addr.zip;
      } else {
        extraNotes.push(`Home address (from QBO): ${personalParts[1]}`);
      }
    }
    for (const part of personalParts.slice(2)) {
      if (/^DOB:/.test(part) || /^Gender:/.test(part)) extraNotes.push(part);
    }

    // Col D "Pay info" — "Hourly rate: $X/hr", "Pay method: ...", "Deductions: ...", "Contributions: ...", "Time off: ..."
    const payInfo = cellText(row, 3);
    for (const part of payInfo.split("\n\n").map((s) => s.trim()).filter(Boolean)) {
      const hourly = /^Hourly rate:\s*\$([0-9,.]+)\/hr/.exec(part);
      if (hourly) {
        employee.payType = "Hourly";
        employee.payRate = parseMoney(hourly[1]);
        continue;
      }
      const salary = /^Salary:\s*\$([0-9,.]+)\/yr/.exec(part);
      if (salary) {
        employee.payType = "Salary";
        extraNotes.push(`Annual salary (from QBO): $${salary[1]}/yr — enter this client's per-period gross manually.`);
        continue;
      }
      if (/^Pay method:/.test(part)) {
        if (/^Pay method:\s*DD/.test(part)) extraNotes.push("Pay method: Direct Deposit (bank details are masked in the export — re-enter under Payment Methods).");
        continue;
      }
      if (!/^(Deductions|Contributions|Time off):\s*None$/.test(part)) extraNotes.push(part);
    }

    // Col E "Tax info" — "SSN: ....NNNN", "Fed: <status>", "<ST>: <status>"
    const taxInfo = cellText(row, 4);
    for (const part of taxInfo.split("\n\n").map((s) => s.trim()).filter(Boolean)) {
      const ssn = /^SSN:\s*\.*(\d{4})$/.exec(part);
      if (ssn) { employee.ssnMasked = `***-**-${ssn[1]}`; continue; }
      const fed = /^Fed:\s*(.+)$/s.exec(part);
      if (fed) { employee.federalFilingStatus = fed[1].split("\n")[0].trim(); continue; }
      const state = /^([A-Z]{2}):\s*(.+)$/s.exec(part);
      if (state) { employee.stateFilingStatus = state[2].split("\n")[0].trim(); continue; }
    }

    const notes = cellText(row, 5);
    if (notes) extraNotes.push(`Note: ${notes}`);

    out.push(employee);
  }
  return out;
}

// ---------------------------------------------------------------------------
// QuickBooks Online — Payroll Details
// ---------------------------------------------------------------------------
export function parseQboPayrollDetails(rows: string[][]): ParsedPaycheck[] {
  const headerIdx = rows.findIndex((r) => cellText(r, 0) === "Name" && cellText(r, 1) === "Pay date");
  if (headerIdx === -1) return [];
  const header = rows[headerIdx];

  const colName = 0, colPayDate = 1, colPeriod = 2, colHours = findHeaderIndex(header, /^Hours - total$/);
  const colGross = findHeaderIndex(header, /^Gross pay - total$/);
  const colNet = findHeaderIndex(header, /^Net pay$/);
  // FIT/state-PIT live in the abbreviated columns (populated per employee row); the
  // full-name "Federal Income Tax"/"<State> Income Tax" columns are only populated
  // on the report's own Total row, not per paycheck — confirmed against a real
  // export, not assumed.
  const colFit = findHeaderIndex(header, /^Employee taxes - FIT$/);
  const colStatePit = findHeaderIndex(header, /^Employee taxes - [A-Z]{2} PIT$/);

  const out: ParsedPaycheck[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = cellText(row, colName);
    if (!name || name === "Total") continue;
    const payDate = parseUsDate(cellText(row, colPayDate));
    if (!payDate) continue;

    const period = cellText(row, colPeriod).split(" - ").map((s) => s.trim());
    out.push({
      employeeName: name,
      payDate,
      payPeriodStart: parseUsDate(period[0]) || undefined,
      payPeriodEnd: parseUsDate(period[1]) || undefined,
      grossWages: colGross >= 0 ? parseMoney(cellText(row, colGross)) : undefined,
      regularHours: colHours >= 0 ? Number(cellText(row, colHours)) || undefined : undefined,
      federalWithholding: colFit >= 0 ? Math.abs(parseMoney(cellText(row, colFit)) || 0) : undefined,
      stateTax: colStatePit >= 0 ? Math.abs(parseMoney(cellText(row, colStatePit)) || 0) : undefined,
      sourceNetPay: colNet >= 0 ? parseMoney(cellText(row, colNet)) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drake — Employee Listing
// ---------------------------------------------------------------------------
export function parseDrakeEmployeeListing(rows: string[][]): ParsedEmployee[] {
  const headerIdx = rows.findIndex((r) => cellText(r, 0) === "Code" && cellText(r, 1) === "Name");
  if (headerIdx === -1) return [];
  const header = rows[headerIdx];
  const colName = 1, colSsn = 2;
  const colPhone = findHeaderIndex(header, /^Phone$/);
  const colAddress = findHeaderIndex(header, /^Address$/);
  const colStatus = findHeaderIndex(header, /^Status$/);

  const out: ParsedEmployee[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = cellText(row, 0);
    const name = cellText(row, colName);
    if (!code || !name) continue;

    const extraNotes: string[] = [];
    const employee: ParsedEmployee = { employeeName: name, extraNotes, status: colStatus >= 0 ? cellText(row, colStatus) : undefined };

    const ssn = /^X+-X+-(\d{4})$/i.exec(cellText(row, colSsn));
    if (ssn) employee.ssnMasked = `***-**-${ssn[1]}`;
    if (colPhone >= 0) employee.phone = cellText(row, colPhone) || undefined;

    if (colAddress >= 0) {
      const addressRaw = cellText(row, colAddress);
      const [street, cityStateZip] = addressRaw.split(/\r?\n/).map((s) => s.trim());
      const m = cityStateZip ? /^([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{1,4})?)$/.exec(cityStateZip) : null;
      if (street && m) {
        employee.streetAddress = street;
        employee.city = m[1];
        employee.state = m[2];
        employee.zipCode = m[3];
      } else if (addressRaw) {
        extraNotes.push(`Address (from Drake): ${addressRaw.replace(/\r?\n/g, ", ")}`);
      }
    }

    out.push(employee);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drake — Payroll Summary
// ---------------------------------------------------------------------------
export function parseDrakePayrollSummary(rows: string[][]): ParsedPaycheck[] {
  const headerIdx = rows.findIndex((r) => cellText(r, 0) === "Check Number");
  if (headerIdx === -1) return [];
  const header = rows[headerIdx];
  const colCheckNum = 0, colCheckDate = 1;
  const colGross = findHeaderIndex(header, /^Gross Wages$/);
  const colFedWh = findHeaderIndex(header, /^Federal WH$/);
  const colStateWh = findHeaderIndex(header, /^State WH$/);
  const colNet = findHeaderIndex(header, /^Net Pay$/);

  const out: ParsedPaycheck[] = [];
  let currentEmployee: string | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const colA = cellText(row, 0);
    const colB = cellText(row, 1);

    if (colA.includes(" --- ")) {
      currentEmployee = colA.split(" --- ")[0].trim();
      continue;
    }
    if (colA === "Employee Total" || colA === "Total All Employees" || colB === "YTD" || colB === "Date Range" || colB === "DateRange") continue;

    const payDate = parseUsDate(colB);
    if (!currentEmployee || !payDate) continue; // not a real paycheck row (blank separator, etc.)

    out.push({
      employeeName: currentEmployee,
      payDate,
      checkNumber: colA || undefined,
      grossWages: colGross >= 0 ? parseMoney(cellText(row, colGross)) : undefined,
      federalWithholding: colFedWh >= 0 ? parseMoney(cellText(row, colFedWh)) : undefined,
      stateTax: colStateWh >= 0 ? parseMoney(cellText(row, colStateWh)) : undefined,
      sourceNetPay: colNet >= 0 ? parseMoney(cellText(row, colNet)) : undefined,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drake — Tax Liability by Check Date (EFTPS deposit workflow)
// ---------------------------------------------------------------------------
export interface DrakeTaxLiabilitySummary {
  federalIncomeTax: number;
  socialSecurity: number;
  medicare: number;
  total941: number;
  futa: number;
  total940: number;
  stateTotal: number;
  localTotal: number;
  grandTotal: number;
}

export function looksLikeDrakeTaxLiabilityByCheckDate(rows: string[][]): boolean {
  return cellText(rows[0], 0).includes("Tax Liability by Check Date");
}

/**
 * Company-wide, already split into Federal/State/Local sections. The "941 Total"
 * row (Federal Income Tax + both shares of Social Security + both shares of
 * Medicare) is the authoritative EFTPS deposit amount used to reconcile against
 * the per-employee breakdown computed from parseDrakePayrollWagesDetail — FUTA/
 * State/Local are read too, only to confirm they're excluded from what this app
 * treats as "the EFTPS number," never to include them in it.
 */
export function parseDrakeTaxLiabilityByCheckDate(rows: string[][]): DrakeTaxLiabilitySummary | null {
  const headerRowIdx = rows.findIndex((r) => r.some((c) => String(c || "").trim() === "Tax Description"));
  if (headerRowIdx === -1) return null;
  const header = rows[headerRowIdx];
  const colLabel = header.findIndex((c) => String(c || "").trim() === "Tax Description");
  const colTotal = header.findIndex((c) => String(c || "").trim() === "Tax Liability");
  if (colLabel === -1 || colTotal === -1) return null;

  // Sub-items ("Federal Income Tax", "941 Total", ...) carry their label at
  // colLabel; the grand total ("Tax Liability Total") is a less-indented row
  // with its label at column 0 instead — check both rather than assume one.
  const totals: Record<string, number> = {};
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const label = cellText(row, 0) || cellText(row, colLabel);
    if (!label) continue;
    const value = parseMoney(cellText(row, colTotal));
    if (value === undefined) continue;
    totals[label] = value;
  }

  return {
    federalIncomeTax: totals["Federal Income Tax"] ?? 0,
    socialSecurity: totals["Social Security Wages"] ?? 0,
    medicare: totals["Medicare Wages & Tips"] ?? 0,
    total941: totals["941 Total"] ?? 0,
    futa: totals["Futa"] ?? 0,
    total940: totals["940 Total"] ?? 0,
    stateTotal: totals["State Total"] ?? 0,
    localTotal: totals["Local Totals"] ?? 0,
    grandTotal: totals["Tax Liability Total"] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Drake — Payroll Wages (EFTPS deposit workflow, per-employee breakdown)
// ---------------------------------------------------------------------------
export interface DrakeFederalPaycheckDetail {
  employeeName: string;
  payDate: string;
  checkNumber?: string;
  socialSecurityWageBase?: number;
  socialSecurityWithheld?: number;
  medicareWageBase?: number;
  medicareWithheld?: number;
  federalWithheld?: number;
}

export function looksLikeDrakePayrollWagesDetail(rows: string[][]): boolean {
  return cellText(rows[0], 0).includes("Payroll Wages");
}

/**
 * Per employee, per paycheck, two rows per check: the first carries each tax
 * type's taxable WAGE BASE, the second (same check, blank Check Number/Date)
 * carries the WITHHELD amount. Only the withheld amounts feed the EFTPS
 * computation — Drake already applies the annual Social Security wage-cap rule
 * when it computes withholding, so simply doubling the withheld Social
 * Security/Medicare figures for the employer match is correct even for an
 * employee who crosses the cap mid-year (their withheld amount, and so the
 * doubled total, is already $0 or partial for that check) — no separate cap
 * check needed here. Wage-base figures are still captured, for display only.
 */
export function parseDrakePayrollWagesDetail(rows: string[][]): DrakeFederalPaycheckDetail[] {
  const headerIdx = rows.findIndex((r) => cellText(r, 0) === "Check Number");
  if (headerIdx === -1) return [];
  const colSocSec = 2, colMedicare = 3, colFederal = 6;

  const out: DrakeFederalPaycheckDetail[] = [];
  let currentEmployee: string | null = null;
  let pending: { checkNumber?: string; payDate: string; ssBase?: number; medicareBase?: number } | null = null;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const colA = cellText(row, 0);
    const colB = cellText(row, 1);

    if (colA.includes(" --- ")) {
      currentEmployee = colA.split(" --- ")[0].trim();
      pending = null;
      continue;
    }
    if (colA === "Employee Total" || colA === "Total All Employees" || colB === "YTD" || colB === "Date Range" || colB === "DateRange") {
      pending = null;
      continue;
    }

    const payDate = parseUsDate(colB);
    if (payDate) {
      pending = {
        checkNumber: colA || undefined,
        payDate,
        ssBase: parseMoney(cellText(row, colSocSec)),
        medicareBase: parseMoney(cellText(row, colMedicare)),
      };
      continue;
    }

    if (pending && currentEmployee && !colA && !colB) {
      out.push({
        employeeName: currentEmployee,
        payDate: pending.payDate,
        checkNumber: pending.checkNumber,
        socialSecurityWageBase: pending.ssBase,
        socialSecurityWithheld: parseMoney(cellText(row, colSocSec)),
        medicareWageBase: pending.medicareBase,
        medicareWithheld: parseMoney(cellText(row, colMedicare)),
        federalWithheld: parseMoney(cellText(row, colFederal)),
      });
      pending = null;
    }
  }
  return out;
}
