import { query } from "../../config/db";

/**
 * Guards every payroll file import against landing on the wrong client. The
 * import screens are client-scoped (staff pick a client, then upload), and
 * nothing used to compare the file with that client — so a file for one company
 * imported cleanly into another, and a big import was painful to unwind.
 *
 * Two independent signals:
 *  1. The company name in the file. QuickBooks exports put it in the first cell.
 *     Other exports are scanned for a "Company:/Client:" line or for any known
 *     client's name in the header rows.
 *  2. The employees in the file. If none of them belong to the selected client
 *     but they do belong to another, that's the strongest evidence of a wrong
 *     client, and it works for exports that never print a company name.
 *
 * "match" lets the import proceed; "mismatch" and "unknown" make the screen
 * (and the commit route) require an explicit confirmation.
 */
export interface CompanyCheck {
  status: "match" | "mismatch" | "unknown";
  detectedName: string | null;
  reasons: string[];
  employees: { total: number; matched: number; clientHasEmployees: boolean };
  suggestedClients: { clientId: string; clientName: string; reason: string }[];
}

interface ClientLite { client_id: string; client_name: string; dba_name?: string | null }

const NOISE_WORDS = new Set(["INC", "INCORPORATED", "LLC", "LLP", "LP", "CORP", "CORPORATION", "CO", "COMPANY", "LTD", "THE", "PC", "PLLC"]);

function normalizeCompany(name: string): string {
  const words = String(name || "").toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  return words.filter((w) => !NOISE_WORDS.has(w)).join(" ");
}

export function companyNamesMatch(a: string, b: string): boolean {
  const x = normalizeCompany(a);
  const y = normalizeCompany(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x];
  return shorter.length >= 6 && longer.startsWith(`${shorter} `);
}

function normalizePerson(name: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).join(" ");
}
/** "Smith, John A" and "John A Smith" are the same person; compare as an unordered set of words. */
function personKey(name: string): string {
  return normalizePerson(name).split(" ").sort().join(" ");
}

/**
 * Reads the company a payroll file is for. QuickBooks puts it in the first
 * cell above the report title; for other exports, a "Company:/Client:/Employer:"
 * line, or any known client's name appearing in the first rows.
 */
export function detectCompanyName(rows: string[][], clients: ClientLite[]): string | null {
  const cell = (r: number, c: number) => String(rows[r]?.[c] ?? "").trim();
  const firstCell = cell(0, 0);
  const secondCell = cell(1, 0);
  // QBO: row 0 = company, row 1 = "Payroll details report" / "Employee details report".
  if (firstCell && /report$/i.test(secondCell) && !/report$/i.test(firstCell)) return firstCell;

  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    for (let c = 0; c < 4; c++) {
      const text = cell(r, c);
      const labelled = /^(?:company|client|employer|business)(?:\s+name)?\s*[:\-]\s*(.+)$/i.exec(text);
      if (labelled) return labelled[1].trim();
    }
  }
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    for (let c = 0; c < 4; c++) {
      const text = cell(r, c);
      if (text.length < 4) continue;
      const hit = clients.find((cl) => companyNamesMatch(text, cl.client_name) || (cl.dba_name ? companyNamesMatch(text, cl.dba_name) : false));
      if (hit) return text;
    }
  }
  return null;
}

export async function checkCompany(opts: { client: ClientLite; detectedName: string | null; employeeNames: string[] }): Promise<CompanyCheck> {
  const { client, detectedName } = opts;
  const allClients = await query<ClientLite>(`SELECT client_id, client_name, dba_name FROM altax.v3_clients`);
  const reasons: string[] = [];
  const suggested = new Map<string, { clientId: string; clientName: string; reason: string }>();

  // --- signal 1: company name in the file
  let nameStatus: "match" | "mismatch" | "unknown" = "unknown";
  if (detectedName) {
    const matchesSelected = companyNamesMatch(detectedName, client.client_name) || (client.dba_name ? companyNamesMatch(detectedName, client.dba_name) : false);
    if (matchesSelected) nameStatus = "match";
    else {
      nameStatus = "mismatch";
      reasons.push(`This file is for "${detectedName}", but you're importing into "${client.client_name}".`);
      for (const c of allClients) {
        if (c.client_id !== client.client_id && (companyNamesMatch(detectedName, c.client_name) || (c.dba_name ? companyNamesMatch(detectedName, c.dba_name) : false))) {
          suggested.set(c.client_id, { clientId: c.client_id, clientName: c.client_name, reason: "Company name in the file matches this client." });
        }
      }
    }
  } else {
    reasons.push("The file doesn't show a company name, so it can't be matched to a client by name.");
  }

  // --- signal 2: employees in the file
  const fileKeys = Array.from(new Set(opts.employeeNames.map(personKey).filter(Boolean)));
  const owned = await query<{ n: string }>(
    `SELECT employee_name AS n FROM altax.v3_employees WHERE client_id = $1
     UNION SELECT employee AS n FROM altax.v3_paychecks WHERE client_id = $1 AND employee IS NOT NULL`,
    [client.client_id]
  );
  const ownedKeys = new Set(owned.map((r) => personKey(r.n)).filter(Boolean));
  const matched = fileKeys.filter((k) => ownedKeys.has(k)).length;
  const clientHasEmployees = ownedKeys.size > 0;

  if (fileKeys.length > 0) {
    const others = await query<{ client_id: string; client_name: string; employee_name: string }>(
      `SELECT c.client_id, c.client_name, e.employee_name FROM altax.v3_employees e JOIN altax.v3_clients c ON c.client_id = e.client_id
        WHERE e.client_id <> $1`, [client.client_id]
    );
    const byClient = new Map<string, { clientName: string; keys: Set<string> }>();
    for (const o of others) {
      const k = personKey(o.employee_name);
      if (!fileKeys.includes(k)) continue;
      const entry = byClient.get(o.client_id) || { clientName: o.client_name, keys: new Set<string>() };
      entry.keys.add(k);
      byClient.set(o.client_id, entry);
    }
    for (const [clientId, e] of byClient) {
      if (e.keys.size >= Math.max(1, Math.ceil(fileKeys.length * 0.5))) {
        suggested.set(clientId, { clientId, clientName: e.clientName, reason: `${e.keys.size} of ${fileKeys.length} employees in the file are on this client's payroll.` });
      }
    }
  }

  let employeeStatus: "match" | "mismatch" | "unknown" = "unknown";
  if (fileKeys.length > 0 && clientHasEmployees) {
    if (matched === 0) {
      employeeStatus = "mismatch";
      reasons.push(`None of the ${fileKeys.length} employee(s) in this file are on ${client.client_name}'s payroll.`);
    } else employeeStatus = "match";
  }

  // --- combine: an affirmative name match stands even if every employee is new; otherwise employees decide.
  let status: CompanyCheck["status"];
  if (nameStatus === "match") status = "match";
  else if (nameStatus === "mismatch") status = "mismatch";
  else if (employeeStatus === "match") status = "match";
  else if (employeeStatus === "mismatch") status = "mismatch";
  else status = "unknown";

  if (status === "match") {
    // Drop the "no company name" note once employees vouch for the file.
    let filtered = reasons.filter((r) => !r.startsWith("The file doesn't show"));
    if (nameStatus === "match" && employeeStatus === "mismatch") {
      filtered = ["The company name matches, but none of these employees are on this client's payroll yet — fine if they're new hires."];
    }
    reasons.splice(0, reasons.length, ...filtered);
  }
  return {
    status, detectedName, reasons,
    employees: { total: fileKeys.length, matched, clientHasEmployees },
    suggestedClients: Array.from(suggested.values()).slice(0, 4),
  };
}

/** Commit-side guard: a non-matching file must be explicitly confirmed, so a stale or hand-built request can't skip the check. */
export async function companyCheckBlocksCommit(
  client: ClientLite, detectedName: unknown, employeeNames: string[], confirmed: unknown
): Promise<{ blocked: false } | { blocked: true; check: CompanyCheck }> {
  const check = await checkCompany({ client, detectedName: typeof detectedName === "string" && detectedName.trim() ? detectedName.trim() : null, employeeNames });
  if (check.status === "match" || confirmed === true) return { blocked: false };
  return { blocked: true, check };
}
