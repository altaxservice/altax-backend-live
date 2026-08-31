/**
 * Identifies whether a task represents one of the 5 obligation-workflow
 * types (EFTPS, MD Sales Tax, MD UI, MD Annual Report, Form 941) and, if so,
 * which Accounting tab actually finishes it.
 *
 * Uses keyword matching rather than an exact task_name/service_line string,
 * because real tasks for the same obligation type carry meaningfully
 * different names depending on how they were created — confirmed live:
 * batch-generated tasks say "Sales Tax Filing"/"MD UI Wages Filing" (no
 * "& Payment"), the daily EFTPS sweep says "EFTPS Deposit Due — <month>",
 * and manually-created ones vary further ("EFTPS Deposit", "MD UI Wages
 * Report", "Sales Tax"). An exact match against any one of these misses
 * the others. Checked against both task_name and service_line since either
 * can carry the identifying keyword depending on creation path.
 */
export function obligationAccountingTab(task: { task_name?: string | null; service_line?: string | null }): string | null {
  const haystack = `${task.task_name || ""} ${task.service_line || ""}`.toLowerCase();
  const KEYWORD_TABS: Array<[string, string]> = [
    ["eftps", "EFTPS Deposits"],
    ["sales tax", "Sales"],
    ["md ui", "MD UI"],
    ["annual report", "Annual Report"],
    ["941", "Form 941"],
  ];
  for (const [keyword, tab] of KEYWORD_TABS) {
    if (haystack.includes(keyword)) return tab;
  }
  return null;
}
