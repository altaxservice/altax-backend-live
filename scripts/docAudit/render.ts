// usage: npx ts-node audit_tmp/render.ts <templateKey> <en|ar> [defaults|yes|no]
import { DOC_TEMPLATES } from "../../src/modules/docBuilder/templates";
import "../../src/modules/docBuilder/templatesAr";
import { renderDocument, allQuestions, type Question } from "../../src/modules/docBuilder/engine";
const [key, lang = "en", mode = "defaults"] = process.argv.slice(2);
const t: any = DOC_TEMPLATES.find((x: any) => x.key === key);
if (!t) { console.log("keys:", DOC_TEMPLATES.map((x: any) => x.key).join(", ")); process.exit(1); }
const a: Record<string, any> = {};
const fill = (q: Question, target: Record<string, any>) => {
  if (q.type === "list") { target[q.id] = [1, 2].map(() => { const r: Record<string, any> = {}; for (const f of q.fields || []) fill(f, r); return r; }); return; }
  if (q.type === "yesno") target[q.id] = mode === "yes" ? true : mode === "no" ? false : Boolean(q.default);
  else if (q.type === "select") target[q.id] = q.default !== undefined ? String(q.default) : q.options![0].value;
  else if (q.type === "date") target[q.id] = "2026-11-01"; else if (q.type === "money") target[q.id] = "1234.5"; else if (q.type === "number") target[q.id] = "7";
  else target[q.id] = `«${q.id}»`;
};
for (const q of allQuestions(t)) fill(q, a);
console.log(`# ${t.title} (${t.key}) — category: ${t.category}\n# description: ${t.description}\n# reviewNote: ${t.reviewNote || "(none)"}\n`);
console.log("## QUESTIONS (id | label | type | required | default | showIf | options)");
for (const q of allQuestions(t)) console.log(`- ${q.id} | ${q.label} | ${q.type}${q.required ? " | REQUIRED" : ""}${q.default !== undefined ? ` | default=${q.default}` : ""}${q.showIf ? ` | showIf ${q.showIf.id}=${q.showIf.equals ?? "set"}` : ""}${q.options ? ` | options: ${q.options.map((o) => o.value).join("/")}` : ""}`);
console.log(`\n## RENDERED (${lang}, mode=${mode}; «id» = a typed answer)\n`);
console.log(renderDocument(t, a, lang as any));
