import crypto from "crypto";
import fs from "fs";
import path from "path";
import express, { Router, Response } from "express";
import { pool, query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { isEncryptionConfigured } from "../../common/encryption";
import { isSmsConfigured, isWhatsAppConfigured } from "../../common/notifications";
import { buildBackupObject, runDailyBackupEmail, isEncryptedBackup, decryptBackup } from "../../common/autoBackup";
import { WITHHOLDING_TAX_YEAR } from "../../common/withholdingTables";
import { persistRotatedJwtSecret } from "../../common/jwtSecret";

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
/**
 * Full data export — a backup the firm holds itself, independent of the
 * database provider.
 *
 * Neon's free tier keeps only about 24 hours of point-in-time history, and the
 * accounting module now performs real hard deletes (a sale or journal entry and
 * its ledger lines are removed, not flagged). Those two facts together mean a
 * mistake noticed on Monday about something deleted on Friday is unrecoverable
 * from the provider alone. This closes that window.
 *
 * Deliberately reads the table list from the database rather than a hardcoded
 * array: a backup that silently misses tables added later is worse than no
 * backup, because it looks like it worked. (The TABLES constant above is for
 * the diagnostics count screen and is allowed to be a curated subset.)
 *
 * WARNING: the output contains everything, including encrypted vault payloads
 * and client tax identifiers. It is only as safe as wherever it is stored.
 */
systemRouter.get("/backup/export", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { backup, tableCount, totalRows } = await buildBackupObject(req.user!.email);

  await logAudit("System", "BACKUP_EXPORT", "", "", "", String(totalRows),
    `Full data export downloaded by ${req.user!.email}: ${tableCount} tables, ${totalRows} rows.`,
    req.user!.email);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="altax-nexus-backup-${stamp}.json"`);
  res.send(JSON.stringify(backup, null, 2));
}));

/** Sends the weekly encrypted backup email right now — for testing the pipeline and for pre-work snapshots. */
systemRouter.post("/backup/email-now", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const result = await runDailyBackupEmail(req.user!.email);
  res.json({ ok: true, ...result });
}));

/** Row counts per table without shipping the data — a fast "is the backup worth taking" check. */
systemRouter.get("/backup/summary", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const tables = await query<any>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'altax' ORDER BY tablename`
  );
  const counts: { table: string; rows: number }[] = [];
  for (const t of tables) {
    const name = String(t.tablename);
    const r = await queryOne<any>(`SELECT count(*)::int AS c FROM altax."${name}"`);
    counts.push({ table: name, rows: Number(r?.c || 0) });
  }
  const size = await queryOne<any>(`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`);
  res.json({
    tableCount: tables.length,
    totalRows: counts.reduce((sum, c) => sum + c.rows, 0),
    databaseSize: size?.s || "unknown",
    tables: counts.sort((a, b) => b.rows - a.rows),
  });
}));

/**
 * Restore from a backup file produced by GET /backup/export.
 *
 * This REPLACES every table's contents with what the file holds, inside one
 * transaction — either the whole restore lands or nothing changes. That
 * atomicity is the safety story: a bad file, a mid-restore crash, or a table
 * mismatch rolls back to the exact pre-restore state.
 *
 * The body is the raw backup file sent as text/plain, not JSON: the global
 * express.json() parser has a 12MB cap sized for document uploads, and a
 * whole-database backup will outgrow that long before the database itself is
 * big. text/plain slips past that parser and gets its own 200MB budget here.
 *
 * Insert order is a topological sort of the live foreign-key graph (parents
 * before children), read from pg_constraint at restore time rather than
 * hardcoded — the same reasoning as the export reading pg_tables: a frozen
 * list rots silently as the schema grows.
 */
const restoreBodyParser = express.text({ type: "text/plain", limit: "200mb" });
systemRouter.post("/backup/restore", requireAuth, requireRole("admin"), restoreBodyParser, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (String(req.query.confirm || "") !== "RESTORE") {
    return res.status(400).json({ error: 'Type "RESTORE" to confirm replacing all current data.' });
  }

  // Weekly email attachments (.enc) decrypt transparently — same upload path,
  // no password step for the admin.
  let bodyText = String(req.body || "");
  if (isEncryptedBackup(bodyText)) {
    try {
      bodyText = decryptBackup(bodyText);
    } catch {
      return res.status(400).json({
        error: "This encrypted backup could not be unlocked. The server's backup key (BACKUP_PASSPHRASE / VAULT_MASTER_KEY) must be the same one that created it, and the file must be unmodified.",
      });
    }
  }
  let backup: any;
  try {
    backup = JSON.parse(bodyText);
  } catch {
    return res.status(400).json({ error: "That file is not a valid backup — it could not be read as JSON." });
  }
  if (!backup || backup.schema !== "altax" || typeof backup.data !== "object" || !backup.data) {
    return res.status(400).json({ error: "That file is not an AL TAX Nexus backup export. Use a file downloaded from Download Full Backup." });
  }

  const liveTables = (await query<any>(`SELECT tablename FROM pg_tables WHERE schemaname = 'altax'`))
    .map((t) => String(t.tablename));
  const backupTables = Object.keys(backup.data);
  const restorable = backupTables.filter((t) => liveTables.includes(t));
  const skippedFromBackup = backupTables.filter((t) => !liveTables.includes(t));
  const notInBackup = liveTables.filter((t) => !backupTables.includes(t));
  if (restorable.length === 0) {
    return res.status(400).json({ error: "None of the tables in that file exist in the current database." });
  }

  // Parents-first order from the live FK graph.
  const fkRows = await query<any>(
    `SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent
       FROM pg_constraint WHERE contype = 'f' AND connamespace = 'altax'::regnamespace`
  );
  const strip = (n: string) => n.replace(/^altax\./, "").replace(/"/g, "");
  const parentsOf = new Map<string, Set<string>>();
  for (const t of restorable) parentsOf.set(t, new Set());
  for (const fk of fkRows) {
    const child = strip(String(fk.child));
    const parent = strip(String(fk.parent));
    if (parentsOf.has(child) && restorable.includes(parent) && child !== parent) {
      parentsOf.get(child)!.add(parent);
    }
  }
  const ordered: string[] = [];
  const placed = new Set<string>();
  while (ordered.length < restorable.length) {
    const ready = restorable.filter((t) => !placed.has(t) && [...parentsOf.get(t)!].every((p) => placed.has(p)));
    if (ready.length === 0) {
      // FK cycle (none exist today) — append the remainder rather than hang.
      for (const t of restorable) if (!placed.has(t)) { ordered.push(t); placed.add(t); }
      break;
    }
    for (const t of ready) { ordered.push(t); placed.add(t); }
  }

  const client = await pool.connect();
  const restoredCounts: Record<string, number> = {};
  try {
    await client.query("BEGIN");
    const truncateList = restorable.map((t) => `altax."${t}"`).join(", ");
    await client.query(`TRUNCATE ${truncateList} CASCADE`);

    for (const table of ordered) {
      const rows: any[] = Array.isArray(backup.data[table]) ? backup.data[table] : [];
      restoredCounts[table] = 0;
      if (rows.length === 0) continue;
      // Only columns that still exist — an old backup may carry dropped columns,
      // and columns added since simply take their defaults.
      const liveColRows = (await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'altax' AND table_name = $1`,
        [table]
      )).rows as { column_name: string; data_type: string }[];
      const liveCols = liveColRows.map((r) => String(r.column_name));
      // json/jsonb columns need JSON.stringify even when the value is an array
      // (e.g. v3_fee_items.business_types) — the pg driver returns both a jsonb
      // array and a native `text[]`/`int[]` array as an indistinguishable plain
      // JS array, so the column's declared type (not the JS value's shape) is
      // the only reliable signal for which encoding it needs. Restore-drill
      // finding, 2026-08-13 (BC-005): a backup containing any jsonb-array row
      // previously aborted the entire restore transaction.
      const jsonCols = new Set(liveColRows.filter((r) => r.data_type === "json" || r.data_type === "jsonb").map((r) => r.column_name));
      const cols = Object.keys(rows[0]).filter((c) => liveCols.includes(c));
      if (cols.length === 0) continue;
      const colSql = cols.map((c) => `"${c}"`).join(", ");
      const CHUNK = 200;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const params: any[] = [];
        const tuples = chunk.map((row) => {
          const placeholders = cols.map((c) => {
            const v = row[c];
            params.push(v !== null && typeof v === "object" && jsonCols.has(c) ? JSON.stringify(v) : v);
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await client.query(`INSERT INTO altax."${table}" (${colSql}) VALUES ${tuples.join(", ")}`, params);
        restoredCounts[table] += chunk.length;
      }
    }

    // Serial columns (like the audit log id) must not hand out ids the restore
    // just re-inserted.
    const serials = (await client.query(
      `SELECT table_name, column_name, pg_get_serial_sequence('altax."' || table_name || '"', column_name) AS seq
         FROM information_schema.columns
        WHERE table_schema = 'altax' AND column_default LIKE 'nextval%'`
    )).rows.filter((r: any) => r.seq && restorable.includes(String(r.table_name)));
    for (const s of serials) {
      await client.query(
        `SELECT setval('${s.seq}', GREATEST((SELECT COALESCE(MAX("${s.column_name}"), 0) FROM altax."${s.table_name}"), 1))`
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const totalRows = Object.values(restoredCounts).reduce((s, n) => s + n, 0);
  await logAudit("System", "BACKUP_RESTORE", "", "", "", String(totalRows),
    `Database restored from backup dated ${backup.exportedAt || "unknown"} by ${req.user!.email}: ` +
    `${Object.keys(restoredCounts).length} tables, ${totalRows} rows.` +
    (skippedFromBackup.length ? ` Skipped (no longer exist): ${skippedFromBackup.join(", ")}.` : "") +
    (notInBackup.length ? ` Left untouched (not in backup): ${notInBackup.join(", ")}.` : ""),
    req.user!.email);

  res.json({
    ok: true,
    backupDate: backup.exportedAt || null,
    tablesRestored: Object.keys(restoredCounts).length,
    totalRows,
    skippedFromBackup,
    notInBackup,
  });
}));

systemRouter.get("/table-counts", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const results: { table: string; count: number }[] = [];
  for (const table of TABLES) {
    const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM altax.${table}`);
    results.push({ table, count: Number(rows[0]?.count || 0) });
  }
  res.json({ tables: results });
}));

/**
 * UX-015 (Hard Audit, 2026-08-13) — Fix Center's own text pointed staff at
 * "docs/MAINTENANCE_MANUAL.md in the project," which meant nothing to anyone
 * without a code editor open — the exact non-technical audience the manual
 * says it's written for. Serves the same file's raw markdown for the
 * frontend to render; kept read-only and admin-only (the manual covers
 * things like .env secrets and JWT rotation) rather than becoming an editable
 * CMS page, since it's still meant to be edited by a developer in the repo.
 * Path resolves from __dirname (dist/modules/system at runtime) up to the
 * project root, matching server.ts's identical pattern for marketing-site/
 * and frontend/dist — docs/ ships as part of the deployed repo tree, not
 * something the build step copies into dist/.
 */
systemRouter.get("/maintenance-manual", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const manualPath = path.join(__dirname, "..", "..", "..", "docs", "MAINTENANCE_MANUAL.md");
  try {
    const content = fs.readFileSync(manualPath, "utf8");
    res.json({ content });
  } catch {
    res.status(404).json({ error: "The maintenance manual file could not be found on this server." });
  }
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
systemRouter.get("/diagnostics", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
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

  // Federal/MD/VA/DC/DE payroll withholding uses hardcoded bracket tables (src/common/
  // withholdingTables.ts) that are only correct for the tax year WITHHOLDING_TAX_YEAR was
  // last bumped to — the IRS and each state republish brackets annually, usually Nov/Dec
  // for the following year, and nothing else in the app would ever notice if they went
  // stale. Unlike most of these checks, this one can't wait to be "warning" until it's
  // already wrong — once the calendar rolls past WITHHOLDING_TAX_YEAR, every paycheck run
  // that day is silently using the wrong brackets, so that state is "critical," not
  // "warning." The "warning" state exists purely to give a head start: the IRS/state
  // agencies typically publish next year's numbers in November/December, so a heads-up
  // starting in November leaves time to source and verify before it becomes urgent.
  // Every other date-sensitive spot in this codebase (server.ts cron jobs,
  // appointments.routes.ts) explicitly computes in America/New_York rather
  // than trusting the process's own local time — this firm is Eastern-time,
  // and a UTC-hosted server would otherwise flip the November-window and
  // January-1 cutovers up to 4-5 hours early/late relative to the real
  // Eastern date.
  const nowEastern = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const currentTaxYear = nowEastern.getFullYear();
  const isAnnualPrepWindow = nowEastern.getMonth() >= 10; // November (10) or December (11)
  const neededByTaxYear = isAnnualPrepWindow ? currentTaxYear + 1 : currentTaxYear;
  const withholdingSourcesNote = "Sources: IRS Publication 15-T (federal), MD Comptroller's Central Payroll Bureau withholding memo (Maryland), Virginia Tax's Income Tax Withholding Guide for Employers, DC OTR's individual income tax bracket schedule, and Delaware Division of Revenue's Tax Computation Schedule (from the PIT-EST instructions). Update the bracket constants in src/common/withholdingTables.ts, then bump the WITHHOLDING_TAX_YEAR constant at the top of that file.";
  if (WITHHOLDING_TAX_YEAR < currentTaxYear) {
    checks.push({ id: "withholding-tax-year", label: "Payroll withholding bracket tables", status: "critical", detail: `The federal/MD/VA/DC/DE withholding tables are still marked verified for tax year ${WITHHOLDING_TAX_YEAR}, but it's now ${currentTaxYear} — every paycheck calculated right now is using the wrong year's tax brackets. ${withholdingSourcesNote}` });
  } else if (WITHHOLDING_TAX_YEAR < neededByTaxYear) {
    checks.push({ id: "withholding-tax-year", label: "Payroll withholding bracket tables", status: "warning", detail: `Withholding tables are verified through tax year ${WITHHOLDING_TAX_YEAR}. Agencies typically publish ${neededByTaxYear} brackets around this time of year — source and verify them before January 1 so payroll doesn't run on stale numbers. ${withholdingSourcesNote}` });
  } else {
    checks.push({ id: "withholding-tax-year", label: "Payroll withholding bracket tables", status: "ok", detail: `Federal, MD, VA, DC, and DE withholding bracket tables are verified current for tax year ${WITHHOLDING_TAX_YEAR}.` });
  }

  // Communications audit (2026-08-19) found best-effort notification catch blocks
  // scattered across the app with inconsistent (or no) failure visibility — some
  // console.error'd, some wrote a one-off audit entry, some (notifyStaffOfAppointmentChange's
  // SMS/email sends) logged nothing at all. Every one of those sites now routes through
  // notifications.ts's recordNotificationFailure(), which always writes one queryable
  // "module: Notifications, action: SEND_FAILED" audit row (unless the failure is just an
  // unconfigured provider, which is expected state and already surfaced by the sms/email
  // checks above) — plus the two pre-existing ad hoc FAILED actions (auth OTP, billing
  // payment receipts), which already land in the same table. This check is the single
  // place staff can see every notification that failed to deliver in the last 7 days,
  // instead of needing to notice it in server logs or on a specific record.
  const recentNotificationFailures = await query<any>(
    `SELECT module, action, record_id, note, logged_at FROM altax.v3_audit_log
      WHERE logged_at > now() - interval '7 days'
        AND ((module = 'Notifications' AND action = 'SEND_FAILED') OR action IN ('EMAIL_OTP_SEND_FAILED', 'PAYMENT_RECEIPT_EMAIL_FAILED'))
      ORDER BY logged_at DESC`
  );
  checks.push(recentNotificationFailures.length === 0
    ? { id: "notification-failures", label: "Notification deliveries (last 7 days)", status: "ok", detail: "No email/SMS notification failed to send in the last 7 days." }
    : { id: "notification-failures", label: "Notification deliveries (last 7 days)", status: "warning", detail: `${recentNotificationFailures.length} notification(s) failed to send in the last 7 days: ${recentNotificationFailures.slice(0, 5).map((f: any) => `${f.record_id || f.module} — ${f.note} (${new Date(f.logged_at).toLocaleDateString()})`).join("; ")}${recentNotificationFailures.length > 5 ? "…" : ""}. The underlying action (payment, filing, appointment, etc.) already succeeded — only the notice about it failed. Whoever's listed as the recipient in each record above may not know something is waiting on them; consider following up directly.` });

  // --- Service Type / Services Provided vs. the granular per-obligation flags ---
  // Confirmed by direct investigation (2026-08-09): "Service Type" (Full Service,
  // Sales Tax Only, etc.) and "Services Provided" (the checkbox list) are NOT
  // connected to eftps_enabled/mdui_enabled/md_annual_report_enabled/
  // md_withholding_frequency/sales_tax_frequency/business_return_type by any code
  // path, database trigger, or the Task Rules Agent — they're three independent,
  // manually-maintained fields. Since the auto-flag system (computeClientFlags /
  // Task Rules Agent) only ever reads the granular fields, a client labeled "Full
  // Service" with none of them actually set gets zero compliance tracking despite
  // looking fully covered. These 5 checks surface that drift instead of silently
  // trusting the label. Nudges only — nothing here writes to a client record.
  const activeClientClause = `(status IS NULL OR lower(status) NOT IN ('no','false','inactive','archived'))`;

  const fullServiceUnconfigured = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause} AND service_type = 'Full Service'
        AND COALESCE(payroll_enabled, false) = false
        AND COALESCE(eftps_enabled, false) = false
        AND COALESCE(mdui_enabled, false) = false
        AND COALESCE(md_annual_report_enabled, false) = false
        AND (sales_tax_frequency IS NULL OR sales_tax_frequency IN ('', 'N/A'))
        AND (business_return_type IS NULL OR business_return_type IN ('', 'N/A'))`
  );
  checks.push(fullServiceUnconfigured.length === 0
    ? { id: "service-type-full-service-empty", label: "\"Full Service\" clients have obligations configured", status: "ok", detail: "Every client labeled Full Service has at least one compliance obligation (payroll, EFTPS, MD Withholding, MD UI, MD Annual Report, sales tax, or business return type) actually turned on." }
    : { id: "service-type-full-service-empty", label: "\"Full Service\" clients have obligations configured", status: "warning", detail: `${fullServiceUnconfigured.length} client(s) are labeled "Full Service" but have none of the compliance flags set — they'll get zero auto-flags no matter what's overdue: ${fullServiceUnconfigured.slice(0, 5).map((c: any) => c.client_name).join(", ")}${fullServiceUnconfigured.length > 5 ? "…" : ""}. Setting "Full Service" doesn't turn anything on automatically — review that client's profile and set the real obligations.` });

  const payrollWithoutTaxObligations = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause}
        AND (COALESCE(payroll_enabled, false) = true OR 'payroll' = ANY(services))
        AND COALESCE(eftps_enabled, false) = false
        AND COALESCE(mdui_enabled, false) = false
        AND (md_withholding_frequency IS NULL OR md_withholding_frequency IN ('', 'N/A'))`
  );
  checks.push(payrollWithoutTaxObligations.length === 0
    ? { id: "payroll-without-tax-obligations", label: "Payroll clients have payroll-tax deposits configured", status: "ok", detail: "Every client with payroll has at least one of EFTPS, MD Withholding, or MD UI configured." }
    : { id: "payroll-without-tax-obligations", label: "Payroll clients have payroll-tax deposits configured", status: "warning", detail: `${payrollWithoutTaxObligations.length} client(s) have Payroll enabled but none of EFTPS/MD Withholding/MD UI are configured — real federal/state deposit deadlines for these clients aren't being tracked at all: ${payrollWithoutTaxObligations.slice(0, 5).map((c: any) => c.client_name).join(", ")}${payrollWithoutTaxObligations.length > 5 ? "…" : ""}. Confirm which of these actually apply and set them on that client's profile.` });

  const taxObligationsWithoutPayroll = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause}
        AND (COALESCE(eftps_enabled, false) = true OR COALESCE(mdui_enabled, false) = true
             OR (md_withholding_frequency IS NOT NULL AND md_withholding_frequency NOT IN ('', 'N/A')))
        AND COALESCE(payroll_enabled, false) = false
        AND NOT ('payroll' = ANY(services))`
  );
  checks.push(taxObligationsWithoutPayroll.length === 0
    ? { id: "tax-obligations-without-payroll", label: "Payroll-tax obligations match a payroll service", status: "ok", detail: "No client has EFTPS/MD Withholding/MD UI turned on without Payroll also marked as a service." }
    : { id: "tax-obligations-without-payroll", label: "Payroll-tax obligations match a payroll service", status: "warning", detail: `${taxObligationsWithoutPayroll.length} client(s) have EFTPS, MD Withholding, or MD UI turned on but Payroll isn't marked as a service and payroll isn't enabled — possibly stale from a client who stopped running payroll: ${taxObligationsWithoutPayroll.slice(0, 5).map((c: any) => c.client_name).join(", ")}${taxObligationsWithoutPayroll.length > 5 ? "…" : ""}. Confirm whether these obligations still apply.` });

  const salesTaxNoFrequency = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause}
        AND (service_type = 'Sales Tax Only' OR 'sales_tax' = ANY(services))
        AND (sales_tax_frequency IS NULL OR sales_tax_frequency IN ('', 'N/A'))`
  );
  checks.push(salesTaxNoFrequency.length === 0
    ? { id: "sales-tax-frequency-missing", label: "Sales tax clients have a filing frequency set", status: "ok", detail: "Every client marked for sales tax has a real filing frequency, so MD sales tax flags can compute." }
    : { id: "sales-tax-frequency-missing", label: "Sales tax clients have a filing frequency set", status: "warning", detail: `${salesTaxNoFrequency.length} client(s) are marked for sales tax (Service Type or Services Provided) but have no filing frequency set — no sales tax due date can be computed for them at all: ${salesTaxNoFrequency.slice(0, 5).map((c: any) => c.client_name).join(", ")}${salesTaxNoFrequency.length > 5 ? "…" : ""}. Set Sales Tax Frequency on that client's profile.` });

  const businessEntityNoReturnType = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause}
        AND entity_type IS NOT NULL AND entity_type NOT IN ('', 'Individual')
        AND (business_return_type IS NULL OR business_return_type IN ('', 'N/A'))`
  );
  checks.push(businessEntityNoReturnType.length === 0
    ? { id: "business-return-type-missing", label: "Business clients have a return type set", status: "ok", detail: "Every non-individual client has a business return type set, so its business tax return deadline can be tracked." }
    : { id: "business-return-type-missing", label: "Business clients have a return type set", status: "warning", detail: `${businessEntityNoReturnType.length} client(s) have a real business entity type but no business return type set (1120/1120S/1065/Schedule C) — their business tax return deadline isn't being tracked: ${businessEntityNoReturnType.slice(0, 5).map((c: any) => c.client_name).join(", ")}${businessEntityNoReturnType.length > 5 ? "…" : ""}. Set Business Return Type on that client's profile.` });

  // Hard audit (2026-08-13), TAX-001: the "Full Service" check above only
  // catches clients labeled exactly that — Add Client defaults service_type to
  // blank, so a client onboarded without anyone picking a label (the actual
  // reported gap) escaped detection forever. This check has no service_type
  // condition at all — any active client with literally none of the
  // compliance-relevant fields set, regardless of label, so a blank/other
  // label can't hide the same problem.
  const zeroComplianceFlags = await query<any>(
    `SELECT client_id, client_name FROM altax.v3_clients
      WHERE ${activeClientClause}
        AND COALESCE(payroll_enabled, false) = false
        AND COALESCE(eftps_enabled, false) = false
        AND COALESCE(mdui_enabled, false) = false
        AND COALESCE(md_annual_report_enabled, false) = false
        AND COALESCE(w21099_enabled, false) = false
        AND (sales_tax_frequency IS NULL OR sales_tax_frequency IN ('', 'N/A'))
        AND (business_return_type IS NULL OR business_return_type IN ('', 'N/A'))
        AND (md_withholding_frequency IS NULL OR md_withholding_frequency IN ('', 'N/A'))
        AND (services IS NULL OR array_length(services, 1) IS NULL OR array_length(services, 1) = 0)`
  );
  checks.push(zeroComplianceFlags.length === 0
    ? { id: "zero-compliance-flags-any-client", label: "Every active client has at least one compliance obligation configured", status: "ok", detail: "No active client — regardless of Service Type label — has zero compliance flags set." }
    : { id: "zero-compliance-flags-any-client", label: "Every active client has at least one compliance obligation configured", status: "warning", detail: `${zeroComplianceFlags.length} active client(s) have absolutely no compliance obligation configured — no payroll, EFTPS, MD UI, MD Annual Report, W-2/1099, sales tax, business return type, or MD Withholding — so they'll never generate a single auto-flag or deadline: ${zeroComplianceFlags.slice(0, 5).map((c: any) => c.client_name).join(", ")}${zeroComplianceFlags.length > 5 ? "…" : ""}. Review each one and set what actually applies, even if that's genuinely nothing (e.g. a dormant or non-client record).` });

  // Only 3 of the app's 11 cron jobs used to write any durable record of
  // whether they actually ran — everything else lived only in console output
  // and a best-effort admin email, neither queryable after the fact. Every
  // job now upserts to v3_job_runs on every run (see common/jobRuns.ts); this
  // is the "did last night's automation actually run" answer, at a glance.
  const jobRuns = await query<any>(`SELECT job_name, last_run_at, last_status, last_detail FROM altax.v3_job_runs ORDER BY job_name ASC`);
  const failedJobs = jobRuns.filter((j: any) => j.last_status === "failure");
  checks.push(failedJobs.length === 0
    ? { id: "cron-job-last-run-status", label: "Background jobs last-run status", status: "ok", detail: jobRuns.length > 0 ? `All ${jobRuns.length} tracked background job(s) succeeded (or were intentionally skipped) on their last run.` : "No background job has recorded a run yet." }
    : { id: "cron-job-last-run-status", label: "Background jobs last-run status", status: "critical", detail: `${failedJobs.length} background job(s) failed on their last run: ${failedJobs.map((j: any) => `${j.job_name} (${new Date(j.last_run_at).toLocaleString()})`).join(", ")}. Check Railway logs for the full error — the admin alert email sent at the time has the detail too.` });

  // BC-002: backup-failure alerting previously only ever reached an admin
  // through the same Resend path a revoked API key would also break — a dead
  // email provider silently took out the backup, the alert about it, and
  // every other admin notification at once. This reads v3_job_runs directly
  // (no email involved at all), so it stays reliable even when Resend is down.
  const backupJob = jobRuns.find((j: any) => j.job_name === "Daily Backup Email");
  const daysSinceBackup = backupJob?.last_run_at ? Math.floor((Date.now() - new Date(backupJob.last_run_at).getTime()) / 86400000) : null;
  if (!backupJob) {
    checks.push({ id: "last-successful-backup", label: "Last successful backup", status: "warning", detail: "No backup job has run yet (or the app was just deployed) — the first daily backup email lands at 6:00AM America/New_York." });
  } else if (backupJob.last_status !== "success") {
    checks.push({ id: "last-successful-backup", label: "Last successful backup", status: "critical", detail: `The most recent backup run (${new Date(backupJob.last_run_at).toLocaleString()}) failed: ${backupJob.last_detail || "no detail recorded"}. Check RESEND_API_KEY and Railway logs — this is independent of email, so it stays accurate even if the alert email itself never arrived.` });
  } else if (daysSinceBackup !== null && daysSinceBackup > 2) {
    checks.push({ id: "last-successful-backup", label: "Last successful backup", status: "warning", detail: `Last successful backup was ${daysSinceBackup} days ago (${new Date(backupJob.last_run_at).toLocaleString()}) — expected daily. Check the cron job is still running.` });
  } else {
    checks.push({ id: "last-successful-backup", label: "Last successful backup", status: "ok", detail: `Last successful backup: ${new Date(backupJob.last_run_at).toLocaleString()}.` });
  }

  // TAX-007: a document request nudges the client forever (reminders.routes.ts's
  // daily digest) but never once flags staff — a client who simply never
  // responds can sit "Requested" indefinitely with nobody at the firm ever
  // seeing it as stale. Same freshness-check shape as the withholding-tax-year
  // check above, applied to a different kind of staleness.
  const staleDocRequests = await query<any>(
    `SELECT request_id, client_name, requested_item, request_date FROM altax.v3_document_requests
      WHERE status = 'Requested' AND request_date < now() - interval '14 days'
      ORDER BY request_date ASC`
  );
  checks.push(staleDocRequests.length === 0
    ? { id: "stale-document-requests", label: "Outstanding document requests", status: "ok", detail: "No open document request has been outstanding for more than 14 days." }
    : { id: "stale-document-requests", label: "Outstanding document requests", status: "warning", detail: `${staleDocRequests.length} document request(s) have been open for more than 14 days with no reply: ${staleDocRequests.slice(0, 5).map((r: any) => `${r.client_name} — ${r.requested_item} (requested ${new Date(r.request_date).toLocaleDateString()})`).join("; ")}${staleDocRequests.length > 5 ? "…" : ""}. Follow up directly, or mark it Not Applicable/Received if it's no longer needed.` });

  // Compliance-config checks are relevant to whoever does client onboarding —
  // frequently staff, not just admin — so staff get this narrower slice of
  // the page rather than being blocked from it entirely (see the checks below,
  // which stay admin-only: JWT/vault/email/SMS credential status, DB
  // connectivity, and portal-user lockout all reveal system-security state
  // that has no reason to be staff-visible).
  const STAFF_VISIBLE_CHECK_IDS = new Set([
    "service-type-full-service-empty", "zero-compliance-flags-any-client",
    "payroll-without-tax-obligations", "tax-obligations-without-payroll",
    "sales-tax-frequency-missing", "business-return-type-missing",
    "stale-document-requests",
  ]);
  const visibleChecks = req.user!.role === "admin" ? checks : checks.filter((c) => STAFF_VISIBLE_CHECK_IDS.has(c.id));

  res.json({ checks: visibleChecks });
}));

/**
 * Generates a fresh random JWT signing secret and writes it into the live
 * process's env var so it takes effect immediately (no restart needed).
 * BC-008 (Hard Audit, 2026-08-13): also persists it to Postgres
 * (v3_jwt_secret_rotation) so a later server restart reapplies the rotated
 * secret instead of silently reverting to .env's stale value — see
 * jwtSecret.ts's applyPersistedJwtSecret(), called once at server start.
 * .env on disk is still not touched directly (no safe way to rewrite this
 * backend's own config file mid-request), so the response still gives the
 * admin the line to paste in for local/dev copies of .env, but production no
 * longer depends on that manual step actually happening before a redeploy.
 * Rotating this immediately invalidates every existing login session
 * (everyone must sign in again) — that is the point, not a side effect, so
 * this is deliberately a separate typed-confirmation action rather than
 * bundled into a generic "fix everything" button.
 */
systemRouter.post("/diagnostics/rotate-jwt-secret", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const confirm = String(req.body?.confirm || "").trim();
  if (confirm !== "ROTATE LOGIN KEY") {
    return res.status(400).json({
      error: 'Type "ROTATE LOGIN KEY" to confirm. This signs every current user out immediately, and also invalidates every 2FA backup code issued so far (they\'re keyed off this same secret — see totp.ts) — anyone who might need one should re-enroll after rotating.',
    });
  }
  const newSecret = crypto.randomBytes(48).toString("base64");
  process.env.JWT_SECRET = newSecret;
  await persistRotatedJwtSecret(newSecret, req.user!.email);

  // SEC-003 x BC-008 interaction (found by independent review, 2026-08-13):
  // backup-code hashes are HMAC-keyed by this same JWT_SECRET, so rotating it
  // silently invalidates every already-issued backup code. Logged explicitly
  // so this isn't a silent side effect buried in an unrelated audit entry.
  await logAudit("System", "ROTATE_JWT_SECRET", "jwt-secret", "", "", "rotated",
    `Login security key rotated by ${req.user!.email}. All sessions invalidated, and every existing 2FA backup code is now invalid (backup codes are keyed off this secret).`, req.user!.email);

  res.json({
    ok: true,
    message: "Login security key rotated. Everyone (including you) will need to log in again. This is now durably saved, so it survives a server restart or redeploy.",
    warning: "This also invalidated every 2FA backup code issued so far, since they're keyed off this same secret. Anyone relying on a saved backup code should re-enroll 2FA to get a fresh set.",
    envLineToSave: `JWT_SECRET=${newSecret}`,
    note: "The line above is only needed if you also run this app locally against .env — the live server itself now persists the rotated key in the database and no longer depends on .env being updated by hand.",
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
      // 3 = scrypt (password.ts's SCRYPT_VERSION "v3", the strong current format);
      // anything else (NULL, 1, 2) is either the legacy unsalted SHA-256 hash or
      // the older iterated-hash "v2" format — both flagged Legacy so this column
      // stays a meaningful "still needs to sign in once to upgrade" signal.
      passwordStorage: !u.password_hash ? "Not Set" : u.password_hash_version === 3 ? "Current" : "Legacy",
      failedLoginCount: u.failed_login_count || 0,
      lockedUntil: u.locked_until,
      lastLogin: u.last_login,
    })),
    events,
  });
}));

// Everything logAudit() actually gets called with (see src/common/audit.ts callers)
// minus the two purely internal/noisy ones — Security has its own dedicated feed
// on the page above, and System is server-lifecycle stuff (backups, key rotation),
// not something staff did.
const ACTIVITY_DIGEST_MODULES = [
  "Accounting", "Billing", "Calculators", "Calendar", "Checklists", "Clients", "Communications",
  "Contractors", "Contracts", "Documents", "Employees", "Firm Portals", "Haccp", "Labels", "Leave",
  "Reminders", "Reports", "Rules", "Secure Vault", "Settings", "Staff", "Tasks", "Templates",
  "Time Tracking", "Tools",
];

/**
 * "What happened since I was last here" — the cutoff is previous_login, not
 * last_login: last_login is overwritten the instant the CURRENT session starts,
 * so it can never be used as the boundary for "since I logged in" without every
 * request seeing an empty window. previous_login is written by the same UPDATE,
 * one login behind, specifically so this has something stable to compare against.
 */
systemRouter.get("/activity-since-login", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const me = await queryOne<any>(`SELECT previous_login FROM altax.v3_users WHERE user_id = $1`, [req.user!.sub]);
  const since = me?.previous_login || null;
  if (!since) {
    return res.json({ since: null, count: 0, events: [] });
  }

  const events = await query<any>(
    `SELECT logged_at, user_email, module, action, note, record_id
       FROM altax.v3_audit_log
      WHERE logged_at > $1 AND module = ANY($2::text[])
      ORDER BY logged_at DESC
      LIMIT 200`,
    [since, ACTIVITY_DIGEST_MODULES]
  );
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM altax.v3_audit_log WHERE logged_at > $1 AND module = ANY($2::text[])`,
    [since, ACTIVITY_DIGEST_MODULES]
  );

  res.json({
    since,
    count: Number(countRow?.count || 0),
    truncated: Number(countRow?.count || 0) > events.length,
    events: events.map((e: any) => ({
      loggedAt: e.logged_at,
      userEmail: e.user_email,
      module: e.module,
      action: e.action,
      recordId: e.record_id,
      note: e.note,
    })),
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
  // Hard Audit finding, 2026-08-27: Additional Medicare Tax didn't exist
  // anywhere in the real payroll engine — every paycheck withheld Medicare
  // at a flat 1.45% no matter how high wages went. Employer withholding is
  // a flat $200k YTD wage trigger regardless of filing status (IRC
  // §3101(b)(2)) — the $250k/$125k MFJ/MFS thresholds only matter for the
  // employee's own Form 8959 return reconciliation, not for what an
  // employer withholds — so this reuses wage_cap as a flat-dollar
  // threshold, same convention as 1099_THRESHOLD below, not a real wage
  // ceiling. Employee-side only — there's no employer match for this one.
  { rateId: "MED_ADDL_EE", rateType: "Additional Medicare Tax (Employee)", rate: 0.009, wageCap: 200000, notes: "Extra employee-side Medicare withholding once YTD Medicare wages cross $200,000 — statutory, unchanged since 2013." },
  { rateId: "FUTA", rateType: "Federal Unemployment (FUTA)", rate: 0.006, wageCap: 7000, notes: "Employer-only federal unemployment tax." },
  { rateId: "SUTA", rateType: "State Unemployment (SUTA)", rate: 0.025, notes: "Employer-only state unemployment tax estimate." },
  // AUTO-011 (hard audit, 2026-08-13): the $600 1099-NEC reporting threshold
  // was hardcoded in accounting.routes.ts, inconsistent with every other rate
  // here — reuses wage_cap as a flat dollar amount rather than a percentage,
  // same as how the Social Security/FUTA rows above store their wage bases.
  { rateId: "1099_THRESHOLD", rateType: "1099-NEC Reporting Threshold", rate: 0, wageCap: 600, notes: "IRS reporting threshold — not a hard block; a firm may still issue a 1099-NEC below this if backup withholding applies. Statutory, stable for decades." },
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

  const managed: Record<string, string[]> = {};
  for (const category of Object.keys(MANAGED_DROPDOWN_DEFAULTS)) {
    managed[category] = await managedList(category);
  }

  res.json({
    clients,
    staff,
    ...managed,
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    coaAccounts,
    smsConfigured: isSmsConfigured(),
    whatsappConfigured: isWhatsAppConfigured(),
  });
}));

/**
 * Editable dropdown lists — the Settings manager's data layer.
 *
 * The lists above used to be literals inside GET /options; the owner asked for
 * a place to manage every dropdown without a code change. The literals now live
 * in MANAGED_DROPDOWN_DEFAULTS and act as the factory state: a category with no
 * rows in v3_dropdown_options serves its defaults unchanged, and the first edit
 * to a category copies the defaults into the table before applying (so editing
 * "add one task type" never silently discards the other twenty-five).
 *
 * Values are copied into records as plain text at creation time (a task keeps
 * saying "Sales Tax Filing" even if the option is later renamed), so removing
 * an option only affects future entries — deactivate hides it from the lists,
 * delete removes the row. Neither rewrites history.
 */
export const MANAGED_DROPDOWN_DEFAULTS: Record<string, { label: string; values: string[] }> = {
  taskTypes: { label: "Task / Service Types", values: [
    "Custom", "Other", "Sales Tax Filing & Payment", "Sales Tax Filing", "Sales Tax Payment", "Payroll Processing", "QBO Payroll Follow-Up", "Payroll Tax Deposit",
    "EFTPS Deposit", "MD Withholding Filing & Payment", "MD Withholding Filing", "MD Withholding", "MD UI Wages Filing & Payment", "MD UI",
    "MD Annual Report Filing & Payment", "MD Annual Report Filing", "MD Annual Report Payment", "Immigration Forms", "Business Formation",
    "EIN Registration", "Business License", "Health Permit", "Use & Occupancy Permit", "Trader's License", "Tobacco License", "Personal Tax",
    "Business Tax", "Business Return", "Bookkeeping", "IRS Notice", "State Notice",
  ] },
  immigrationFormTypes: { label: "Immigration Form Types", values: [
    "I-130 Petition for Alien Relative", "I-485 Adjustment of Status", "I-765 Employment Authorization",
    "I-864 Affidavit of Support", "N-400 Naturalization", "I-90 Green Card Renewal", "I-751 Remove Conditions",
    "I-589 Asylum", "DS-260 Immigrant Visa", "FOIA Request", "Other Immigration Form",
  ] },
  requestTypes: { label: "Request Types", values: [
    "Payroll", "Sales Tax", "Business Return", "Annual Report", "EFTPS", "Document Request", "IRS Notice",
    "State Notice", "New Employee", "Termination", "General Question", "Other",
  ] },
  requestedItems: { label: "Requested Document Items", values: [
    "Bank Statement", "POS Report", "Prior Year Tax Return", "W-2", "1099", "Profit & Loss Statement", "Balance Sheet",
    "Payroll Records", "Receipts / Invoices", "ID / EIN Documentation", "Lease Agreement", "Signed Engagement Letter", "Other",
  ] },
  priorities: { label: "Task Priorities", values: ["Normal", "Low", "High", "Urgent"] },
  taskStatuses: { label: "Task Statuses", values: [
    "Not Started", "In Progress", "In Process", "Waiting Docs", "Waiting on Client", "Pending", "Preparation",
    "Submitted", "In Review", "Inspection Phase", "Additional Information Required", "Fee Due", "Approved",
    "Completed", "Closed", "Archived", "Void",
  ] },
  invoiceStatuses: { label: "Invoice Statuses", values: ["Unpaid", "Partial", "Paid", "Void"] },
  documentStatuses: { label: "Document Request Statuses", values: ["Requested", "Open", "Waiting on Client", "Received", "Completed", "Closed", "Void"] },
  paymentMethods: { label: "Payment Methods", values: ["Cash", "Check", "Zelle", "Card", "ACH", "Wire", "Other"] },
  communicationChannels: { label: "Communication Channels", values: ["Email", "Portal Note", "SMS", "WhatsApp", "Phone"] },
  // "Permit / License Renewal Needed" and "Signature Needed (POA/W-4/W-9)" cover the two
  // gaps the automated flag engine (computeClientFlags -> complianceGapFlags.ts) can NOT
  // detect on its own: neither HACCP/business-license expiration nor POA/W4/W9 signing
  // deadlines have a real due-date column anywhere in the schema today, so staff still
  // have to notice and flag these by hand. See computeClientFlags's own "explicitly out
  // of scope" reasoning (clients.routes.ts) for why these stay manual.
  clientFlagCategories: { label: "Client Flag Categories", values: [
    "Balance Past Due", "Not in Good Standing", "Compliance Issue", "Permit / License Renewal Needed",
    "Signature Needed (POA/W-4/W-9)", "Missing Documentation", "Legal / Dispute",
    "Ownership Change Pending", "Collections", "Other",
  ] },
};

async function managedList(category: string): Promise<string[]> {
  const rows = await query<any>(
    `SELECT value FROM altax.v3_dropdown_options WHERE category = $1 AND active = true ORDER BY sort_order, value`,
    [category]
  );
  return rows.length ? rows.map((r) => String(r.value)) : (MANAGED_DROPDOWN_DEFAULTS[category]?.values || []);
}

/** Copies a category's factory defaults into the table the first time it is edited. */
async function ensureDropdownSeeded(category: string): Promise<void> {
  const existing = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_dropdown_options WHERE category = $1`, [category]);
  if (existing!.n > 0) return;
  const defaults = MANAGED_DROPDOWN_DEFAULTS[category]?.values || [];
  for (let i = 0; i < defaults.length; i++) {
    await query(
      `INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order) VALUES ($1,$2,$3,true,$4)`,
      [`OPT-${category}-${i + 1}-${Date.now()}`, category, defaults[i], (i + 1) * 10]
    );
  }
}

/** Every managed list with full row detail for the Settings screen (inactive rows included). */
systemRouter.get("/dropdowns", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query<any>(
    `SELECT option_id, category, value, active, sort_order FROM altax.v3_dropdown_options ORDER BY category, sort_order, value`
  );
  const byCategory = new Map<string, any[]>();
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push({ optionId: r.option_id, value: r.value, active: r.active, sortOrder: r.sort_order });
  }
  const categories = Object.entries(MANAGED_DROPDOWN_DEFAULTS).map(([key, def]) => ({
    category: key,
    label: def.label,
    customized: byCategory.has(key),
    options: byCategory.get(key)
      || def.values.map((v, i) => ({ optionId: null, value: v, active: true, sortOrder: (i + 1) * 10 })),
  }));
  res.json({ categories });
}));

systemRouter.post("/dropdowns/:category", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { category } = req.params;
  if (!MANAGED_DROPDOWN_DEFAULTS[category]) return res.status(404).json({ error: "Unknown dropdown list." });
  const value = String((req.body || {}).value || "").trim();
  if (!value) return res.status(400).json({ error: "The new option's text is required." });
  await ensureDropdownSeeded(category);
  const dup = await queryOne<any>(
    `SELECT 1 FROM altax.v3_dropdown_options WHERE category = $1 AND lower(value) = lower($2)`, [category, value]
  );
  if (dup) return res.status(400).json({ error: `"${value}" already exists in this list.` });
  const max = await queryOne<any>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM altax.v3_dropdown_options WHERE category = $1`, [category]);
  const optionId = `OPT-${category}-${Date.now()}`;
  await query(
    `INSERT INTO altax.v3_dropdown_options (option_id, category, value, active, sort_order) VALUES ($1,$2,$3,true,$4)`,
    [optionId, category, value, Number(max!.m) + 10]
  );
  await logAudit("Settings", "DROPDOWN_ADD", optionId, category, "", value, `Added "${value}" to ${category}.`, req.user!.email);
  res.status(201).json({ ok: true, optionId });
}));

systemRouter.patch("/dropdowns/option/:optionId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { optionId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_dropdown_options WHERE option_id = $1`, [optionId]);
  if (!existing) return res.status(404).json({ error: "Option not found." });
  const body = req.body || {};

  if (body.direction === "up" || body.direction === "down") {
    // Swap sort_order with the neighbour in that direction.
    const neighbour = await queryOne<any>(
      body.direction === "up"
        ? `SELECT option_id, sort_order FROM altax.v3_dropdown_options WHERE category = $1 AND sort_order < $2 ORDER BY sort_order DESC LIMIT 1`
        : `SELECT option_id, sort_order FROM altax.v3_dropdown_options WHERE category = $1 AND sort_order > $2 ORDER BY sort_order ASC LIMIT 1`,
      [existing.category, existing.sort_order]
    );
    if (neighbour) {
      await query(`UPDATE altax.v3_dropdown_options SET sort_order = $2 WHERE option_id = $1`, [optionId, neighbour.sort_order]);
      await query(`UPDATE altax.v3_dropdown_options SET sort_order = $2 WHERE option_id = $1`, [neighbour.option_id, existing.sort_order]);
    }
    return res.json({ ok: true });
  }

  const value = body.value !== undefined ? String(body.value).trim() : undefined;
  if (value !== undefined && !value) return res.status(400).json({ error: "The option's text cannot be empty." });
  const active = body.active !== undefined ? Boolean(body.active) : undefined;
  await query(
    `UPDATE altax.v3_dropdown_options SET value = COALESCE($2, value), active = COALESCE($3, active), updated_at = NOW() WHERE option_id = $1`,
    [optionId, value ?? null, active ?? null]
  );
  await logAudit("Settings", "DROPDOWN_EDIT", optionId, existing.category, String(existing.value),
    value ?? String(existing.value), `Edited "${existing.value}" in ${existing.category}${active !== undefined ? ` (active: ${active})` : ""}.`, req.user!.email);
  res.json({ ok: true });
}));

systemRouter.post("/dropdowns/option/:optionId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { optionId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_dropdown_options WHERE option_id = $1`, [optionId]);
  if (!existing) return res.status(404).json({ error: "Option not found." });
  await query(`DELETE FROM altax.v3_dropdown_options WHERE option_id = $1`, [optionId]);
  await logAudit("Settings", "DROPDOWN_DELETE", optionId, existing.category, String(existing.value), "",
    `Deleted "${existing.value}" from ${existing.category}. Existing records keep the text they were saved with.`, req.user!.email);
  res.json({ ok: true });
}));
