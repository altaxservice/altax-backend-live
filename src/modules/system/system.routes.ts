import crypto from "crypto";
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { isEncryptionConfigured } from "../../common/encryption";

export const systemRouter = Router();

const TABLES = [
  "v3_clients", "v3_users", "v3_employees", "v3_payment_methods", "v3_tasks", "v3_task_rules",
  "v3_invoices", "v3_payments", "v3_recurring_billing", "v3_document_requests", "v3_audit_log",
  "v3_client_secrets", "v3_secret_access_log", "v3_archived_tasks", "v3_task_batches",
  "v3_sales_input", "v3_payroll_input", "v3_paychecks", "v3_contractor_payments",
  "v3_document_uploads", "v3_manual_je", "v3_gl_entries", "v3_tax_rates", "v3_communications",
  "v3_templates", "v3_check_settings", "v3_dropdown_options", "v3_coa",
  "v3_time_entries", "v3_leave_requests",
];

/** Read-only table-row-count check, mirroring the "System Check" panel of legacy's Fix Center. */
systemRouter.get("/table-counts", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const results: { table: string; count: number }[] = [];
  for (const table of TABLES) {
    const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM altax.${table}`);
    results.push({ table, count: Number(rows[0]?.count || 0) });
  }
  res.json({ tables: results });
}));

interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "critical";
  detail: string;
  fixAction?: "rotate-jwt-secret";
}

/**
 * Plain-English self-diagnostic panel — the "self fix system" the app owner asked
 * for, so someone with no engineering background can see, in one place, whether
 * anything in the backend is misconfigured or the data has drifted into a bad
 * state, without needing to read logs or a database console. Each check reports
 * ok/warning/critical plus a sentence explaining what it means and what to do,
 * matching the pattern already established for "not configured" errors elsewhere
 * in this app (never a bare stack trace). See docs/MAINTENANCE_MANUAL.md for the
 * full explanation of each check and the manual fix for anything not auto-fixable
 * here.
 */
systemRouter.get("/diagnostics", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const checks: DiagnosticCheck[] = [];

  try {
    await query(`SELECT 1`);
    checks.push({ id: "database", label: "Database connection", status: "ok", detail: "Connected to the live database." });
  } catch (err: any) {
    checks.push({ id: "database", label: "Database connection", status: "critical", detail: `Cannot reach the database: ${err?.message || "unknown error"}. The whole app is down until this is fixed — check DATABASE_URL in .env and that the database host is reachable.` });
  }

  const jwtSecret = process.env.JWT_SECRET || "";
  if (!jwtSecret || jwtSecret === "replace-with-a-long-random-string") {
    checks.push({
      id: "jwt-secret", label: "Login security key", status: "critical",
      detail: "JWT_SECRET is still the sample placeholder value from the setup template. Anyone who has seen that template (it's in the project's example config) could forge a valid admin login without a password. Fix this before using the app with real client data.",
      fixAction: "rotate-jwt-secret",
    });
  } else {
    checks.push({ id: "jwt-secret", label: "Login security key", status: "ok", detail: "A real, non-default login security key is set." });
  }

  checks.push(isEncryptionConfigured()
    ? { id: "vault", label: "Sensitive-data encryption (SSNs, bank accounts)", status: "ok", detail: "The encryption key is set — SSNs, EINs, and bank account numbers are stored encrypted, not as plain text." }
    : { id: "vault", label: "Sensitive-data encryption (SSNs, bank accounts)", status: "critical", detail: "VAULT_MASTER_KEY is not set. Employee SSNs, bank account numbers, and Vault secrets cannot be saved or read until this is set. See the Maintenance Manual for how to generate one — and back it up somewhere safe once set, because losing it permanently locks every encrypted value already saved." });

  checks.push(process.env.RESEND_API_KEY
    ? { id: "email", label: "Email sending", status: "ok", detail: "An email API key is configured. If email still isn't sending to real clients, check that a sending domain is verified at resend.com/domains." }
    : { id: "email", label: "Email sending", status: "warning", detail: "No email API key is set (RESEND_API_KEY in .env). Emails will be logged but not actually sent until this is added." });

  checks.push(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? { id: "sms", label: "SMS / WhatsApp sending", status: "ok", detail: "Twilio credentials are configured." }
    : { id: "sms", label: "SMS / WhatsApp sending", status: "warning", detail: "No Twilio credentials are set. SMS and WhatsApp messages will be logged but not actually sent until TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER are added." });

  const lockedOutUsers = await query<any>(
    `SELECT user_id, email, role FROM altax.v3_users
      WHERE active = true AND password_hash IS NULL AND invite_token IS NULL`
  );
  checks.push(lockedOutUsers.length === 0
    ? { id: "locked-out-users", label: "Portal users who can log in", status: "ok", detail: "Every active portal user has either a password or a pending invite." }
    : { id: "locked-out-users", label: "Portal users who can log in", status: "warning", detail: `${lockedOutUsers.length} active portal user(s) have no password and no invite link, so they cannot log in at all: ${lockedOutUsers.slice(0, 5).map((u: any) => u.email).join(", ")}${lockedOutUsers.length > 5 ? "…" : ""}. Fix from Portal Access — Resend Invite or Set Temporary Password.` });

  // Same bug class caught and fixed live this session (a paycheck's employee name
  // didn't match its employee record, silently excluding it from W-3/940/941 and
  // Reports totals) — this check surfaces any other paycheck with that same
  // silent-exclusion problem instead of relying on someone noticing missing money
  // on a tax form.
  const mismatchedPaychecks = await query<any>(
    `SELECT p.paycheck_id, p.employee, p.client_id, p.pay_date
       FROM altax.v3_paychecks p
       LEFT JOIN altax.v3_employees e ON lower(e.employee_name) = lower(p.employee) AND e.client_id = p.client_id
      WHERE e.employee_id IS NULL AND lower(p.status) <> 'void'`
  );
  checks.push(mismatchedPaychecks.length === 0
    ? { id: "paycheck-employee-match", label: "Paycheck ↔ employee name matching", status: "ok", detail: "Every paycheck's employee name matches a real employee record for that client." }
    : { id: "paycheck-employee-match", label: "Paycheck ↔ employee name matching", status: "warning", detail: `${mismatchedPaychecks.length} paycheck(s) have an employee name that doesn't exactly match any employee record for that client (a typo or spelling mismatch), so they're silently left out of W-3/940/941 totals and Reports: ${mismatchedPaychecks.slice(0, 5).map((p: any) => p.paycheck_id).join(", ")}${mismatchedPaychecks.length > 5 ? "…" : ""}. Fix by correcting the employee name on the paycheck to match the employee record exactly.` });

  const missingEin = await query<any>(
    `SELECT DISTINCT c.client_id, c.client_name
       FROM altax.v3_clients c
       JOIN altax.v3_paychecks p ON p.client_id = c.client_id AND lower(p.status) <> 'void'
      WHERE c.ein IS NULL OR c.ein = ''`
  );
  checks.push(missingEin.length === 0
    ? { id: "client-ein", label: "Employer EINs on file", status: "ok", detail: "Every client running payroll has an EIN on file." }
    : { id: "client-ein", label: "Employer EINs on file", status: "warning", detail: `${missingEin.length} client(s) running payroll have no EIN on file, so their W-2/W-3/940/941 forms will print with a blank EIN box: ${missingEin.slice(0, 5).map((c: any) => c.client_name).join(", ")}${missingEin.length > 5 ? "…" : ""}. Fix from that client's profile.` });

  res.json({ checks });
}));

/**
 * Generates a fresh random JWT signing secret and writes it straight into the
 * live process's env var so it takes effect immediately (no restart needed) —
 * .env on disk is NOT touched, since this backend has no safe way to rewrite
 * its own config file mid-request without risking corrupting it. This means
 * the fix is temporary across a real restart; the response tells the admin the
 * exact line to paste into .env to make it permanent. Rotating this immediately
 * invalidates every existing login session (everyone must sign in again) — that
 * is the point, not a side effect, so this is deliberately a separate typed-
 * confirmation action rather than bundled into a generic "fix everything" button.
 */
systemRouter.post("/diagnostics/rotate-jwt-secret", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const confirm = String(req.body?.confirm || "").trim();
  if (confirm !== "ROTATE LOGIN KEY") {
    return res.status(400).json({ error: 'Type "ROTATE LOGIN KEY" to confirm. This signs every current user out immediately.' });
  }
  const newSecret = crypto.randomBytes(48).toString("base64");
  process.env.JWT_SECRET = newSecret;

  await logAudit("System", "ROTATE_JWT_SECRET", "jwt-secret", "", "", "rotated", `Login security key rotated by ${req.user!.email}. All sessions invalidated.`, req.user!.email);

  res.json({
    ok: true,
    message: "Login security key rotated for this running server. Everyone (including you) will need to log in again.",
    envLineToSave: `JWT_SECRET=${newSecret}`,
    note: "This change is live now but only in memory. Add the line above to your .env file so it survives the next server restart — otherwise the server will fall back to the old .env value next time it starts.",
  });
}));

/** Portal Security Center — account lockout, password status, and recent auth audit events. */
systemRouter.get("/security", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const users = await query<any>(
    `SELECT user_id, name, email, role, active, password_hash, password_hash_version,
            must_reset_password, failed_login_count, locked_until, last_login
       FROM altax.v3_users
      ORDER BY name ASC`
  );

  const events = await query<any>(
    `SELECT logged_at, user_email, action, record_id, note
       FROM altax.v3_audit_log
      WHERE module = 'Security'
      ORDER BY logged_at DESC
      LIMIT 25`
  );

  const now = Date.now();
  const activeUsers = users.filter((u: any) => u.active).length;
  const lockedAccounts = users.filter((u: any) => u.locked_until && new Date(u.locked_until).getTime() > now).length;
  const needsSetup = users.filter((u: any) => !u.password_hash || u.must_reset_password).length;

  res.json({
    summary: { activeUsers, lockedAccounts, needsSetup, totalUsers: users.length },
    users: users.map((u: any) => ({
      userId: u.user_id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      passwordStatus: !u.password_hash ? "Not Set" : u.must_reset_password ? "Must Reset" : "Ready",
      passwordStorage: !u.password_hash ? "Not Set" : u.password_hash_version === 2 ? "Current" : "Legacy",
      failedLoginCount: u.failed_login_count || 0,
      lockedUntil: u.locked_until,
      lastLogin: u.last_login,
    })),
    events,
  });
}));

/**
 * Default Global tax rates — one row per RateID the accounting module's
 * lookupRate() already falls back to in-memory when no configured row
 * exists (Sales Input's ST6/ST12/VAPE20/RATE60, Payroll's FIT/STATE/
 * SS_EE/MED_EE/SS_ER/MED_ER/FUTA/SUTA — see accountingHelpers.ts and every
 * lookupRate() call in accounting.routes.ts). Seeding these as real rows
 * makes the fallback values visible and editable on the Tax Rates tab
 * instead of only living as hardcoded defaults in application code.
 */
const DEFAULT_TAX_RATES: { rateId: string; rateType: string; rate: number; wageCap?: number; notes: string }[] = [
  { rateId: "ST6", rateType: "Sales Tax 6%", rate: 0.06, notes: "Maryland standard sales tax rate." },
  { rateId: "ST12", rateType: "Sales Tax 12%", rate: 0.12, notes: "Maryland special/alcohol sales tax rate." },
  { rateId: "VAPE20", rateType: "Vape Tax 20%", rate: 0.20, notes: "Maryland vape/e-cigarette tax rate." },
  { rateId: "RATE60", rateType: "60% Rate", rate: 0.60, notes: "Rate applied to the 60%-bucket sales category." },
  { rateId: "FIT", rateType: "Federal Income Tax Withholding", rate: 0.025116, notes: "Flat-rate payroll estimate, not IRS bracket withholding." },
  { rateId: "STATE", rateType: "State Income Tax Withholding", rate: 0.03, notes: "Flat-rate payroll estimate." },
  { rateId: "SS_EE", rateType: "Social Security (Employee)", rate: 0.062, wageCap: 184500, notes: "Employee-side Social Security withholding." },
  { rateId: "MED_EE", rateType: "Medicare (Employee)", rate: 0.0145, notes: "Employee-side Medicare withholding." },
  { rateId: "SS_ER", rateType: "Social Security (Employer)", rate: 0.062, wageCap: 184500, notes: "Employer-side Social Security match." },
  { rateId: "MED_ER", rateType: "Medicare (Employer)", rate: 0.0145, notes: "Employer-side Medicare match." },
  { rateId: "FUTA", rateType: "Federal Unemployment (FUTA)", rate: 0.006, wageCap: 7000, notes: "Employer-only federal unemployment tax." },
  { rateId: "SUTA", rateType: "State Unemployment (SUTA)", rate: 0.025, notes: "Employer-only state unemployment tax estimate." },
];

/**
 * Full legacy chart of accounts (alTaxV5DefaultCOARows_, Code.gs) — expanded
 * from an earlier 13-account starter list after the parity audit found it
 * only covered the handful of accounts this app's own GL-posting code
 * writes to, not the ~40-account standard COA legacy actually seeded.
 * Account IDs are legacy's own numeric codes (1000, 2000, ...), not this
 * module's earlier ACCT-* scheme, so a fresh deployment's COA numbering
 * matches what legacy shipped.
 */
const DEFAULT_COA_ACCOUNTS: { accountId: string; accountName: string; accountType: string; detailType: string; normalBalance: string; notes: string }[] = [
  { accountId: "1000", accountName: "Cash", accountType: "Asset", detailType: "Bank", normalBalance: "Debit", notes: "Main operating bank" },
  { accountId: "1010", accountName: "Undeposited Funds", accountType: "Asset", detailType: "Other Current Asset", normalBalance: "Debit", notes: "Payments not yet deposited" },
  { accountId: "1100", accountName: "Accounts Receivable", accountType: "Asset", detailType: "Receivable", normalBalance: "Debit", notes: "Client balances" },
  { accountId: "1200", accountName: "Prepaid Expenses", accountType: "Asset", detailType: "Other Current Asset", normalBalance: "Debit", notes: "Prepaid costs" },
  { accountId: "1500", accountName: "Furniture and Equipment", accountType: "Asset", detailType: "Fixed Asset", normalBalance: "Debit", notes: "Business equipment" },
  { accountId: "1510", accountName: "Accumulated Depreciation", accountType: "Asset", detailType: "Accumulated Depreciation", normalBalance: "Credit", notes: "Contra asset depreciation" },
  { accountId: "2000", accountName: "Accounts Payable", accountType: "Liability", detailType: "Payable", normalBalance: "Credit", notes: "Vendor payables" },
  { accountId: "2100", accountName: "Sales Tax Payable", accountType: "Liability", detailType: "Tax Payable", normalBalance: "Credit", notes: "Sales tax collected" },
  { accountId: "2200", accountName: "Payroll Tax Payable", accountType: "Liability", detailType: "Payroll Tax Payable", normalBalance: "Credit", notes: "Payroll tax liability" },
  { accountId: "2210", accountName: "Payroll Deduction Payable", accountType: "Liability", detailType: "Payroll Payable", normalBalance: "Credit", notes: "Employee payroll deductions withheld until remitted" },
  { accountId: "2300", accountName: "Credit Card Payable", accountType: "Liability", detailType: "Credit Card", normalBalance: "Credit", notes: "Business credit card balance" },
  { accountId: "3000", accountName: "Owner Equity", accountType: "Equity", detailType: "Equity", normalBalance: "Credit", notes: "Owner equity" },
  { accountId: "3100", accountName: "Owner Draw", accountType: "Equity", detailType: "Owner Draw", normalBalance: "Debit", notes: "Owner distributions" },
  { accountId: "4000", accountName: "Sales Revenue", accountType: "Income", detailType: "Sales", normalBalance: "Credit", notes: "Sales income" },
  { accountId: "4100", accountName: "Service Revenue", accountType: "Income", detailType: "Services", normalBalance: "Credit", notes: "Service income" },
  { accountId: "4200", accountName: "Other Income", accountType: "Income", detailType: "Other Income", normalBalance: "Credit", notes: "Other income" },
  { accountId: "5000", accountName: "Cost of Goods Sold", accountType: "COGS", detailType: "Cost of Sales", normalBalance: "Debit", notes: "Cost of goods sold" },
  { accountId: "6000", accountName: "Payroll Expense", accountType: "Expense", detailType: "Payroll", normalBalance: "Debit", notes: "Gross wages" },
  { accountId: "6010", accountName: "Payroll Tax Expense", accountType: "Expense", detailType: "Payroll Taxes", normalBalance: "Debit", notes: "Employer payroll taxes" },
  { accountId: "6020", accountName: "Contract Labor", accountType: "Expense", detailType: "Contractors", normalBalance: "Debit", notes: "1099 contractor labor" },
  { accountId: "6100", accountName: "Rent Expense", accountType: "Expense", detailType: "Rent or Lease", normalBalance: "Debit", notes: "Office or store rent" },
  { accountId: "6110", accountName: "Utilities", accountType: "Expense", detailType: "Utilities", normalBalance: "Debit", notes: "Electric, gas, water" },
  { accountId: "6120", accountName: "Telephone and Internet", accountType: "Expense", detailType: "Telephone", normalBalance: "Debit", notes: "Phone and internet service" },
  { accountId: "6200", accountName: "Insurance Expense", accountType: "Expense", detailType: "Insurance", normalBalance: "Debit", notes: "Business insurance" },
  { accountId: "6300", accountName: "Professional Fees", accountType: "Expense", detailType: "Legal and Professional", normalBalance: "Debit", notes: "Legal, accounting, consulting" },
  { accountId: "6400", accountName: "Bank Fees", accountType: "Expense", detailType: "Bank Charges", normalBalance: "Debit", notes: "Bank charges" },
  { accountId: "6410", accountName: "Merchant Processing Fees", accountType: "Expense", detailType: "Merchant Fees", normalBalance: "Debit", notes: "Card processing fees" },
  { accountId: "6500", accountName: "Advertising and Marketing", accountType: "Expense", detailType: "Advertising", normalBalance: "Debit", notes: "Advertising and promotions" },
  { accountId: "6600", accountName: "Office Expense", accountType: "Expense", detailType: "Office", normalBalance: "Debit", notes: "Office expenses" },
  { accountId: "6610", accountName: "Supplies", accountType: "Expense", detailType: "Supplies", normalBalance: "Debit", notes: "Operating supplies" },
  { accountId: "6700", accountName: "Meals", accountType: "Expense", detailType: "Meals", normalBalance: "Debit", notes: "Business meals" },
  { accountId: "6710", accountName: "Travel", accountType: "Expense", detailType: "Travel", normalBalance: "Debit", notes: "Business travel" },
  { accountId: "6720", accountName: "Auto Expense", accountType: "Expense", detailType: "Automobile", normalBalance: "Debit", notes: "Vehicle costs" },
  { accountId: "6800", accountName: "Repairs and Maintenance", accountType: "Expense", detailType: "Repairs", normalBalance: "Debit", notes: "Repairs and maintenance" },
  { accountId: "6900", accountName: "Dues and Subscriptions", accountType: "Expense", detailType: "Dues", normalBalance: "Debit", notes: "Subscriptions and memberships" },
  { accountId: "6910", accountName: "Licenses and Permits", accountType: "Expense", detailType: "Licenses", normalBalance: "Debit", notes: "Business licenses and permits" },
  { accountId: "6920", accountName: "Postage and Delivery", accountType: "Expense", detailType: "Postage", normalBalance: "Debit", notes: "Mail and delivery" },
  { accountId: "7000", accountName: "Taxes and Licenses", accountType: "Expense", detailType: "Taxes", normalBalance: "Debit", notes: "Non-income business taxes" },
  { accountId: "7100", accountName: "Depreciation Expense", accountType: "Expense", detailType: "Depreciation", normalBalance: "Debit", notes: "Depreciation expense" },
  { accountId: "8000", accountName: "Ask My Accountant", accountType: "Other", detailType: "Suspense", normalBalance: "Debit", notes: "Temporary account for unclear items" },
];

/**
 * One-time (safely repeatable) seed for a fresh deployment — inserts the
 * default tax rates and chart of accounts above, but only rows that don't
 * already exist by id, so re-running this on a database an admin has
 * already customized never overwrites their configured values.
 */
systemRouter.post("/seed-defaults", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  let ratesCreated = 0;
  let accountsCreated = 0;

  for (const r of DEFAULT_TAX_RATES) {
    const existing = await queryOne<any>(`SELECT rate_id FROM altax.v3_tax_rates WHERE rate_id = $1`, [r.rateId]);
    if (existing) continue;
    await query(
      `INSERT INTO altax.v3_tax_rates (rate_id, scope, rate_type, rate, wage_cap, active, notes)
       VALUES ($1,'Global',$2,$3,$4,true,$5)`,
      [r.rateId, r.rateType, r.rate, r.wageCap ?? null, r.notes]
    );
    ratesCreated++;
  }

  for (const a of DEFAULT_COA_ACCOUNTS) {
    // Match by name, not id: a real COA (numeric codes like "1000") won't share this
    // module's ACCT-* id scheme, so an id-only check would create name duplicates —
    // caught live against production data on first run (13 dupes, since removed).
    const existing = await queryOne<any>(`SELECT account_id FROM altax.v3_coa WHERE lower(account_name) = lower($1)`, [a.accountName]);
    if (existing) continue;
    await query(
      `INSERT INTO altax.v3_coa (account_id, account_name, account_type, detail_type, normal_balance, active, notes, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,true,$6,'Node Web App',$1)`,
      [a.accountId, a.accountName, a.accountType, a.detailType, a.normalBalance, a.notes]
    );
    accountsCreated++;
  }

  await logAudit("System", "SEED_DEFAULTS", "seed-defaults", "", "",
    `${ratesCreated} rates, ${accountsCreated} accounts`, `Default tax rates/COA seeded by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, ratesCreated, accountsCreated, ratesSkipped: DEFAULT_TAX_RATES.length - ratesCreated, accountsSkipped: DEFAULT_COA_ACCOUNTS.length - accountsCreated });
}));

const ASSIGNABLE_STAFF_ROLES = ["admin", "staff", "manager", "owner"];

/**
 * Mirrors alTaxV3WebOptions (Code.gs:11022): every dropdown/select list the
 * frontend needs in one call, instead of each form hardcoding its own copy
 * of task types, statuses, priorities, etc. (a source of drift legacy's own
 * forms suffered from — several sheets-side dropdowns had gone stale against
 * this exact function). Static lists are ported verbatim from legacy; client,
 * staff, and chart-of-accounts lists are read live so they stay current.
 */
systemRouter.get("/options", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const clientRows = await query<any>(`SELECT client_id, client_name, status FROM altax.v3_clients ORDER BY client_name ASC`);
  const clients = clientRows
    .filter((c) => String(c.client_id || "").trim())
    .map((c) => ({ clientId: c.client_id, clientName: c.client_name || c.client_id, status: c.status || "" }));

  const userRows = await query<any>(`SELECT name, email, role, active FROM altax.v3_users`);
  const staff = Array.from(new Set(
    userRows
      .filter((u) => u.active !== false && ASSIGNABLE_STAFF_ROLES.includes(String(u.role || "").trim().toLowerCase()))
      .map((u) => String(u.name || u.email || "").trim())
      .filter((name) => name)
  )).sort();

  const coaRows = await query<any>(`SELECT account_name, account_id FROM altax.v3_coa WHERE active = true`);
  const coaAccounts = coaRows.map((a) => a.account_name || a.account_id).filter((name) => String(name || "").trim());

  res.json({
    clients,
    staff,
    taskTypes: [
      "Custom", "Other", "Sales Tax Filing", "Sales Tax Payment", "Payroll Processing", "Payroll Tax Deposit",
      "EFTPS Deposit", "MD Withholding Filing", "MD Withholding", "MD UI", "MD Annual Report Filing",
      "MD Annual Report Payment", "Immigration Forms", "Business Formation", "EIN Registration", "Personal Tax",
      "Business Tax", "Business Return", "Bookkeeping", "IRS Notice", "State Notice",
    ],
    immigrationFormTypes: [
      "I-130 Petition for Alien Relative", "I-485 Adjustment of Status", "I-765 Employment Authorization",
      "I-864 Affidavit of Support", "N-400 Naturalization", "I-90 Green Card Renewal", "I-751 Remove Conditions",
      "I-589 Asylum", "DS-260 Immigrant Visa", "FOIA Request", "Other Immigration Form",
    ],
    requestTypes: [
      "Payroll", "Sales Tax", "Business Return", "Annual Report", "EFTPS", "Document Request", "IRS Notice",
      "State Notice", "New Employee", "Termination", "General Question", "Other",
    ],
    requestedItems: [
      "Bank Statement", "Prior Year Tax Return", "W-2", "1099", "Profit & Loss Statement", "Balance Sheet",
      "Payroll Records", "Receipts / Invoices", "ID / EIN Documentation", "Lease Agreement", "Signed Engagement Letter", "Other",
    ],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    priorities: ["Normal", "Low", "High", "Urgent"],
    taskStatuses: ["Not Started", "In Progress", "In Process", "Waiting Docs", "Waiting on Client", "Pending", "Preparation", "Submitted", "Completed", "Closed", "Archived", "Void"],
    invoiceStatuses: ["Unpaid", "Partial", "Paid", "Void"],
    documentStatuses: ["Requested", "Open", "Waiting on Client", "Received", "Completed", "Closed", "Void"],
    paymentMethods: ["Cash", "Check", "Zelle", "Card", "ACH", "Wire", "Other"],
    communicationChannels: ["Email", "Portal Note", "SMS", "WhatsApp", "Phone"],
    coaAccounts,
  });
}));
