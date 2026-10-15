/**
 * Unit tests (no database, no server) for the W-4 "Exempt from withholding" election:
 *   - the exemption window (Treas. Reg. 31.3402(f)(4)-1(b): not effective for wages paid after Feb 15 of the
 *     following year),
 *   - the federal withholding engine returning $0 only while the exemption is in force,
 *   - the "exempt means nothing else" rule (Treas. Reg. 31.3402(f)(5)-1(b)(2)) in the data normalizer and in the
 *     filled IRS PDF (only the Exempt box is checked; Step 1(c) and Steps 2-4 stay blank).
 *
 * Run with: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { calculateFederalWithholding, w4ExemptionStatus, w4ExemptionWarning } from "../common/withholdingTables";
import { generateW4, normalizeW4Data, W4_FORM_YEAR } from "../modules/govForms/w4";

test("exemption window: in force from Jan 1 of the claim year through Feb 15 of the next year", () => {
  const at = (payDate: string) => w4ExemptionStatus({ exempt: true, year: 2026, payDate });
  assert.equal(at("2026-01-01"), "exempt");
  assert.equal(at("2026-12-31"), "exempt");
  assert.equal(at("2027-02-15"), "exempt");
  assert.equal(at("2027-02-16"), "expired");
  assert.equal(at("2028-01-01"), "expired");
  assert.equal(at("2025-12-31"), "future"); // a 2026 exemption does not reach back into 2025
});

test("exemption window: bad or missing data never grants an exemption", () => {
  assert.equal(w4ExemptionStatus(null), "none");
  assert.equal(w4ExemptionStatus({ exempt: false, year: 2026, payDate: "2026-06-01" }), "none");
  assert.equal(w4ExemptionStatus({ exempt: true, year: null, payDate: "2026-06-01" }), "expired");
  assert.equal(w4ExemptionStatus({ exempt: true, year: "abc", payDate: "2026-06-01" }), "expired");
  assert.equal(w4ExemptionStatus({ exempt: true, year: 2026, payDate: "not-a-date" }), "expired");
  assert.equal(w4ExemptionStatus({ exempt: true, year: "2026", payDate: new Date("2026-06-01T12:00:00Z") }), "exempt");
});

test("federal withholding is $0 for an exempt employee and unchanged for everyone else", () => {
  const normal = calculateFederalWithholding(2000, "Bi-Weekly", "Single");
  assert.ok(normal > 0, "a $2,000 biweekly paycheck has federal withholding");
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", { exempt: true, year: 2026, payDate: "2026-09-15" }), 0);
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", { exempt: true, year: 2026, payDate: "2027-02-15" }), 0);
  // Lapsed (Feb 16 onward): back to normal bracket withholding - the engine does not need staff to flip a switch.
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", { exempt: true, year: 2026, payDate: "2027-02-16" }), normal);
  // Future-year exemption, not-exempt flag, null and omitted inputs all withhold normally.
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", { exempt: true, year: 2027, payDate: "2026-09-15" }), normal);
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", { exempt: false, year: 2026, payDate: "2026-09-15" }), normal);
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single", null), normal);
  assert.equal(calculateFederalWithholding(2000, "Bi-Weekly", "Single"), normal);
});

test("staff warning appears only for a lapsed exemption", () => {
  const lapsed = w4ExemptionWarning({ exempt: true, year: 2026, payDate: "2027-03-01" }, "Pat Smith");
  assert.ok(lapsed && lapsed.includes("Pat Smith") && lapsed.includes("February 15") && lapsed.includes("new Form W-4"));
  assert.equal(w4ExemptionWarning({ exempt: true, year: 2026, payDate: "2026-09-01" }, "Pat Smith"), null);
  assert.equal(w4ExemptionWarning({ exempt: false, year: null, payDate: "2027-03-01" }, "Pat Smith"), null);
  assert.equal(w4ExemptionWarning(null, "Pat Smith"), null);
});

test("normalizeW4Data: exempt keeps identity only; non-exempt drops the exempt keys", () => {
  const exempt = normalizeW4Data({
    firstName: "A", lastName: "B", ssn: "000-00-0000", exempt: true, exemptYear: 2026,
    filingStatus: "Head of household", multipleJobsCheckbox: true, qualifyingChildrenAmount: "2000",
    otherDependentsAmount: "500", otherIncome: "100", deductions: "5", extraWithholding: "10",
  } as any) as any;
  assert.equal(exempt.exempt, true);
  assert.equal(exempt.firstName, "A");
  for (const k of ["filingStatus", "multipleJobsCheckbox", "qualifyingChildrenAmount", "otherDependentsAmount", "otherIncome", "deductions", "extraWithholding"]) {
    assert.equal(exempt[k], undefined, `${k} must be dropped on an exempt W-4`);
  }
  const normal = normalizeW4Data({ firstName: "A", lastName: "B", filingStatus: "Single or Married filing separately", exempt: false, exemptYear: 2026, extraWithholding: "10" } as any) as any;
  assert.equal(normal.exempt, undefined);
  assert.equal(normal.exemptYear, undefined);
  assert.equal(normal.extraWithholding, "10");
});

/** Reads field values back off page 1 of a generated W-4 (checkbox /AS state and text /V). */
async function readW4Fields(bytes: Uint8Array): Promise<Record<string, string>> {
  const doc = await PDFDocument.load(bytes);
  const out: Record<string, string> = {};
  const annots = doc.getPage(0).node.Annots();
  for (const ref of annots ? annots.asArray() : []) {
    const widget = doc.context.lookup(ref) as PDFDict;
    const parts: string[] = [];
    let node: PDFDict | undefined = widget;
    while (node) {
      const t = node.get(PDFName.of("T")) as any;
      if (t?.decodeText) parts.unshift(t.decodeText());
      const parent = node.get(PDFName.of("Parent"));
      node = parent ? (doc.context.lookup(parent) as PDFDict) : undefined;
    }
    const leaf = parts[parts.length - 1] || "";
    const v = widget.get(PDFName.of("V")) as any;
    out[leaf] = v ? (v.decodeText ? v.decodeText() : String(v)) : "";
  }
  return out;
}

test("generateW4: an exempt W-4 checks only the Exempt box and leaves 1(c) and Steps 2-4 blank", async () => {
  assert.equal(W4_FORM_YEAR, 2026);
  const pdf = await generateW4({
    firstName: "Pat", lastName: "Smith", address: "1 Main St", city: "Baltimore", state: "MD", zip: "21201",
    exempt: true, filingStatus: "Head of household", multipleJobsCheckbox: true, qualifyingChildrenAmount: "2000",
    otherDependentsAmount: "500", otherIncome: "100", deductions: "5", extraWithholding: "10",
  });
  const f = await readW4Fields(pdf);
  assert.equal(f["c1_3[0]"], "1", "Exempt from withholding box is checked");
  for (const k of ["c1_1[0]", "c1_1[1]", "c1_1[2]", "c1_2[0]"]) assert.equal(f[k], "Off", `${k} must stay unchecked`);
  for (const k of ["f1_06[0]", "f1_07[0]", "f1_08[0]", "f1_09[0]", "f1_10[0]", "f1_11[0]"]) assert.equal(f[k], "", `${k} must stay blank`);
  assert.equal(f["f1_01[0]"], "Pat");
  assert.equal(f["f1_02[0]"], "Smith");
});

test("generateW4: a normal W-4 is unchanged and does not check the Exempt box", async () => {
  const pdf = await generateW4({
    firstName: "Pat", lastName: "Smith", address: "1 Main St", city: "Baltimore", state: "MD", zip: "21201",
    filingStatus: "Head of household", multipleJobsCheckbox: true, qualifyingChildrenAmount: "2000", extraWithholding: "10",
  });
  const f = await readW4Fields(pdf);
  assert.equal(f["c1_3[0]"], "Off");
  assert.equal(f["c1_1[2]"], "3");
  assert.equal(f["c1_2[0]"], "1");
  assert.equal(f["f1_06[0]"], "2000");
  assert.equal(f["f1_11[0]"], "10");
});
