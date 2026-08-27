/**
 * Public, no-login lead capture for the website tools (Business Health Check,
 * Entity Comparison, Document Checklist, and the Paycheck Calculator). Most
 * calculation/scoring happens client-side in the tool pages themselves — the
 * /lead endpoint only fires when a visitor opts to get an emailed result, a
 * personalized action plan, or a follow-up, i.e. when they're actively
 * asking to be contacted. /paycheck-calculator (added 2026-08-27) is the one
 * exception: it's a real, stateless calculation call, not a lead — it exists
 * so the public site reuses the SAME tested federal/state withholding
 * bracket tables the firm's actual payroll processing uses
 * (src/common/withholdingTables.ts), instead of a second, drift-prone copy
 * hand-written in client-side JS. That file has zero imports of its own — no
 * DB access at all — so pulling it in here doesn't touch the hard rule below.
 *
 * HARD RULE: this file — and everything else under src/modules/publicTools —
 * must only ever import ../../config/publicToolsDb, never ../../config/db.
 * That's what makes the isolation from client data real: the database role
 * behind publicToolsDb has zero grants on the altax schema, so even a bug
 * here cannot reach client records. Do not "temporarily" import the main
 * pool to look something up — if a lookup against altax.* is ever genuinely
 * needed, it belongs in the authenticated app, not here.
 *
 * Admin notification uses a fixed env var (PUBLIC_TOOLS_NOTIFY_EMAIL) rather
 * than querying altax.v3_users for admin addresses, for the same reason —
 * that table lives in the walled-off schema this module cannot touch.
 */
import { Router, Request, Response } from "express";
import { publicToolsQueryOne } from "../../config/publicToolsDb";
import { asyncHandler } from "../../common/asyncHandler";
import { sendEmail, NotConfiguredError } from "../../common/notifications";
import { rateLimit } from "../../common/rateLimit";
import { escapeHtml } from "../../common/html";
import {
  calculateFederalWithholding, calculateMarylandWithholding, calculateVirginiaWithholding,
  calculateDcWithholding, calculateDelawareWithholding, PAY_FREQUENCIES, MD_COUNTIES,
  type PayFrequency,
} from "../../common/withholdingTables";

export const publicToolsRouter = Router();

const TOOL_NAMES = new Set(["business-health-check", "entity-comparison", "document-checklist", "paycheck-calculator"]);

const toolsLeadLimiter = rateLimit({ name: "public-tools-lead", windowMs: 15 * 60 * 1000, max: 15 });

publicToolsRouter.post("/lead", toolsLeadLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { toolName, name, email, phone, payload, website } = req.body || {};

  // Honeypot — same convention as the contact form (common/publicContact.routes.ts):
  // "website" is a hidden field no real visitor can see or fill in.
  if (website) {
    return res.json({ ok: true });
  }

  if (typeof toolName !== "string" || !TOOL_NAMES.has(toolName)) {
    return res.status(400).json({ error: "Unknown tool." });
  }
  if (!email) {
    return res.status(400).json({ error: "An email address is required." });
  }
  // payload is intentionally unrestricted in shape (each tool's own answers/scores),
  // but must never contain anything resembling SSN/EIN/bank/account data — that
  // rule is enforced by what the tool pages are allowed to send, not by this route.

  const row = await publicToolsQueryOne<any>(
    `INSERT INTO altax_public.tool_leads (tool_name, name, email, phone, payload, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, created_at`,
    [toolName, name || null, email, phone || null, payload ? JSON.stringify(payload) : null, req.ip || null]
  );

  const notifyEmail = process.env.PUBLIC_TOOLS_NOTIFY_EMAIL;
  if (notifyEmail) {
    try {
      const html = `
        <h2>New website tool lead</h2>
        <p><strong>Tool:</strong> ${escapeHtml(toolName)}</p>
        ${name ? `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` : ""}
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ""}
        ${payload ? `<p><strong>Details:</strong><br><pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(JSON.stringify(payload, null, 2))}</pre></p>` : ""}
        <p style="color:#777;font-size:12px;">Submitted ${row.created_at} · Record #${row.id}</p>
      `;
      await sendEmail({ to: notifyEmail, subject: `New ${toolName} lead from the website`, html });
    } catch (err) {
      if (!(err instanceof NotConfiguredError)) {
        // eslint-disable-next-line no-console
        console.error("Public tool lead admin notification failed:", err);
      }
    }
  }

  res.json({ ok: true });
}));

// ---- Paycheck / take-home pay calculator ----

// Statutory FICA constants — not part of withholdingTables.ts since that file is
// income-tax-only; these are fixed federal payroll-tax figures, not brackets.
// SS wage base is the one number that changes yearly (2026 figure, SSA fact sheet);
// the Additional Medicare thresholds are fixed by statute (IRC §3101(b)(2)), not
// inflation-adjusted, and haven't changed since 2013.
const SS_WAGE_BASE_2026 = 184500;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;
const ADDITIONAL_MEDICARE_RATE = 0.009;
const ADDITIONAL_MEDICARE_THRESHOLD: Record<string, number> = {
  "Married Filing Jointly": 250000,
  "Married Filing Separately": 125000,
};
const ADDITIONAL_MEDICARE_THRESHOLD_DEFAULT = 200000; // Single, Head of Household

const CALCULATOR_STATES = ["MD", "VA", "DC", "DE", "Other"] as const;

const paycheckCalcLimiter = rateLimit({ name: "public-paycheck-calc", windowMs: 15 * 60 * 1000, max: 60 });

/**
 * Stateless — no DB read or write, nothing stored. Every exemption/dependent/
 * county-specific input the real engine supports defaults to the same
 * "unknown, use the safer/higher-withholding assumption" the engine itself
 * already falls back to (see withholdingTables.ts) — this calculator only
 * asks a visitor for what a W-4/state form's headline fields actually are:
 * gross pay, frequency, filing status, state. Real numbers will differ once
 * an actual W-4/state form with dependents/exemptions is on file, which the
 * result text says explicitly.
 */
publicToolsRouter.post("/paycheck-calculator", paycheckCalcLimiter, asyncHandler(async (req: Request, res: Response) => {
  const grossPay = Number(req.body?.grossPay);
  const payFrequency = String(req.body?.payFrequency || "") as PayFrequency;
  const filingStatus = String(req.body?.filingStatus || "Single");
  const state = String(req.body?.state || "Other");
  const county = req.body?.county ? String(req.body.county) : null;

  if (!Number.isFinite(grossPay) || grossPay <= 0) return res.status(400).json({ error: "Enter a gross pay amount greater than $0." });
  if (!PAY_FREQUENCIES.includes(payFrequency)) return res.status(400).json({ error: "Unrecognized pay frequency." });
  if (!(CALCULATOR_STATES as readonly string[]).includes(state)) return res.status(400).json({ error: "Unrecognized state." });
  if (state === "MD" && county && !MD_COUNTIES.includes(county as any)) return res.status(400).json({ error: "Unrecognized Maryland county." });

  const periodsPerYear: Record<PayFrequency, number> = {
    "Weekly": 52, "Bi-Weekly": 26, "Semi-Monthly": 24, "Monthly": 12,
    "Quarterly": 4, "Semi-Annually": 2, "Annually": 1, "Daily": 260,
  };
  const periods = periodsPerYear[payFrequency];
  const annualGross = grossPay * periods;

  const federal = calculateFederalWithholding(grossPay, payFrequency, filingStatus);

  let stateTax = 0;
  if (state === "MD") stateTax = calculateMarylandWithholding(grossPay, payFrequency, filingStatus === "Married Filing Jointly" ? "Married" : filingStatus === "Head of Household" ? "Head of Household" : "Single", county, 0);
  else if (state === "VA") stateTax = calculateVirginiaWithholding(grossPay, payFrequency, 0, 0);
  else if (state === "DC") stateTax = calculateDcWithholding(grossPay, payFrequency, 0);
  else if (state === "DE") stateTax = calculateDelawareWithholding(grossPay, payFrequency, filingStatus === "Married Filing Jointly" ? "Married" : "Single", 0);

  // Social Security: capped at the annual wage base — once this period's
  // running annual total would exceed it, only the remaining room is taxed.
  // A single-paycheck calculator has no "prior YTD wages" to check, so this
  // assumes the same gross every period all year (the only reasonable
  // assumption without asking for YTD earnings), same annualize-then-divide
  // approach as every income-tax function above.
  const ssTaxableAnnual = Math.min(annualGross, SS_WAGE_BASE_2026);
  const socialSecurity = (ssTaxableAnnual / periods) * SS_RATE;
  const medicare = grossPay * MEDICARE_RATE;
  const additionalMedicareThreshold = ADDITIONAL_MEDICARE_THRESHOLD[filingStatus] ?? ADDITIONAL_MEDICARE_THRESHOLD_DEFAULT;
  const additionalMedicareAnnual = Math.max(0, annualGross - additionalMedicareThreshold) * ADDITIONAL_MEDICARE_RATE;
  const additionalMedicare = additionalMedicareAnnual / periods;

  const totalTax = federal + stateTax + socialSecurity + medicare + additionalMedicare;
  const netPay = grossPay - totalTax;

  const round2 = (n: number) => Math.round(n * 100) / 100;
  res.json({
    grossPay: round2(grossPay),
    federal: round2(federal),
    state: round2(stateTax),
    socialSecurity: round2(socialSecurity),
    medicare: round2(medicare + additionalMedicare),
    totalTax: round2(totalTax),
    netPay: round2(netPay),
    annualGross: round2(annualGross),
    annualNet: round2(netPay * periods),
  });
}));
