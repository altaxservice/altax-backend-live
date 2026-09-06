import { Router, Response } from "express";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler, ValidationError } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { appendGl, money } from "../../common/accountingHelpers";
import { MACRS_HALF_YEAR_TABLES, isMacrsPropertyClass } from "../../common/macrsTables";

/**
 * Fixed Assets — client-scoped asset purchases with straight-line depreciation.
 * v3_coa is firm-wide (no client_id) and has no purchase date, cost, or useful
 * life — an actual asset purchase is inherently per-client data with nowhere
 * to live there. Discovered via a real client's Balance Sheet showing
 * Accumulated Depreciation with no underlying asset ever recorded. No
 * separate depreciation-history table: accumulated depreciation and "already
 * posted this year?" are both derived from v3_gl_entries via `source`/`ref` —
 * appendGl (accountingHelpers.ts) hardcodes source_system to 'Node Web App'
 * and reuses `ref` as source_record_id, so `source`+`ref` (both caller-
 * controlled) is this module's own idempotency key, not source_system.
 */
export const fixedAssetsRouter = Router();

const PURCHASE_SOURCE = "Fixed Asset Purchase";
const DEPRECIATION_SOURCE = "Fixed Asset Depreciation";

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

async function loadClient(req: AuthedRequest, clientId: string): Promise<{ client: { clientId: string; clientName: string } } | { error: string; status: number }> {
  if (!clientId) return { error: "Client is required.", status: 400 };
  if (!(await canAccessClient(req.user!, clientId))) return { error: "You do not have access to this client.", status: 403 };
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { error: "Client not found.", status: 404 };
  return { client: { clientId: client.client_id, clientName: client.client_name } };
}

/**
 * A DATE column comes back from `SELECT *` as a JS Date, not a string — the same
 * gotcha filingConfirmationEmail.ts's fmtDate already documents. String(date)
 * runs it through the JS Date's locale-formatted toString() ("Mon Jun 30 2025
 * 00:00:00 GMT-0400...", not "2025-06-30"), so .slice(0,10) on that silently
 * produces garbage and every date comparison downstream becomes NaN vs NaN —
 * confirmed live: a disposed asset's later-year depreciation posted anyway
 * because the disposal-year check never actually threw.
 */
function isoDateOnly(v: string | Date | null): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Accumulated depreciation posted so far — the sum of every depreciation GL entry for this asset, regardless of year. */
async function accumulatedDepreciation(assetId: string): Promise<number> {
  const row = await queryOne<any>(
    `SELECT COALESCE(SUM(credit), 0) AS total FROM altax.v3_gl_entries WHERE source = $1 AND ref LIKE $2`,
    [DEPRECIATION_SOURCE, `${assetId}:%`]
  );
  return Number(row?.total || 0);
}

fixedAssetsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });

  const rows = await query<any>(`SELECT * FROM altax.v3_fixed_assets WHERE client_id = $1 ORDER BY purchase_date DESC, created_at DESC`, [clientId]);
  const assets = await Promise.all(rows.map(async (a) => {
    const accumulated = await accumulatedDepreciation(a.asset_id);
    const bookValue = Math.max(Number(a.salvage_value), Number(a.cost) - accumulated);
    return { ...a, accumulated_depreciation: accumulated, book_value: bookValue };
  }));
  res.json({ assets });
}));

fixedAssetsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  const loaded = await loadClient(req, clientId);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    const assetName = String(body.assetName || "").trim();
    const accountName = String(body.accountName || "").trim();
    const offsetAccount = String(body.offsetAccount || "").trim();
    const assetClass = body.assetClass === "Current" ? "Current" : "Fixed";
    const purchaseDate = String(body.purchaseDate || "").trim();
    const cost = money(body.cost);
    const salvageValue = money(body.salvageValue || 0);
    const depreciationMethod = assetClass !== "Fixed" ? "Straight-Line"
      : body.depreciationMethod === "MACRS" ? "MACRS"
      : body.depreciationMethod === "Manual" ? "Manual"
      : "Straight-Line";
    const usefulLifeYears = assetClass === "Fixed" && depreciationMethod === "Straight-Line" ? Number(body.usefulLifeYears) : null;
    const macrsPropertyClass = assetClass === "Fixed" && depreciationMethod === "MACRS" ? body.macrsPropertyClass : null;
    const section179Amount = depreciationMethod === "MACRS" ? money(body.section179Amount || 0) : 0;
    const bonusDepreciationPct = depreciationMethod === "MACRS" ? Number(body.bonusDepreciationPct || 0) : 0;
    const manualMethodLabel = depreciationMethod === "Manual" ? String(body.manualMethodLabel || "").trim() || null : null;

    if (!assetName) throw new ValidationError("Asset name is required.");
    if (!accountName) throw new ValidationError("Account is required.");
    if (!offsetAccount) throw new ValidationError("Offsetting account is required.");
    if (!purchaseDate) throw new ValidationError("Purchase date is required.");
    if (!(cost > 0)) throw new ValidationError("Cost must be greater than 0.");
    if (assetClass === "Fixed" && depreciationMethod === "Straight-Line" && !(usefulLifeYears! > 0)) throw new ValidationError("Useful life (years) is required for a Fixed asset.");
    if (assetClass === "Fixed" && depreciationMethod === "MACRS") {
      if (!isMacrsPropertyClass(macrsPropertyClass)) throw new ValidationError("Property class (5-Year or 7-Year) is required for MACRS.");
      if (section179Amount < 0 || section179Amount > cost) throw new ValidationError("Section 179 amount must be between 0 and the asset's cost.");
      if (bonusDepreciationPct < 0 || bonusDepreciationPct > 100) throw new ValidationError("Bonus depreciation % must be between 0 and 100.");
    }

    const coaAccount = await queryOne<any>(`SELECT account_id FROM altax.v3_coa WHERE lower(account_name) = lower($1)`, [accountName]);
    if (!coaAccount) {
      await query(
        `INSERT INTO altax.v3_coa (account_id, account_name, account_type, normal_balance, active, current_balance, source_system, source_record_id)
         VALUES ($1,$2,'Asset','Debit',true,0,'Node Web App',$1)`,
        [`ACCT-${idSuffix()}`, accountName]
      );
    }

    const assetId = `ASSET-${idSuffix()}`;
    await withTransaction(async (db) => {
      await db.query(
        `INSERT INTO altax.v3_fixed_assets
           (asset_id, client_id, asset_name, account_name, asset_class, purchase_date, cost, salvage_value,
            useful_life_years, offset_account, notes, created_by, depreciation_method, macrs_property_class,
            section_179_amount, bonus_depreciation_pct, manual_method_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [assetId, client.clientId, assetName, accountName, assetClass, purchaseDate, cost, salvageValue,
          usefulLifeYears, offsetAccount, String(body.notes || "").trim() || null, req.user!.email,
          depreciationMethod, macrsPropertyClass, section179Amount, bonusDepreciationPct, manualMethodLabel]
      );
      await appendGl(client.clientId, client.clientName, {
        entryDate: purchaseDate, ref: assetId, description: `Fixed asset purchase — ${assetName}`,
        account: accountName, debit: cost, credit: 0, source: PURCHASE_SOURCE,
      }, db);
      await appendGl(client.clientId, client.clientName, {
        entryDate: purchaseDate, ref: assetId, description: `Fixed asset purchase — ${assetName}`,
        account: offsetAccount, debit: 0, credit: cost, source: PURCHASE_SOURCE,
      }, db);
    });

    await logAudit("Accounting", "CREATE_FIXED_ASSET", assetId, "", "", assetName, `Fixed asset "${assetName}" ($${cost.toFixed(2)}) recorded for ${client.clientName} by ${req.user!.email}.`, req.user!.email);
    res.status(201).json({ ok: true, assetId });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

fixedAssetsRouter.post("/:assetId/run-depreciation", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const asset = await queryOne<any>(`SELECT * FROM altax.v3_fixed_assets WHERE asset_id = $1`, [req.params.assetId]);
  if (!asset) return res.status(404).json({ error: "Asset not found." });
  const loaded = await loadClient(req, asset.client_id);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });
  const { client } = loaded;

  try {
    if (asset.asset_class !== "Fixed") throw new ValidationError("Current assets don't depreciate.");
    if (asset.depreciation_method === "MACRS" && !isMacrsPropertyClass(asset.macrs_property_class)) {
      throw new ValidationError("This asset has no MACRS property class set — edit it before running depreciation.");
    }
    if (asset.depreciation_method === "Straight-Line" && !asset.useful_life_years) {
      throw new ValidationError("This asset has no useful life set — edit it before running depreciation.");
    }

    const year = Number(req.body?.year) || new Date().getFullYear();
    const ref = `${asset.asset_id}:${year}`;

    const existing = await queryOne<any>(`SELECT gl_entry_id FROM altax.v3_gl_entries WHERE source = $1 AND ref = $2`, [DEPRECIATION_SOURCE, ref]);
    if (existing) throw new ValidationError(`Depreciation for ${year} has already been posted for this asset.`);

    const purchaseDate = new Date(`${isoDateOnly(asset.purchase_date)}T00:00:00Z`);
    const disposedDateIso = isoDateOnly(asset.disposed_date);
    const disposedDate = disposedDateIso ? new Date(`${disposedDateIso}T00:00:00Z`) : null;
    if (disposedDate && disposedDate.getUTCFullYear() < year) throw new ValidationError("This asset was disposed before this year — nothing to depreciate.");
    if (purchaseDate.getUTCFullYear() > year) throw new ValidationError("This asset wasn't purchased yet in this year.");

    let amount: number;

    if (asset.depreciation_method === "Manual") {
      // No calculation here at all, by design — this method exists specifically
      // for depreciation the firm's actual tax software (Drake) already computed
      // (150% DB, Mid-Quarter, real property, anything beyond the verified
      // 5-/7-year 200DB/HY path this app can independently reproduce). Staff
      // types in Drake's own number; this just posts and tracks it like any
      // other depreciation entry.
      const entered = money(req.body?.amount);
      if (!(entered > 0)) throw new ValidationError("Enter the depreciation amount for this year (from your tax software).");
      const alreadyDepreciated = await accumulatedDepreciation(asset.asset_id);
      const remainingDepreciable = Math.max(0, Number(asset.cost) - Number(asset.salvage_value) - alreadyDepreciated);
      if (entered > remainingDepreciable + 0.01) {
        throw new ValidationError(`That's more than what's left to depreciate on this asset ($${remainingDepreciable.toFixed(2)} remaining).`);
      }
      amount = entered;
    } else if (asset.depreciation_method === "MACRS") {
      // Half-year convention already bakes "half a year" into the Year-1 table
      // percentage itself — unlike straight-line, MACRS does NOT get further
      // prorated by actual months owned. Known gap: a mid-year disposal under
      // MACRS should technically halve that year's table amount (a separate
      // IRS rule) — not implemented; disposing simply blocks any LATER year
      // via the check above, same as straight-line.
      const table = MACRS_HALF_YEAR_TABLES[asset.macrs_property_class as "5-Year" | "7-Year"];
      const yearIndex = year - purchaseDate.getUTCFullYear() + 1;
      if (yearIndex < 1 || yearIndex > table.length) throw new ValidationError("This asset is fully depreciated.");

      const section179Amount = Number(asset.section_179_amount) || 0;
      const bonusPct = Number(asset.bonus_depreciation_pct) || 0;
      const basisAfter179 = Number(asset.cost) - section179Amount;
      const bonusAmount = basisAfter179 * (bonusPct / 100);
      const macrsBasis = basisAfter179 - bonusAmount;
      const tableAmount = macrsBasis * (table[yearIndex - 1] / 100);
      amount = money(yearIndex === 1 ? section179Amount + bonusAmount + tableAmount : tableAmount);
    } else {
      // Months owned within `year` — prorates the first year (purchased mid-year) and the
      // disposal year (sold mid-year) instead of always assuming a full 12 months.
      const yearStart = new Date(Date.UTC(year, 0, 1));
      const yearEnd = new Date(Date.UTC(year, 11, 31));
      const periodStart = purchaseDate > yearStart ? purchaseDate : yearStart;
      const periodEnd = disposedDate && disposedDate < yearEnd ? disposedDate : yearEnd;
      const monthsOwned = Math.max(0, Math.min(12,
        (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 + (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) + 1
      ));

      const annualDepreciation = (Number(asset.cost) - Number(asset.salvage_value)) / Number(asset.useful_life_years);
      const alreadyDepreciated = await accumulatedDepreciation(asset.asset_id);
      const remainingDepreciable = Math.max(0, Number(asset.cost) - Number(asset.salvage_value) - alreadyDepreciated);
      amount = money(Math.min(remainingDepreciable, annualDepreciation * (monthsOwned / 12)));
    }

    if (!(amount > 0)) throw new ValidationError("Nothing left to depreciate — this asset is already at its salvage value.");

    await withTransaction(async (db) => {
      await appendGl(client.clientId, client.clientName, {
        entryDate: `${year}-12-31`, ref, description: `${year} depreciation — ${asset.asset_name}`,
        account: "Depreciation Expense", debit: amount, credit: 0, source: DEPRECIATION_SOURCE,
      }, db);
      await appendGl(client.clientId, client.clientName, {
        entryDate: `${year}-12-31`, ref, description: `${year} depreciation — ${asset.asset_name}`,
        account: "Accumulated Depreciation", debit: 0, credit: amount, source: DEPRECIATION_SOURCE,
      }, db);
    });

    await logAudit("Accounting", "RUN_ASSET_DEPRECIATION", asset.asset_id, "", "", String(amount), `${year} depreciation ($${amount.toFixed(2)}) posted for "${asset.asset_name}" by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true, amount });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));

fixedAssetsRouter.post("/:assetId/dispose", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const asset = await queryOne<any>(`SELECT asset_id, client_id, asset_name, status FROM altax.v3_fixed_assets WHERE asset_id = $1`, [req.params.assetId]);
  if (!asset) return res.status(404).json({ error: "Asset not found." });
  const loaded = await loadClient(req, asset.client_id);
  if ("error" in loaded) return res.status(loaded.status).json({ error: loaded.error });

  try {
    if (asset.status === "Disposed") throw new ValidationError("This asset is already marked disposed.");

    const disposedDate = String(req.body?.disposedDate || "").trim();
    if (!disposedDate) throw new ValidationError("Disposal date is required.");

    await query(`UPDATE altax.v3_fixed_assets SET status = 'Disposed', disposed_date = $2, updated_at = now() WHERE asset_id = $1`, [asset.asset_id, disposedDate]);
    await logAudit("Accounting", "DISPOSE_FIXED_ASSET", asset.asset_id, "status", "Active", "Disposed", `"${asset.asset_name}" marked disposed (${disposedDate}) by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
}));
