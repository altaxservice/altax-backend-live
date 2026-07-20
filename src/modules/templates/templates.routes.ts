import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { APP_NAME } from "../../common/branding";
import { clientMatchesRule, isActiveFlag } from "../rules/rules.routes";

export const templatesRouter = Router();

/**
 * Built-in default templates — mirrors the legacy app's hardcoded template set
 * (Client Follow Up, Payment Reminder, etc). These aren't seeded into v3_templates;
 * they're a code-level fallback exactly like legacy's "Built-in default" source,
 * so a fresh install has usable templates without a data migration. Saving a
 * template with the same name creates/updates a v3_templates row that overrides it.
 */
export const BUILT_IN: { name: string; category: string; subject: string; english: string; arabic: string }[] = [
  { name: "Client Follow Up", category: "Communications", subject: "Follow up from AL TAX",
    english: "Hi {{clientName}}, following up on your account. Let us know if you have questions.",
    arabic: "مرحباً {{clientName}}،\n\nنتواصل معكم لمتابعة حسابكم. يرجى إعلامنا إذا كان لديكم أي استفسارات." },
  { name: "Client Tax and Payroll Update", category: "Communications", subject: "Client tax and payroll update{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your tax and payroll update{{periodLabel}}.\n\n{{periodSummary}}",
    arabic: "مرحباً {{clientName}}،\n\nإليكم تحديث الضرائب والرواتب الخاص بكم{{periodLabel}}.\n\n{{periodSummary}}" },
  { name: "Direct Deposit Question", category: "Communications", subject: "Direct deposit question",
    english: "We have a question about your direct deposit setup.",
    arabic: "لدينا استفسار بخصوص إعدادات الإيداع المباشر الخاصة بكم." },
  { name: "Document Request", category: "Communications", subject: "Documents needed",
    english: "Hello {{clientName}},\n\nWe need the following from you to continue:\n\n{{itemsList}}\n\nPlease upload these through your client portal or reply to this message.",
    arabic: "مرحباً {{clientName}}،\n\nنحتاج إلى ما يلي منكم لمتابعة العمل:\n\n{{itemsList}}\n\nيرجى رفعها عبر بوابة العميل الخاصة بكم أو الرد على هذه الرسالة." },
  { name: "Document Upload Note", category: "Communications", subject: "Documents uploaded",
    english: "New documents were uploaded to your account.",
    arabic: "تم رفع مستندات جديدة إلى حسابكم." },
  { name: "Employee Paystub Notice", category: "Communications", subject: "Paystub available",
    english: "Your paystub is available for review.",
    arabic: "قسيمة راتبكم متوفرة الآن للمراجعة." },
  { name: "Employee Paystub Question", category: "Communications", subject: "Paystub question",
    english: "We have a question about your paystub.",
    arabic: "لدينا استفسار بخصوص قسيمة راتبكم." },
  { name: "Payment Question", category: "Communications", subject: "Payment question",
    english: "We have a question about a recent payment.",
    arabic: "لدينا استفسار بخصوص دفعة أخيرة." },
  { name: "Payment Reminder", category: "Communications", subject: "Payment reminder",
    english: "Hello {{clientName}},\n\nThis is a reminder that you have an outstanding balance of {{balanceDue}}. Please arrange payment at your earliest convenience.\n\nThank you.",
    arabic: "مرحباً {{clientName}}،\n\nهذا تذكير بأن لديكم رصيداً مستحقاً غير مسدد بقيمة {{balanceDue}}. يرجى ترتيب السداد في أقرب وقت ممكن.\n\nشكراً لكم." },
  { name: "Payroll Summary", category: "Communications", subject: "Payroll summary{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your payroll summary{{periodLabel}}.\n\n{{periodSummary}}",
    arabic: "مرحباً {{clientName}}،\n\nإليكم ملخص الرواتب الخاص بكم{{periodLabel}}.\n\n{{periodSummary}}" },
  { name: "Payroll Tax Question", category: "Communications", subject: "Payroll tax question",
    english: "We have a question about payroll taxes.",
    arabic: "لدينا استفسار بخصوص ضرائب الرواتب." },
  { name: "Question to AL TAX", category: "Communications", subject: "Question from client portal",
    english: "A client submitted a question through the portal.",
    arabic: "قام أحد العملاء بإرسال استفسار عبر البوابة الإلكترونية." },
  { name: "Sales Tax Summary", category: "Communications", subject: "Sales tax summary{{periodLabel}}",
    english: "Hello {{clientName}},\n\nHere is your sales tax summary{{periodLabel}}.\n\n{{periodSummary}}",
    arabic: "مرحباً {{clientName}}،\n\nإليكم ملخص ضريبة المبيعات الخاص بكم{{periodLabel}}.\n\n{{periodSummary}}" },
  { name: "Staff Task Reminder", category: "Communications", subject: "Staff task reminder: {{taskName}}",
    english: `Task: {{taskName}}\nClient: {{clientName}}\nStatus: {{taskStatus}}\nDue: {{dueDate}}\n\nPlease review and update this task in ${APP_NAME}.`,
    arabic: `المهمة: {{taskName}}\nالعميل: {{clientName}}\nالحالة: {{taskStatus}}\nتاريخ الاستحقاق: {{dueDate}}\n\nيرجى مراجعة هذه المهمة وتحديثها في نظام ${APP_NAME}.` },
];

templatesRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const overrides = await query<any>(`SELECT * FROM altax.v3_templates ORDER BY template_name ASC`);
  const overrideByName = new Map(overrides.map((r: any) => [r.template_name.toLowerCase(), r]));

  const templates = BUILT_IN.map((b) => {
    const override = overrideByName.get(b.name.toLowerCase());
    overrideByName.delete(b.name.toLowerCase());
    if (override) {
      return { templateId: override.template_id, name: override.template_name, category: override.category, subject: override.subject, active: override.active, source: "Custom override" };
    }
    return { templateId: null, name: b.name, category: b.category, subject: b.subject, active: true, source: "Built-in default" };
  });

  for (const remaining of overrideByName.values()) {
    templates.push({ templateId: remaining.template_id, name: remaining.template_name, category: remaining.category, subject: remaining.subject, active: remaining.active, source: "Custom" });
  }

  res.json({ templates });
}));

/**
 * Resolves {{placeholder}} tokens against a client (and, loosely, the firm)
 * before a template is handed to the compose UI. Previously the frontend
 * copied template text verbatim into the message box, so every built-in
 * template's {{clientName}} (and any custom template's own tokens) went out
 * unresolved — this closes that gap without requiring the caller to know
 * which tokens exist; unknown tokens are left as-is rather than blanked, so
 * a typo'd placeholder is visibly wrong instead of silently disappearing.
 */
export function substitutePlaceholders(text: string, client: any | null, extra?: Record<string, string>): string {
  if (!text) return text;
  const today = new Date();
  const values: Record<string, string> = {
    firmName: "AL TAX SERVICE",
    today: `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`,
    clientName: client?.client_name || "",
    clientEmail: client?.email || "",
    clientPhone: client?.phone || "",
    balanceDue: client?.balance_due !== undefined && client?.balance_due !== null
      ? `$${Number(client.balance_due).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "",
    periodLabel: "", periodSummary: "",
    ...extra,
  };
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value !== undefined && value !== "" ? value : match === "{{periodLabel}}" || match === "{{periodSummary}}" ? "" : match;
  });
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(v: unknown): string {
  const d = v ? new Date(v as string) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { timeZone: "UTC" }) : "";
}

/**
 * Projects the filing/payment due date a Task Rule implies for a given reporting
 * period, from its `due_month`/`due_day` config columns — the same two columns
 * `POST /rules/:ruleId/batch` leaves for staff to fill in by hand every time. Real
 * production values (checked directly against v3_task_rules) are one of: "Next
 * Month" (monthly rules — due the following calendar month), "Current Month" (TR-005
 * only), "Quarter End" / "Quarter End + 1" (quarterly rules), a bare numeric month
 * string like "4" (annual rules — fixed calendar month, due the year AFTER the tax
 * year closes, e.g. a 2025 return due April 15 2026), or null (Custom/Once rules,
 * which have no projectable due date and are skipped by the caller). Quarterly rules
 * with no `due_month` set (only TR-014Q today) fall back to "Quarter End + 1" since
 * that's what every other quarterly rule in production actually uses.
 */
function projectRuleDueDate(rule: any, periodEnd: Date): Date | null {
  const dueDay = Number(String(rule.due_day || "").trim());
  if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return null;
  const dueMonth = String(rule.due_month || "").trim();
  const y = periodEnd.getUTCFullYear();
  const m = periodEnd.getUTCMonth();
  const quarterEndMonth = Math.floor(m / 3) * 3 + 2; // 0-indexed: Mar=2, Jun=5, Sep=8, Dec=11

  if (dueMonth === "Next Month") return new Date(Date.UTC(y, m + 1, dueDay));
  if (dueMonth === "Current Month") return new Date(Date.UTC(y, m, dueDay));
  if (dueMonth === "Quarter End") return new Date(Date.UTC(y, quarterEndMonth, dueDay));
  if (dueMonth === "Quarter End + 1") return new Date(Date.UTC(y, quarterEndMonth + 1, dueDay));
  if (!dueMonth && rule.frequency === "Quarterly") return new Date(Date.UTC(y, quarterEndMonth + 1, dueDay));

  const fixedMonth = Number(dueMonth);
  if (Number.isFinite(fixedMonth) && fixedMonth >= 1 && fixedMonth <= 12) {
    return new Date(Date.UTC(y + 1, fixedMonth - 1, dueDay));
  }
  return null;
}

/**
 * Real, computed "Important Dates" — which active Task Rules this specific client
 * matches (same trigger logic `POST /rules/:ruleId/batch` uses to pick clients for a
 * batch run) and what due date each implies for the period just reported on. Requires
 * the FULL client row (every trigger column `clientMatchesRule` might check), not the
 * client_id/name/email/phone slice `resolveTemplate` normally fetches.
 */
async function computeImportantDates(client: any, periodEnd: Date): Promise<{ label: string; date: Date }[]> {
  const rules = await query<any>(`SELECT * FROM altax.v3_task_rules WHERE frequency <> 'Once'`);
  // Two rules can legitimately share a task_type — e.g. TR-005 ("Payroll Processing",
  // triggers on a specific Payroll Frequency) and TR-005A (same task_type, triggers on
  // Payroll?=Yes as TR-013's prerequisite step) — and both match any client with
  // payroll_enabled=true AND payroll_frequency=Monthly (65 real clients). When that
  // happens they usually project the identical due date too, so dedupe on label+date
  // rather than showing the same line twice; two rules with the same label but a
  // genuinely different projected date both stay, since that's real information.
  const seen = new Set<string>();
  const dates: { label: string; date: Date }[] = [];
  for (const rule of rules) {
    if (!isActiveFlag(rule.active)) continue;
    if (!clientMatchesRule(client, rule)) continue;
    const due = projectRuleDueDate(rule, periodEnd);
    if (!due) continue;
    const label = String(rule.task_type || rule.rule_id);
    const key = `${label}|${due.toISOString().slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dates.push({ label, date: due });
  }
  dates.sort((a, b) => a.date.getTime() - b.date.getTime());
  return dates;
}

/**
 * Builds a real, computed period summary (sales tax + payroll figures) from this
 * client's actual v3_sales_input/v3_paychecks rows for the given date range — not a
 * static blurb. Powers the {{periodSummary}} token on the three "report" built-in
 * templates (Client Tax and Payroll Update, Sales Tax Summary, Payroll Summary).
 * Sections are omitted entirely when there's no data for that period, rather than
 * printing an all-zeros block. Only reads already-recorded rows (no payroll
 * creation/bank fields touched — that area stays paused pending real verification).
 */
async function computeClientPeriodSummary(clientId: string, periodStart: string, periodEnd: string): Promise<string> {
  const sales = await query<any>(
    `SELECT * FROM altax.v3_sales_input WHERE client_id = $1 AND sale_date BETWEEN $2 AND $3 ORDER BY sale_date ASC`,
    [clientId, periodStart, periodEnd]
  );
  const paychecks = await query<any>(
    `SELECT * FROM altax.v3_paychecks WHERE client_id = $1 AND pay_date BETWEEN $2 AND $3 ORDER BY pay_date ASC`,
    [clientId, periodStart, periodEnd]
  );

  const sum = (rows: any[], col: string) => rows.reduce((s, r) => s + Number(r[col] || 0), 0);
  const salesTaxDue = sum(sales, "total_tax_due");
  const grossWages = sum(paychecks, "gross_wages");
  const employeeTaxes = sum(paychecks, "employee_taxes");
  const employerTaxes = sum(paychecks, "employer_taxes");
  const netPay = sum(paychecks, "net_pay");

  const lines: string[] = ["SUMMARY"];
  if (sales.length) lines.push(`Sales tax due: ${fmtMoney(salesTaxDue)}`);
  if (paychecks.length) {
    lines.push(`Payroll checks: ${paychecks.length}`);
    lines.push(`Payroll gross wages: ${fmtMoney(grossWages)}`);
    lines.push(`Net payroll paid: ${fmtMoney(netPay)}`);
    lines.push(`Payroll taxes: employee ${fmtMoney(employeeTaxes)} | employer ${fmtMoney(employerTaxes)}`);
  }
  if (!sales.length && !paychecks.length) lines.push("No sales or payroll activity recorded for this period.");

  if (sales.length) {
    lines.push("", "SALES TAX DETAIL");
    lines.push(`Gross sales: ${fmtMoney(sum(sales, "gross_sales"))}`);
    // Category breakdown reads v3_sales_input_lines (multi-state/multi-category,
    // 2026-07-14) rather than the old fixed taxable6_sales/special12_sales/
    // vape20_sales/sixty_rate_sales columns — those stay populated on legacy rows
    // for audit purposes but are no longer written to, so summing them here would
    // silently miss every sale recorded after the migration.
    const saleIds = sales.map((s) => s.sale_id);
    const lineRows = saleIds.length
      ? await query<any>(
          `SELECT l.taxable_amount, l.tax_amount, c.category_name FROM altax.v3_sales_input_lines l
           JOIN altax.v3_sales_tax_categories c ON c.category_id = l.category_id
           WHERE l.sale_id = ANY($1::text[]) ORDER BY c.display_order`,
          [saleIds]
        )
      : [];
    const byCategory = new Map<string, { taxable: number; tax: number }>();
    for (const l of lineRows) {
      const entry = byCategory.get(l.category_name) || { taxable: 0, tax: 0 };
      entry.taxable += Number(l.taxable_amount) || 0;
      entry.tax += Number(l.tax_amount) || 0;
      byCategory.set(l.category_name, entry);
    }
    for (const [categoryName, { taxable, tax }] of byCategory) {
      lines.push(`${categoryName}: ${fmtMoney(taxable)} taxable, ${fmtMoney(tax)} tax`);
    }
    lines.push(`Adjustments: ${fmtMoney(sum(sales, "adjustments"))}`);
    lines.push(`Sales tax due: ${fmtMoney(salesTaxDue)}`);
    const lastPayment = sales.map((s) => s.payment_date).filter(Boolean).sort().slice(-1)[0];
    if (lastPayment) lines.push(`Last recorded payment date: ${fmtDate(lastPayment)}`);
  }

  if (paychecks.length) {
    lines.push("", "PAYROLL SUMMARY");
    lines.push(`Checks: ${paychecks.length}`);
    lines.push(`Gross wages: ${fmtMoney(grossWages)}`);
    lines.push(`Employee taxes: ${fmtMoney(employeeTaxes)}`);
    lines.push(`Employer taxes: ${fmtMoney(employerTaxes)}`);
    lines.push(`Net pay: ${fmtMoney(netPay)}`);
    lines.push(`Total payroll cost: ${fmtMoney(sum(paychecks, "total_cost"))}`);
    lines.push("", "PAYROLL TAX DETAIL");
    lines.push(`Federal withholding: ${fmtMoney(sum(paychecks, "federal_withholding"))}`);
    lines.push(`Social Security - employee: ${fmtMoney(sum(paychecks, "social_security_ee"))}`);
    lines.push(`Social Security - employer: ${fmtMoney(sum(paychecks, "social_security_er"))}`);
    lines.push(`Medicare - employee: ${fmtMoney(sum(paychecks, "medicare_ee"))}`);
    lines.push(`Medicare - employer: ${fmtMoney(sum(paychecks, "medicare_er"))}`);
    lines.push(`State withholding: ${fmtMoney(sum(paychecks, "state_tax"))}`);
    lines.push(`State unemployment (SUTA): ${fmtMoney(sum(paychecks, "suta"))}`);
  }

  const periodEndDate = new Date(periodEnd);
  if (!Number.isNaN(periodEndDate.getTime())) {
    const client = await queryOne<any>(`SELECT * FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    const importantDates = client ? await computeImportantDates(client, periodEndDate) : [];
    if (importantDates.length) {
      lines.push("", "IMPORTANT DATES");
      for (const { label, date } of importantDates) lines.push(`${label} due date: ${fmtDate(date)}`);
    }
  }

  return lines.join("\n");
}

export interface ResolvedTemplate {
  template_name: string; category: string | null;
  subject: string; message_english: string; message_arabic: string;
  active: boolean; source: "Custom override" | "Built-in default";
}

/**
 * Looks up a template by name and substitutes client/period placeholders —
 * shared by the GET /:templateName route below, reportsPdf.ts's Client
 * Message PDF, and reminders.routes.ts (which passes extraOverride for
 * task/document-specific tokens like {{taskName}}/{{itemsList}} that have
 * no client/period source), so all three read the exact same resolved text
 * rather than each re-deriving it independently and risking drift.
 */
export async function resolveTemplate(
  name: string, clientId: string, periodStart: string, periodEnd: string,
  extraOverride?: Record<string, string>
): Promise<ResolvedTemplate | null> {
  const client = clientId ? await queryOne<any>(`SELECT client_id, client_name, email, phone FROM altax.v3_clients WHERE client_id = $1`, [clientId]) : null;

  const extra: Record<string, string> = {};
  if (clientId && periodStart && periodEnd) {
    extra.periodLabel = ` for ${fmtDate(periodStart)} - ${fmtDate(periodEnd)}`;
    extra.periodSummary = await computeClientPeriodSummary(clientId, periodStart, periodEnd);
  }
  Object.assign(extra, extraOverride);

  const override = await queryOne<any>(`SELECT * FROM altax.v3_templates WHERE lower(template_name) = lower($1)`, [name]);
  if (override) {
    return {
      template_name: override.template_name, category: override.category, active: override.active,
      subject: substitutePlaceholders(override.subject, client, extra),
      message_english: substitutePlaceholders(override.message_english, client, extra),
      message_arabic: substitutePlaceholders(override.message_arabic, client, extra),
      source: "Custom override",
    };
  }
  const builtIn = BUILT_IN.find((b) => b.name.toLowerCase() === name.toLowerCase());
  if (!builtIn) return null;
  return {
    template_name: builtIn.name, category: builtIn.category, active: true,
    subject: substitutePlaceholders(builtIn.subject, client, extra),
    message_english: substitutePlaceholders(builtIn.english, client, extra),
    message_arabic: substitutePlaceholders(builtIn.arabic, client, extra),
    source: "Built-in default",
  };
}

templatesRouter.get("/:templateName", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const name = req.params.templateName;
  const clientId = String(req.query.clientId || "").trim();
  const periodStart = String(req.query.periodStart || "").trim();
  const periodEnd = String(req.query.periodEnd || "").trim();

  const resolved = await resolveTemplate(name, clientId, periodStart, periodEnd);
  if (!resolved) return res.status(404).json({ error: "Template not found." });
  const { source, ...template } = resolved;
  res.json({ template, source });
}));

/** Create/edit a template — ported from alTaxPortalSaveTemplate. Admin/staff. Upserts by template name so saving a built-in overrides it, matching legacy's "edit a built-in to override" behavior. */
templatesRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const templateName = String(body.templateName || "").trim();
  if (!templateName) return res.status(400).json({ error: "Template name is required." });

  const existing = await queryOne<any>(`SELECT template_id FROM altax.v3_templates WHERE lower(template_name) = lower($1)`, [templateName]);
  const templateId = existing?.template_id || `TPL-${Date.now()}`;

  const fields = {
    template_name: templateName, category: String(body.category || "Communications").trim(),
    subject: String(body.subject || "").trim(), message_english: String(body.messageEnglish || "").trim() || null,
    message_arabic: String(body.messageArabic || "").trim() || null,
    active: body.active === undefined ? true : Boolean(body.active), notes: String(body.notes || "").trim() || null,
  };

  if (existing) {
    await query(
      `UPDATE altax.v3_templates SET category=$2, subject=$3, message_english=$4, message_arabic=$5, active=$6,
         notes=$7, updated_at = now(), updated_by = $8
       WHERE template_id = $1`,
      [templateId, ...Object.values(fields), req.user!.email]
    );
    await logAudit("Templates", "EDIT", templateId, "", "", templateName, `Template edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_templates (template_id, template_name, category, subject, message_english, message_arabic, active, notes, updated_by, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Node Web App',$1)`,
      [templateId, ...Object.values(fields), req.user!.email]
    );
    await logAudit("Templates", "CREATE", templateId, "", "", templateName, `Template created by ${req.user!.email}.`, req.user!.email);
  }

  res.json({ ok: true, templateId });
}));
