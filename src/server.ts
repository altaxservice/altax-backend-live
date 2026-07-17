import express from "express";
import helmet from "helmet";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { authRouter } from "./modules/auth/auth.routes";
import { clientsRouter } from "./modules/clients/clients.routes";
import { usersRouter } from "./modules/users/users.routes";
import { tasksRouter } from "./modules/tasks/tasks.routes";
import { documentsRouter } from "./modules/documents/documents.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import { communicationsRouter } from "./modules/communications/communications.routes";
import { accountingRouter } from "./modules/accounting/accounting.routes";
import { rulesRouter } from "./modules/rules/rules.routes";
import { vaultRouter } from "./modules/vault/vault.routes";
import { paymentMethodsRouter } from "./modules/paymentMethods/paymentMethods.routes";
import { systemRouter } from "./modules/system/system.routes";
import { templatesRouter } from "./modules/templates/templates.routes";
import { searchRouter } from "./modules/search/search.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { timeTrackingRouter } from "./modules/timeTracking/timeTracking.routes";
import { productsRouter } from "./modules/products/products.routes";
import { publicInvoiceRouter } from "./modules/billing/publicInvoice.routes";
import { remindersRouter, runReminders } from "./modules/reminders/reminders.routes";
import { firmSettingsRouter } from "./modules/firmSettings/firmSettings.routes";
import cron from "node-cron";

dotenv.config();

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "12mb" })); // covers base64-encoded file uploads (see documents.routes.ts POST /uploads) up to ~8MB raw

app.get("/health", (_req, res) => res.json({ ok: true, phase: "0-foundation" }));

// Read-only internal demo page (public/preview.html) — not part of the real client/staff
// app, just a way to see the API's data against real records without a frontend yet.
app.use(express.static("public"));

const frontendDist = path.join(__dirname, "..", "frontend", "dist");

// Several frontend page paths intentionally match API route prefixes 1:1 (the "/clients"
// page vs. "GET /clients" the list endpoint, "/firm-settings" the page vs. its own GET
// route, etc.) — both are correct on their own, but with the frontend and API on one
// origin, Express would otherwise route a real page load of e.g. "/clients" into the
// clients API instead of the app. The fix: real browser navigation (address bar, refresh,
// bookmark) always sends "Accept: text/html" first; this app's own fetch() calls never do
// (Content-Type is set, Accept is not, so it defaults to "*/*") — so intercepting only
// html-preferring GETs here, before any API router is mounted, serves the app for page
// loads while leaving every actual API call untouched.
app.get("*", (req, res, next) => {
  if (req.path.includes(".") || !req.headers.accept?.includes("text/html")) return next();
  res.sendFile(path.join(frontendDist, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.use("/auth", authRouter);
app.use("/clients", clientsRouter);
app.use("/users", usersRouter);
app.use("/tasks", tasksRouter);
app.use("/documents", documentsRouter);
app.use("/billing", billingRouter);
app.use("/communications", communicationsRouter);
app.use("/accounting", accountingRouter);
app.use("/rules", rulesRouter);
app.use("/vault", vaultRouter);
app.use("/payment-methods", paymentMethodsRouter);
app.use("/system", systemRouter);
app.use("/templates", templatesRouter);
app.use("/search", searchRouter);
app.use("/reports", reportsRouter);
app.use("/time-tracking", timeTrackingRouter);
app.use("/products", productsRouter);
app.use("/public/invoices", publicInvoiceRouter);
app.use("/reminders", remindersRouter);
app.use("/firm-settings", firmSettingsRouter);

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
    // eslint-disable-next-line no-console
    console.error("Daily reminders run failed:", err);
  });
}, { timezone: "America/New_York" });
// eslint-disable-next-line no-console
console.log("Daily reminders scheduled for 6:30AM America/New_York.");

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`AL TAX backend (Phase 0) listening on :${port}`);
});
