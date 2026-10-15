// usage: npx ts-node scripts/docAudit/artifacts.ts  (ONLY=key1,key2 to limit)
// Renders every document in English and Arabic with every switch on, every switch off and the defaults, and flags text artifacts
// a reader would notice: doubled punctuation, space before a comma/period, empty brackets, doubled words, a sentence starting with a lowercase letter.
import { DOC_TEMPLATES } from "../../src/modules/docBuilder/templates";
import "../../src/modules/docBuilder/templatesAr";
import { renderDocument, allQuestions, type Question } from "../../src/modules/docBuilder/engine";
const only = new Set((process.env.ONLY || "").split(",").filter(Boolean));
const rules: [RegExp, string][] = [
  [/(?<![ap]\.m)[.،,;:]\s*[.،,;]\s/g, "doubled punctuation"],
  [/\s[,.;:،]/g, "space before punctuation"],
  [/\(\s*\)|\[\s*\]|«\s*»/g, "empty brackets"],
  [/\b(\w{3,})\s+\1\b/gi, "repeated word"],
  [/\.\s+[a-z]/g, "sentence starts lowercase"],
  [/[^\n]\s{2,}[^\n_ ]/g, "double space"],
];
const mkAnswers = (t: any, mode: string) => {
  const a: Record<string, any> = {};
  const fill = (q: Question, target: Record<string, any>) => {
    if (q.type === "list") { target[q.id] = [1, 2].map((i) => { const r: Record<string, any> = {}; for (const f of q.fields || []) fill(f, r); return r; }); return; }
    if (q.type === "yesno") target[q.id] = mode === "yes" ? true : mode === "no" ? false : Boolean(q.default);
    else if (q.type === "select") target[q.id] = q.default !== undefined ? String(q.default) : q.options![0].value;
    else if (q.type === "date") target[q.id] = "2026-11-01"; else if (q.type === "money") target[q.id] = "1234.5"; else if (q.type === "number") target[q.id] = "7";
    else target[q.id] = `Sample ${q.id}`;
  };
  for (const q of allQuestions(t)) fill(q, a);
  return a;
};
let n = 0;
for (const t of DOC_TEMPLATES as any[]) {
  if (only.size && !only.has(t.key)) continue;
  for (const lang of ["en", "ar"] as const) for (const mode of ["defaults", "yes", "no"]) {
    let body = "";
    try { body = renderDocument(t, mkAnswers(t, mode), lang); } catch (e: any) { console.log(`[HIGH] ${t.key} ${lang}/${mode}: render error ${e.message}`); n++; continue; }
    if (/\{\{|\}\}|undefined|NaN/.test(body)) { console.log(`[HIGH] ${t.key} ${lang}/${mode}: unresolved markup`); n++; }
    for (const line of body.split("\n")) {
      if (/_{4,}|^•|^[A-Z0-9 .,'&\/()-]+$/.test(line)) continue;
      for (const [re, name] of rules) {
        if (name === "double space" || name === "sentence starts lowercase") continue;
        const m = line.match(re);
        if (m) { const at = line.indexOf(m[0]); console.log(`[LOW] ${t.key} ${lang}/${mode}: ${name}: …${line.slice(Math.max(0, at - 30), at + 40)}…`); n++; break; }
      }
    }
  }
}
console.log(`artifact scan done: ${n} findings`);
