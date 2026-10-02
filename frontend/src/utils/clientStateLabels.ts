/**
 * The client profile's tax/registration fields were all written with
 * Maryland names ("MD UI Employer ID", "MD Withholding Frequency", "(SDAT)")
 * even though the firm has real clients in DC/VA/PA/DE. The underlying
 * columns are generic (a frequency, an enabled flag, an employer ID), so only
 * the wording needed to follow the client's own state. A client with no
 * state set keeps the old Maryland wording, since that was the only behavior
 * before this.
 */
const SOS_AGENCY: Record<string, string> = {
  DC: "DLCP",
  VA: "SCC",
  PA: "PA Dept. of State",
  DE: "DE Division of Corporations",
};

function normalize(state: string | null | undefined): string {
  return String(state || "").trim().toUpperCase();
}

/** True for a Maryland client or one with no state on file (legacy default). */
export function isMarylandClient(state: string | null | undefined): boolean {
  const st = normalize(state);
  return !st || st === "MD";
}

/** The state records agency that issues a business's Secretary of State ID — "SDAT" in Maryland. */
export function sosAgencyLabel(state: string | null | undefined): string {
  const st = normalize(state);
  if (isMarylandClient(st)) return "SDAT";
  return SOS_AGENCY[st] ?? `${st} Secretary of State`;
}

/** The states whose yearly business filing the calendar has real rules for — Maryland's April 15 Annual Report, DC's biennial report, Virginia's annual registration, Pennsylvania's annual report, Delaware's annual tax/franchise report. */
export function hasAnnualReportRules(state: string | null | undefined): boolean {
  const st = normalize(state);
  return isMarylandClient(st) || ["DC", "VA", "PA", "DE"].includes(st);
}

const ANNUAL_REPORT_NAME: Record<string, string> = {
  DC: "DC Biennial Report",
  VA: "VA Annual Registration",
  PA: "PA Annual Report",
  DE: "DE Annual Report / Franchise Tax",
};

/** Rewrites the Maryland wording of a profile field label for the client's own state. */
export function clientStateLabel(label: string, state: string | null | undefined): string {
  const st = normalize(state);
  if (isMarylandClient(st)) return label;
  return label
    .replace(/\bMD Annual Report\b/g, ANNUAL_REPORT_NAME[st] ?? `${st} Annual Report`)
    .replace(/\bMD (UI|Withholding)\b/g, `${st} $1`)
    .replace("(SDAT)", `(${sosAgencyLabel(st)})`);
}

/**
 * Catalog services named "State ..." ("State Withholding Filing") show the
 * client's own state when it's known — "DC Withholding Filing", "MD
 * Withholding Filing" — and stay generic when no state is chosen yet. The
 * stored catalog label never changes, so pricing, contracts and invoices keep
 * working off one stable name.
 */
export function serviceLabelForState(label: string, state: string | null | undefined): string {
  const st = normalize(state);
  if (!/^[A-Z]{2}$/.test(st)) return label;
  return label.replace(/^State /, `${st} `);
}
