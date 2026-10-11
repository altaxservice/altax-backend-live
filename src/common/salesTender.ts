import { ValidationError } from "./asyncHandler";
import { appendGl } from "./accountingHelpers";

/**
 * How a day's sales were paid. Card and EBT/SNAP money goes to the bank (a day or two later, card net of the processor's
 * fee), but there is no "undeposited funds" step: every portion posts straight to Cash, as its own Cash line so the bank
 * reconciliation can see it:
 *   Dr Cash — cash sales
 *   Dr Cash — card sales (settles to the bank in a batch)
 *   Dr Cash — EBT/SNAP sales (settles to the bank)
 *   Cr Sales Revenue / Cr Sales Tax Payable
 * When the bank statement is reconciled, Bank Rec → "Card / EBT" matches a deposit to the days' card/EBT lines and books
 * the processor's fee (Dr Merchant Processing Fees / Cr Cash) — the only difference between the sales and the deposit.
 * These businesses don't sell on account, so no Accounts Receivable is involved.
 */
export const FEE_ACCOUNT = "Merchant Processing Fees";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface Tender { cash: number; card: number; ebt: number }

/** Cash is whatever was collected that wasn't card or EBT. Rejects negatives and card+EBT above the total collected. */
export function splitTender(totalCollected: number, card: unknown, ebt: unknown): Tender {
  const c = r2(Number(card) || 0);
  const e = r2(Number(ebt) || 0);
  const total = r2(totalCollected);
  if (c < 0 || e < 0) throw new ValidationError("Card and EBT amounts can't be negative.");
  if (c + e > total + 0.005) throw new ValidationError(`Card ($${c.toFixed(2)}) plus EBT ($${e.toFixed(2)}) is more than the total collected ($${total.toFixed(2)}). Check the amounts.`);
  return { cash: r2(total - c - e), card: c, ebt: e };
}

/** Posts the sale's ledger lines (all money to Cash; card/EBT as their own Cash lines) and returns the card/EBT line ids. Caller supplies the transaction. */
export async function postSalesGl(
  db: any, client: { client_id: string; client_name: string }, saleId: string, saleDate: string | null,
  gross: number, totalTax: number, tender: Tender
): Promise<{ cardGlId: string | null; ebtGlId: string | null }> {
  const base = { entryDate: saleDate as any, ref: saleId, source: "Sales Input", account: "Cash", credit: 0 };
  let cardGlId: string | null = null, ebtGlId: string | null = null;
  // A sale with no card/EBT posts the single Cash line exactly as before; with a split, a cash line appears only if some cash was taken.
  if (tender.cash > 0 || (tender.card === 0 && tender.ebt === 0)) {
    await appendGl(client.client_id, client.client_name, { ...base, description: "Sales receipt / tax collected", debit: tender.cash }, db);
  }
  if (tender.card > 0) cardGlId = await appendGl(client.client_id, client.client_name, { ...base, description: "Card sales — settles to bank", debit: tender.card }, db);
  if (tender.ebt > 0) ebtGlId = await appendGl(client.client_id, client.client_name, { ...base, description: "EBT/SNAP sales — settles to bank", debit: tender.ebt }, db);
  await appendGl(client.client_id, client.client_name, { entryDate: saleDate as any, ref: saleId, source: "Sales Input", description: "Sales revenue", account: "Sales Revenue", debit: 0, credit: gross }, db);
  await appendGl(client.client_id, client.client_name, { entryDate: saleDate as any, ref: saleId, source: "Sales Input", description: "Sales tax payable", account: "Sales Tax Payable", debit: 0, credit: totalTax }, db);
  return { cardGlId, ebtGlId };
}

/** Opens one item per non-zero card / EBT portion (linked to its Cash line) so a later bank deposit can be matched against it. */
export async function openClearingItems(db: any, clientId: string, saleId: string, saleDate: string | null, tender: Tender, glIds: { cardGlId: string | null; ebtGlId: string | null }): Promise<void> {
  for (const [kind, amount, glId] of [["card", tender.card, glIds.cardGlId], ["ebt", tender.ebt, glIds.ebtGlId]] as const) {
    if (amount > 0) await db.query(`INSERT INTO altax.v3_tender_clearing (client_id, sale_id, tender, amount, sale_date, gl_entry_id) VALUES ($1,$2,$3,$4,$5,$6)`, [clientId, saleId, kind, amount, saleDate, glId]);
  }
}

/** True when any of this sale's card/EBT portions has already been matched to a bank deposit. */
export async function hasClearedItems(db: any, saleId: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM altax.v3_tender_clearing WHERE sale_id = $1 AND cleared_at IS NOT NULL LIMIT 1`, [saleId]);
  return rows.length > 0;
}

/** Makes sure the processing-fee account exists in the (firm-wide) chart of accounts. */
export async function ensureTenderAccounts(db: any): Promise<void> {
  const row = await db.query(`SELECT 1 FROM altax.v3_coa WHERE lower(account_name) = lower($1) LIMIT 1`, [FEE_ACCOUNT]);
  if (row.length) return;
  const id = `ACCT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
  await db.query(
    `INSERT INTO altax.v3_coa (account_id, account_name, account_type, normal_balance, active, current_balance, source_system, source_record_id) VALUES ($1,$2,'Expense','Debit',true,0,'Node Web App',$1)`,
    [id, FEE_ACCOUNT]);
}
