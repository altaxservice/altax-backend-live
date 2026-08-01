import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { rateLimit } from "./common/rateLimit";
import { pool } from "./config/db";
import { authRouter } from "./modules/auth/auth.routes";
import { clientsRouter } from "./modules/clients/clients.routes";
import { usersRouter } from "./modules/users/users.routes";
import { estimatesRouter } from "./modules/estimates/estimates.routes";
import { poaFormsRouter } from "./modules/poaForms/poaForms.routes";
import { govFormsRouter } from "./modules/govForms/govForms.routes";
import { calculatorsRouter } from "./modules/calculators/calculators.routes";
import { tasksRouter } from "./modules/tasks/tasks.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import { communicationsRouter } from "./modules/communications/communications.routes";
import { accountingRouter } from "./modules/accounting/accounting.routes";
import { payrollImportRouter } from "./modules/payrollImport/payrollImport.routes";
import { rulesRouter } from "./modules/rules/rules.routes";
import { vaultRouter } from "./modules/vault/vault.routes";
import { firmPortalsRouter } from "./modules/vault/firmPortals.routes";
import { paymentMethodsRouter } from "./modules/paymentMethods/paymentMethods.routes";
import { systemRouter } from "./modules/system/system.routes";
import { templatesRouter } from "./modules/templates/templates.routes";
import { searchRouter } from "./modules/search/search.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { timeTrackingRouter } from "./modules/timeTracking/timeTracking.routes";
import { productsRouter } from "./modules/products/products.routes";
import { publicInvoiceRouter } from "./modules/billing/publicInvoice.routes";
import { publicContactRouter } from "./modules/publicContact/publicContact.routes";
import { remindersRouter, runReminders } from "./modules/reminders/reminders.routes";
import { runWeeklyBackupEmail } from "./common/autoBackup";
import { firmSettingsRouter } from "./modules/firmSettings/firmSettings.routes";
import { contractsRouter } from "./modules/contracts/contracts.routes";
import { publicContractRouter } from "./modules/contracts/publicContract.routes";
import { publicMessageRouter } from "./modules/communications/publicMessage.routes";
import { haccpRouter } from "./modules/haccp/haccp.routes";
import { checklistsRouter } from "./modules/checklists/checklists.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import cron from "node-cron";
import { alertAdmins } from "./common/adminAlerts";

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
    },
  },
}));

// The app is same-origin in production (marketing site, portals, and API all served
// from altaxgroup.com by this one process) — cross-origin requests should only ever
// come from local dev (frontend on :5173 hitting this backend on :4000) or the
// Railway-assigned subdomain during the window before the custom domain was live.
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
    try {
      if (/\.up\.railway\.app$/.test(new URL(origin).hostname)) return callback(null, true);
    } catch {
      // Malformed Origin header — fall through to rejection below.
    }
    callback(new Error("Not allowed by CORS"));
  },
}));
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
  "/news": "news.html",
  "/contact": "contact.html",
  "/privacy": "privacy.html",
  "/sms-terms": "sms-terms.html",
  "/accessibility": "accessibility.html",
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
app.use("/import", payrollImportRouter);
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
app.use("/public/invoices", publicInvoiceRouter);
app.use("/public/contact", publicContactRouter);
app.use("/reminders", remindersRouter);
app.use("/firm-settings", firmSettingsRouter);
app.use("/contracts", contractsRouter);
app.use("/public/contracts", publicContractRouter);
app.use("/public/messages", publicMessageRouter);
app.use("/haccp", haccpRouter);
app.use("/checklists", checklistsRouter);
app.use("/budgets", budgetsRouter);

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

// Daily reminders — staff digest, firm digest, and client document/payment
// reminders (see reminders.routes.ts's runReminders doc comment: one consolidated
// email per recipient per day, never per-task). 6:30AM America/New_York, chosen to
// land in the user's requested 6-7AM Eastern window. This is safe as an in-process
// timer specifically because this app now runs as a persistent server (Railway),
// unlike the serverless/ephemeral hosting the original "no scheduler yet" decision
// was made under.
cron.schedule("30 6 * * *", () => {
  runReminders("System (Daily Reminder Job)").catch((err) => {
    alertAdmins("Daily reminders job failed", err instanceof Error ? (err.stack || err.message) : String(err));
  });
}, { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Daily reminders scheduled for 6:30AM America/New_York.");

// Sundays 6:00AM ET, before the 6:30 digest — the week's encrypted backup
// lands in the admin inbox without anyone remembering to click Download.
cron.schedule("0 6 * * 0", () => {
  runWeeklyBackupEmail("System (Weekly Backup Job)").catch((err) => {
    alertAdmins("Weekly backup email failed", err instanceof Error ? (err.stack || err.message) : String(err));
  });
}, { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Weekly encrypted backup email scheduled for Sundays 6:00AM America/New_York.");

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
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`AL TAX backend (Phase 0) listening on :${port}`);
});
