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

function matchesSingleCondition(client: Client, columnRaw: string, valueRaw: unknown): boolean {
  const triggerColumn = CLIENT_TRIGGER_COLUMNS[columnRaw];
  if (!triggerColumn) return false;
  const triggerValue = normalizeText(valueRaw);
  let actual = normalizeText((client as Record<string, unknown>)[triggerColumn]);
  // No state on file has always meant Maryland — keep a "State = MD" rule matching those clients.
  if (triggerColumn === "state" && !actual) actual = "md";
  if (actual === triggerValue) return true;
  return triggerValue === "yes" && ["yes", "true", "active"].includes(actual);
}

export function clientMatchesRule(client: Client, rule: TaskRule | null): boolean {
  if (!rule) return false;
  // state_scope (sql/173): a rule limited to certain states. No state on file counts as Maryland.
  const scope = String((rule as unknown as { state_scope?: string | null }).state_scope || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (scope.length > 0 && !scope.includes(normalizeText((client as Record<string, unknown>).state) || "md")) return false;
  const triggerColumnRaw = String(rule.trigger_column || "").trim();
  const triggerValue = normalizeText(rule.trigger_value);
  const isEmptyTrigger = !triggerColumnRaw || !triggerValue || triggerValue === "=";
  if (!isEmptyTrigger && !matchesSingleCondition(client, triggerColumnRaw, rule.trigger_value)) return false;

  // Optional second, AND-combined condition (sql/136) — what scopes a rule to one state.
  const extra = rule as unknown as { trigger_column_2?: string | null; trigger_value_2?: string | null };
  const column2 = String(extra.trigger_column_2 || "").trim();
  const value2 = normalizeText(extra.trigger_value_2);
  if (column2 && value2 && value2 !== "=") return matchesSingleCondition(client, column2, extra.trigger_value_2);
  return true;
}
