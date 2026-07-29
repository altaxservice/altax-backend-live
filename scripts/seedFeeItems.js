/**
 * Seeds the fee catalog with STARTING values only.
 *
 * Nothing here is authoritative and nothing is hardcoded in the app — every row
 * is editable in Tools → Fee Schedule, which is the whole point: agencies change
 * their prices and the firm re-prices with them. The Maryland state filing rows
 * are the ones confirmed against real Maryland Business Express receipts (a
 * Close Corp expedited filing totalling $216.30 and an LLC rush filing totalling
 * $478.95, both of which this catalog reproduces to the cent). The Baltimore City
 * permit rows come from the firm's own Big Boys Carryout estimate and should be
 * reviewed per job, since several are tiered in reality.
 *
 * Safe to re-run: rows are upserted by fee_item_id, so editing an amount in the
 * app and re-running this will NOT overwrite it (existing rows are left alone).
 *
 *   node scripts/seedFeeItems.js
 */
require("dotenv").config();
const { Pool } = require("pg");

const ALL_BUSINESS = [];   // empty = applies to every business type
const FOOD = ["Restaurant / Carryout", "Food Retail"];
const RETAIL_ISH = ["Restaurant / Carryout", "Food Retail", "Retail Store", "Convenience Store"];

const ITEMS = [
  // ---- Maryland state filings (MD SDAT via Maryland Business Express) -------
  // Base filing: one per entity type. Confirmed against firm receipts.
  { id: "FEE-MD-LLC", name: "Articles of Organization (LLC)", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: ["LLC"], cost: 100, price: 100, sort: 10, statewide: true, task: true },
  { id: "FEE-MD-CORP", name: "Articles of Incorporation (Corporation)", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: ["Corporation", "S-Corp", "C-Corp", "Close Corporation"], cost: 120, price: 120, sort: 11,
    statewide: true, task: true, notes: "$20 more than an LLC filing." },
  { id: "FEE-MD-NONSTOCK", name: "Articles of Incorporation (Nonstock / Nonprofit)", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: ["Nonstock", "Nonprofit"], cost: 170, price: 170, sort: 12, statewide: true, task: true },
  { id: "FEE-MD-TRADENAME", name: "Trade Name Registration", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 25, price: 25, sort: 13, optional: true, statewide: true, task: true },

  // Speed surcharges: added only when the estimate is at that speed.
  { id: "FEE-MD-EXPEDITE", name: "Expedited Processing", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 50, price: 50, speed: "Expedited", sort: 20, statewide: true, turnaround: "About 7 business days" },
  { id: "FEE-MD-RUSH", name: "Rush Processing (same day)", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 325, price: 325, speed: "Rush", sort: 21, statewide: true, turnaround: "Reviewed within 3 hours if filed by 2:30pm" },

  // Certified copies — the line most often forgotten when quoting by hand.
  { id: "FEE-MD-CERTCOPY", name: "Certified Copy", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 20, price: 20, sort: 30, statewide: true },
  { id: "FEE-MD-CERTCOPY-EXP", name: "Certified Copy — Expedited", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 20, price: 20, speed: "Expedited", sort: 31, statewide: true },
  { id: "FEE-MD-CERTCOPY-RUSH", name: "Certified Copy — Expedited", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], cost: 20, price: 20, speed: "Rush", sort: 32, statewide: true },

  // Percentage fee: recalculated from the government subtotal, so it stays right
  // when any fee above changes. This is why it is not stored as a flat amount.
  { id: "FEE-MD-TECH", name: "Maryland Technology Fee", agency: "MD SDAT", jurisdiction: "Maryland",
    entity: [], kind: "percent", percent: 3, cost: 0, price: 0, sort: 40, statewide: true,
    notes: "3% of the state filing subtotal on online payments. Computed, not fixed." },

  // ---- Baltimore City permits (firm's own figures — review per job) ---------
  { id: "FEE-BC-UO", name: "Use & Occupancy Permit", agency: "Baltimore City", jurisdiction: "Baltimore City",
    entity: [], business: ALL_BUSINESS, cost: 100, price: 100, sort: 50, task: true },
  { id: "FEE-BC-FIRE", name: "Fire Inspection Fee", agency: "Baltimore City Fire Dept", jurisdiction: "Baltimore City",
    entity: [], business: FOOD, cost: 100, price: 100, sort: 51, task: true },
  { id: "FEE-BC-HEALTH-APP", name: "Health Application Fee", agency: "Baltimore City Health Dept", jurisdiction: "Baltimore City",
    entity: [], business: FOOD, cost: 150, price: 150, sort: 52, task: true },
  { id: "FEE-BC-HEALTH-PERMIT", name: "Health Permit Fee", agency: "Baltimore City Health Dept", jurisdiction: "Baltimore City",
    entity: [], business: FOOD, cost: 285, price: 285, sort: 53, task: true },
  { id: "FEE-BC-TRADERS", name: "Trader's License", agency: "Clerk of the Circuit Court", jurisdiction: "Baltimore City",
    entity: [], business: RETAIL_ISH, cost: 385, price: 385, sort: 54, task: true,
    notes: "Tiered by average inventory value — Baltimore City runs to $2,125. Confirm the tier per client." },

  // ---- AL TAX's own work ---------------------------------------------------
  { id: "FEE-SVC-FORMATION", name: "Company Formation Office Fee", agency: "AL TAX SERVICE", jurisdiction: "Any",
    entity: [], category: "Service", cost: 0, price: 750, sort: 60 },
  { id: "FEE-SVC-EIN", name: "EIN (Federal Tax ID)", agency: "AL TAX SERVICE", jurisdiction: "Any",
    entity: [], category: "Service", cost: 0, price: 0, included: true, sort: 61, task: true,
    notes: "Free from the IRS; shown as Included so the client sees the value." },
  { id: "FEE-SVC-SUT", name: "Sales & Use Tax Number", agency: "AL TAX SERVICE", jurisdiction: "Any",
    entity: [], category: "Service", cost: 0, price: 0, included: true, sort: 62, task: true,
    notes: "No state charge for the Combined Registration Application." },
];

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let inserted = 0;
  let skipped = 0;
  for (const it of ITEMS) {
    const res = await pool.query(
      `INSERT INTO altax.v3_fee_items
         (fee_item_id, name, category, agency, jurisdiction, entity_types, business_types, speed,
          amount_kind, percent_rate, unit_cost, unit_price, default_qty, included, optional,
          statewide, creates_task, turnaround_days, notes, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,1,$13,$14,$15,$16,$17,$18,TRUE,$19)
       ON CONFLICT (fee_item_id) DO NOTHING`,
      [
        it.id, it.name, it.category || "Government", it.agency, it.jurisdiction,
        JSON.stringify(it.entity || []), JSON.stringify(it.business || []), it.speed || null,
        it.kind || "fixed", it.percent || 0, it.cost || 0, it.price || 0,
        Boolean(it.included), Boolean(it.optional), Boolean(it.statewide), Boolean(it.task),
        it.turnaround || null, it.notes || null, it.sort || 0,
      ]
    );
    if (res.rowCount) inserted++; else skipped++;
  }
  console.log(`fee catalog: ${inserted} added, ${skipped} already present (left untouched).`);
  await pool.end();
})();
