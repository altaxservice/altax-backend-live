export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD",
  "TN","TX","UT","VT","VA","WA","WV","WI","WY",
];
export const ENTITY_TYPES = ["LLC", "S-Corp", "C-Corp", "Partnership", "Sole Proprietorship", "Nonprofit", "Individual"];
export const SERVICE_TYPES = ["Full Service", "Bookkeeping Only", "Tax Only", "Payroll Only", "Sales Tax Only", "Permits & Licensing Only", "Consulting"];
// v3_clients.industry_category is "advisory only, not enforced" (see its schema
// comment) — a free-text column, no DB constraint — so this list is a starting
// point for the <select>, not a hard rule; a client can still be saved with a
// custom typed value via the "Other…" option. Not a single client had this set
// before this list existed (confirmed against production: 158/158 blank), so
// there was no existing free-text data this needed to reconcile with.
export const INDUSTRY_CATEGORIES = [
  "Convenience Store / Grocery", "Restaurant / Carryout / Food Service", "Smoke Shop / Tobacco / Vape",
  "Retail (Other)", "Construction / Contracting", "Professional Services", "Medical / Healthcare",
  "Real Estate", "Automotive", "Salon / Personal Care", "Transportation / Logistics",
  "Technology / IT Services", "Nonprofit",
];
// "Semiannual" was missing even though it's a real stored value on 14 live clients'
// sales_tax_frequency — the <select> silently showed blank for them instead of their
// actual frequency (same class of casing/coverage bug as PAYROLL_FREQS below).
export const FREQ_OPTIONS = ["Monthly", "Quarterly", "Semiannual", "Annually", "N/A"];
// Casing matches the real values already stored on clients ("Bi-Weekly", "Semi-Monthly")
// — a mismatch here (previously "Bi-weekly"/"Semi-monthly") makes the <select> unable to
// find a matching <option>, so it silently shows blank instead of the client's real value.
export const PAYROLL_FREQS = ["Weekly", "Bi-Weekly", "Semi-Monthly", "Monthly", "N/A"];
// These four mirror the filing-status categories the 2026 IRS Publication 15-T STANDARD
// Withholding Rate Schedules actually distinguish (see src/common/withholdingTables.ts on
// the backend, which this must stay in sync with) — Single and Married Filing Separately
// share the same bracket table there, but both are offered here since that's how a real
// W-4 is filled out.
export const FEDERAL_FILING_STATUSES = ["Single", "Married Filing Jointly", "Married Filing Separately", "Head of Household"];
// Mirrors Form MW507's own filing-status categories and src/common/withholdingTables.ts's
// MD_FILING_STATUSES on the backend.
export const MD_FILING_STATUSES = ["Single", "Married", "Head of Household"];
// All 23 Maryland counties + Baltimore City, plus the two special cases the Comptroller's
// Central Payroll Bureau defines for missing/out-of-state data — must stay in sync with
// MD_COUNTIES in src/common/withholdingTables.ts on the backend.
export const MD_COUNTIES = [
  "Allegany County", "Anne Arundel County", "Baltimore County", "Baltimore City",
  "Calvert County", "Caroline County", "Carroll County", "Cecil County", "Charles County",
  "Dorchester County", "Frederick County", "Garrett County", "Harford County", "Howard County",
  "Kent County", "Montgomery County", "Prince George's County", "Queen Anne's County",
  "St. Mary's County", "Somerset County", "Talbot County", "Washington County",
  "Wicomico County", "Worcester County", "Unknown Maryland County", "Out of State",
];
export const PAYROLL_PROVIDERS = ["QBO", "Drake", "Gusto", "ADP", "Paychex", "Other"];
// Ownership Transfer's asset allocation schedule — real IRC Section 1060 / Form
// 8594 asset classes (Class I cash through Class VII goodwill), covering the
// realistic set for this firm's client base (delis, smoke shops, convenience
// stores) plus Class I/II for completeness. Must stay in sync with
// ASSET_ALLOCATION_CLASS in src/modules/govForms/billOfSale.ts on the backend
// (the label strings are the lookup key there) — "Other" intentionally has no
// class, since a fixed list can't anticipate everything.
export const ASSET_ALLOCATION_CATEGORIES = [
  "Cash",
  "Marketable Securities / CDs",
  "Accounts Receivable",
  "Inventory / Stock in Trade",
  "Equipment & Machinery",
  "Furniture & Fixtures",
  "Vehicles",
  "Real Property / Leasehold Improvements",
  "Covenant Not to Compete",
  "Customer List / Customer Relationships",
  "Trade Name / Business Name",
  "Licenses & Permits",
  "Goodwill",
  "Other",
];
export const RETURN_TYPES = ["1120", "1120S", "1065", "Schedule C", "990", "N/A"];
// Matches normalizeLanguagePreference() in src/modules/communications/communications.routes.ts
// exactly — that's the only thing that actually reads this value (which language(s) a
// client's emails/SMS/WhatsApp get sent in). This app is bilingual English/Arabic only
// (see contracts, reminders, the portal's EN/Arabic toggle) — there's no Spanish support
// anywhere in the codebase, so offering it here was always a dead option that silently
// fell back to "Both" server-side.
export const LANGUAGES = ["English", "Arabic", "Both"];
export const CONTACT_PREFS = ["Email", "Phone", "SMS", "Portal"];
// Suggested values only (the field is free text) — how a client found the firm.
export const REFERRAL_SOURCES = ["Referral", "Google", "Website", "Social Media", "Walk-in", "Other"];

// Firm-wide service lines a client can be engaged for — keys must match
// FIRM_SERVICES in src/modules/contracts/contractContent.ts (backend), since
// these keys drive which contract template gets suggested on the client
// profile. Independent of the legacy single-select SERVICE_TYPES above.
//
// `legacy: true` keeps a key's label resolvable for clients who already have
// it (so their profile doesn't fall back to showing the bare key), while
// hiding it from the "check a new service" list going forward — see
// servicesForClientType below. Never remove or repoint a key once clients
// have data against it.
export const FIRM_SERVICES: { key: string; label: string; legacy?: boolean }[] = [
  { key: "tax_prep", label: "Tax Preparation", legacy: true },
  { key: "personal_tax_prep", label: "Personal Tax Preparation" },
  { key: "business_tax_prep", label: "Business Tax Preparation" },
  { key: "bookkeeping", label: "Bookkeeping & Accounting" },
  { key: "payroll", label: "Payroll Services" },
  { key: "sales_tax", label: "Sales Tax & Business Compliance" },
  { key: "formation", label: "Business Formation & Registered Agent" },
  { key: "business_transfer", label: "Business Transfer Documents (Bill of Sale, Amendments, etc.)" },
  { key: "permits_licenses", label: "Business Licenses & Permits (Health, Use & Occupancy, Trader's, Tobacco)" },
  { key: "snap_retailer_application", label: "SNAP Retailer Application" },
  { key: "immigration", label: "Immigration Document Preparation" },
  { key: "consulting", label: "Other Consulting & Administrative Services" },
];

// Bookkeeping/payroll/sales-tax/formation are business-only concepts (no
// individual has payroll or a registered agent) — an Individual client only
// ever needs personal tax prep, immigration help, or general consulting.
// Used to filter the Services Provided checklist by Client Type so the form
// only shows options that could actually apply.
export const INDIVIDUAL_SERVICE_KEYS = ["personal_tax_prep", "immigration", "consulting"];

/**
 * Auto-derives the legacy single-select Service Type label from the granular
 * Services Provided checkboxes — used to show a live preview as staff check
 * boxes, before saving. Mirror of deriveServiceType in
 * src/modules/contracts/contractContent.ts (backend), which is the one that
 * actually gets saved; kept in sync manually, same convention as
 * FIRM_SERVICES/SERVICE_TYPES above. Service Type is no longer a field staff
 * set directly — see the 2026-08-22 fix (78 of 152 active clients were
 * labeled "Full Service" while missing most of what was actually checked).
 */
export function deriveServiceType(services: string[] | null | undefined): string | null {
  const keys = services || [];
  if (keys.length === 0) return null;
  const hasBookkeeping = keys.includes("bookkeeping");
  const hasPayroll = keys.includes("payroll");
  const hasSalesTax = keys.includes("sales_tax");
  const hasTaxPrep = keys.includes("business_tax_prep") || keys.includes("personal_tax_prep") || keys.includes("tax_prep");
  const hasPermits = keys.includes("permits_licenses");
  const hasConsulting = keys.includes("consulting");
  const corePillars = [hasBookkeeping, hasPayroll, hasSalesTax, hasTaxPrep].filter(Boolean).length;

  if (corePillars >= 3) return "Full Service";
  if (corePillars === 1 && !hasPermits && !hasConsulting) {
    if (hasBookkeeping) return "Bookkeeping Only";
    if (hasPayroll) return "Payroll Only";
    if (hasSalesTax) return "Sales Tax Only";
    return "Tax Only";
  }
  if (corePillars === 0 && hasPermits && !hasConsulting) return "Permits & Licensing Only";
  if (corePillars === 0 && hasConsulting && !hasPermits) return "Consulting";
  return "Custom";
}

/**
 * The checkbox list for "check a new service" — excludes legacy keys, EXCEPT
 * a legacy key a given client already has checked stays visible for that
 * client (so it can still be seen/unchecked; nobody has to lose or
 * re-classify data just because the option was retired going forward).
 */
export function servicesForClientType(clientType: string, alreadySelected: string[] = []): { key: string; label: string; legacy?: boolean }[] {
  const byType = clientType === "Individual" ? FIRM_SERVICES.filter((s) => INDIVIDUAL_SERVICE_KEYS.includes(s.key)) : FIRM_SERVICES;
  return byType.filter((s) => !s.legacy || alreadySelected.includes(s.key));
}

// Mirrors contractContent.ts on the backend — the services where checking the
// box also auto-generates the Authorization to Act and Release of
// Information alongside the ordinary engagement letter (see
// autoGenerateContracts in clients.routes.ts). poa_release itself is not a
// FIRM_SERVICES entry (never manually checked), which is why ContractsSection
// has to compute its "suggested" state separately from clientServices.
export const POA_COVERED_SERVICE_KEYS = ["formation", "permits_licenses", "snap_retailer_application"];
export const POA_RELEASE_SERVICE_KEY = "poa_release";
export const POA_RELEASE_LABEL = "Authorization to Act and Release of Information";
