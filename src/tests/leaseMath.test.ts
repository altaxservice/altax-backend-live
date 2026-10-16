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

test("renewal rent modes: flat, own percentage, own amount, written out", () => {
  const base = { startDate: "2026-10-16", endDate: "2031-10-15", rent: 2000, increaseType: "none", renewal: true, renewalCount: 1, renewalYears: 3 };
  const ren = (extra: object) => rentPlan({ ...base, ...extra })!.rows.filter((r) => r.renewal).map((r) => r.monthly);
  assert.deepEqual(ren({ renewalRent: "flat" }), [2000, 2000, 2000]);
  assert.deepEqual(ren({ renewalRent: "percent", renewalIncreasePercent: 3 }), [2060, 2121.8, 2185.45]);
  assert.deepEqual(ren({ renewalRent: "amount", renewalIncreaseAmount: 100 }), [2100, 2200, 2300]);
  assert.deepEqual(ren({ renewalRent: "terms", renewalRentTerms: "$2,400 a month" }), []);
  assert.match(leaseDerived({ ...base, renewalRent: "terms", renewalRentTerms: "$2,400.00 per month" }, "en").renewalText, /Base Rent during a renewal term: \$2,400\.00 per month\./);
});

test("a flat rent still gets the year-by-year table (and a sentence); the recording clause only applies to terms over seven years", () => {
  const d = leaseDerived({ startDate: "2026-10-16", endDate: "2031-10-15", rent: 2000, increaseType: "none", renewal: true, renewalCount: 1, renewalYears: 3, renewalRent: "flat" }, "en");
  assert.match(d.rentTable, /\| Year 5 \| Oct 16, 2030 – Oct 15, 2031 \| \$2,000\.00 \| \$24,000\.00 \|/);
  assert.match(d.rentTable, /Renewal 1, year 3/);
  assert.match(d.rentIncreaseText, /stays the same throughout the initial term/);
  assert.equal(d.longTerm, "");
  assert.equal(leaseDerived({ startDate: "2026-10-16", endDate: "2034-10-15", rent: 1 }, "en").longTerm, "yes");
  assert.equal(leaseDerived({ startDate: "2026-10-16", endDate: "2033-10-15", rent: 1 }, "en").longTerm, "");
  assert.equal(leaseDerived({ startDate: "2026-10-16", endDate: "2031-10-15", rent: 1, renewal: true, renewalYears: 8 }, "en").longTerm, "yes");
});

test("commercial lease text: no doubled county, no stray full stop, phone formatted, sale-of-business terms sit inside the transfer section", () => {
  require("../modules/docBuilder/templatesAr");
  const a: any = { landlord: "L", landlordAddress: "1 A St", landlordPhone: "3369895235", tenant: "T", tenantAddress: "2 B St", premises: "923 N Eden St, Baltimore, MD 21205", county: "Baltimore", use: "Grocery store.", startDate: "2026-10-16", possessionDate: "2026-10-16", termYears: 5, rent: 2000, rentDay: 1, graceDays: 5, deposit: 2000, fixDays: 30, saleConsentDays: 15, saleReasons: true, saleQualifications: true, extraClauses: "X" };
  for (const lang of ["en", "ar"] as const) {
    const out = renderDocument(getDocTemplate("lease_commercial")!, a, lang);
    assert.ok(!/MD 21205,? Baltimore|21205، Baltimore/.test(out));
    assert.ok(out.includes("(336) 989-5235"));
    assert.ok(!/Grocery store\.,/.test(out));
    assert.ok(!/Tenant may take possession/.test(out));
    assert.ok(!/longer of/.test(out));
    assert.ok(out.includes("15"));
  }
  const en = renderDocument(getDocTemplate("lease_commercial")!, a, "en");
  assert.match(en, /within 15 days, and if Landlord refuses it will state the specific reasons in writing/);
  assert.match(en, /the additional term controls/);
});
