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
import { query, queryOne } from "../config/db";

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

/**
 * Closes any open task for this client that represents the given obligation
 * type and period, however that task was actually created — an exact
 * task_name/source_system match (closeTaskRulesAgentTask above,
 * closeEftpsStaffTask) only catches tasks the Task Rules Agent's own batch
 * generator or daily sweep created. A real task made through "New Work Item"
 * or a batch with a slightly different label ("EFTPS Deposit" instead of
 * "EFTPS Deposit Due — August 2026", "MD UI Wages Filing" instead of "MD UI
 * Wages Filing & Payment") never matched — confirmed live, staff had to
 * close those by hand after already recording the filing, exactly the
 * double-step this exists to remove.
 *
 * Matches on two independent signals, either one sufficient: a keyword
 * search across task_name/service_line (same keyword set the frontend's
 * obligationAccountingTab uses for the "Finish in Accounting" button, so a
 * task that offers that button is guaranteed to be one this can close),
 * combined with EITHER the period's real statutory due date (a precise
 * value every mark-filed route computes the same way) OR the task's own
 * free-text period label — checked independently rather than the label
 * only being a fallback for a null due date, because a manually-created
 * task's due date is sometimes hand-typed and doesn't land on the exact
 * date the app would compute (confirmed live: a real task's due date was 2
 * days off the statutory rule), which would otherwise leave it unclosed
 * even though its period label ("August 2026") was an exact match.
 */
export async function closeObligationTask(params: {
  clientId: string;
  keyword: string;
  dueDate: string;
  periodLabel?: string | null;
  filedDate: string;
  paidDate?: string | null;
}): Promise<void> {
  await query(
    `UPDATE altax.v3_tasks
        SET status = 'Completed', filed_date = $5::date, paid_date = $6::date, updated_at = now()
      WHERE client_id = $1
        AND (lower(task_name) LIKE '%' || lower($2) || '%' OR lower(coalesce(service_line, '')) LIKE '%' || lower($2) || '%')
        AND lower(status) NOT IN ('completed', 'closed', 'archived', 'void')
        AND (
          agency_due_date = $3::date
          OR ($4::text IS NOT NULL AND lower(coalesce(period, '')) = lower($4))
        )`,
    [params.clientId, params.keyword, params.dueDate, params.periodLabel ?? null, params.filedDate, params.paidDate ?? null]
  );
}

/**
 * Fills in paid_date on a task closeObligationTask already completed at
 * filing time with paidDate still unknown — every "mark filed" route accepts
 * filing and payment as independent facts (deliberate: staff often file
 * before payment clears), which means closeObligationTask runs once with
 * paidDate: null and flips status to 'Completed' — and its own WHERE clause
 * then excludes that task from ever matching again (status already
 * 'completed'), so the later "record payment" step in every obligation
 * module (EFTPS, MD Sales Tax, Form 941, MD UI, Annual Report) was updating
 * only its own filing table and never reaching the task at all. Confirmed
 * live: a client's EFTPS deposit was filed and paid in full, yet its
 * "Agency Past Due" flag never cleared — that flag reads directly off
 * v3_tasks.paid_date (computeClientFlags, clients.routes.ts), ignoring
 * status entirely, so a "Completed" task with a still-null paid_date stays
 * flagged forever. This matches the same task by the same keyword/due-date/
 * period-label signals, WITHOUT the status exclusion (status was already
 * set correctly by closeObligationTask and isn't touched again here) —
 * gated only on paid_date still being null, so it's safe to call
 * unconditionally every time a payment is recorded.
 */
export async function markObligationTaskPaid(params: {
  clientId: string;
  keyword: string;
  dueDate: string;
  periodLabel?: string | null;
  paidDate: string;
}): Promise<void> {
  await query(
    `UPDATE altax.v3_tasks
        SET paid_date = $5::date, updated_at = now()
      WHERE client_id = $1
        AND (lower(task_name) LIKE '%' || lower($2) || '%' OR lower(coalesce(service_line, '')) LIKE '%' || lower($2) || '%')
        AND lower(status) NOT IN ('void')
        AND paid_date IS NULL
        AND (
          agency_due_date = $3::date
          OR ($4::text IS NOT NULL AND lower(coalesce(period, '')) = lower($4))
        )`,
    [params.clientId, params.keyword, params.dueDate, params.periodLabel ?? null, params.paidDate]
  );
}

/**
 * A DATE column comes back from `SELECT *` as a JS Date, not a string — same
 * gotcha documented in fixedAssets.routes.ts's isoDateOnly and
 * filingConfirmationEmail.ts's fmtDate. Duplicated here (not imported) since
 * this file has no other dependency on either of those modules and the
 * helper is three lines.
 */
function isoDateOnly(v: string | Date | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

const EVIDENCE_TABLES: Record<string, { table: string; filedCol: string; paidCol: string }> = {
  "sales tax": { table: "v3_md_filing_payments", filedCol: "filed_date", paidCol: "paid_date" },
  "form 941": { table: "v3_form941_filings", filedCol: "filed_date", paidCol: "paid_date" },
  "md ui": { table: "v3_md_ui_filings", filedCol: "filed_date", paidCol: "paid_date" },
  "annual report": { table: "v3_annual_report_filings", filedCol: "filed_date", paidCol: "paid_date" },
};

/**
 * Real filing evidence for a client+period, independent of whether a v3_tasks
 * row exists at all — the piece that was missing from runRuleBatch's own
 * duplicate check (rules.routes.ts), which only ever asked "does a v3_tasks
 * row already exist," never "was this period actually already filed."
 * Confirmed live: a client's Sales Tax period was marked filed at 5:27 PM,
 * but the Task Rules batch didn't create that period's task until 6:23 PM —
 * closeObligationTask had nothing to close at filing time, and nothing ever
 * revisited that exact period again, leaving the task permanently stuck at
 * "Not Started" despite being genuinely filed and paid weeks earlier.
 *
 * `keyword` is the same lowercase substring closeObligationTask/
 * markObligationTaskPaid already key off ("sales tax", "form 941", "md ui",
 * "annual report") — MD Withholding has no dedicated filing table (still
 * task-matching only, per the earlier compliance-timeline audit) and isn't
 * in this map, so it's unaffected by this check, same as today.
 */
export async function findRealFilingEvidence(
  clientId: string, taskTypeOrKeyword: string, periodLabel: string
): Promise<{ filedDate: string; paidDate: string | null } | null> {
  // Accepts either a bare keyword ("sales tax") or a full task_type string
  // ("Sales Tax Filing & Payment") — substring match, same semantics
  // closeObligationTask already uses matching the other direction (keyword
  // found inside task_name).
  const lower = taskTypeOrKeyword.toLowerCase().trim();
  const matchedKey = Object.keys(EVIDENCE_TABLES).find((k) => lower.includes(k));
  const cfg = matchedKey ? EVIDENCE_TABLES[matchedKey] : undefined;
  if (!cfg) return null;

  const periodMatch = /^\d{4}$/.test(periodLabel)
    ? `EXTRACT(YEAR FROM period_start)::text = $2`
    : /^Q[1-4] \d{4}$/.test(periodLabel)
    ? `('Q' || (((EXTRACT(MONTH FROM period_start)::int - 1) / 3) + 1) || ' ' || EXTRACT(YEAR FROM period_start)::int) = $2`
    : `TO_CHAR(period_start, 'FMMonth YYYY') = $2`;

  const row = await queryOne<any>(
    `SELECT ${cfg.filedCol} AS filed_date, ${cfg.paidCol} AS paid_date FROM altax.${cfg.table}
      WHERE client_id = $1 AND ${periodMatch}`,
    [clientId, periodLabel]
  );
  if (!row || !row.filed_date) return null;
  return { filedDate: isoDateOnly(row.filed_date)!, paidDate: isoDateOnly(row.paid_date) };
}

/**
 * Runs daily. Catches the one case runRuleBatch's own creation-time check
 * can't reach: a task that was already orphaned (open, but the period was
 * actually already filed) before this fix existed, or any future edge case
 * that slips past it — periods don't repeat, so no later batch run ever
 * revisits that exact client+period again to notice on its own. Matches on
 * the task's own stored agency_due_date (a guaranteed self-match, no
 * ambiguity about which period it is) and reuses the existing
 * closeObligationTask rather than duplicating its UPDATE.
 */
export async function healOrphanedObligationTasks(): Promise<{ healed: number }> {
  const keywords = Object.keys(EVIDENCE_TABLES);
  const openTasks = await query<any>(
    `SELECT task_id, client_id, task_name, period, agency_due_date FROM altax.v3_tasks
      WHERE lower(status) NOT IN ('completed','closed','archived','void')
        AND (${keywords.map((_, i) => `lower(task_name) LIKE '%' || $${i + 1} || '%'`).join(" OR ")})`,
    keywords
  );

  let healed = 0;
  for (const task of openTasks) {
    const taskNameLower = String(task.task_name || "").toLowerCase();
    const matchedKeyword = keywords.find((k) => taskNameLower.includes(k));
    const periodLabel = String(task.period || "").trim();
    if (!matchedKeyword || !periodLabel) continue;

    const evidence = await findRealFilingEvidence(task.client_id, matchedKeyword, periodLabel);
    if (!evidence) continue;

    const dueDate = isoDateOnly(task.agency_due_date) || evidence.filedDate;
    await closeObligationTask({
      clientId: task.client_id, keyword: matchedKeyword, dueDate,
      periodLabel, filedDate: evidence.filedDate, paidDate: evidence.paidDate,
    });
    healed++;
  }
  return { healed };
}
