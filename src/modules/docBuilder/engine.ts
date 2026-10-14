/**
 * Document Builder engine: a template is a list of question steps plus a body written with a tiny markup —
 *   {{id}}                         the answer (money / date / yes-no / choice label are formatted for reading)
 *   {{#if id}}…{{else}}…{{/if}}    show a block when the answer is filled in / yes; also {{#if id=value}} and {{#if !id}}
 *   {{#list id}}…{{/list}}         repeat for each row of a "list" question; inside, {{n}} is the row number and {{field}} a row field
 * Everything here is pure (no database), so the live preview and the saved document are always rendered by the same code.
 */
export type QType = "text" | "textarea" | "date" | "money" | "number" | "select" | "yesno" | "list";
export type PrefillKey = "clientName" | "clientAddress" | "clientEmail" | "clientPhone" | "firmName" | "firmAddress" | "today";
export interface Cond { id: string; equals?: string | boolean; notEmpty?: boolean }
export interface Question {
  id: string; label: string; type: QType; required?: boolean; help?: string; placeholder?: string;
  options?: { value: string; label: string; labelAr?: string }[]; default?: string | boolean; prefill?: PrefillKey;
  showIf?: Cond; fields?: Question[]; addLabel?: string; minItems?: number;
}
export interface Step { title: string; description?: string; questions: Question[] }
export interface DocTemplate {
  key: string; title: string; category: string; description: string; steps: Step[]; body: string;
  /** Arabic edition: same questions, its own wording. {{select}} answers use an option's labelAr. */
  titleAr?: string; bodyAr?: string;
  /** Shown above the preview — what to double-check before this document is signed. */
  reviewNote?: string;
}
export type Answers = Record<string, unknown>;
export type DocLang = "en" | "ar" | "both";
export const parseLang = (v: unknown): DocLang => (v === "ar" || v === "both" ? v : "en");
export const hasArabic = (t: DocTemplate) => Boolean(t.bodyAr && t.titleAr);

const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function fmtLongDate(v: unknown, lang: "en" | "ar" = "en"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  if (!m) return "";
  return lang === "ar" ? `${Number(m[3])} ${MONTHS_AR[Number(m[2]) - 1]} ${m[1]}` : `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}
export function fmtMoney(v: unknown): string {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "";
}

export function isFilled(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "boolean") return v;
  return String(v ?? "").trim() !== "";
}

export function condMet(c: Cond | undefined, answers: Answers): boolean {
  if (!c) return true;
  const v = answers[c.id];
  if (c.equals !== undefined) return typeof c.equals === "boolean" ? Boolean(v) === c.equals : String(v ?? "") === String(c.equals);
  if (c.notEmpty) return isFilled(v);
  return isFilled(v);
}

function formatValue(q: Question, v: unknown, lang: "en" | "ar"): string {
  switch (q.type) {
    case "money": return fmtMoney(v);
    case "date": return fmtLongDate(v, lang);
    case "yesno": return lang === "ar" ? (v ? "نعم" : "لا") : v ? "Yes" : "No";
    case "select": { const o = q.options?.find((x) => x.value === String(v ?? "")); return (lang === "ar" && o?.labelAr) || o?.label || String(v ?? ""); }
    default: return String(v ?? "").trim();
  }
}

type Node =
  | { t: "text"; s: string }
  | { t: "var"; id: string }
  | { t: "if"; id: string; equals?: string; negate: boolean; yes: Node[]; no: Node[] }
  | { t: "list"; id: string; body: Node[] };

const TAG = /\{\{\s*(?:(#if|#list|else|\/if|\/list)(?![A-Za-z0-9_]))?\s*([^}]*?)\s*\}\}/g;

export function parseBody(src: string): Node[] {
  const root: Node[] = [];
  const stack: { kind: "if" | "list"; node: any; target: Node[] }[] = [];
  let cur = root, last = 0, m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src))) {
    if (m.index > last) cur.push({ t: "text", s: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const [, kind, rest] = m;
    if (kind === "#if") {
      let expr = rest.trim(), negate = false, equals: string | undefined;
      if (expr.startsWith("!")) { negate = true; expr = expr.slice(1).trim(); }
      const eq = expr.indexOf("=");
      if (eq > 0) { equals = expr.slice(eq + 1).trim().replace(/^"|"$/g, ""); expr = expr.slice(0, eq).trim(); }
      const node: Node = { t: "if", id: expr, equals, negate, yes: [], no: [] };
      cur.push(node); stack.push({ kind: "if", node, target: cur }); cur = node.yes;
    } else if (kind === "else") {
      const top = stack[stack.length - 1];
      if (top?.kind === "if") cur = top.node.no;
    } else if (kind === "/if" || kind === "/list") {
      const top = stack.pop();
      if (top) cur = top.target;
    } else if (kind === "#list") {
      const node: Node = { t: "list", id: rest.trim(), body: [] };
      cur.push(node); stack.push({ kind: "list", node, target: cur }); cur = node.body;
    } else if (rest) {
      cur.push({ t: "var", id: rest.trim() });
    }
  }
  if (last < src.length) cur.push({ t: "text", s: src.slice(last) });
  return root;
}

interface Scope { answers: Answers; questions: Question[]; n?: number; lang: "en" | "ar" }

function evalNodes(nodes: Node[], scope: Scope): string {
  let out = "";
  for (const node of nodes) {
    if (node.t === "text") out += node.s;
    else if (node.t === "var") {
      if (node.id === "n" && scope.n !== undefined) { out += String(scope.n); continue; }
      const q = scope.questions.find((x) => x.id === node.id);
      out += q ? formatValue(q, scope.answers[node.id], scope.lang) : "";
    } else if (node.t === "if") {
      const v = scope.answers[node.id];
      const qd = scope.questions.find((x) => x.id === node.id);
      const isZero = (qd?.type === "number" || qd?.type === "money") && String(v ?? "").trim() !== "" && Number(String(v).replace(/[$,\s]/g, "")) === 0;
      let ok = node.equals !== undefined ? String(v ?? "") === node.equals : isFilled(v) && !isZero;
      if (node.negate) ok = !ok;
      out += evalNodes(ok ? node.yes : node.no, scope);
    } else if (node.t === "list") {
      const q = scope.questions.find((x) => x.id === node.id);
      const rows = Array.isArray(scope.answers[node.id]) ? (scope.answers[node.id] as Answers[]) : [];
      rows.forEach((row, i) => { out += evalNodes(node.body, { answers: row, questions: q?.fields || [], n: i + 1, lang: scope.lang }); });
    }
  }
  return out;
}

export function allQuestions(t: DocTemplate): Question[] { return t.steps.flatMap((s) => s.questions); }

const HEADING_EN = /^\d+\.\s+[A-Z][A-Z0-9 &,'\/()-]+$/;
const HEADING_AR = /^\d+\.\s+[؀-ۿ][؀-ۿ0-9 ،'\/()-]+$/;

function renderOne(t: DocTemplate, answers: Answers, lang: "en" | "ar"): string {
  const src = lang === "ar" ? t.bodyAr || t.body : t.body;
  const text = evalNodes(parseBody(src), { answers, questions: allQuestions(t), lang });
  // Section headings ("1. PROMISE TO PAY") are renumbered in order, so a section that is switched off never leaves a gap.
  const heading = lang === "ar" ? HEADING_AR : HEADING_EN;
  let sec = 0;
  return text.split("\n").map((l) => l.replace(/[ \t]+$/g, "")).map((l) => (heading.test(l) ? l.replace(/^\d+/, String(++sec)) : l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Renders the document with the answers: English, Arabic, or both (English first, then its Arabic edition). */
export function renderDocument(t: DocTemplate, answers: Answers, lang: DocLang = "en"): string {
  if (lang === "ar" && hasArabic(t)) return renderOne(t, answers, "ar");
  if (lang === "both" && hasArabic(t)) return `${renderOne(t, answers, "en")}\n\n\n${renderOne(t, answers, "ar")}`;
  return renderOne(t, answers, "en");
}

export function docTitle(t: DocTemplate, lang: DocLang): string {
  if (lang === "ar" && t.titleAr) return t.titleAr;
  if (lang === "both" && t.titleAr) return `${t.title} / ${t.titleAr}`;
  return t.title;
}

/** Labels of required questions that are visible but unanswered (including required fields inside list rows). */
export function missingAnswers(t: DocTemplate, answers: Answers): string[] {
  const missing: string[] = [];
  for (const q of allQuestions(t)) {
    if (!condMet(q.showIf, answers)) continue;
    if (q.type === "list") {
      const rows = Array.isArray(answers[q.id]) ? (answers[q.id] as Answers[]) : [];
      if (rows.length < (q.minItems ?? (q.required ? 1 : 0))) missing.push(`${q.label} (add at least ${q.minItems ?? 1})`);
      rows.forEach((row, i) => { for (const f of q.fields || []) if (f.required && condMet(f.showIf, row) && !isFilled(row[f.id])) missing.push(`${q.label} #${i + 1}: ${f.label}`); });
    } else if (q.required && !isFilled(answers[q.id]) && q.type !== "yesno") {
      missing.push(q.label);
    }
  }
  return missing;
}

/** Keeps only answers for known questions, with sane types, so what's stored and rendered is predictable. */
export function cleanAnswers(t: DocTemplate, raw: unknown): Answers {
  const src = (raw && typeof raw === "object" ? raw : {}) as Answers;
  const clean = (qs: Question[], from: Answers): Answers => {
    const out: Answers = {};
    for (const q of qs) {
      const v = from[q.id];
      if (q.type === "yesno") out[q.id] = Boolean(v);
      else if (q.type === "list") out[q.id] = (Array.isArray(v) ? v : []).slice(0, 25).map((row) => clean(q.fields || [], (row && typeof row === "object" ? row : {}) as Answers));
      else out[q.id] = String(v ?? "").slice(0, q.type === "textarea" ? 6000 : 500);
    }
    return out;
  };
  return clean(allQuestions(t), src);
}
