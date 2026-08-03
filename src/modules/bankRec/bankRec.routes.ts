import { Router, Response } from "express";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { appendGl } from "../../common/accountingHelpers";
import { readWorkbookRows } from "../../common/xlsxReader";
import { extractPdfText, parsePdfBankLines } from "../../common/pdfBankReader";

/**
 * Manual bank reconciliation — staff upload a bank's own CSV/Excel statement
 * export, then match each line against an existing (unmatched) GL entry for
 * that account, or create the missing GL entry directly from the bank line
 * (e.g. a bank fee no one recorded yet). Reuses readWorkbookRows (the same
 * SheetJS reader the QBO/Drake payroll import already uses) rather than
 * inventing a second file-reading path.
 */
export const bankRecRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const DATE_KEYS = ["date", "transaction date", "posting date", "post date"];
const DESC_KEYS = ["description", "memo", "payee", "name", "details"];
const AMOUNT_KEYS = ["amount", "transaction amount"];
const DEBIT_KEYS = ["debit", "withdrawal", "withdrawals", "money out", "amount debit"];
const CREDIT_KEYS = ["credit", "deposit", "deposits", "money in", "amount credit"];

function findCol(header: string[], keys: string[]): number {
  return header.findIndex((h) => keys.includes(String(h || "").trim().toLowerCase()));
}

function parseAmount(raw: string): number | null {
  const cleaned = String(raw || "").replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDate(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Lenient generic-bank-CSV parser — unlike the QBO/Drake payroll import, there's no
 * single canonical "bank statement export" format to detect; every bank's CSV differs.
 * Finds the header row by looking for a Date-like column, then reads either a single
 * signed Amount column or separate Debit/Credit columns (Credit=in, Debit=out).
 */
function parseBankCsv(rows: string[][]): { lines: { date: string; description: string; amount: number }[]; error?: string } {
  let headerIdx = -1;
  let dateCol = -1, descCol = -1, amountCol = -1, debitCol = -1, creditCol = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const header = rows[i].map((c) => String(c || ""));
    const d = findCol(header, DATE_KEYS);
    if (d === -1) continue;
    headerIdx = i;
    dateCol = d;
    descCol = findCol(header, DESC_KEYS);
    amountCol = findCol(header, AMOUNT_KEYS);
    debitCol = findCol(header, DEBIT_KEYS);
    creditCol = findCol(header, CREDIT_KEYS);
    break;
  }
  if (headerIdx === -1) return { lines: [], error: "Could not find a Date column in this file's header row." };
  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    return { lines: [], error: "Could not find an Amount (or Debit/Credit) column in this file's header row." };
  }

  const lines: { date: string; description: string; amount: number }[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row.length) continue;
    const date = parseDate(row[dateCol]);
    if (!date) continue; // skips blank rows and trailing "Total"/footer rows
    const description = descCol >= 0 ? String(row[descCol] || "").trim() : "";
    let amount: number | null = null;
    if (amountCol >= 0) {
      amount = parseAmount(row[amountCol]);
    } else {
      const debit = parseAmount(row[debitCol]) || 0;
      const credit = parseAmount(row[creditCol]) || 0;
      amount = credit - Math.abs(debit);
    }
    if (amount === null) continue;
    lines.push({ date, description, amount });
  }
  return { lines };
}

bankRecRouter.post("/upload", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  const accountName = String(body.accountName || "").trim();
  if (!clientId || !accountName) return res.status(400).json({ error: "Client and account are required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const fileBase64 = String(body.fileBase64 || "").trim();
  if (!fileBase64) return res.status(400).json({ error: "No file was uploaded." });
  const sizeBytes = Math.ceil((fileBase64.length * 3) / 4);
  if (sizeBytes > MAX_UPLOAD_BYTES) return res.status(400).json({ error: "That file is too large — uploads are limited to 8MB." });

  const fileBuffer = Buffer.from(fileBase64, "base64");
  const isPdf = fileBuffer.subarray(0, 5).toString("latin1") === "%PDF-";

  let parsed: { lines: { date: string; description: string; amount: number }[]; error?: string };
  if (isPdf) {
    let text: string;
    try {
      text = await extractPdfText(fileBuffer);
    } catch {
      return res.status(400).json({ error: "Could not read this PDF." });
    }
    parsed = { lines: parsePdfBankLines(text) };
    if (!parsed.lines.length) {
      return res.status(400).json({ error: "Could not find any transaction lines in this PDF. Try a CSV/Excel export instead, or review the statement and enter lines manually." });
    }
  } else {
    let rows: string[][];
    try {
      rows = readWorkbookRows(fileBuffer);
    } catch {
      return res.status(400).json({ error: "Could not read this file." });
    }
    parsed = parseBankCsv(rows);
  }
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!parsed.lines.length) return res.status(400).json({ error: "No transaction rows were found in this file." });

  let inserted = 0;
  for (const line of parsed.lines) {
    await query(
      `INSERT INTO altax.v3_bank_statement_lines (line_id, client_id, account_name, statement_date, description, amount, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`BSL-${idSuffix()}-${inserted}`, clientId, accountName, line.date, line.description || null, line.amount, req.user!.email]
    );
    inserted++;
  }

  await logAudit("Accounting", "UPLOAD_BANK_STATEMENT", clientId, "Account", "", accountName,
    `Bank statement uploaded (${inserted} lines) for ${accountName} by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, inserted });
}));

bankRecRouter.get("/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const accountName = String(req.query.accountName || "").trim();
  if (!accountName) return res.status(400).json({ error: "accountName is required." });

  const bankLines = await query<any>(
    `SELECT line_id, statement_date, description, amount, matched_gl_entry_id
       FROM altax.v3_bank_statement_lines
      WHERE client_id = $1 AND account_name = $2
      ORDER BY statement_date ASC`,
    [clientId, accountName]
  );

  // GL entries for this account not yet claimed by any bank line — candidates to
  // match against. Signed to the bank's own convention (debit=in for a cash asset
  // account, so "amount" here is debit-credit) so it lines up with bank_line.amount.
  const glCandidates = await query<any>(
    `SELECT gl_entry_id, entry_date, description, ref, (debit - credit) AS amount
       FROM altax.v3_gl_entries g
      WHERE client_id = $1 AND account = $2
        AND NOT EXISTS (SELECT 1 FROM altax.v3_bank_statement_lines b WHERE b.matched_gl_entry_id = g.gl_entry_id)
      ORDER BY entry_date ASC`,
    [clientId, accountName]
  );

  const bookBalanceRow = await queryOne<any>(
    `SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM altax.v3_gl_entries WHERE client_id = $1 AND account = $2`,
    [clientId, accountName]
  );
  const clearedBalanceRow = await queryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM altax.v3_bank_statement_lines WHERE client_id = $1 AND account_name = $2 AND matched_gl_entry_id IS NOT NULL`,
    [clientId, accountName]
  );

  res.json({
    bankLines: bankLines.map((b: any) => ({ ...b, amount: Number(b.amount) })),
    glCandidates: glCandidates.map((g: any) => ({ ...g, amount: Number(g.amount) })),
    bookBalance: Number(bookBalanceRow?.balance || 0),
    clearedBalance: Number(clearedBalanceRow?.balance || 0),
  });
}));

/**
 * Auto-match — deterministic amount + nearest-date matching, not an AI/LLM guess.
 * For money, an exact-to-the-cent match is either genuinely the same transaction
 * or a coincidence worth a human looking at — a probabilistic "AI" match would
 * add uncertainty exactly where none is acceptable. Claims each unmatched bank
 * line against the unmatched GL entry with the identical signed amount that's
 * closest in date (within a 10-day window, since a debit can lag its GL posting
 * by a few days); anything without an exact-amount match in that window is left
 * for manual review/match or "New Entry."
 */
bankRecRouter.post("/:clientId/auto-match", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const accountName = String(req.query.accountName || req.body?.accountName || "").trim();
  if (!accountName) return res.status(400).json({ error: "accountName is required." });

  const bankLines = await query<any>(
    `SELECT line_id, statement_date, amount FROM altax.v3_bank_statement_lines
      WHERE client_id = $1 AND account_name = $2 AND matched_gl_entry_id IS NULL
      ORDER BY statement_date ASC`,
    [clientId, accountName]
  );
  const glCandidates = await query<any>(
    `SELECT gl_entry_id, entry_date, (debit - credit) AS amount
       FROM altax.v3_gl_entries g
      WHERE client_id = $1 AND account = $2
        AND NOT EXISTS (SELECT 1 FROM altax.v3_bank_statement_lines b WHERE b.matched_gl_entry_id = g.gl_entry_id)`,
    [clientId, accountName]
  );

  const DAY_MS = 24 * 60 * 60 * 1000;
  const claimed = new Set<string>();
  const matches: { lineId: string; glEntryId: string }[] = [];

  for (const line of bankLines) {
    const lineAmountCents = Math.round(Number(line.amount) * 100);
    const lineDate = new Date(line.statement_date).getTime();
    let best: any = null;
    let bestDiff = Infinity;
    for (const g of glCandidates) {
      if (claimed.has(g.gl_entry_id)) continue;
      if (Math.round(Number(g.amount) * 100) !== lineAmountCents) continue;
      const diff = Math.abs(new Date(g.entry_date).getTime() - lineDate);
      if (diff > 10 * DAY_MS) continue;
      if (diff < bestDiff) { bestDiff = diff; best = g; }
    }
    if (best) {
      claimed.add(best.gl_entry_id);
      matches.push({ lineId: line.line_id, glEntryId: best.gl_entry_id });
    }
  }

  for (const m of matches) {
    await query(`UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2 WHERE line_id = $1`, [m.lineId, m.glEntryId]);
  }

  await logAudit("Accounting", "AUTO_MATCH_BANK_REC", clientId, "Account", "", accountName,
    `Auto-matched ${matches.length} bank line(s) for ${accountName} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, matched: matches.length, remaining: bankLines.length - matches.length });
}));

/** Delete a bank statement line — a bad upload, a duplicate, or a footer/total row that got parsed as a transaction. Leaves any matched GL entry untouched; it just becomes unmatched again. */
bankRecRouter.post("/:lineId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { lineId } = req.params;
  const line = await queryOne<any>(`SELECT client_id FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  if (!line) return res.status(404).json({ error: "Bank statement line not found." });
  if (!(await canAccessClient(req.user!, line.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  await query(`DELETE FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  res.json({ ok: true });
}));

/** Match an unmatched bank line to an existing unmatched GL entry. */
bankRecRouter.post("/:lineId/match", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { lineId } = req.params;
  const glEntryId = String(req.body?.glEntryId || "").trim();
  if (!glEntryId) return res.status(400).json({ error: "glEntryId is required." });

  const line = await queryOne<any>(`SELECT * FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  if (!line) return res.status(404).json({ error: "Bank statement line not found." });
  if (!(await canAccessClient(req.user!, line.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  if (line.matched_gl_entry_id) return res.status(400).json({ error: "This line is already matched." });

  const gl = await queryOne<any>(`SELECT gl_entry_id, (debit - credit) AS amount FROM altax.v3_gl_entries WHERE gl_entry_id = $1 AND client_id = $2`, [glEntryId, line.client_id]);
  if (!gl) return res.status(404).json({ error: "GL entry not found for this client." });
  const alreadyClaimed = await queryOne<any>(`SELECT line_id FROM altax.v3_bank_statement_lines WHERE matched_gl_entry_id = $1`, [glEntryId]);
  if (alreadyClaimed) return res.status(400).json({ error: "That GL entry is already matched to another bank line." });
  // Same exact-cents comparison as auto-match — a manual match that doesn't
  // actually balance would silently corrupt the cleared balance and hide the
  // real unmatched transaction (see bug found in the Accounting audit).
  if (Math.round(Number(line.amount) * 100) !== Math.round(Number(gl.amount) * 100)) {
    return res.status(400).json({ error: `Amounts don't match: bank line is $${Number(line.amount).toFixed(2)}, GL entry is $${Number(gl.amount).toFixed(2)}.` });
  }

  await query(`UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2 WHERE line_id = $1`, [lineId, glEntryId]);
  res.json({ ok: true });
}));

/** Unmatch a previously-matched bank line. */
bankRecRouter.post("/:lineId/unmatch", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { lineId } = req.params;
  const line = await queryOne<any>(`SELECT client_id FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  if (!line) return res.status(404).json({ error: "Bank statement line not found." });
  if (!(await canAccessClient(req.user!, line.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  await query(`UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = NULL WHERE line_id = $1`, [lineId]);
  res.json({ ok: true });
}));

/**
 * Create the missing GL entry directly from a bank line (e.g. a bank fee nobody
 * recorded) — a simple balanced 2-line entry: the bank account itself, plus an
 * offset account the caller supplies (staff has to categorize it; the software
 * can't guess whether an unexplained charge is a bank fee or something else).
 */
bankRecRouter.post("/:lineId/create-entry", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { lineId } = req.params;
  const offsetAccount = String(req.body?.offsetAccount || "").trim();
  if (!offsetAccount) return res.status(400).json({ error: "Pick an account to offset this transaction against." });

  const line = await queryOne<any>(`SELECT * FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  if (!line) return res.status(404).json({ error: "Bank statement line not found." });
  if (!(await canAccessClient(req.user!, line.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  if (line.matched_gl_entry_id) return res.status(400).json({ error: "This line is already matched." });

  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [line.client_id]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const amount = Number(line.amount);
  const bankDebit = amount > 0 ? amount : 0;
  const bankCredit = amount < 0 ? Math.abs(amount) : 0;
  const jeId = `JE-${idSuffix()}`;

  let glEntryId = "";
  await withTransaction(async (db) => {
    glEntryId = await appendGl(client.client_id, client.client_name, {
      entryDate: line.statement_date, ref: jeId, description: line.description || "Bank reconciliation entry",
      account: line.account_name, debit: bankDebit, credit: bankCredit, source: "Bank Reconciliation", notes: null,
    }, db);
    await appendGl(client.client_id, client.client_name, {
      entryDate: line.statement_date, ref: jeId, description: line.description || "Bank reconciliation entry",
      account: offsetAccount, debit: bankCredit, credit: bankDebit, source: "Bank Reconciliation", notes: null,
    }, db);
    await db.query(`UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2 WHERE line_id = $1`, [lineId, glEntryId]);
  });

  await logAudit("Accounting", "CREATE_BANK_REC_ENTRY", glEntryId, "", "", String(amount),
    `GL entry created from bank line by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, glEntryId });
}));
