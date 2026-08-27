import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { rateLimit } from "./common/rateLimit";
import { pool } from "./config/db";
import { applyPersistedJwtSecret } from "./common/jwtSecret";
import { authRouter } from "./modules/auth/auth.routes";
import { clientsRouter, runSwotFindingsSweep, runClientRiskFlagSweep, runClientMdSalesTaxDeadlineNotifications } from "./modules/clients/clients.routes";
import { runComplianceDeadlineReminders } from "./common/complianceReminders";
import { ownershipTransferRouter } from "./modules/clients/ownershipTransfer.routes";
import { noticesRouter } from "./modules/clients/notices.routes";
import { taxReturnsRouter } from "./modules/clients/taxReturns.routes";
import { runMonthlySnapshotSweep } from "./modules/clients/monthlySnapshot";
import { runMonthlyManagementSummary } from "./modules/clients/monthlyManagementSummary";
import { usersRouter } from "./modules/users/users.routes";
import { estimatesRouter } from "./modules/estimates/estimates.routes";
import { poaFormsRouter } from "./modules/poaForms/poaForms.routes";
import { govFormsRouter } from "./modules/govForms/govForms.routes";
import { calculatorsRouter } from "./modules/calculators/calculators.routes";
import { tasksRouter } from "./modules/tasks/tasks.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { billingRouter, runRecurringBillingSweep } from "./modules/billing/billing.routes";
import { runStripeReconciliation } from "./modules/billing/stripePayments";
import { communicationsRouter } from "./modules/communications/communications.routes";
import { accountingRouter } from "./modules/accounting/accounting.routes";
import { payrollAgentRouter, runPayrollAgentSweep, isPayrollAgentAutoRunEnabled } from "./modules/accounting/payrollAgent.routes";
import { payrollImportRouter } from "./modules/payrollImport/payrollImport.routes";
import { salesInputImportRouter } from "./modules/salesInputImport/salesInputImport.routes";
import { rulesRouter, runTaskRulesAgentSweep, isTaskRulesAgentAutoRunEnabled } from "./modules/rules/rules.routes";
import { vaultRouter } from "./modules/vault/vault.routes";
import { firmPortalsRouter } from "./modules/vault/firmPortals.routes";
import { paymentMethodsRouter } from "./modules/paymentMethods/paymentMethods.routes";
import { systemRouter } from "./modules/system/system.routes";
import { templatesRouter } from "./modules/templates/templates.routes";
import { searchRouter } from "./modules/search/search.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { timeTrackingRouter } from "./modules/timeTracking/timeTracking.routes";
import { productsRouter } from "./modules/products/products.routes";
import { serviceCatalogRouter } from "./modules/serviceCatalog/serviceCatalog.routes";
import { publicServiceCatalogRouter } from "./modules/serviceCatalog/publicServiceCatalog.routes";
import { publicInvoiceRouter } from "./modules/billing/publicInvoice.routes";
import { publicContactRouter } from "./modules/publicContact/publicContact.routes";
import { publicNewsletterRouter } from "./modules/publicNewsletter/publicNewsletter.routes";
import { publicAnalyticsRouter } from "./modules/publicAnalytics/publicAnalytics.routes";
import { analyticsAdminRouter } from "./modules/publicAnalytics/analyticsAdmin.routes";
import { newsletterAdminRouter } from "./modules/publicNewsletter/newsletterAdmin.routes";
import { publicToolsRouter } from "./modules/publicTools/publicTools.routes";
import { publicAppointmentsRouter } from "./modules/publicAppointments/publicAppointments.routes";
import { remindersRouter, runReminders } from "./modules/reminders/reminders.routes";
import { appointmentsRouter, runAppointmentReminders, runAppointmentAutoComplete, runAppointmentConfirmationRequests } from "./modules/appointments/appointments.routes";
import { runPaymentDueReminders } from "./common/paymentReminders";
import { runDailyBackupEmail } from "./common/autoBackup";
import { firmSettingsRouter } from "./modules/firmSettings/firmSettings.routes";
import { appointmentSettingsRouter } from "./modules/appointmentSettings/appointmentSettings.routes";
import { pushSubscriptionsRouter } from "./modules/pushSubscriptions/pushSubscriptions.routes";
import { contractsRouter } from "./modules/contracts/contracts.routes";
import { publicContractRouter } from "./modules/contracts/publicContract.routes";
import { publicMessageRouter } from "./modules/communications/publicMessage.routes";
import { haccpRouter } from "./modules/haccp/haccp.routes";
import { checklistsRouter } from "./modules/checklists/checklists.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { labelsRouter } from "./modules/labels/labels.routes";
import { suggestionsRouter } from "./modules/suggestions/suggestions.routes";
import { formDraftsRouter } from "./modules/formDrafts/formDrafts.routes";
import { bankRecRouter } from "./modules/bankRec/bankRec.routes";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes";
import cron from "node-cron";
import { alertAdmins } from "./common/adminAlerts";
import { recordJobRun } from "./common/jobRuns";

dotenv.config();

const app = express();
// Needed for req.ip to resolve the real client address (not Railway's proxy
// address) behind the platform's reverse proxy — used as part of the contract
// e-signature audit trail (see publicContract.routes.ts POST /:token/sign).
app.set("trust proxy", true);
// helmet()'s default CSP has no frame-src directive, so it falls back to
// default-src 'self' — which blocks blob: URLs from loading inside an
// <iframe>. That's exactly how SendEstimateModal/SendInvoiceModal preview a
// generated PDF (fetch as blob, URL.createObjectURL, iframe src), so without
// this override the preview panel silently shows a broken-file icon instead
// of the PDF, in production where this same server serves the page hosting
// that iframe (dev's separate Vite server doesn't apply this CSP, which is
// why the bug didn't surface there).
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "frame-src": ["'self'", "blob:"],
      // Every marketing-site page (marketing-site/*.html) carries one small
      // inline <script> that reads localStorage before first paint and sets
      // lang="ar"/dir="rtl" early, to avoid a flash of the wrong direction
      // for a returning Arabic-preferring visitor before main.js loads.
      // helmet's default script-src ('self' only) was silently blocking it
      // on every single page — confirmed live via the browser console,
      // 2026-08-27. Not a crash (main.js re-applies the same lang/dir once
      // it loads), just a brief visual flash each page load. Allow-listing
      // by exact SHA-256 hash (not 'unsafe-inline', which would open the
      // door to any inline script) is the standard CSP fix for a single,
      // fixed, non-dynamic inline script — this hash covers only this exact
      // string; a future edit to that script needs a new hash here too.
      "script-src": ["'self'", "'sha256-Xx5GNGGcaMTokQNCiFCa/+6iwqDoWC2Kw1nBiQq0sRM='"],
    },
  },
}));

// The app is same-origin in production (marketing site, portals, and API all served
// from altaxgroup.com by this one process) — cross-origin requests should only ever
// come from local dev (frontend on :5173 hitting this backend on :4000). The
// Railway-assigned *.up.railway.app subdomain was allowed here too during the
// window before the custom domain went live — removed now that it's live,
// since that's a shared public PaaS domain anyone can claim a subdomain on.
// Default cors() reflects any origin; an explicit allow-list closes that off without
// breaking the one legitimate cross-origin case (dev).
const ALLOWED_ORIGINS = new Set([
  "https://altaxgroup.com",
  "https://www.altaxgroup.com",
  "https://api.altaxgroup.com",
  "http://localhost:5173",
  "http://localhost:4000",
]);
app.use(cors({
  origin(origin, callback) {
    // No Origin header (same-origin requests, curl, server-to-server) — allow.
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
}));
// Mounted BEFORE the global express.json() below — both webhook routes verify a
// signature computed over the raw/form-encoded request body, and express.json()
// would already have consumed those bytes by the time a route handler saw them.
// No Origin header on a server-to-server webhook POST, so the CORS allow-list
// above doesn't block these either way.
app.use("/webhooks", webhooksRouter);
app.use(express.json({ limit: "12mb" })); // covers base64-encoded file uploads (see documents.routes.ts POST /uploads) up to ~8MB raw

// Previously a static {ok:true} with no database check, so a full DB outage would
// still report "healthy" to Railway/any uptime monitor watching this route. Kept
// unauthenticated (a health check needs to work when the app is otherwise broken)
// and deliberately reveals nothing about *why* the DB is unreachable, only that it
// is — the real error goes to the server's own logs, not the response body.
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, phase: "0-foundation" });
  } catch (err) {
    console.error("[health] database check failed:", err);
    res.status(503).json({ ok: false, error: "Database unreachable." });
  }
});

// Read-only internal demo page (public/preview.html) — not part of the real client/staff
// app, just a way to see the API's data against real records without a frontend yet.
app.use(express.static("public"));

// Public marketing site (marketing-site/) — plain static HTML/CSS/JS, no build step.
// Only its asset subdirectories are statically served, NOT the directory root. The
// page routes themselves are registered further down (MARKETING_PAGES), ahead of the
// SPA catch-all, so they win over the React app for those paths.
//
// This used to be `app.use(express.static(marketingSiteDir))` (serving the whole
// directory, including its index.html by literal filename). That collided with
// frontend/dist/index.html — both are named "index.html", this mount was registered
// first, so a literal request for /index.html silently served the MARKETING site's
// homepage instead of the React app shell. That's normally harmless (nobody links to
// "/index.html" directly — the marketing home is "/"), except the PWA's own service
// worker uses `navigateFallback: '/index.html'` (see frontend/vite.config.ts) as its
// offline/unmatched-route fallback — so it precached the wrong page, and ANY app route
// not explicitly denylisted (e.g. /login/client) silently rendered the marketing
// homepage instead of the login screen. Confirmed live: curl '/index.html' returned
// the marketing site's <title>, and the service worker's active precache matched.
// Scoping this mount to only css/js/images removes the collision at the source: no
// marketing .html file is ever reachable except through the explicit route map below.
const marketingSiteDir = path.join(__dirname, "..", "marketing-site");
app.use("/css", express.static(path.join(marketingSiteDir, "css")));
app.use("/js", express.static(path.join(marketingSiteDir, "js")));
// helmet() defaults Cross-Origin-Resource-Policy to same-origin, which blocks these
// images from rendering anywhere off this origin — email clients (the signature logo
// in Gmail/Outlook/Apple Mail) and any external embed. Public brand assets, so allow.
app.use("/images", (_req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});
app.use("/images", express.static(path.join(marketingSiteDir, "images")));

const frontendDist = path.join(__dirname, "..", "frontend", "dist");

// Public marketing pages take the bare root and its top-level paths. Must be registered
// before the SPA catch-all below — Express matches in registration order, and both would
// otherwise match "/". The React app's own home lives at "/dashboard" specifically so it
// never collides with this (see App.tsx — this was a deliberate migration off "/").
const MARKETING_PAGES: Record<string, string> = {
  "/": "index.html",
  "/about": "about.html",
  "/services": "services.html",
  "/resources": "resources.html",
  "/tools": "tools/index.html",
  "/news": "news.html",
  "/contact": "contact.html",
  "/book": "book.html",
  "/manage-appointment": "manage-appointment.html",
  "/privacy": "privacy.html",
  "/sms-terms": "sms-terms.html",
  "/accessibility": "accessibility.html",
  "/tax-glossary": "tax-glossary.html",
  "/record-retention-guide": "record-retention-guide.html",
  "/taxpayer-rights": "taxpayer-rights.html",
  "/tax-calendar.ics": "tax-calendar.ics",
};
app.get(Object.keys(MARKETING_PAGES), (req, res) => {
  res.sendFile(path.join(marketingSiteDir, MARKETING_PAGES[req.path]));
});

// Tax News articles (marketing-site/news/*.html) — an explicit slug allowlist rather
// than reading req.params.slug straight into a file path, since that path never touches
// disk lookups or directory listing and can't be walked outside marketing-site/news/.
const NEWS_ARTICLE_SLUGS = new Set([
  "2026-estimated-tax-payments",
  "payroll-mistakes-irs-penalties",
  "maryland-sales-tax-registration",
  "llc-vs-s-corp",
  "life-changes-tax-return",
  "recordkeeping-habits",
]);
app.get("/news/:slug", (req, res, next) => {
  if (!NEWS_ARTICLE_SLUGS.has(req.params.slug)) return next();
  res.sendFile(path.join(marketingSiteDir, "news", `${req.params.slug}.html`));
});

// Public website tools (marketing-site/tools/*.html) — same explicit slug-allowlist
// pattern as the news articles above, for the same reason (no disk path built from
// unvalidated user input).
const TOOL_PAGE_SLUGS = new Set(["business-health-check", "entity-comparison", "document-checklist", "paycheck-calculator"]);
app.get("/tools/:slug", (req, res, next) => {
  if (!TOOL_PAGE_SLUGS.has(req.params.slug)) return next();
  res.sendFile(path.join(marketingSiteDir, "tools", `${req.params.slug}.html`));
});

// Several frontend page paths intentionally match API route prefixes 1:1 (the "/clients"
// page vs. "GET /clients" the list endpoint, "/firm-settings" the page vs. its own GET
// route, etc.) — both are correct on their own, but with the frontend and API on one
// origin, Express would otherwise route a real page load of e.g. "/clients" into the
// clients API instead of the app. The fix: real browser navigation (address bar, refresh,
// bookmark) always sends "Accept: text/html" first; this app's own fetch() calls never do
// (Content-Type is set, Accept is not, so it defaults to "*/*") — so intercepting only
// html-preferring GETs here, before any API router is mounted, serves the app for page
// loads while leaving every actual API call untouched.
//
// /public/contracts/*/pdf and /public/invoices/*/print are the one deliberate exception:
// they're real binary downloads a client opens via a plain <a href> (View/Download PDF on
// the public contract/invoice pages, and any raw link pasted into a browser), which is
// itself a real navigation sending "Accept: text/html" first — so without this exclusion
// they'd get swallowed by this catch-all and silently served the SPA shell (confirmed
// live: navigating straight to /public/contracts/:token/pdf rendered the login page, not
// the PDF, even though the route works fine when fetched via JS). The frontend's own page
// routes for these are the singular /public/contract/:token and /public/invoice/:token —
// deliberately different from these plural API paths — so this carve-out can't shadow them.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/public/contracts/") || req.path.startsWith("/public/invoices/")) return next();
  // Same class of bug as those two: /documents/uploads/:id/download is a real binary
  // download with no file extension in its URL, reached by a client tapping a raw link
  // in an SMS/WhatsApp message (a genuine browser navigation, sending Accept: text/html)
  // — without this exclusion it matched this catch-all and silently served the React
  // app shell instead of the file, which then redirected to a login screen. Confirmed
  // live: a client's SMS attachment link opened a login page instead of downloading.
  if (/^\/documents\/uploads\/[^/]+\/download$/.test(req.path)) return next();
  if (req.path.includes(".") || !req.headers.accept?.includes("text/html")) return next();
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

// General-purpose safety net — previously only the auth surface and the public
// contact form had any rate limiting at all, so a scripted attacker could hammer
// any other route (a client search, a report export, an ID-guessing attempt) with
// zero friction. 900 requests/5min per IP is well above what the SPA's own heaviest
// page (Accounting's several parallel fetches on tab switch) generates in normal use,
// so this is meant to catch scripted abuse, not throttle a real user's browser.
app.use(rateLimit({ name: "api-general", windowMs: 5 * 60 * 1000, max: 900 }));

app.use("/auth", authRouter);
// ownershipTransferRouter/noticesRouter/taxReturnsRouter mount BEFORE clientsRouter:
// clientsRouter's GET /:clientId and /:clientId/summary are wildcard catch-alls that
// otherwise shadow these routers' literal firm-wide paths (GET /clients/notices,
// /clients/tax-returns, /clients/tax-returns/summary) — Express matches "notices" or
// "tax-returns" as a clientId and never reaches the real handler. Found live: the Firm
// Report page's Tax Return Production panel was crashing the whole page because
// /clients/tax-returns/summary was silently resolving to computeClientOpsSummary("tax-returns", ...)
// instead of the real tax-returns/summary handler, returning a shape with no `counts` field.
app.use("/clients", ownershipTransferRouter);
app.use("/clients", noticesRouter);
app.use("/clients", taxReturnsRouter);
app.use("/clients", clientsRouter);
app.use("/users", usersRouter);
app.use("/estimates", estimatesRouter);
app.use("/poa-forms", poaFormsRouter);
app.use("/gov-forms", govFormsRouter);
app.use("/calculators", calculatorsRouter);
app.use("/tasks", tasksRouter);
app.use("/documents", documentsRouter);
app.use("/billing", billingRouter);
app.use("/communications", communicationsRouter);
app.use("/accounting", accountingRouter);
app.use("/accounting/payroll-agent", payrollAgentRouter);
app.use("/import", payrollImportRouter);
app.use("/sales-input-import", salesInputImportRouter);
app.use("/rules", rulesRouter);
app.use("/vault", vaultRouter);
app.use("/firm-portals", firmPortalsRouter);
app.use("/payment-methods", paymentMethodsRouter);
app.use("/system", systemRouter);
app.use("/templates", templatesRouter);
app.use("/search", searchRouter);
app.use("/reports", reportsRouter);
app.use("/time-tracking", timeTrackingRouter);
app.use("/products", productsRouter);
app.use("/service-catalog", serviceCatalogRouter);
app.use("/public", publicServiceCatalogRouter);
app.use("/public/invoices", publicInvoiceRouter);
app.use("/public/contact", publicContactRouter);
app.use("/public/newsletter", publicNewsletterRouter);
app.use("/newsletter", newsletterAdminRouter);
app.use("/public/analytics", publicAnalyticsRouter);
app.use("/analytics", analyticsAdminRouter);
app.use("/public/tools", publicToolsRouter);
app.use("/public/appointments", publicAppointmentsRouter);
app.use("/reminders", remindersRouter);
app.use("/appointments", appointmentsRouter);
app.use("/firm-settings", firmSettingsRouter);
app.use("/appointment-settings", appointmentSettingsRouter);
app.use("/push", pushSubscriptionsRouter);
app.use("/contracts", contractsRouter);
app.use("/public/contracts", publicContractRouter);
app.use("/public/messages", publicMessageRouter);
app.use("/haccp", haccpRouter);
app.use("/checklists", checklistsRouter);
app.use("/budgets", budgetsRouter);
app.use("/labels", labelsRouter);
app.use("/suggestions", suggestionsRouter);
app.use("/form-drafts", formDraftsRouter);
app.use("/bank-rec", bankRecRouter);

// Static JS/CSS/asset files for the build above — these have real file extensions and
// never collide with an API prefix, so plain static serving after the API routers is safe.
app.use(express.static(frontendDist));

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

// Must be registered last, and must keep all 4 args (err, req, res, next) — that arity
// is how Express recognizes error-handling middleware. Without this, a rejected promise
// forwarded by asyncHandler's next(err) has nowhere to go and the request hangs with an
// empty response (confirmed live before this was added).
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (res.headersSent) return;
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "That upload is too large. Files over 8MB need to be shared as a link instead." });
  }
  res.status(500).json({ error: "Internal server error." });
});

/**
 * Wraps a cron job body so every job — not just the 3 that happened to add
 * this themselves — writes a durable "did this actually run" record
 * (v3_job_runs, see common/jobRuns.ts) alongside the existing best-effort
 * admin-email alert. Previously the only trace of a failure was console
 * output plus that email; neither is queryable after the fact, so a quietly
 * broken job could go unnoticed indefinitely.
 */
function runScheduledJob(jobName: string, task: () => Promise<unknown>): () => void {
  return () => {
    task()
      .then(() => recordJobRun(jobName, "success"))
      .catch((err) => {
        const detail = err instanceof Error ? (err.stack || err.message) : String(err);
        recordJobRun(jobName, "failure", detail);
        alertAdmins(`${jobName} failed`, detail);
      });
  };
}

// Daily reminders — staff digest, firm digest, and client document/payment
// reminders (see reminders.routes.ts's runReminders doc comment: one consolidated
// email per recipient per day, never per-task). 6:30AM America/New_York, chosen to
// land in the user's requested 6-7AM Eastern window. This is safe as an in-process
// timer specifically because this app now runs as a persistent server (Railway),
// unlike the serverless/ephemeral hosting the original "no scheduler yet" decision
// was made under.
cron.schedule("30 6 * * *", runScheduledJob("Daily Reminders", () => runReminders("System (Daily Reminder Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Daily reminders scheduled for 6:30AM America/New_York.");

// Daily 6:00AM ET, before the 6:30 digest — the day's encrypted backup lands
// in the admin inbox without anyone remembering to click Download. Was
// weekly (BC-004: up to 6 days of data-loss exposure, on top of the DB
// provider's own short point-in-time-recovery window) — moved to daily since
// the job itself is cheap and there was no real reason not to.
cron.schedule("0 6 * * *", runScheduledJob("Daily Backup Email", () => runDailyBackupEmail("System (Daily Backup Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Daily encrypted backup email scheduled for 6:00AM America/New_York.");

// Every 5 minutes (was hourly until 2026-08-24) — checks a window around each
// configured lead time (Calendar Settings, see runAppointmentReminders's doc
// comment), so an appointment gets each configured reminder once regardless
// of which tick catches it, without ever double-sending. Tightened from
// hourly specifically to make the new "15 minutes before" preset (added
// alongside staff push notifications) actually mean 15 minutes — an hourly
// sweep's ±1-hour matching window could have fired that reminder up to 45
// minutes after the appointment had already started.
cron.schedule("*/5 * * * *", runScheduledJob("Appointment Reminders", () => runAppointmentReminders("System (Appointment Reminder Job)")));
// eslint-disable-next-line no-console
console.log("Appointment reminders scheduled every 5 minutes.");

// Auto-completes past Scheduled appointments (see runAppointmentAutoComplete's
// doc comment) — offset 5 minutes past the hour from the reminder sweep above
// so the two don't hit the DB in the same instant.
cron.schedule("5 * * * *", runScheduledJob("Appointment Auto-Complete", () => runAppointmentAutoComplete("System (Appointment Auto-Complete Job)")));
// eslint-disable-next-line no-console
console.log("Appointment auto-complete scheduled hourly.");

// "Please confirm your appointment" — fixed 24-hours-before ask, offset 10
// minutes past the hour so it doesn't hit the DB alongside the two sweeps
// above. Not tied to Calendar Settings' reminderLeadMinutes (see
// runAppointmentConfirmationRequests's doc comment) — always runs.
cron.schedule("10 * * * *", runScheduledJob("Appointment Confirmation Requests", () => runAppointmentConfirmationRequests("System (Appointment Confirmation Request Job)")));
// eslint-disable-next-line no-console
console.log("Appointment confirmation requests scheduled hourly.");

// "Your payment is due tomorrow" — fires once a filing/deposit is marked
// filed with Save & Send and payment isn't recorded yet (MD Sales Tax, EFTPS/
// obligation-completion deposits, task-tracked agency filings). Offset 40
// minutes past the hour so it doesn't hit the DB alongside the other hourly
// sweeps above (see runPaymentDueReminders's own doc comment for the
// atomic-claim + re-verify-before-send design).
cron.schedule("40 * * * *", runScheduledJob("Payment Due Reminders", () => runPaymentDueReminders("System (Payment Due Reminder Job)")));
// eslint-disable-next-line no-console
console.log("Payment due reminders scheduled hourly.");

// Daily recurring-billing sweep — previously this only ran when a staff member
// remembered to click "Run Recurring Billing," so a forgotten click meant a late
// invoice. 6:00AM ET, before the 6:30 digest, so today's newly-created invoices
// can show up in it. The sweep itself is idempotent per schedule/period (see
// runRecurringBillingSweep's doc comment), so a schedule already run today is a
// no-op rather than a duplicate invoice — safe to also run manually the same day.
cron.schedule("0 6 * * *", runScheduledJob("Recurring Billing Sweep", () => runRecurringBillingSweep({ email: "System (Recurring Billing Job)", role: "admin" })), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Recurring billing sweep scheduled for 6:00AM America/New_York.");

// Stripe reconciliation sweep (ACC-012) — settleStripePaymentIfPaid previously
// only ran when the specific public invoice share link was reloaded; a client
// who paid and never bounced back through the success_url left their invoice
// "Unpaid" forever with no way for the firm to find out. Every 4 hours,
// idempotent (same locking/dedup as the page-load path), so this can't
// double-record even if it overlaps a live settle.
cron.schedule("20 */4 * * *", runScheduledJob("Stripe Reconciliation", () => runStripeReconciliation()));
// eslint-disable-next-line no-console
console.log("Stripe reconciliation sweep scheduled every 4 hours.");

// Payroll Agent sweep — staggered 15 minutes after the recurring-billing sweep
// to avoid both jobs hitting the DB in the same instant. Idempotent per
// schedule/pay-date (see runPayrollAgentSweep's doc comment) via the same
// pattern as recurring billing, so a manual "Run Agent Now" the same day is
// always safe to also fire. Unlike recurring billing, this never creates a
// real, GL-posted record on its own — only a Pending draft awaiting staff approval.
// Gated on the "Auto Payroll" toggle (v3_payroll_agent_settings) — staff can turn
// this automatic sweep off without touching the "Run Agent Now" manual trigger,
// which always works regardless of this flag. Recorded as "skipped", not
// "success", when the toggle is off — a real disabled-on-purpose state, not
// silence, but distinct from an actual sweep having run.
cron.schedule("15 6 * * *", () => {
  isPayrollAgentAutoRunEnabled()
    .then((enabled) => {
      if (!enabled) return recordJobRun("Payroll Agent Sweep", "skipped", "Auto Payroll toggle is off.");
      return runPayrollAgentSweep({ email: "System (Payroll Agent Job)", role: "admin" }).then(() => recordJobRun("Payroll Agent Sweep", "success"));
    })
    .catch((err) => {
      const detail = err instanceof Error ? (err.stack || err.message) : String(err);
      recordJobRun("Payroll Agent Sweep", "failure", detail);
      alertAdmins("Payroll agent sweep failed", detail);
    });
}, { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Payroll agent sweep scheduled for 6:15AM America/New_York.");

// Task Rules Agent sweep — staggered 5 minutes after Payroll Agent, same
// reasoning. Idempotent per rule/period (UNIQUE(rule_id, period_label) on
// v3_task_batch_drafts — see sql/034_task_rules_agent.sql), so a manual "Run
// Agent Now" the same day is always safe to also fire. Never creates real
// tasks on its own — only a Pending draft awaiting staff approval, same
// two-gate shape as Payroll Agent. Gated on the auto-run toggle
// (v3_task_rules_agent_settings); the manual trigger and the existing
// Create Batch Tasks flow both always work regardless of this flag.
cron.schedule("20 6 * * *", () => {
  isTaskRulesAgentAutoRunEnabled()
    .then((enabled) => {
      if (!enabled) return recordJobRun("Task Rules Agent Sweep", "skipped", "Auto-run toggle is off.");
      return runTaskRulesAgentSweep("System (Task Rules Agent Job)").then(() => recordJobRun("Task Rules Agent Sweep", "success"));
    })
    .catch((err) => {
      const detail = err instanceof Error ? (err.stack || err.message) : String(err);
      recordJobRun("Task Rules Agent Sweep", "failure", detail);
      alertAdmins("Task Rules Agent sweep failed", detail);
    });
}, { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Task Rules Agent sweep scheduled for 6:20AM America/New_York.");

// SWOT Findings sweep — generates new structured advisory findings from real
// data and auto-resolves any Auto finding whose condition has cleared (see
// runFindingsGenerateAndReconcile's doc comment in clients.routes.ts).
// Unlike the 3 Agents above, nothing here has a financial side effect (a
// finding is advisory text, not a posted record), so there's no
// Pending/Approve gate and no separate auto-run toggle — this always runs.
cron.schedule("25 6 * * *", runScheduledJob("SWOT Findings Sweep", () => runSwotFindingsSweep("System (SWOT Findings Sweep)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("SWOT findings sweep scheduled for 6:25AM America/New_York.");

// Client-facing MD Sales Tax deadline notice — staggered 2 minutes after the
// SWOT Findings sweep above so it always reads the current period's
// markedFiledDate off the same up-to-date data. Deliberately its own cron
// entry (not folded into the SWOT sweep) since it's a client-facing send with
// its own consent gate and dedup key, not a staff advisory finding. MD Sales
// Tax only for now, per owner decision — see runClientMdSalesTaxDeadlineNotifications's
// doc comment in clients.routes.ts.
cron.schedule("27 6 * * *", runScheduledJob("Client MD Sales Tax Deadline Notice", () => runClientMdSalesTaxDeadlineNotifications("System (Client MD Filing Notice Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Client MD sales tax deadline notice scheduled for 6:27AM America/New_York.");

// Client-facing compliance deadline reminders — direct owner request,
// 2026-08-26: the same idea as the MD Sales Tax notice above, generalized
// to the other 9 real obligation types (EFTPS, MD Withholding, MD UI,
// Business/Individual Tax Return, Estimated Tax, MD Annual Report, Federal
// Payroll Tax, 1099/W-2), each on its own configurable lead-day schedule
// (see v3_compliance_reminder_settings, Fix Center). Deliberately excludes
// MD Sales Tax (the sweep above already owns it) and staggered 2 minutes
// after it for the same "always reads current data" reason.
cron.schedule("29 6 * * *", runScheduledJob("Client Compliance Deadline Reminders", () => runComplianceDeadlineReminders("System (Compliance Reminder Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Client compliance deadline reminders scheduled for 6:29AM America/New_York.");

// Client risk-flag sweep (UX-005) — the "push" counterpart to the At-Risk
// Clients dashboard panel (UX-001): logs one audit event per client newly
// crossing into BalancePastDue/AgencyPastDue, which the 6:30 since-login
// digest below then picks up automatically ("Clients" is already in its
// module allowlist) — staff who weren't specifically looking at that panel
// still see it the next time they log in.
cron.schedule("22 6 * * *", runScheduledJob("Client Risk Flag Sweep", () => runClientRiskFlagSweep("System (Client Risk Flag Sweep)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Client risk flag sweep scheduled for 6:22AM America/New_York.");

// Monthly client snapshot — 1st of each month, after the month it records
// has fully closed. Feeds the At a Glance dashboard's "vs prior period" and
// 12-month trend (see GET /reports/client-monthly-snapshots/:clientId).
cron.schedule("0 7 1 * *", runScheduledJob("Monthly Client Snapshot", () => runMonthlySnapshotSweep("System (Monthly Snapshot Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Monthly client snapshot sweep scheduled for 7:00AM America/New_York on the 1st of each month.");

// Monthly management summary — staggered 15 minutes after the snapshot
// sweep so the figures it references (via each client's open SWOT
// findings) are current. One email per staff member across their assigned
// clients, idempotent per recipient per month.
cron.schedule("15 7 1 * *", runScheduledJob("Monthly Management Summary", () => runMonthlyManagementSummary("System (Monthly Management Summary Job)")), { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Monthly management summary scheduled for 7:15AM America/New_York on the 1st of each month.");

// Previously nothing caught these — a crash outside an Express request handler (a
// bad async callback, a rejected promise nobody awaited) just died silently except
// for whatever happened to scroll past in Railway's own logs. uncaughtException means
// the process is now in an undefined state, so this alerts then exits deliberately
// (Railway restarts it) rather than limping on; unhandledRejection just alerts, since
// most of those in this codebase are already deliberately-swallowed .catch(() => {})
// patterns elsewhere and forcing an exit here would be too aggressive.
process.on("uncaughtException", (err) => {
  const detail = err instanceof Error ? (err.stack || err.message) : String(err);
  Promise.race([alertAdmins("Server crashed (uncaught exception)", detail), new Promise((r) => setTimeout(r, 5000))])
    .finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  alertAdmins("Unhandled promise rejection", detail).catch(() => {});
});

const port = Number(process.env.PORT || 4000);
// BC-008 — reapply any DB-persisted JWT secret rotation before accepting
// requests, so a restart doesn't silently revert to .env's stale value.
applyPersistedJwtSecret().finally(() => {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`AL TAX backend (Phase 0) listening on :${port}`);
  });
});
