/**
 * One-time + incremental migration: reads every "v3_" tab from the existing
 * AL TAX Google Sheet (via the Sheets API, read-only) and upserts rows into
 * the matching PostgreSQL table created by sql/001_init_schema.sql.
 *
 * Run manually during Phase 0/1 parallel-run:
 *   npm run migrate:sheets
 *
 * This does NOT write back to Google Sheets and does NOT touch v3_Client_Secrets
 * or v3_Secret_Access_Log automatically — those are migrated separately with
 * extra review, per the migration plan's Phase 6 gate.
 */
import { google } from "googleapis";
import fs from "fs";
import dotenv from "dotenv";
import { pool } from "../config/db";
import schema from "../../sql/schema_source.json";

dotenv.config();

const RESTRICTED_TABLES = new Set(["v3_Client_Secrets", "v3_Secret_Access_Log"]);

function toSnakeColumn(col: string): string {
  let s = col.replace(/(?<!^)(?=[A-Z][a-z])/g, "_").replace(/(?<=[a-z0-9])(?=[A-Z])/g, "_");
  s = s.toLowerCase();
  if (/^[0-9]/.test(s)) s = (s.includes("eligible") || s.includes("enabled") ? "is_" : "f_") + s;
  return s;
}

const OVERRIDES: Record<string, Record<string, string>> = {
  v3_Audit_Log: { Timestamp: "logged_at", User: "user_email" },
  v3_Secret_Access_Log: { Timestamp: "logged_at", User: "user_email" },
};

async function getSheetsClient() {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string;
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

async function migrateTable(sheets: any, spreadsheetId: string, tableName: string, columns: string[]) {
  const pgTable = tableName.toLowerCase();
  console.log(`\n== ${tableName} -> altax.${pgTable} ==`);

  const range = `${tableName}!A1:ZZ`;
  const resp = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const values: string[][] = resp.data.values || [];
  if (values.length < 2) {
    console.log("  (no data rows, skipping)");
    return;
  }

  const header = values[0];
  const rows = values.slice(1);
  const colOverrides = OVERRIDES[tableName] || {};
  const pgColumns = header.map((h) => colOverrides[h] || toSnakeColumn(h));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let upserted = 0;

    for (const row of rows) {
      if (row.every((v) => !v)) continue; // skip fully blank rows

      const values2 = header.map((_, i) => row[i] ?? null);
      const placeholders = values2.map((_, i) => `$${i + 1}`).join(", ");
      const updateSet = pgColumns
        .filter((c) => !isPrimaryKeyColumn(tableName, header, c))
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(", ");

      const pkColumn = primaryKeyColumnFor(tableName, header, pgColumns);

      const sql = pkColumn
        ? `INSERT INTO altax.${pgTable} (${pgColumns.join(", ")})
           VALUES (${placeholders})
           ON CONFLICT (${pkColumn}) DO UPDATE SET ${updateSet}`
        : `INSERT INTO altax.${pgTable} (${pgColumns.join(", ")}) VALUES (${placeholders})`;

      await client.query(sql, values2);
      upserted++;
    }

    await client.query("COMMIT");
    console.log(`  upserted ${upserted} rows`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`  FAILED, rolled back: ${(err as Error).message}`);
  } finally {
    client.release();
  }
}

// Minimal PK lookup mirroring TABLE_PK in sql/generate_schema.py
const TABLE_PK: Record<string, string> = {
  v3_Clients: "ClientID", v3_Users: "UserID", v3_Tasks: "TaskID", v3_Task_Rules: "RuleID",
  v3_Invoices: "InvoiceID", v3_Payments: "PaymentID", v3_Recurring_Billing: "RecurringBillingID",
  v3_Document_Requests: "RequestID", v3_Archived_Tasks: "TaskID", v3_Task_Batches: "BatchID",
  v3_Sales_Input: "SaleID", v3_Payroll_Input: "PayrollInputID", v3_Paychecks: "PaycheckID",
  v3_Employees: "EmployeeID", v3_Contractor_Payments: "ContractorPaymentID",
  v3_Document_Uploads: "UploadID", v3_Manual_JE: "JEID", v3_GL_Entries: "GLEntryID",
  v3_Tax_Rates: "RateID", v3_Communications: "CommunicationID", v3_Templates: "TemplateID",
  v3_Payment_Methods: "PaymentMethodID", v3_Check_Settings: "SettingID",
  v3_Dropdown_Options: "OptionID", v3_COA: "AccountID",
};

function primaryKeyColumnFor(tableName: string, header: string[], pgColumns: string[]): string | null {
  const pk = TABLE_PK[tableName];
  if (!pk) return null;
  const idx = header.indexOf(pk);
  return idx >= 0 ? pgColumns[idx] : null;
}

function isPrimaryKeyColumn(tableName: string, header: string[], pgCol: string): boolean {
  const pk = TABLE_PK[tableName];
  if (!pk) return false;
  const idx = header.indexOf(pk);
  return idx >= 0 && pgCol === toSnakeColumn(pk);
}

async function main() {
  const spreadsheetId = process.env.SOURCE_SPREADSHEET_ID as string;
  if (!spreadsheetId) throw new Error("Set SOURCE_SPREADSHEET_ID in .env");

  const sheets = await getSheetsClient();
  const tableNames = Object.keys(schema as Record<string, string[]>);

  for (const tableName of tableNames) {
    if (RESTRICTED_TABLES.has(tableName)) {
      console.log(`\n== ${tableName} skipped (restricted — migrate separately with extra review) ==`);
      continue;
    }
    const columns = (schema as Record<string, string[]>)[tableName];
    try {
      await migrateTable(sheets, spreadsheetId, tableName, columns);
    } catch (err) {
      console.error(`Could not migrate ${tableName}: ${(err as Error).message}`);
    }
  }

  await pool.end();
  console.log("\nMigration pass complete.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
