import type { Client } from "../api/types";
import type { TaskRule } from "../api/types2";

/**
 * Mirrors CLIENT_TRIGGER_COLUMNS + clientMatchesRule in src/modules/rules/rules.routes.ts.
 * Client-side copy exists only to drive the "Select Matching Rule" convenience button in
 * the batch-creation client picker — the backend re-validates matching (and duplicate-skip)
 * authoritatively on every POST /rules/:ruleId/batch call, so drift here is a UX nuisance,
 * not a correctness risk.
 */
const CLIENT_TRIGGER_COLUMNS: Record<string, string> = {
  ClientName: "client_name", EntityType: "entity_type", Status: "status", State: "state",
  Email: "email", Phone: "phone", AssignedTo: "assigned_to",
  SalesTaxFrequency: "sales_tax_frequency", "Sales Tax Frequency": "sales_tax_frequency",
  PayrollEnabled: "payroll_enabled", "Payroll?": "payroll_enabled",
  PayrollFrequency: "payroll_frequency", "Payroll Frequency": "payroll_frequency",
  PayrollSystem: "payroll_system",
  EFTPSEnabled: "eftps_enabled", "EFTPS?": "eftps_enabled",
  MDWithholdingFrequency: "md_withholding_frequency", "MD Withholding Frequency": "md_withholding_frequency",
  MDUIEnabled: "mdui_enabled", "MD UI": "mdui_enabled",
  MDAnnualReportEnabled: "md_annual_report_enabled", "MD Annual Report?": "md_annual_report_enabled",
  BusinessReturnType: "business_return_type", "Business Return Type": "business_return_type",
  SMSAllowed: "sms_allowed", EmailAllowed: "email_allowed", PortalEnabled: "portal_enabled",
  ClientType: "client_type", ServiceType: "service_type", W21099Enabled: "w21099_enabled",
  PreferredLanguage: "preferred_language",
};

function normalizeText(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

export function clientMatchesRule(client: Client, rule: TaskRule | null): boolean {
  if (!rule) return false;
  const triggerColumnRaw = String(rule.trigger_column || "").trim();
  const triggerValue = normalizeText(rule.trigger_value);
  if (!triggerColumnRaw || !triggerValue || triggerValue === "=") return true;
  const triggerColumn = CLIENT_TRIGGER_COLUMNS[triggerColumnRaw];
  if (!triggerColumn) return false;
  const actual = normalizeText((client as Record<string, unknown>)[triggerColumn]);
  if (actual === triggerValue) return true;
  return triggerValue === "yes" && ["yes", "true", "active"].includes(actual);
}
