import { Router, Response } from "express";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { appendGl } from "../../common/accountingHelpers";
import { readWorkbookRows } from "../../common/xlsxReader";
import { extractPdfText, parsePdfBankLines } from "../../common/pdfBankReader";
import { scanFileForMalware } from "../../common/malwareScan";

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

/**
 * Bank Rec Agent — rule-based categorization suggestion for a bank line's
 * description, not an LLM/AI guess (same "deterministic, not probabilistic"
 * philosophy as auto-match above). Client-scoped rules only; the longest
 * matching rule wins so a specific rule ("APEX CARD SERVICES") beats a
 * generic one ("CARD"), with a deterministic tie-break (most-recently-
 * updated rule, then lowest rule_id) so two equal-length matches never
 * produce a random result.
 */
async function suggestCategory(clientId: string, description: string | null): Promise<{ account: string; ruleId: string } | null> {
  const desc = String(description || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!desc) return null;
  const rules = await query<any>(
    `SELECT rule_id, match_text, account_name, updated_at FROM altax.v3_je_category_rules WHERE client_id = $1 AND active = true`,
    [clientId]
  );
  let best: any = null;
  let bestNorm = "";
  for (const r of rules) {
    const norm = String(r.match_text || "").toUpperCase().replace(/\s+/g, " ").trim();
    if (!norm || !desc.includes(norm)) continue;
    if (!best || norm.length > bestNorm.length) { best = r; bestNorm = norm; continue; }
    if (norm.length === bestNorm.length) {
      const newer = new Date(r.updated_at).getTime() > new Date(best.updated_at).getTime();
      const sameAgeLowerId = new Date(r.updated_at).getTime() === new Date(best.updated_at).getTime() && String(r.rule_id) < String(best.rule_id);
      if (newer || sameAgeLowerId) { best = r; bestNorm = norm; }
    }
  }
  return best ? { account: best.account_name, ruleId: best.rule_id } : null;
}

/** Shared by the manual "New Entry" flow and Bank Rec Agent draft approval — the balanced 2-line GL entry a bank line needs. Does NOT touch matched_gl_entry_id; callers decide whether/when to mark the line matched. */
async function createBalancedBankLineEntry(
  client: { client_id: string; client_name: string },
  line: { statement_date: string; description: string | null; amount: number | string; account_name: string },
  offsetAccount: string,
  jeId: string,
  db: any
): Promise<string> {
  const amount = Number(line.amount);
  const bankDebit = amount > 0 ? amount : 0;
  const bankCredit = amount < 0 ? Math.abs(amount) : 0;
  const glEntryId = await appendGl(client.client_id, client.client_name, {
    entryDate: line.statement_date, ref: jeId, description: line.description || "Bank reconciliation entry",
    account: line.account_name, debit: bankDebit, credit: bankCredit, source: "Bank Reconciliation", notes: null,
  }, db);
  await appendGl(client.client_id, client.client_name, {
    entryDate: line.statement_date, ref: jeId, description: line.description || "Bank reconciliation entry",
    account: offsetAccount, debit: bankCredit, credit: bankDebit, source: "Bank Reconciliation", notes: null,
  }, db);
  return glEntryId;
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

  const scan = await scanFileForMalware(fileBuffer, `${accountName}-statement`);
  if (scan.scanned && !scan.clean) {
    return res.status(400).json({ error: `This file was flagged by malware scanning${scan.foundViruses?.length ? ` (${scan.foundViruses.join(", ")})` : ""} and was not uploaded.` });
  }

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
    const lineId = `BSL-${idSuffix()}-${inserted}`;
    await query(
      `INSERT INTO altax.v3_bank_statement_lines (line_id, client_id, account_name, statement_date, description, amount, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [lineId, clientId, accountName, line.date, line.description || null, line.amount, req.user!.email]
    );
    // Bank Rec Agent: every freshly-uploaded line gets a draft immediately, so
    // "read the statement and add the JE" happens on upload, not behind a
    // separate trigger — staff still has to approve before anything posts.
    const suggestion = await suggestCategory(clientId, line.description);
    await query(
      `INSERT INTO altax.v3_je_drafts (je_draft_id, client_id, client_name, bank_line_id, bank_account_name, amount, description, suggested_account, matched_rule_id, source_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Bank Rec Agent')`,
      [`JED-${idSuffix()}-${inserted}`, clientId, client.client_name, lineId, accountName, line.amount, line.description || null, suggestion?.account || null, suggestion?.ruleId || null]
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
  // "As of" scopes Book Balance and Cleared Balance to the SAME cutoff date
  // (defaults to today client-side) — without this, Book Balance was every
  // GL entry ever posted while Cleared Balance was only what happened to be
  // matched so far, so Difference could never reach zero for an account with
  // any real history and staff learned to ignore it. Reconciling "as of" a
  // real statement date is what actually makes the two comparable.
  const asOf = String(req.query.asOf || "").trim();
  const asOfClause = asOf ? " AND entry_date <= $3" : "";
  const asOfClauseBank = asOf ? " AND statement_date <= $3" : "";
  const params: any[] = asOf ? [clientId, accountName, asOf] : [clientId, accountName];

  // matched_gl_description/matched_gl_date: only populated for already-matched
  // lines, so the "Matched" section (see BankRecTab) can show what a line is
  // matched to — previously matched lines were dropped from the UI entirely
  // once matched, with no way to see or undo a match short of deleting the
  // bank line outright (which destroys the record instead of just unmatching).
  const bankLines = await query<any>(
    `SELECT b.line_id, b.statement_date, b.description, b.amount, b.matched_gl_entry_id,
            g.description AS matched_gl_description, g.entry_date AS matched_gl_date,
            d.je_draft_id, d.status AS je_draft_status
       FROM altax.v3_bank_statement_lines b
       LEFT JOIN altax.v3_gl_entries g ON g.gl_entry_id = b.matched_gl_entry_id
       LEFT JOIN altax.v3_je_drafts d ON d.bank_line_id = b.line_id
      WHERE b.client_id = $1 AND b.account_name = $2${asOfClauseBank}
      ORDER BY b.statement_date ASC`,
    params
  );

  // GL entries for this account not yet claimed by any bank line — candidates to
  // match against. Signed to the bank's own convention (debit=in for a cash asset
  // account, so "amount" here is debit-credit) so it lines up with bank_line.amount.
  const glCandidates = await query<any>(
    `SELECT gl_entry_id, entry_date, description, ref, (debit - credit) AS amount
       FROM altax.v3_gl_entries g
      WHERE client_id = $1 AND account = $2${asOfClause}
        AND NOT EXISTS (SELECT 1 FROM altax.v3_bank_statement_lines b WHERE b.matched_gl_entry_id = g.gl_entry_id)
      ORDER BY entry_date ASC`,
    params
  );

  const bookBalanceRow = await queryOne<any>(
    `SELECT COALESCE(SUM(debit - credit), 0) AS balance FROM altax.v3_gl_entries WHERE client_id = $1 AND account = $2${asOfClause}`,
    params
  );
  const clearedBalanceRow = await queryOne<any>(
    `SELECT COALESCE(SUM(amount), 0) AS balance FROM altax.v3_bank_statement_lines WHERE client_id = $1 AND account_name = $2 AND matched_gl_entry_id IS NOT NULL${asOfClauseBank}`,
    params
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

  // Candidates were computed from a snapshot taken above — applying them with
  // plain unguarded UPDATEs would let a concurrent manual match (or another
  // auto-match run) on the same line or GL entry get silently overwritten
  // (last write wins). Each UPDATE re-checks both sides are still unclaimed
  // at write time, inside one transaction, so a real conflict is skipped
  // rather than clobbered.
  let appliedCount = 0;
  await withTransaction(async (db) => {
    for (const m of matches) {
      const updated = await db.query(
        `UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2
           WHERE line_id = $1 AND matched_gl_entry_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM altax.v3_bank_statement_lines WHERE matched_gl_entry_id = $2)
           RETURNING line_id`,
        [m.lineId, m.glEntryId]
      );
      if (updated.length) appliedCount++;
    }
  });

  await logAudit("Accounting", "AUTO_MATCH_BANK_REC", clientId, "Account", "", accountName,
    `Auto-matched ${appliedCount} bank line(s) for ${accountName} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, matched: appliedCount, remaining: bankLines.length - appliedCount });
}));

/** Delete a bank statement line — a bad upload, a duplicate, or a footer/total row that got parsed as a transaction. Leaves any matched GL entry untouched; it just becomes unmatched again. */
bankRecRouter.post("/:lineId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { lineId } = req.params;
  const line = await queryOne<any>(`SELECT client_id FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  if (!line) return res.status(404).json({ error: "Bank statement line not found." });
  if (!(await canAccessClient(req.user!, line.client_id))) return res.status(403).json({ error: "You do not have access to this client." });

  // An Approved draft already posted a real GL entry from this line — deleting
  // the line would silently orphan that entry (nothing left to reconcile it
  // through). A Pending draft hasn't posted anything, so it's safe to let the
  // schema's ON DELETE CASCADE remove it along with the line.
  let hasApprovedDraft = false;
  await withTransaction(async (db) => {
    // FOR UPDATE here contends with approveJeDraft's own atomic claim UPDATE
    // on this same je_drafts row — a draft approved in the same instant a
    // delete is requested can no longer race past a stale "still Pending"
    // read; whichever gets here first blocks the other until it commits.
    const drafts = await db.query<any>(`SELECT status FROM altax.v3_je_drafts WHERE bank_line_id = $1 FOR UPDATE`, [lineId]);
    if (drafts.some((d) => d.status === "Approved")) { hasApprovedDraft = true; return; }
    await db.query(`DELETE FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [lineId]);
  });
  if (hasApprovedDraft) return res.status(400).json({ error: "This line has an approved journal entry — reconcile it or reverse the GL entry manually before deleting." });
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
  // Same exact-cents comparison as auto-match — a manual match that doesn't
  // actually balance would silently corrupt the cleared balance and hide the
  // real unmatched transaction (see bug found in the Accounting audit).
  if (Math.round(Number(line.amount) * 100) !== Math.round(Number(gl.amount) * 100)) {
    return res.status(400).json({ error: `Amounts don't match: bank line is $${Number(line.amount).toFixed(2)}, GL entry is $${Number(gl.amount).toFixed(2)}.` });
  }

  let claimedByOther = false;
  let lineAlreadyMatched = false;
  await withTransaction(async (db) => {
    // Lock the GL entry row first — two concurrent /match calls naming the
    // same glEntryId (from two different bank lines) now serialize here: the
    // second one blocks until the first commits, then its re-check below sees
    // the first's claim instead of both racing past a stale "not yet claimed"
    // read and double-claiming the same GL entry.
    await db.query(`SELECT gl_entry_id FROM altax.v3_gl_entries WHERE gl_entry_id = $1 FOR UPDATE`, [glEntryId]);
    const stillClaimed = await db.query(`SELECT line_id FROM altax.v3_bank_statement_lines WHERE matched_gl_entry_id = $1`, [glEntryId]);
    if (stillClaimed.length) { claimedByOther = true; return; }
    const updated = await db.query(
      `UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2 WHERE line_id = $1 AND matched_gl_entry_id IS NULL RETURNING line_id`,
      [lineId, glEntryId]
    );
    if (!updated.length) lineAlreadyMatched = true;
  });
  if (claimedByOther) return res.status(400).json({ error: "That GL entry is already matched to another bank line." });
  if (lineAlreadyMatched) return res.status(400).json({ error: "This line is already matched." });
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
  // Bank Rec Agent already has (or is working on) a draft for this line —
  // creating a second entry here would double-post the same transaction.
  const activeDraft = await queryOne<any>(`SELECT je_draft_id FROM altax.v3_je_drafts WHERE bank_line_id = $1 AND status != 'Dismissed'`, [lineId]);
  if (activeDraft) return res.status(400).json({ error: "This line has a pending or approved draft journal entry — use the draft instead of creating a new one." });

  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [line.client_id]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const jeId = `JE-${idSuffix()}`;
  let glEntryId = "";
  let alreadyMatched = false;
  let hasDraft = false;
  await withTransaction(async (db) => {
    // Row-lock the bank line for the duration of this transaction — a second
    // concurrent create-entry (or approve) call for the same line blocks here
    // until this one commits or rolls back, then re-reads the now-current
    // matched_gl_entry_id/draft state instead of racing past the earlier,
    // now-stale checks above and posting a second GL entry for the same line.
    const locked = await db.query(`SELECT matched_gl_entry_id FROM altax.v3_bank_statement_lines WHERE line_id = $1 FOR UPDATE`, [lineId]);
    if (locked[0]?.matched_gl_entry_id) { alreadyMatched = true; return; }
    const draftCheck = await db.query(`SELECT je_draft_id FROM altax.v3_je_drafts WHERE bank_line_id = $1 AND status != 'Dismissed'`, [lineId]);
    if (draftCheck.length) { hasDraft = true; return; }
    glEntryId = await createBalancedBankLineEntry(client, line, offsetAccount, jeId, db);
    await db.query(`UPDATE altax.v3_bank_statement_lines SET matched_gl_entry_id = $2 WHERE line_id = $1`, [lineId, glEntryId]);
  });
  if (alreadyMatched) return res.status(400).json({ error: "This line is already matched." });
  if (hasDraft) return res.status(400).json({ error: "This line has a pending or approved draft journal entry — use the draft instead of creating a new one." });

  await logAudit("Accounting", "CREATE_BANK_REC_ENTRY", glEntryId, "", "", String(line.amount),
    `GL entry created from bank line by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, glEntryId });
}));

/** Bank Rec Agent — Stage 1 review queue: drafts auto-created on upload, awaiting staff approval before anything posts. */
bankRecRouter.get("/:clientId/je-drafts", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const status = String(req.query.status || "Pending").trim();
  const accountName = String(req.query.accountName || "").trim();
  const params: any[] = [clientId, status];
  let accountClause = "";
  if (accountName) { params.push(accountName); accountClause = ` AND d.bank_account_name = $${params.length}`; }
  const drafts = await query<any>(
    `SELECT d.*, b.statement_date, r.match_text AS matched_rule_text
       FROM altax.v3_je_drafts d
       JOIN altax.v3_bank_statement_lines b ON b.line_id = d.bank_line_id
       LEFT JOIN altax.v3_je_category_rules r ON r.rule_id = d.matched_rule_id
      WHERE d.client_id = $1 AND d.status = $2${accountClause}
      ORDER BY b.statement_date ASC`,
    params
  );
  res.json({ drafts: drafts.map((d: any) => ({ ...d, amount: Number(d.amount) })) });
}));

/** Bank Rec Agent — Stage 1 approve: posts the balanced GL entry, does NOT mark the bank line matched (that's Stage 2, a separate explicit confirmation). */
async function approveJeDraft(draftId: string, actor: { email: string }, body: any): Promise<{ ok: true; glEntryId: string } | { ok: false; error: string }> {
  const draft = await queryOne<any>(`SELECT * FROM altax.v3_je_drafts WHERE je_draft_id = $1`, [draftId]);
  if (!draft) return { ok: false, error: "Draft not found." };
  if (draft.status !== "Pending") return { ok: false, error: `This draft is already ${draft.status}.` };

  const line = await queryOne<any>(`SELECT * FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [draft.bank_line_id]);
  if (!line) return { ok: false, error: "The underlying bank line no longer exists." };
  if (line.matched_gl_entry_id) return { ok: false, error: "This bank line was already matched outside the draft flow." };

  const overrides = body?.overrides || {};
  const account = String(overrides.account || draft.suggested_account || "").trim();
  if (!account) return { ok: false, error: "Pick a category before approving." };
  const description = String(overrides.description || draft.description || "Bank reconciliation entry").trim();

  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [draft.client_id]);
  if (!client) return { ok: false, error: "Client not found." };

  const jeId = `JE-${idSuffix()}`;
  let glEntryId = "";
  let claimFailed = false;
  let lineFailed = false;
  try {
    await withTransaction(async (db) => {
      // Atomic claim as the FIRST statement in the transaction — two concurrent
      // approve calls for the same draft (a double-click, or an individual
      // Approve firing while a bulk-approve is mid-flight) can no longer both
      // pass the earlier status read and both post a balanced GL entry: only
      // one UPDATE...WHERE status='Pending' can match the row, so the loser
      // gets zero rows back here and the whole transaction rolls back with
      // nothing posted, instead of double-posting the same bank line.
      const claimed = await db.query(
        `UPDATE altax.v3_je_drafts SET status = 'Approved', staff_overrides = $2, approved_by = $3, approved_at = now(), updated_at = now()
         WHERE je_draft_id = $1 AND status = 'Pending' RETURNING je_draft_id`,
        [draftId, Object.keys(overrides).length ? JSON.stringify(overrides) : null, actor.email]
      );
      if (!claimed.length) { claimFailed = true; return; }
      // Re-check under the transaction — the claim above already flipped this
      // draft's status, so if the bank line turns out to have been matched by
      // something else in the meantime, this throw is what rolls that claim
      // back too, instead of leaving the draft stuck "Approved" with nothing posted.
      const freshLine = await db.query(`SELECT matched_gl_entry_id FROM altax.v3_bank_statement_lines WHERE line_id = $1`, [draft.bank_line_id]);
      if (freshLine[0]?.matched_gl_entry_id) { lineFailed = true; throw new Error("__line_already_matched__"); }
      glEntryId = await createBalancedBankLineEntry(client, { ...line, description }, account, jeId, db);
      await db.query(
        `UPDATE altax.v3_je_drafts SET resulting_gl_entry_id = $2, resulting_je_ref = $3, updated_at = now() WHERE je_draft_id = $1`,
        [draftId, glEntryId, jeId]
      );
    });
  } catch (err) {
    if (!lineFailed) throw err;
  }
  if (claimFailed) {
    const fresh = await queryOne<any>(`SELECT status FROM altax.v3_je_drafts WHERE je_draft_id = $1`, [draftId]);
    return { ok: false, error: fresh ? `This draft is already ${fresh.status}.` : "Draft not found." };
  }
  if (lineFailed) return { ok: false, error: "This bank line was already matched outside the draft flow." };

  // The draft is already approved and the GL entry already posted at this
  // point — a failure saving the "remember this" rule (e.g. a DB hiccup) is a
  // secondary, best-effort step, not a reason to report the whole approval as
  // failed back to a staff member who'd then think nothing happened and retry.
  if (body?.rememberAsRule) {
    const ruleMatchText = String(body.ruleMatchText || line.description || "").trim();
    if (ruleMatchText) {
      try {
        await query(
          `INSERT INTO altax.v3_je_category_rules (rule_id, client_id, match_text, account_name, created_by)
           VALUES ($1,$2,$3,$4,$5)`,
          [`JER-${idSuffix()}`, draft.client_id, ruleMatchText, account, actor.email]
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[bankRec] Failed to save category rule after approving draft ${draftId}:`, err);
      }
    }
  }

  await logAudit("Accounting", "APPROVE_JE_DRAFT", glEntryId, "", "", account,
    `Bank Rec Agent draft approved by ${actor.email}.`, actor.email);

  return { ok: true, glEntryId };
}

bankRecRouter.post("/je-drafts/:id/approve", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT client_id FROM altax.v3_je_drafts WHERE je_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (!(await canAccessClient(req.user!, draft.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  const result = await approveJeDraft(req.params.id, req.user!, req.body || {});
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json(result);
}));

/** Bulk approve — partial success allowed, mirroring the Payroll Agent's approve-bulk. */
bankRecRouter.post("/je-drafts/approve-bulk", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draftIds: string[] = Array.isArray(req.body?.draftIds) ? req.body.draftIds : [];
  if (!draftIds.length) return res.status(400).json({ error: "draftIds is required." });
  const results: any[] = [];
  for (const draftId of draftIds) {
    const draft = await queryOne<any>(`SELECT client_id FROM altax.v3_je_drafts WHERE je_draft_id = $1`, [draftId]);
    if (!draft) { results.push({ draftId, ok: false, error: "Draft not found." }); continue; }
    if (!(await canAccessClient(req.user!, draft.client_id))) { results.push({ draftId, ok: false, error: "No access to this client." }); continue; }
    const result = await approveJeDraft(draftId, req.user!, {});
    results.push(result.ok ? { draftId, ok: true, glEntryId: result.glEntryId } : { draftId, ok: false, error: result.error });
  }
  res.json({ ok: true, results });
}));

/** Dismiss a Stage 1 draft — nothing was posted, so no reversal is needed. */
bankRecRouter.post("/je-drafts/:id/dismiss", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const draft = await queryOne<any>(`SELECT client_id, status FROM altax.v3_je_drafts WHERE je_draft_id = $1`, [req.params.id]);
  if (!draft) return res.status(404).json({ error: "Draft not found." });
  if (!(await canAccessClient(req.user!, draft.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  if (draft.status !== "Pending") return res.status(400).json({ error: `This draft is already ${draft.status}.` });
  const reason = String(req.body?.reason || "").trim();
  await query(
    `UPDATE altax.v3_je_drafts SET status = 'Dismissed', dismissed_reason = $2, dismissed_by = $3, dismissed_at = now(), updated_at = now() WHERE je_draft_id = $1`,
    [req.params.id, reason || null, req.user!.email]
  );
  res.json({ ok: true });
}));

/** Bank Rec Agent — Stage 2 review queue: Approved drafts whose bank line still isn't reconciled. Confirming reuses the existing /:lineId/match route unmodified. */
bankRecRouter.get("/:clientId/ready-to-reconcile", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const accountName = String(req.query.accountName || "").trim();
  const params: any[] = [clientId];
  let accountClause = "";
  if (accountName) { params.push(accountName); accountClause = ` AND d.bank_account_name = $${params.length}`; }
  const rows = await query<any>(
    `SELECT d.je_draft_id AS "draftId", d.bank_line_id AS "bankLineId", d.resulting_gl_entry_id AS "glEntryId",
            d.amount, d.description, d.resulting_je_ref AS "jeRef"
       FROM altax.v3_je_drafts d
       JOIN altax.v3_bank_statement_lines b ON b.line_id = d.bank_line_id
      WHERE d.client_id = $1 AND d.status = 'Approved' AND b.matched_gl_entry_id IS NULL${accountClause}
      ORDER BY b.statement_date ASC`,
    params
  );
  res.json({ ready: rows.map((r: any) => ({ ...r, amount: Number(r.amount) })) });
}));

/** Bank Rec Agent — per-client categorization rules ("if description contains X, suggest account Y"). */
bankRecRouter.get("/:clientId/je-rules", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const rules = await query<any>(`SELECT * FROM altax.v3_je_category_rules WHERE client_id = $1 ORDER BY active DESC, match_text ASC`, [clientId]);
  res.json({ rules });
}));

bankRecRouter.post("/je-rules", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.body?.clientId || "").trim();
  const matchText = String(req.body?.matchText || "").trim();
  const accountName = String(req.body?.accountName || "").trim();
  if (!clientId || !matchText || !accountName) return res.status(400).json({ error: "clientId, matchText, and accountName are required." });
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = await queryOne<any>(`SELECT client_id FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });
  const ruleId = `JER-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_je_category_rules (rule_id, client_id, match_text, account_name, created_by) VALUES ($1,$2,$3,$4,$5)`,
    [ruleId, clientId, matchText, accountName, req.user!.email]
  );
  res.status(201).json({ ok: true, ruleId });
}));

/** Update or deactivate/reactivate a rule. */
bankRecRouter.post("/je-rules/:id", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rule = await queryOne<any>(`SELECT client_id FROM altax.v3_je_category_rules WHERE rule_id = $1`, [req.params.id]);
  if (!rule) return res.status(404).json({ error: "Rule not found." });
  if (!(await canAccessClient(req.user!, rule.client_id))) return res.status(403).json({ error: "You do not have access to this client." });
  const body = req.body || {};
  const fields: string[] = [];
  const params: any[] = [req.params.id];
  if (body.matchText !== undefined) { params.push(String(body.matchText).trim()); fields.push(`match_text = $${params.length}`); }
  if (body.accountName !== undefined) { params.push(String(body.accountName).trim()); fields.push(`account_name = $${params.length}`); }
  if (body.active !== undefined) { params.push(Boolean(body.active)); fields.push(`active = $${params.length}`); }
  if (!fields.length) return res.status(400).json({ error: "Nothing to update." });
  fields.push(`updated_at = now()`);
  await query(`UPDATE altax.v3_je_category_rules SET ${fields.join(", ")} WHERE rule_id = $1`, params);
  res.json({ ok: true });
}));
