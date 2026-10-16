import { test } from "node:test";
import assert from "node:assert/strict";
import { runChecks, type Check } from "../modules/docBuilder/checks";

const pct: Check = { type: "sumEquals", list: "members", field: "percent", total: 100, message: "Ownership percentages must total 100" };
const dates: Check = { type: "dateAfter", later: "endDate", earlier: "startDate", message: "The end date must be after the start date." };
const fee: Check = { type: "lte", id: "lateFee", other: "rent", multiplier: 0.05, message: "Late fee is more than 5% of the rent." };

test("sumEquals passes at 100 and reports the real total otherwise", () => {
  assert.deepEqual(runChecks([pct], { members: [{ percent: "60" }, { percent: "40" }] }), []);
  assert.deepEqual(runChecks([pct], { members: [{ percent: "33.33" }, { percent: "33.33" }, { percent: "33.34" }] }), []);
  const r = runChecks([pct], { members: [{ percent: "60" }, { percent: "30" }] });
  assert.equal(r.length, 1);
  assert.match(r[0], /add up to 90, not 100/);
});

test("sumEquals stays quiet while a value is still blank", () => {
  assert.deepEqual(runChecks([pct], { members: [{ percent: "60" }, { percent: "" }] }), []);
  assert.deepEqual(runChecks([pct], { members: [] }), []);
});

test("dateAfter needs both dates and flags equal or reversed dates", () => {
  assert.deepEqual(runChecks([dates], { startDate: "2026-01-01", endDate: "2026-02-01" }), []);
  assert.equal(runChecks([dates], { startDate: "2026-02-01", endDate: "2026-02-01" }).length, 1);
  assert.equal(runChecks([dates], { startDate: "2026-03-01", endDate: "2026-02-01" }).length, 1);
  assert.deepEqual(runChecks([dates], { startDate: "2026-03-01" }), []);
});

test("lte multiplies and only runs when both numbers exist", () => {
  assert.deepEqual(runChecks([fee], { rent: "1000", lateFee: "50" }), []);
  assert.equal(runChecks([fee], { rent: "1000", lateFee: "50.01" }).length, 1);
  assert.deepEqual(runChecks([fee], { rent: "1000" }), []);
});

test("atLeastOne and when conditions", () => {
  const one: Check = { type: "atLeastOne", ids: ["a", "b"], message: "Tick at least one.", when: { id: "kind", equals: "general" } };
  assert.equal(runChecks([one], { kind: "general", a: false, b: false }).length, 1);
  assert.deepEqual(runChecks([one], { kind: "general", a: false, b: true }), []);
  assert.deepEqual(runChecks([one], { kind: "limited", a: false, b: false }), []);
});

import { CHECKS, problemsFor } from "../modules/docBuilder/checks";
import { DOC_TEMPLATES } from "../modules/docBuilder/templates";
import { allQuestions } from "../modules/docBuilder/engine";

test("every check refers to real questions of its own document", () => {
  const byKey = new Map(DOC_TEMPLATES.map((t) => [t.key, new Set(allQuestions(t).map((q) => q.id))]));
  const listFields = new Map(DOC_TEMPLATES.map((t) => [t.key, new Map(allQuestions(t).filter((q) => q.type === "list").map((q) => [q.id, new Set((q.fields || []).map((f) => f.id))]))]));
  for (const [key, checks] of Object.entries(CHECKS)) {
    const ids = byKey.get(key);
    assert.ok(ids, `unknown document ${key}`);
    for (const c of checks as any[]) {
      const refs: string[] = [c.later, c.earlier, c.id, c.other, ...(c.ids || []), c.when?.id].filter(Boolean);
      for (const r of refs) assert.ok(ids!.has(r), `${key}: check refers to unknown question "${r}"`);
      if (c.type === "sumEquals") assert.ok(listFields.get(key)!.get(c.list)?.has(c.field), `${key}: list ${c.list}.${c.field} not found`);
    }
  }
});

test("real documents: the checks that matter fire on bad input and stay quiet on good input", () => {
  assert.equal(problemsFor("llc_operating_agreement", { members: [{ percent: "50" }, { percent: "40" }] }).length, 1);
  assert.deepEqual(problemsFor("llc_operating_agreement", { members: [{ percent: "50" }, { percent: "50" }] }), []);
  assert.equal(problemsFor("lease_residential", { rent: "1000", deposit: "1500" }).length, 1);
  assert.deepEqual(problemsFor("lease_residential", { rent: "1000", deposit: "1000", lateFee: true, lateFeeAmount: "50" }), []);
  assert.equal(problemsFor("lease_residential", { rent: "1000", lateFee: true, lateFeeAmount: "60" }).length, 1);
  assert.equal(problemsFor("lease_commercial", { startDate: "2026-02-01", endDate: "2026-01-01" }).length, 1);
  assert.equal(problemsFor("general_poa", { powerType: "general", sReal: false, manageProperty: "" }).length, 1);
  assert.deepEqual(problemsFor("general_poa", { powerType: "general", manageProperty: "12 Main St" }), []);
  assert.deepEqual(problemsFor("general_poa", { powerType: "limited" }), []);
  assert.equal(problemsFor("client_privacy_notice", { noAffiliates: false }).length, 1);
  assert.deepEqual(problemsFor("client_privacy_notice", { noAffiliates: true }), []);
});

test("sublease documents: a home cannot go in the commercial sublease, and a lease cannot outlast the master lease", async () => {
  const { problemsFor } = await import("../modules/docBuilder/checks");
  assert.equal(problemsFor("commercial_sublease", { residential: true }).length, 1);
  assert.deepEqual(problemsFor("commercial_sublease", { residential: false }), []);
  assert.equal(problemsFor("lease_residential", { masterLeaseEnd: "2027-01-01", endDate: "2027-10-31" }).length, 1);
  assert.deepEqual(problemsFor("lease_residential", { masterLeaseEnd: "2031-10-31", endDate: "2027-10-31" }), []);
  assert.deepEqual(problemsFor("lease_residential", { endDate: "2027-10-31" }), []);
});

test("a residential lease made as a sublease is titled as one, in English and Arabic", async () => {
  const { docTitle } = await import("../modules/docBuilder/engine");
  const { DOC_TEMPLATES } = await import("../modules/docBuilder/templates");
  await import("../modules/docBuilder/templatesAr");
  const t: any = (DOC_TEMPLATES as any[]).find((x) => x.key === "lease_residential");
  assert.equal(docTitle(t, "en"), "Residential Lease Agreement");
  assert.equal(docTitle(t, "en", { sublease: true }), "Residential Sublease Agreement");
  assert.match(docTitle(t, "ar", { sublease: true }), /من الباطن/);
  assert.equal(docTitle(t, "en", { sublease: false }), "Residential Lease Agreement");
});

test("leases with more than one landlord or tenant name everyone, make each responsible, and give each a signature block", async () => {
  const { DOC_TEMPLATES } = await import("../modules/docBuilder/templates");
  const { renderDocument, cleanAnswers } = await import("../modules/docBuilder/engine");
  const { suggestSigners } = await import("../modules/docBuilder/signerSpec");
  await import("../modules/docBuilder/templatesAr");
  const t: any = (DOC_TEMPLATES as any[]).find((x) => x.key === "lease_commercial");
  const a = cleanAnswers(t, { landlord: "OWNER ONE", moreLandlords: [{ name: "OWNER TWO" }], tenant: "TENANT ONE", moreTenants: [{ name: "TENANT TWO" }] });
  for (const lang of ["en", "ar"] as const) {
    const out = renderDocument(t, a, lang, { firmName: "x" });
    assert.ok(/OWNER ONE (and|و)OWNER TWO/.test(out.replace(/\s+/g, " ").replace("OWNER ONE and OWNER TWO", "OWNER ONE andOWNER TWO").replace("OWNER ONE andOWNER TWO", "OWNER ONE and OWNER TWO").replace("OWNER ONE and OWNER TWO", "OWNER ONE andOWNER TWO")) || /OWNER ONE and OWNER TWO|OWNER ONE وOWNER TWO/.test(out));
    assert.equal((out.match(/(LANDLORD|المؤجِّر): OWNER (ONE|TWO)/g) || []).length, 2);
    assert.equal((out.match(/(TENANT|المستأجر): TENANT (ONE|TWO)/g) || []).length, 2);
  }
  assert.deepEqual(suggestSigners("lease_commercial", a).map((s: any) => s.name), ["OWNER ONE", "OWNER TWO", "TENANT ONE", "TENANT TWO"]);
  const one = renderDocument(t, cleanAnswers(t, { landlord: "OWNER ONE", tenant: "TENANT ONE" }), "en", { firmName: "x" });
  assert.ok(!/each Landlord is responsible/.test(one));
});
