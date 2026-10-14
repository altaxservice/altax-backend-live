// @ts-nocheck
import fs from "fs";
const DB = process.env.DB_DIR || "../../src/modules/docBuilder";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DOC_TEMPLATES } = require(`${DB}/templates`); require(`${DB}/templatesAr`);
const { renderDocument, allQuestions } = require(`${DB}/engine`);
const { suggestSigners, NEEDS_NOTARY } = require(`${DB}/signerSpec`);
type Question = any;

type Issue = { key: string; sev: "HIGH" | "MED" | "LOW"; msg: string };
const issues: Issue[] = [];
const add = (key: string, sev: Issue["sev"], msg: string) => { if (!issues.some((i) => i.key === key && i.msg === msg)) issues.push({ key, sev, msg }); };

const varsIn = (src: string): Set<string> => {
  const out = new Set<string>();
  for (const m of src.matchAll(/\{\{\s*(?:#if\s+!?|#list\s+)?([A-Za-z0-9_.]+)/g)) if (!["else", "n"].includes(m[1])) out.add(m[1]);
  return out;
};
const flatQs = (qs: Question[]): Question[] => qs.flatMap((q) => (q.fields ? [q, ...q.fields] : [q]));

function sample(t: any, mode: "defaults" | "alltrue" | "allfalse", pick: Record<string, string> = {}): Record<string, any> {
  const a: Record<string, any> = {};
  const fill = (q: Question, target: Record<string, any>) => {
    if (q.type === "list") { target[q.id] = [1, 2].map((i) => { const row: Record<string, any> = {}; for (const f of q.fields || []) fill(f, row); return row; }); return; }
    if (q.type === "yesno") target[q.id] = mode === "alltrue" ? true : mode === "allfalse" ? false : Boolean(q.default);
    else if (q.type === "select") target[q.id] = pick[q.id] ?? (q.default !== undefined ? String(q.default) : q.options![0].value);
    else if (q.type === "date") target[q.id] = "2026-11-01";
    else if (q.type === "money") target[q.id] = "1234.5";
    else if (q.type === "number") target[q.id] = "7";
    else target[q.id] = `«${q.id}»`;
  };
  for (const q of allQuestions(t)) fill(q, a);
  return a;
}

const SMELLS: [RegExp, string][] = [
  [/\{\{|\}\}/, "unrendered {{ }}"], [/undefined|\[object|NaN/, "undefined/NaN in text"], [/\(\s*\)/, "empty parentheses"],
  [/,\s*,/, "double comma"], [/\s,/, "space before comma"], [/ \./, "space before period"], [/\.\./, "double period"], [/[^\S\n]{3,}/, "3+ spaces"],
  [/\b(a|an|the|of|to|and)\s+\1\b/i, "repeated word"], [/:\s*$/m, "line ends with colon (empty value?)"], [/\bof\s*\./, "'of .' (empty value)"], [/\s\)/, "space before )"], [/\(\s/, "space after ("],
];

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean);
for (const t of DOC_TEMPLATES as any[]) {
  if (ONLY.length && !ONLY.includes(t.key)) continue;
  const key = t.key;
  const qs = flatQs(allQuestions(t));
  const ids = new Set(qs.map((q) => q.id));
  const enVars = varsIn(t.body), arVars = t.bodyAr ? varsIn(t.bodyAr) : new Set<string>();
  for (const v of enVars) if (!ids.has(v) && !v.includes(".")) add(key, "HIGH", `EN body uses unknown variable {{${v}}}`);
  for (const v of arVars) if (!ids.has(v) && !v.includes(".")) add(key, "HIGH", `AR body uses unknown variable {{${v}}}`);
  if (!t.bodyAr) add(key, "HIGH", "no Arabic edition");
  else {
    for (const v of enVars) if (!arVars.has(v)) add(key, "MED", `variable {{${v}}} used in English but not in Arabic`);
    for (const v of arVars) if (!enVars.has(v)) add(key, "MED", `variable {{${v}}} used in Arabic but not in English`);
  }
  for (const q of qs) { if (!enVars.has(q.id) && !arVars.has(q.id)) add(key, q.required ? "HIGH" : "MED", `question "${q.label}" (${q.id}) is never used in the document text`); }
  // select options: every option should have an Arabic label, and equality tests should use real option values
  for (const q of qs.filter((x) => x.type === "select")) {
    if (t.bodyAr) for (const o of (q.options || []) as any[]) if (!o.labelAr) add(key, "LOW", `select ${q.id}: option "${o.value}" has no Arabic label`);
    for (const src of [t.body, t.bodyAr || ""]) for (const m of src.matchAll(new RegExp(`\\{\\{#if\\s+${q.id}=([A-Za-z0-9_-]+)\\}\\}`, "g"))) if (!(q.options || []).some((o: any) => o.value === m[1])) add(key, "HIGH", `condition ${q.id}=${m[1]} matches no option`);
  }
  // required question without a showIf that has no marker in rendering
  const scenarios: [string, Record<string, any>][] = [["defaults", sample(t, "defaults")], ["all-yes", sample(t, "alltrue")], ["all-no", sample(t, "allfalse")]];
  for (const q of qs.filter((x) => x.type === "select")) for (const o of q.options || []) scenarios.push([`${q.id}=${o.value}`, sample(t, "defaults", { [q.id]: o.value })]);
  const langs: ("en" | "ar")[] = t.bodyAr ? ["en", "ar"] : ["en"];
  const seen = new Set<string>();
  let sigCountEn = 0;
  for (const [name, ans] of scenarios) for (const lang of langs) {
    let out = "";
    try { out = renderDocument(t, ans, lang); } catch (e: any) { add(key, "HIGH", `render error (${lang}, ${name}): ${e.message}`); continue; }
    for (const [re, label] of SMELLS) { const m = re.exec(out); if (m) { const k = `${lang}:${label}`; if (!seen.has(k)) { seen.add(k); add(key, label === "3+ spaces" || label === "space before comma" ? "LOW" : "MED", `${lang.toUpperCase()} [${name}]: ${label} — …${out.slice(Math.max(0, m.index - 40), m.index + 50).replace(/\n/g, "⏎")}…`); } } }
    // headings should be sequential
    const heads = [...out.matchAll(/^(\d+)\.\s+\S/gm)].map((m) => Number(m[1]));
    heads.forEach((n, i) => { if (n !== i + 1 && !seen.has(`${lang}:num`)) { seen.add(`${lang}:num`); add(key, "MED", `${lang.toUpperCase()} [${name}]: clause numbering not sequential (${heads.join(",")})`); } });
    if (name === "all-yes" && lang === "en") sigCountEn = (out.match(/Signature:/g) || []).length;
    if (name === "all-yes" && lang === "en") {
      // every named question in the document should show up when everything is switched on
      for (const q of qs) if ((q.type === "text" || q.type === "textarea") && !q.fields && !out.includes(`«${q.id}»`) && enVars.has(q.id)) add(key, "LOW", `text answer ${q.id} used in body but absent when everything is on`);
    }
    if (name === "defaults" && lang === "en") {
      for (const q of qs) if (q.required && !q.showIf && (q.type === "text" || q.type === "textarea") && !out.includes(`«${q.id}»`) && !(ans[q.id] === undefined)) add(key, "HIGH", `required answer "${q.label}" never appears in the text`);
    }
  }
  // signers
  const signers = suggestSigners(key, sample(t, "alltrue"));
  const spec = signers.length;
  if (!spec) add(key, "HIGH", "no signer spec — e-sign cannot suggest signers");
  const body = renderDocument(t, sample(t, "alltrue"), "en");
  const sigLines = (body.match(/_{6,}/g) || []).length;
  const notary = /NOTARY|Notary/.test(body);
  const witness = /WITNESS|Witness/.test(body);
  if (sigLines === 0) add(key, "HIGH", "no signature line in the document text");
  if (spec && sigLines && !notary && Math.abs(sigLines - spec) > 0 && !witness) add(key, "LOW", `signature lines (${sigLines}) differ from suggested signers (${spec})`);
  if ((notary) && !NEEDS_NOTARY.has(key)) add(key, "MED", "body has a notary block but the notary warning flag is not set for this template");
  if (NEEDS_NOTARY.has(key) && !notary) add(key, "MED", "notary warning is set but the body has no notary block");
  if (!t.reviewNote) add(key, "LOW", "no review note");
  if (!t.description || t.description.length < 30) add(key, "LOW", "weak description");
}
const order = { HIGH: 0, MED: 1, LOW: 2 } as const;
issues.sort((a, b) => order[a.sev] - order[b.sev] || a.key.localeCompare(b.key));
const by: Record<string, number> = { HIGH: 0, MED: 0, LOW: 0 }; for (const i of issues) by[i.sev]++;
console.log(`templates checked: ${ONLY.length || DOC_TEMPLATES.length}  issues: HIGH ${by.HIGH}  MED ${by.MED}  LOW ${by.LOW}`);
for (const i of issues) console.log(`[${i.sev}] ${i.key}: ${i.msg}`);
