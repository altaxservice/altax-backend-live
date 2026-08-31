/**
 * Identifies whether a task represents one of the 5 obligation-workflow
 * types (EFTPS, MD Sales Tax, MD UI, MD Annual Report, Form 941) and, if so,
 * which Accounting tab actually finishes it. These strings must stay in sync
 * with each module's own TASK_NAME constant matched by closeTaskRulesAgentTask
 * (src/common/taskRulesAgentBridge.ts) / closeEftpsStaffTask
 * (src/modules/eftpsDeposits/eftpsStaffTasks.ts) when a real filing closes
 * the task — this is deliberately the same matching key, not a new one.
 */
export function obligationAccountingTab(task: { task_name?: string | null; source_system?: string | null }): string | null {
  // EFTPS's daily-sweep task is generated outside the Task Rules pipeline
  // entirely (ensureEftpsStaffTasks), so it's identified by source_system
  // rather than an exact task_name match like the other 4.
  if (task.source_system === "EftpsDepositTask") return "EFTPS Deposits";

  const name = (task.task_name || "").trim().toLowerCase();
  const OBLIGATION_TASK_TABS: Record<string, string> = {
    "sales tax filing & payment": "Sales",
    "md ui wages filing & payment": "MD UI",
    "md annual report filing & payment": "Annual Report",
    "form 941 filing": "Form 941",
  };
  return OBLIGATION_TASK_TABS[name] || null;
}
