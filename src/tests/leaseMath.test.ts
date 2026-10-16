import { test } from "node:test";
import assert from "node:assert/strict";
import { termEnd, rentPlan, leaseDerived } from "../modules/docBuilder/leaseMath";
import { getDocTemplate } from "../modules/docBuilder/templates";
import { renderDocument } from "../modules/docBuilder/engine";

test("term end is start + length - 1 day, with month-end clamping", () => {
  assert.equal(termEnd("2026-10-16", 5, 0), "2031-10-15");
  assert.equal(termEnd("2026-01-01", 1, 0), "2026-12-31");
  assert.equal(termEnd("2026-10-01", 2, 6), "2029-03-31");
  assert.equal(termEnd("2026-01-31", 0, 1), "2026-02-27");
  assert.equal(termEnd("2024-02-29", 1, 0), "2025-02-27");
  assert.equal(termEnd("", 5, 0), null);
  assert.equal(termEnd("2026-10-16", 0, 0), null);
});

test("percent increase compounds and rounds to cents each year (master-lease example)", () => {
  const p = rentPlan({ startDate: "2026-10-16", endDate: "2031-10-15", rent: 4300, increaseType: "percent", increasePercent: 3 })!;
  assert.deepEqual(p.rows.map((r) => r.monthly), [4300, 4429, 4561.87, 4698.73, 4839.69]);
  assert.equal(p.rows[0].yearly, 51600);
});

test("fixed-amount increase, free months and a partial last year", () => {
  const p = rentPlan({ startDate: "2026-10-01", endDate: "2029-03-31", rent: 1600, increaseType: "amount", increaseAmount: 50, freeMonths: 1 })!;
  assert.deepEqual(p.rows.map((r) => r.monthly), [1600, 1650, 1700]);
  assert.equal(p.rows[0].yearly, 17600);
  assert.equal(p.rows[2].partial, true);
  assert.equal(p.rows[2].yearly, 10200);
  assert.equal(p.initialTotal, 17600 + 19800 + 10200);
});

test("renewal rows continue the increase only when asked", () => {
  const base = { startDate: "2026-10-01", endDate: "2029-09-30", rent: 1000, increaseType: "percent", increasePercent: 10, renewal: true, renewalCount: 1, renewalYears: 2 };
  assert.equal(rentPlan({ ...base, renewalRent: "same" })!.rows.filter((r) => r.renewal).length, 2);
  assert.equal(rentPlan({ ...base, renewalRent: "terms" })!.rows.filter((r) => r.renewal).length, 0);
  assert.match(leaseDerived({ ...base, renewalRent: "same" }, "en").renewalText, /one additional term of 2 years/);
});

test("no increase and one year gives no table; missing data gives no table", () => {
  assert.equal(leaseDerived({ startDate: "2026-01-01", endDate: "2026-12-31", rent: 1000, increaseType: "none" }, "en").rentTable, "");
  assert.equal(leaseDerived({ rent: 1000, increaseType: "percent", increasePercent: 3 }, "en").rentTable, "");
});

test("the four lease templates print the end date, increase sentence and table (English and Arabic)", () => {
  require("../modules/docBuilder/templatesAr");
  const a: any = { startDate: "2026-10-01", termYears: 3, rent: 1600, increaseType: "amount", increaseAmount: 50, termType: "fixed", rentBasis: "amount", landlord: "L", tenant: "T", premises: "1 Main", rentDay: 1, graceDays: 5 };
  for (const key of ["lease_commercial", "commercial_lease_short", "lease_residential", "commercial_sublease"]) {
    for (const lang of ["en", "ar"] as const) {
      const out = renderDocument(getDocTemplate(key)!, a, lang);
      assert.match(out, /\| \$1,650\.00 \|/, `${key} ${lang} table`);
      assert.match(out, lang === "en" ? /September 30, 2029|Sep 30, 2029/ : /30 سبتمبر 2029/, `${key} ${lang} end date`);
      assert.ok(!/\{\{|\}\}/.test(out));
    }
  }
  // a month-to-month residential tenancy has no schedule
  assert.ok(!/Lease year/.test(renderDocument(getDocTemplate("lease_residential")!, { ...a, termType: "monthly" }, "en")));
});
