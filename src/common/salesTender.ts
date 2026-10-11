import { ValidationError } from "./asyncHandler";
import { appendGl } from "./accountingHelpers";

/**
 * How a day's sales were paid. The books used to treat every sale as cash. Card and EBT/SNAP money reaches the bank
 * later (and card arrives net of the processor's fee), so each sale now posts:
 *   Dr Cash                 the cash portion (the rest of what was collected)
 *   Dr Undeposited Funds    card + EBT portions — money earned but not yet in the bank
 *   Cr Sales Revenue        gross sales
 *   Cr Sales Tax Payable    sales tax
 * When the deposit hits the bank, Bank Rec → "Card / EBT deposit" moves it out of Undeposited Funds into Cash and books
 * the processor's fee. These businesses don't sell on account, so no Accounts Receivable is involved.
 */
export const CLEARING_ACCOUNT = "Undeposited Funds";
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

/** Posts the sale's ledger lines (replaces the old fixed three lines) and returns nothing. Caller supplies the transaction. */
export async function postSalesGl(
  db: any, client: { client_id: string; client_name: string }, saleId: string, saleDate: string | null,
  gross: number, totalTax: number, tender: Tender
): Promise<void> {
  const base = { entryDate: saleDate as any, ref: saleId, source: "Sales Input" };
  // A sale with no card/EBT posts the single Cash line exactly as before; with a split, Cash appears only if some cash was taken.
  if (tender.cash > 0 || (tender.card === 0 && tender.ebt === 0)) {
    await appendGl(client.client_id, client.client_name, { ...base, description: "Sales receipt / tax collected", account: "Cash", debit: tender.cash, credit: 0 }, db);
  }
  if (tender.card > 0) {
    await appendGl(client.client_id, client.client_name, { ...base, description: "Card sales — awaiting bank deposit", account: CLEARING_ACCOUNT, debit: tender.card, credit: 0 }, db);
  }
  if (tender.ebt > 0) {
    await appendGl(client.client_id, client.client_name, { ...base, description: "EBT/SNAP sales — awaiting bank deposit", account: CLEARING_ACCOUNT, debit: tender.ebt, credit: 0 }, db);
  }
  await appendGl(client.client_id, client.client_name, { ...base, description: "Sales revenue", account: "Sales Revenue", debit: 0, credit: gross }, db);
  await appendGl(client.client_id, client.client_name, { ...base, description: "Sales tax payable", account: "Sales Tax Payable", debit: 0, credit: totalTax }, db);
}

/** Opens one clearing item per non-zero card / EBT portion so a later bank deposit can be matched against it. */
export async function openClearingItems(db: any, clientId: string, saleId: string, saleDate: string | null, tender: Tender): Promise<void> {
  for (const [kind, amount] of [["card", tender.card], ["ebt", tender.ebt]] as const) {
    if (amount > 0) await db.query(`INSERT INTO altax.v3_tender_clearing (client_id, sale_id, tender, amount, sale_date) VALUES ($1,$2,$3,$4,$5)`, [clientId, saleId, kind, amount, saleDate]);
  }
}

/** True when any of this sale's card/EBT portions has already been matched to a bank deposit. */
export async function hasClearedItems(db: any, saleId: string): Promise<boolean> {
  const rows = await db.query(`SELECT 1 FROM altax.v3_tender_clearing WHERE sale_id = $1 AND cleared_at IS NOT NULL LIMIT 1`, [saleId]);
  return rows.length > 0;
}

/** Makes sure the accounts the split posts to exist in the (firm-wide) chart of accounts. */
export async function ensureTenderAccounts(db: any): Promise<void> {
  const ensure = async (name: string, type: string, normal: string) => {
    const row = await db.query(`SELECT 1 FROM altax.v3_coa WHERE lower(account_name) = lower($1) LIMIT 1`, [name]);
    if (row.length) return;
    const id = `ACCT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;
    await db.query(
      `INSERT INTO altax.v3_coa (account_id, account_name, account_type, normal_balance, active, current_balance, source_system, source_record_id) VALUES ($1,$2,$3,$4,true,0,'Node Web App',$1)`,
      [id, name, type, normal]);
  };
  await ensure(CLEARING_ACCOUNT, "Asset", "Debit");
  await ensure(FEE_ACCOUNT, "Expense", "Debit");
}
