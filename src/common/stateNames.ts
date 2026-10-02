/** Full state names for client-facing wording ("Maryland Unemployment Insurance"). Keyed by 2-letter code, DC included. */
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** The state's full name, or null when the code is empty/unrecognized. */
export function stateDisplayName(state: string | null | undefined): string | null {
  return STATE_NAMES[String(state || "").trim().toUpperCase()] ?? null;
}

/** "Maryland Unemployment Insurance" for an MD client, "District of Columbia Unemployment Insurance" for DC — Maryland when no state is on file, the original behavior. */
export function unemploymentInsuranceLabel(state: string | null | undefined): string {
  return `${stateDisplayName(state) ?? "Maryland"} Unemployment Insurance`;
}

/** The state's own name for its yearly business filing: Maryland/Pennsylvania "Annual Report", DC "Biennial Report" (every two years), Virginia "Annual Registration", Delaware "Annual Report / Franchise Tax". Maryland when no state is on file, the original behavior. */
export function annualReportLabel(state: string | null | undefined): string {
  const code = String(state || "").trim().toUpperCase();
  if (code === "DC") return "DC Biennial Report";
  if (code === "VA") return "Virginia Annual Registration";
  if (code === "DE") return "Delaware Annual Report / Franchise Tax";
  return `${stateDisplayName(code) ?? "Maryland"} Annual Report`;
}

const STATE_NAMES_AR: Record<string, string> = {
  MD: "ماريلاند", DC: "مقاطعة كولومبيا", VA: "فرجينيا", PA: "بنسلفانيا", DE: "ديلاوير",
};

/** Arabic wording of {@link annualReportLabel} for the bilingual client messages. States without an Arabic name on file fall back to their English name inside the Arabic sentence rather than naming the wrong state. */
export function annualReportLabelAr(state: string | null | undefined): string {
  const code = String(state || "").trim().toUpperCase() || "MD";
  if (code === "DC") return "التقرير الدوري (كل سنتين) لمقاطعة كولومبيا";
  if (code === "VA") return "التسجيل السنوي لولاية فرجينيا";
  if (code === "DE") return "التقرير السنوي / ضريبة الامتياز لولاية ديلاوير";
  return `التقرير السنوي لولاية ${STATE_NAMES_AR[code] ?? stateDisplayName(code) ?? "ماريلاند"}`;
}

export function unemploymentInsuranceLabelAr(state: string | null | undefined): string {
  const code = String(state || "").trim().toUpperCase() || "MD";
  if (code === "DC") return "تأمين البطالة لمقاطعة كولومبيا";
  return `تأمين البطالة لولاية ${STATE_NAMES_AR[code] ?? stateDisplayName(code) ?? "ماريلاند"}`;
}

/** The lowercase phrase a state's UI wage-filing task name contains ("MD UI Wages Filing & Payment" -> "md ui"), used to find and close that task when the filing is recorded. */
export function uiTaskKeyword(state: string | null | undefined): string {
  const code = String(state || "").trim().toUpperCase();
  return `${/^[A-Z]{2}$/.test(code) ? code.toLowerCase() : "md"} ui`;
}

/** Payroll tax line labels for the client's state ("DC Withholding", "DC Unemployment (SUTA)") — Maryland when no state is on file, the original behavior. */
export function statePayrollTaxLabels(state: string | null | undefined): { withholding: string; suta: string } {
  const code = String(state || "").trim().toUpperCase();
  const st = /^[A-Z]{2}$/.test(code) ? code : "MD";
  return { withholding: `${st} Withholding`, suta: `${st} Unemployment (SUTA)` };
}
