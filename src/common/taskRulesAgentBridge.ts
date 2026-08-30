/**
 * Closes a real Task-Rules-Agent-generated v3_tasks row once the obligation
 * it represents is genuinely filed — shared by every "obligation module"
 * (MD Sales Tax, Annual Report, MD UI, ...) that has its own dedicated
 * filing-record table but still gets its task drafted through the generic
 * v3_task_rules → v3_task_batch_drafts → v3_tasks pipeline (rules.routes.ts).
 *
 * Extracted from MD Sales Tax's Phase 1 implementation (closeSalesTaxTask),
 * generalized to any task_name/frequency rather than being hardcoded to
 * "Sales Tax Filing & Payment". Reuses runRuleBatch's own
 * client_id+task_name+period idempotency key (rules.routes.ts) rather than
 * source_system/source_record_id — those are set to the batch's own ID,
 * shared across every client in the batch, not a per-client-period key, so
 * they can't be used to look up "the task for this client+period."
 */
import { query } from "../config/db";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Derives the same period-label format the Task Rules Agent's own
 * computeDuePeriod (rules.routes.ts) uses — "August 2026" (Monthly),
 * "Q3 2026" (Quarterly), "2026" (Annual) — directly from a period's actual
 * start date rather than re-deriving it from "today", since this is always
 * called with the specific period just filed. Null for Semiannual/unset
 * frequency (no active rule uses Semiannual today) or an unparseable date.
 */
export function deriveTaskRulesPeriodLabel(periodStart: string, frequency: string | null | undefined): string | null {
  const freq = String(frequency || "").trim().toLowerCase();
  const d = new Date(`${periodStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (freq === "monthly") return `${MONTH_NAMES[m]} ${y}`;
  if (freq === "quarterly") return `Q${Math.floor(m / 3) + 1} ${y}`;
  if (freq === "annual") return `${y}`;
  return null;
}

/** A safe no-op when no matching task exists (filed manually without ever going through the Agent, or already closed). */
export async function closeTaskRulesAgentTask(clientId: string, taskName: string, periodLabel: string | null): Promise<void> {
  if (!periodLabel) return;
  await query(
    `UPDATE altax.v3_tasks SET status = 'Completed', updated_at = now()
      WHERE client_id = $1 AND lower(task_name) = lower($2)
        AND lower(coalesce(period,'')) = lower($3)
        AND lower(status) NOT IN ('completed','closed','archived','void')`,
    [clientId, taskName, periodLabel]
  );
}
