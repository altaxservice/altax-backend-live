export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD",
  "TN","TX","UT","VT","VA","WA","WV","WI","WY",
];
export const ENTITY_TYPES = ["LLC", "S-Corp", "C-Corp", "Partnership", "Sole Proprietorship", "Nonprofit", "Individual"];
export const SERVICE_TYPES = ["Full Service", "Bookkeeping Only", "Tax Only", "Payroll Only", "Sales Tax Only", "Consulting"];
export const FREQ_OPTIONS = ["Monthly", "Quarterly", "Annually", "N/A"];
// Casing matches the real values already stored on clients ("Bi-Weekly", "Semi-Monthly")
// — a mismatch here (previously "Bi-weekly"/"Semi-monthly") makes the <select> unable to
// find a matching <option>, so it silently shows blank instead of the client's real value.
export const PAYROLL_FREQS = ["Weekly", "Bi-Weekly", "Semi-Monthly", "Monthly", "N/A"];
export const RETURN_TYPES = ["1120", "1120S", "1065", "Schedule C", "990", "N/A"];
export const LANGUAGES = ["English", "Spanish", "Other"];
export const CONTACT_PREFS = ["Email", "Phone", "SMS", "Portal"];

// Firm-wide service lines a client can be engaged for — keys must match
// FIRM_SERVICES in src/modules/contracts/contractContent.ts (backend), since
// these keys drive which contract template gets suggested on the client
// profile. Independent of the legacy single-select SERVICE_TYPES above.
export const FIRM_SERVICES: { key: string; label: string }[] = [
  { key: "tax_prep", label: "Tax Preparation" },
  { key: "bookkeeping", label: "Bookkeeping & Accounting" },
  { key: "payroll", label: "Payroll Services" },
  { key: "sales_tax", label: "Sales Tax & Business Compliance" },
  { key: "formation", label: "Business Formation & Registered Agent" },
  { key: "immigration", label: "Immigration Document Preparation" },
  { key: "consulting", label: "Other Consulting & Administrative Services" },
];

// Bookkeeping/payroll/sales-tax/formation are business-only concepts (no
// individual has payroll or a registered agent) — an Individual client only
// ever needs personal tax prep, immigration help, or general consulting.
// Used to filter the Services Provided checklist by Client Type so the form
// only shows options that could actually apply.
export const INDIVIDUAL_SERVICE_KEYS = ["tax_prep", "immigration", "consulting"];
export function servicesForClientType(clientType: string): { key: string; label: string }[] {
  return clientType === "Individual" ? FIRM_SERVICES.filter((s) => INDIVIDUAL_SERVICE_KEYS.includes(s.key)) : FIRM_SERVICES;
}
