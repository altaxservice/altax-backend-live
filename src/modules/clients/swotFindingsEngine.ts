/**
 * Deterministic, rule-based SWOT/advisory findings — every candidate traces
 * to a real number already assembled by the caller (see assembleSwotEngineInput
 * in clients.routes.ts). Matches this codebase's established "no external
 * AI, in-app deterministic automation" choice (Payroll Agent, Bank Rec
 * Agent, Task Rules Agent all made the same call) — this is template
 * sentences over computed numbers, not a model call.
 *
 * Deliberately a pure function with no DB access of its own: the caller
 * assembles a fully-resolved SwotEngineInput first, so this file can be
 * imported by both clients.routes.ts and reports.routes.ts without risking
 * a circular import between them.
 *
 * Every candidate carries a stable autoTriggerKey identifying WHICH
 * condition produced it — used both for dedup (a fresh generate run won't
 * create a second open row for the same condition) and, from Phase 3
 * onward, for auto-resolving a finding once its underlying condition
 * clears. Category is one of the 4 classic SWOT buckets, or "Recommendation"
 * for standalone strategic guidance not tied to a single S/W/O/T item (each
 * S/W/O/T row already carries its own recommendedAction, so this category
 * is reserved for broader calls like a growth plan — this keeps one issue
 * from producing two near-duplicate rows).
 */

import { computeScorpElectionStatus } from "../../common/scorpElection";

export interface CandidateFinding {
  category: "Strength" | "Weakness" | "Opportunity" | "Threat" | "Recommendation";
  subcategory?: "Tax" | "Staffing" | "Marketing" | "Growth" | "CostReduction" | "RevenueGrowth" | "CashFlow" | "Compliance";
  findingText: string;
  supportingData: string;
  businessImpact: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  recommendedAction: string;
  dataType: "Fact" | "Estimate" | "Assumption" | "Recommendation";
  autoTriggerKey: string;
}

export interface SwotEngineInput {
  clientId: string;
  industryCategory: string | null;
  yearsInBusiness: number | null;
  // Added for the S-Corp election deadline rule below — see
  // src/common/scorpElection.ts for the actual IRS-rule math.
  entityType: string | null;
  dateOfFormation: string | null;
  has2553Filing: boolean;
  currentServiceLabels: string[];
  serviceGaps: { key: string; label: string }[];
  clientTypeIsIndividual: boolean;

  revenue: number;
  profit: number;
  trendPct: number | null;
  startedFromZero: boolean;

  openTasks: number;
  balanceDue: number;
  overdueInvoices: { invoiceId: string; balanceDue: number; daysOverdue: number }[];

  taxLiabilities: number;

  cashBalance: number;

  mdFilingOnTime: boolean | null; // null = not an MD client, or no period in range
  mdLatePeriodEnds: string[]; // period end dates (YYYY-MM-DD) currently showing late
  // Current (most recent) filing period's own due date/tax due — separate
  // from mdLatePeriodEnds because this drives the *upcoming* (not yet late)
  // deadline warning below, not a past-due one.
  mdCurrentPeriodDueDate: string | null;
  mdCurrentPeriodTaxDue: number;
  mdCurrentPeriodOnTime: boolean | null;

  // Upcoming deadlines beyond MD Sales Tax (which keeps its own dedicated rule
  // above — Form 202 is the only one of these with real discount/penalty/
  // interest math behind it). EFTPS, MD Withholding, MD UI, and Business Tax
  // Return all come from the same computeUpcomingDeadlines() engine that feeds
  // the dashboard's Upcoming Deadlines card (complianceCalendar.ts), so the
  // finding and the dashboard never quietly disagree on a due date.
  upcomingObligationDeadlines: { label: string; date: string; source: string }[];

  budgetVariances: { accountName: string; accountType: "Income" | "COGS" | "Expense"; budget: number; actual: number; variance: number; periodLabel: string }[];

  payrollThisMonthCost: number;
  payrollLastMonthCost: number;
  payrollPeriodLabel: string;

  // Admin-configurable (v3_dashboard_alert_settings) — read once by the
  // caller and threaded through here so this stays a pure function with no
  // DB access of its own. Also what separates "worth a finding" from
  // "worth paging someone" (Urgent priority) for overdue AR and an
  // upcoming filing deadline.
  alertThresholds: { cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number };
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00`).getTime() - new Date(`${fromIso}T00:00:00`).getTime()) / 86400000);
}

function fmtMoney(v: number): string {
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function overduePriority(days: number, urgentThreshold: number): "Low" | "Medium" | "High" | "Urgent" {
  if (days > urgentThreshold) return "Urgent";
  if (days > 60) return "High";
  if (days > 30) return "Medium";
  return "Low";
}

export function computeSwotFindings(input: SwotEngineInput): CandidateFinding[] {
  const findings: CandidateFinding[] = [];

  // --- Revenue trend ---
  if (input.startedFromZero) {
    findings.push({
      category: "Strength", findingText: "Revenue activity began partway through the last 6 months.",
      supportingData: "No prior-period baseline exists yet to compare against.",
      businessImpact: "Too early to assess a trend — worth revisiting next period.",
      priority: "Low", recommendedAction: "Re-run this analysis once a full comparable period exists.",
      dataType: "Fact", autoTriggerKey: "revenue_started_from_zero",
    });
  } else if (input.trendPct !== null && input.trendPct >= 10) {
    findings.push({
      category: "Strength", findingText: `Revenue trended up ${input.trendPct}% over the last 6 months.`,
      supportingData: `6-month revenue trend: +${input.trendPct}%.`,
      businessImpact: "Growing top line — a good position to invest from.",
      priority: "Low", recommendedAction: "Consider whether this is a good time to expand services or capacity.",
      dataType: "Fact", autoTriggerKey: "revenue_growth",
    });
  } else if (input.trendPct !== null && input.trendPct <= -10) {
    findings.push({
      category: "Weakness", findingText: `Revenue trended down ${Math.abs(input.trendPct)}% over the last 6 months.`,
      supportingData: `6-month revenue trend: ${input.trendPct}%.`,
      businessImpact: "A declining top line puts pressure on margin and cash flow if it continues.",
      priority: "High", recommendedAction: "Review pricing and cost structure; investigate the cause before it compounds.",
      dataType: "Fact", autoTriggerKey: "revenue_decline",
    });
  }

  // --- Profit margin ---
  if (input.revenue > 0) {
    const margin = input.profit / input.revenue;
    if (margin >= 0.15) {
      findings.push({
        category: "Strength", findingText: `Healthy net margin of ${Math.round(margin * 100)}% over the last 6 months.`,
        supportingData: `Net profit ${fmtMoney(input.profit)} on revenue ${fmtMoney(input.revenue)}.`,
        businessImpact: "Strong profitability supports reinvestment or a cash reserve.",
        priority: "Low", recommendedAction: "Maintain current cost discipline.",
        dataType: "Fact", autoTriggerKey: "healthy_margin",
      });
    } else if (input.profit < 0) {
      findings.push({
        category: "Weakness", findingText: `Net loss of ${fmtMoney(Math.abs(input.profit))} over the last 6 months.`,
        supportingData: `Revenue ${fmtMoney(input.revenue)}, net result ${fmtMoney(input.profit)}.`,
        businessImpact: "Sustained losses erode cash reserves and borrowing capacity.",
        priority: "Urgent", recommendedAction: "Review pricing, cost structure, and non-essential spending immediately.",
        dataType: "Fact", autoTriggerKey: "net_loss",
      });
    } else if (margin < 0.05) {
      findings.push({
        category: "Weakness", findingText: `Thin net margin of ${Math.round(margin * 100)}% over the last 6 months.`,
        supportingData: `Net profit ${fmtMoney(input.profit)} on revenue ${fmtMoney(input.revenue)}.`,
        businessImpact: "Little buffer against a slow month or unexpected cost.",
        priority: "High", recommendedAction: "Identify the largest expense categories and look for savings.",
        dataType: "Fact", autoTriggerKey: "thin_margin",
      });
    }
  }

  // --- Open tasks ---
  if (input.openTasks === 0) {
    findings.push({
      category: "Strength", findingText: "No overdue tasks — operations are current.",
      supportingData: "0 open tasks as of today.", businessImpact: "Nothing is being missed on the compliance/ops side.",
      priority: "Low", recommendedAction: "Maintain the current review cadence.",
      dataType: "Fact", autoTriggerKey: "tasks_current",
    });
  } else {
    findings.push({
      category: "Weakness", findingText: `${input.openTasks} open task${input.openTasks === 1 ? "" : "s"} as of today.`,
      supportingData: `${input.openTasks} open task${input.openTasks === 1 ? "" : "s"}.`,
      businessImpact: "Open items risk turning into missed deadlines or client dissatisfaction.",
      priority: input.openTasks >= 4 ? "High" : "Medium", recommendedAction: "Review and clear the open task list.",
      dataType: "Fact", autoTriggerKey: "open_tasks_backlog",
    });
  }

  // --- Balance due (aggregate — only when nothing is individually overdue) ---
  if (input.balanceDue <= 0) {
    findings.push({
      category: "Strength", findingText: "No outstanding balance — account is current on billing.",
      supportingData: "Balance due: $0.00.", businessImpact: "No collection risk from this client.",
      priority: "Low", recommendedAction: "No action needed.",
      dataType: "Fact", autoTriggerKey: "ar_current",
    });
  }

  // --- Per-invoice overdue AR ---
  for (const inv of input.overdueInvoices) {
    findings.push({
      category: "Threat", findingText: `Invoice ${inv.invoiceId} is ${inv.daysOverdue} days past due.`,
      supportingData: `Balance due ${fmtMoney(inv.balanceDue)}, ${inv.daysOverdue} days overdue.`,
      businessImpact: "Uncollected receivables directly reduce available cash.",
      priority: overduePriority(inv.daysOverdue, input.alertThresholds.overdueDaysThreshold),
      recommendedAction: inv.daysOverdue > input.alertThresholds.overdueDaysThreshold ? "Escalate collection — consider a firm deadline or stopping further work until paid." : "Send a payment reminder.",
      dataType: "Fact", autoTriggerKey: `overdue_ar:${inv.invoiceId}`,
    });
  }

  // --- Tax liabilities ---
  if (input.taxLiabilities > 0) {
    findings.push({
      category: "Threat", findingText: `Outstanding tax liability of ${fmtMoney(input.taxLiabilities)} on the books.`,
      supportingData: `Sales/payroll tax payable balance: ${fmtMoney(input.taxLiabilities)}.`,
      businessImpact: "Unpaid tax liability accrues penalty and interest the longer it sits.",
      priority: "High", recommendedAction: `Prioritize the ${fmtMoney(input.taxLiabilities)} outstanding tax liability before its due date to avoid additional penalty and interest.`,
      dataType: "Fact", autoTriggerKey: "tax_liability_outstanding",
    });
  }

  // --- MD sales tax filing ---
  if (input.mdFilingOnTime === true) {
    findings.push({
      category: "Strength", findingText: "Sales tax filings are on time for the period(s) reviewed.",
      supportingData: "No late Maryland sales tax filing periods in the current window.",
      businessImpact: "Avoids late-filing penalty and interest.",
      priority: "Low", recommendedAction: "Keep the current filing schedule.",
      dataType: "Fact", autoTriggerKey: "md_filing_on_time",
    });
  } else if (input.mdFilingOnTime === false) {
    for (const periodEnd of input.mdLatePeriodEnds) {
      findings.push({
        category: "Weakness", findingText: `Sales tax filing for the period ending ${periodEnd} currently shows as late.`,
        supportingData: `Maryland sales tax period ending ${periodEnd} is past its due date.`,
        businessImpact: "The 10% late penalty plus monthly interest adds up fast on a missed filing.",
        priority: "High", recommendedAction: "File and pay as soon as possible; set a recurring reminder ahead of each due date going forward.",
        dataType: "Fact", autoTriggerKey: `md_filing_late:${periodEnd}`,
      });
    }
  }

  // --- Upcoming (not yet late) filing deadline ---
  // Distinct from the late-filing rule above: this fires while there's
  // still time to act. Urgent once inside alertThresholds.filingDeadlineDaysThreshold
  // (the push-worthy window), High out to 14 days (dashboard-visible only).
  if (input.mdCurrentPeriodOnTime !== false && input.mdCurrentPeriodDueDate && input.mdCurrentPeriodTaxDue > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const daysUntilDue = daysBetween(today, input.mdCurrentPeriodDueDate);
    if (daysUntilDue >= 0 && daysUntilDue <= 14) {
      findings.push({
        category: "Weakness",
        findingText: `Sales tax filing for the period ending ${input.mdCurrentPeriodDueDate} is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"}.`,
        supportingData: `Tax due ${fmtMoney(input.mdCurrentPeriodTaxDue)}, due date ${input.mdCurrentPeriodDueDate}.`,
        businessImpact: "Missing the deadline triggers the 10% late penalty plus monthly interest.",
        priority: daysUntilDue <= input.alertThresholds.filingDeadlineDaysThreshold ? "Urgent" : "High",
        recommendedAction: "File and pay before the due date to avoid penalty and interest.",
        dataType: "Fact", autoTriggerKey: `filing_deadline_soon:${input.mdCurrentPeriodDueDate}`,
      });
    }
  }

  // --- Upcoming obligation deadlines (EFTPS, MD Withholding, MD UI, Business Tax Return) ---
  // Same window/urgency logic as the MD Sales Tax rule above, generalized
  // across every other obligation computeUpcomingDeadlines() knows about via
  // v3_clients' eftps_enabled/md_withholding_frequency/mdui_enabled/
  // business_return_type. Each source gets its own auto_trigger_key prefix so
  // they dedup and auto-resolve independently of each other and of MD Sales Tax.
  {
    const OBLIGATION_KEY_PREFIX: Record<string, string> = {
      EFTPS: "eftps", "MD Withholding": "mdwh", "MD UI": "mdui", "Business Tax Return": "bustax",
    };
    const today = new Date().toISOString().slice(0, 10);
    for (const d of input.upcomingObligationDeadlines) {
      const prefix = OBLIGATION_KEY_PREFIX[d.source];
      if (!prefix) continue;
      const daysUntilDue = daysBetween(today, d.date);
      if (daysUntilDue < 0 || daysUntilDue > 14) continue;
      findings.push({
        category: "Weakness", subcategory: "Compliance",
        findingText: `${d.label} is due in ${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} (${d.date}).`,
        supportingData: `${d.label}, due date ${d.date}.`,
        businessImpact: "Missing this deadline risks late-filing penalties and interest with the relevant agency.",
        priority: daysUntilDue <= input.alertThresholds.filingDeadlineDaysThreshold ? "Urgent" : "High",
        recommendedAction: "File and pay before the due date to avoid penalty and interest.",
        dataType: "Fact", autoTriggerKey: `filing_deadline_soon:${prefix}:${d.date}`,
      });
    }
  }

  // --- Form 2553 (S-Corp election) deadline ---
  // computeScorpElectionStatus already returns null for anything not
  // actionable (wrong entity type, no formation date, or a 2553 already on
  // file) — this block only has to decide priority and whether it's still
  // worth a finding at all. autoTriggerKey is keyed to the deadline date
  // itself, not just the client, so a formation-date correction produces a
  // fresh finding instead of silently keeping a stale one open.
  {
    const scorp = computeScorpElectionStatus(input.entityType, input.dateOfFormation, input.has2553Filing);
    if (scorp && !scorp.pastDeadline) {
      const urgent = scorp.daysUntilDeadline <= 14;
      findings.push({
        category: "Threat", subcategory: "Tax",
        findingText: `S-Corp election (Form 2553) deadline is ${scorp.deadline} — ${scorp.daysUntilDeadline} day${scorp.daysUntilDeadline === 1 ? "" : "s"} away.`,
        supportingData: `Entity type: ${input.entityType}. Formed ${input.dateOfFormation}. Deadline = 2 months 15 days after formation, per Form 2553 instructions. No 2553 on file for this client.`,
        businessImpact: "Missing this deadline means the entity is taxed under its default classification for the entire tax year — often a real self-employment-tax cost, not just a paperwork delay.",
        priority: urgent ? "Urgent" : "High",
        recommendedAction: "Confirm with the client whether S-Corp election is wanted, and file Form 2553 before the deadline if so.",
        dataType: "Fact", autoTriggerKey: `scorp_election_deadline:${scorp.deadline}`,
      });
    } else if (scorp && scorp.pastDeadline && scorp.lateReliefAvailable) {
      findings.push({
        category: "Threat", subcategory: "Tax",
        findingText: `S-Corp election (Form 2553) deadline of ${scorp.deadline} has passed, but late-election relief is still available until ${scorp.lateReliefDeadline}.`,
        supportingData: `Entity type: ${input.entityType}. Formed ${input.dateOfFormation}. Rev. Proc. 2013-30 allows late relief within 3 years and 75 days of the intended effective date, subject to reasonable-cause and other conditions.`,
        businessImpact: "The standard election window is closed, but the entity can likely still elect S-Corp treatment retroactively if relief is requested before the window above closes.",
        priority: "High",
        recommendedAction: "Discuss late-election relief with the client and file Form 2553 with the required reasonable-cause statement if they want to proceed.",
        dataType: "Fact", autoTriggerKey: `scorp_election_late_relief:${scorp.lateReliefDeadline}`,
      });
    }
  }

  // --- Service enrollment gaps ---
  if (input.serviceGaps.length > 0) {
    findings.push({
      category: "Opportunity",
      findingText: `Not currently enrolled in: ${input.serviceGaps.map((g) => g.label).join(", ")}.`,
      supportingData: `Current services: ${input.currentServiceLabels.join(", ") || "none on file"}.`,
      businessImpact: "Potential to expand the engagement and better serve the client.",
      priority: "Low", recommendedAction: "Raise these services in the next client conversation.",
      dataType: "Recommendation", autoTriggerKey: "service_gaps",
    });
  }

  // --- Cash balance ---
  if (input.cashBalance < input.alertThresholds.cashThreshold) {
    findings.push({
      category: "Threat", findingText: `Estimated cash balance (${fmtMoney(input.cashBalance)}) is below the ${fmtMoney(input.alertThresholds.cashThreshold)} threshold.`,
      supportingData: `Estimated from recorded ledger activity on Bank/Cash-tagged accounts: ${fmtMoney(input.cashBalance)}.`,
      businessImpact: "A low cash position risks missed payments (payroll, vendors, taxes) if it isn't addressed.",
      priority: "Urgent", recommendedAction: "Review upcoming receipts and payments; consider a short-term cash-flow plan.",
      dataType: "Estimate", autoTriggerKey: "cash_balance_negative",
    });
  }

  // --- Budget variance (current month, meaningful variances only) ---
  for (const bv of input.budgetVariances) {
    if (bv.budget === 0) continue;
    const pctOver = bv.variance / bv.budget;
    const isExpenseType = bv.accountType === "Expense" || bv.accountType === "COGS";
    const meaningfullyOver = isExpenseType && bv.variance > 0 && Math.abs(pctOver) >= 0.15 && Math.abs(bv.variance) >= 50;
    const meaningfullyUnder = bv.accountType === "Income" && bv.variance < 0 && Math.abs(pctOver) >= 0.15 && Math.abs(bv.variance) >= 50;
    if (!meaningfullyOver && !meaningfullyUnder) continue;
    findings.push({
      category: "Weakness",
      findingText: isExpenseType
        ? `${bv.accountName} is ${fmtMoney(bv.variance)} over budget for ${bv.periodLabel}.`
        : `${bv.accountName} is ${fmtMoney(Math.abs(bv.variance))} under budget for ${bv.periodLabel}.`,
      supportingData: `Budget ${fmtMoney(bv.budget)}, actual ${fmtMoney(bv.actual)}, variance ${bv.variance > 0 ? "+" : ""}${fmtMoney(bv.variance)}.`,
      businessImpact: isExpenseType ? "Overspending in this category erodes margin if it continues." : "A revenue shortfall against plan affects overall cash flow.",
      priority: "Medium", recommendedAction: isExpenseType ? "Review recent transactions in this category for anything unplanned." : "Investigate why revenue in this category is behind plan.",
      dataType: "Fact", autoTriggerKey: `budget_variance:${bv.accountName}:${bv.periodLabel}`,
    });
  }

  // --- Payroll cost spike ---
  if (input.payrollLastMonthCost > 0) {
    const change = (input.payrollThisMonthCost - input.payrollLastMonthCost) / input.payrollLastMonthCost;
    if (change >= 0.2) {
      findings.push({
        category: "Weakness", findingText: `Payroll cost is up ${Math.round(change * 100)}% from last month.`,
        supportingData: `This month: ${fmtMoney(input.payrollThisMonthCost)}; last month: ${fmtMoney(input.payrollLastMonthCost)}.`,
        businessImpact: "A payroll cost spike compresses margin if it isn't matched by revenue growth.",
        priority: "Medium", recommendedAction: "Confirm the increase was planned (new hire, overtime, raise) and expected to continue.",
        dataType: "Fact", autoTriggerKey: `payroll_cost_spike:${input.payrollPeriodLabel}`,
      });
    }
  }

  // --- Standalone growth-plan recommendation ---
  if (input.trendPct !== null && input.trendPct >= 10) {
    findings.push({
      category: "Recommendation", subcategory: "Growth",
      findingText: `Revenue is trending up${input.serviceGaps.length ? ` — consider expanding into ${input.serviceGaps[0].label}` : ""}.`,
      supportingData: `6-month revenue trend: +${input.trendPct}%.`,
      businessImpact: "Growth momentum is a good time to invest in expansion.",
      priority: "Low", recommendedAction: "Discuss expansion options at the next client meeting.",
      dataType: "Recommendation", autoTriggerKey: "growth_plan",
    });
  } else if (input.trendPct !== null && input.trendPct <= -10) {
    findings.push({
      category: "Recommendation", subcategory: "Growth",
      findingText: "Revenue is trending down — review pricing and cost structure, and clear outstanding tax liability first to protect margin.",
      supportingData: `6-month revenue trend: ${input.trendPct}%.`,
      businessImpact: "Protects remaining margin while the underlying cause is addressed.",
      priority: "High", recommendedAction: "Prioritize outstanding tax items, then review pricing and costs.",
      dataType: "Recommendation", autoTriggerKey: "growth_plan",
    });
  }

  return findings;
}

/**
 * Groups the structured candidates back into the 6 legacy paragraph fields
 * computeSwotAutoDraft has always returned, so the existing "Auto-Fill from
 * Business Data" button keeps working exactly as it did before this engine
 * existed — zero behavior change there.
 */
export function groupFindingsToLegacyFields(findings: CandidateFinding[]): {
  overview: string; strengths: string; weaknesses: string; opportunities: string; threats: string;
  taxRecommendations: string; growthRecommendations: string;
} {
  const byCategory = (cat: CandidateFinding["category"]) => findings.filter((f) => f.category === cat).map((f) => f.findingText).join(" ");
  const taxRecommendations = findings.filter((f) => f.autoTriggerKey === "tax_liability_outstanding" || f.autoTriggerKey.startsWith("md_filing_late")).map((f) => f.recommendedAction).join(" ");
  const growthRecommendations = findings.filter((f) => f.autoTriggerKey === "growth_plan").map((f) => f.findingText).join(" ");
  return {
    overview: "",
    strengths: byCategory("Strength"),
    weaknesses: byCategory("Weakness"),
    opportunities: byCategory("Opportunity"),
    threats: byCategory("Threat"),
    taxRecommendations,
    growthRecommendations,
  };
}
