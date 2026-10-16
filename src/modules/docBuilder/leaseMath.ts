/**
 * Lease arithmetic for the Document Builder: the end date from a start date and a length, the year-by-year rent schedule (a yearly increase
 * by percentage or by a fixed amount, compounding, free months at the start) and the dates of renewal terms. Pure functions: the engine
 * feeds the results into the lease text as {{rentIncreaseText}}, {{rentTable}} and {{renewalText}}.
 * The same date rule is repeated in the wizard (frontend/src/pages/DocumentBuilderPage.tsx) to fill the end date as you type.
 */
export type Answers = Record<string, unknown>;

const DAY = 86_400_000;
const MON_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

export function parseIso(v: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
export const toIso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown): number | null => { const n = Number(String(v ?? "").replace(/[$,%\s]/g, "")); return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null; };
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The date `years` years and `months` months after d, keeping the day of the month (the last day of a shorter month, e.g. Jan 31 + 1 month = Feb 28). */
export function addYearsMonths(d: Date, years: number, months: number): Date {
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + years * 12 + months;
  const y = Math.floor(total / 12), m = total % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last)));
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Last day of a term that starts on `startIso` and runs `years` years and `months` months (start + length − 1 day); null if the inputs are missing. */
export function termEnd(startIso: unknown, years: unknown, months: unknown): string | null {
  const s = parseIso(startIso); const y = num(years) ?? 0; const m = num(months) ?? 0;
  if (!s || (y <= 0 && m <= 0) || y < 0 || m < 0 || y > 100) return null;
  return toIso(addDays(addYearsMonths(s, Math.floor(y), Math.floor(m)), -1));
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortDate = (d: Date, ar: boolean) => (ar ? `${d.getUTCDate()} ${MON_AR[d.getUTCMonth()]} ${d.getUTCFullYear()}` : `${MON_EN[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`);
const longDate = (d: Date, ar: boolean) => shortDate(d, ar);
const arYears = (n: number) => (n === 1 ? "سنة واحدة" : n === 2 ? "سنتين" : n <= 10 ? `${n} سنوات` : `${n} سنة`);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Months in the period [from, to] (inclusive): whole calendar months plus the leftover days as a fraction of 30. */
function monthsBetween(from: Date, to: Date): number {
  const end = addDays(to, 1);
  let whole = 0;
  while (addYearsMonths(from, 0, whole + 1).getTime() <= end.getTime()) whole++;
  const rest = Math.round((end.getTime() - addYearsMonths(from, 0, whole).getTime()) / DAY);
  return round2(whole + rest / 30);
}

export interface RentRow { label: string; from: Date; to: Date; monthly: number; yearly: number; partial: boolean; renewal: boolean }
export interface RentPlan { rows: RentRow[]; initialTotal: number; type: "none" | "percent" | "amount"; pct: number; amt: number; free: number }

export type RenewalMode = "same" | "flat" | "percent" | "amount" | "terms";
export function renewalMode(a: Answers): RenewalMode {
  const m = String(a.renewalRent ?? "same");
  return m === "flat" || m === "percent" || m === "amount" || m === "terms" ? m : "same";
}

export function increaseType(a: Answers): "none" | "percent" | "amount" {
  const t = String(a.increaseType ?? "");
  if (t === "percent" || t === "amount" || t === "none") return t;
  return (num(a.increasePercent) ?? 0) > 0 ? "percent" : "none";
}

/** The year-by-year rent, or null when the start date, end date or monthly rent is missing. */
export function rentPlan(a: Answers): RentPlan | null {
  const start = parseIso(a.startDate), end = parseIso(a.endDate), base = num(a.rent);
  if (!start || !end || base === null || base <= 0 || end.getTime() < start.getTime()) return null;
  const type = increaseType(a); const pct = num(a.increasePercent) ?? 0; const amt = num(a.increaseAmount) ?? 0; const free = Math.max(0, Math.floor(num(a.freeMonths) ?? 0));
  const step = (prev: number) => (type === "percent" ? round2(prev * (1 + pct / 100)) : type === "amount" ? round2(prev + amt) : prev);
  const rows: RentRow[] = [];
  let monthly = round2(base); let ys = start; let k = 1;
  while (ys.getTime() <= end.getTime() && k <= 60) {
    const nextStart = addYearsMonths(start, k, 0); const ye = new Date(Math.min(addDays(nextStart, -1).getTime(), end.getTime()));
    const months = monthsBetween(ys, ye); const partial = months < 11.99;
    const payable = k === 1 ? Math.max(0, months - free) : months;
    rows.push({ label: `Year ${k}`, from: ys, to: ye, monthly, yearly: round2(monthly * payable), partial, renewal: false });
    ys = nextStart; monthly = step(monthly); k++;
  }
  const initialTotal = round2(rows.reduce((s, r) => s + r.yearly, 0));
  // Renewal terms: the yearly increase continues, the rent stays flat, or it rises by its own percentage / amount each year.
  const rc = Math.floor(num(a.renewalCount) ?? 0), ry = Math.floor(num(a.renewalYears) ?? 0);
  const mode = renewalMode(a);
  if (a.renewal === true && rc > 0 && ry > 0 && mode !== "terms" && rows.length) {
    const rpct = num(a.renewalIncreasePercent) ?? 0, ramt = num(a.renewalIncreaseAmount) ?? 0;
    const last = rows[rows.length - 1].monthly;
    const stepR = (prev: number) => (mode === "same" ? step(prev) : mode === "flat" ? prev : mode === "percent" ? round2(prev * (1 + rpct / 100)) : round2(prev + ramt));
    let rentNow = mode === "same" ? monthly : mode === "flat" ? last : stepR(last);
    let from = addDays(end, 1);
    for (let r = 1; r <= Math.min(rc, 6); r++) for (let y = 1; y <= Math.min(ry, 30); y++) {
      const to = addDays(addYearsMonths(from, 1, 0), -1);
      rows.push({ label: `Renewal ${r}, year ${y}`, from, to, monthly: rentNow, yearly: round2(rentNow * 12), partial: false, renewal: true });
      from = addDays(to, 1); rentNow = stepR(rentNow);
    }
  }
  return { rows, initialTotal, type, pct, amt, free };
}

export function renewalTerms(a: Answers): { n: number; from: Date; to: Date }[] {
  const end = parseIso(a.endDate); const rc = Math.floor(num(a.renewalCount) ?? 0), ry = Math.floor(num(a.renewalYears) ?? 0);
  if (!end || a.renewal !== true || rc <= 0 || ry <= 0) return [];
  const out: { n: number; from: Date; to: Date }[] = []; let from = addDays(end, 1);
  for (let r = 1; r <= Math.min(rc, 6); r++) { const to = addDays(addYearsMonths(from, ry, 0), -1); out.push({ n: r, from, to }); from = addDays(to, 1); }
  return out;
}

const AR_HEAD = ["السنة الإيجارية", "الفترة", "الإيجار الشهري", "الإيجار السنوي"];
const EN_HEAD = ["Lease year", "Period", "Monthly rent", "Yearly rent"];
const arYear = (label: string) => label.replace(/^Year (\d+)$/, "السنة $1").replace(/^Renewal (\d+), year (\d+)$/, "التجديد $1، السنة $2");

/** Text for the lease body: {{rentIncreaseText}}, {{rentTable}} (a `| a | b |` table block) and {{renewalText}}. Empty strings when not applicable. */
export function leaseDerived(a: Answers, lang: "en" | "ar"): Record<string, string> {
  const ar = lang === "ar"; const plan = rentPlan(a);
  let increase = "";
  const type = increaseType(a);
  const ref = plan ? (ar ? " كما هو مبيَّن في الجدول أدناه" : ", as shown in the schedule below") : "";
  if (type === "percent" && plan && plan.pct > 0) increase = ar ? `ويزداد الإيجار الأساسي كل سنة في ذكرى تاريخ البدء بنسبة ${plan.pct}% من الإيجار الأساسي المعمول به في السنة السابقة${ref}.` : `Each year on the anniversary of the start date, Base Rent increases by ${plan.pct}% of the Base Rent in effect the year before${ref}.`;
  else if (type === "amount" && plan && plan.amt > 0) increase = ar ? `ويزداد الإيجار الأساسي كل سنة في ذكرى تاريخ البدء بمبلغ ${money(plan.amt)} شهريًا${ref}.` : `Each year on the anniversary of the start date, Base Rent increases by ${money(plan.amt)} per month${ref}.`;
  else if (type === "percent" && !plan && (num(a.increasePercent) ?? 0) > 0) increase = ar ? `ويزداد الإيجار الأساسي كل سنة في ذكرى تاريخ البدء بنسبة ${num(a.increasePercent)}% من الإيجار المعمول به.` : `Each year on the anniversary of the start date, Base Rent increases by ${num(a.increasePercent)}% of the rent in effect.`;
  else if (type === "amount" && !plan && (num(a.increaseAmount) ?? 0) > 0) increase = ar ? `ويزداد الإيجار الأساسي كل سنة في ذكرى تاريخ البدء بمبلغ ${money(num(a.increaseAmount)!)} شهريًا.` : `Each year on the anniversary of the start date, Base Rent increases by ${money(num(a.increaseAmount)!)} per month.`;
  const free = Math.max(0, Math.floor(num(a.freeMonths) ?? 0));
  if (!increase && plan && plan.type === "none" && plan.rows.filter((r) => !r.renewal).length > 1) increase = ar ? "ويبقى الإيجار الأساسي ثابتًا طوال المدة الأولى." : "Base Rent stays the same throughout the initial term.";
  if (free > 0) increase += ar ? ` ويُعفى المستأجر من الإيجار الأساسي عن ${free === 1 ? "الشهر الأول" : `الأشهر الـ ${free} الأولى`} من المدة.` : ` Base Rent is waived for the ${free === 1 ? "first month" : `first ${free} months`} of the term; all other charges remain due.`;

  let table = "";
  if (plan && (new Set(plan.rows.map((r) => r.monthly)).size > 1 || free > 0)) {
    const head = ar ? AR_HEAD : EN_HEAD;
    const lines = [`| ${head.join(" | ")} |`];
    for (const r of plan.rows) {
      const label = ar ? arYear(r.label) : r.label;
      lines.push(`| ${label}${r.partial ? (ar ? " (جزء من سنة)" : " (partial year)") : ""} | ${shortDate(r.from, ar)} – ${shortDate(r.to, ar)} | ${money(r.monthly)} | ${money(r.yearly)} |`);
      if (!r.renewal && r === plan.rows.filter((x) => !x.renewal).slice(-1)[0]) lines.push(`| ${ar ? "الإجمالي للمدة الأولى" : "Total for the initial term"} |  |  | ${money(plan.initialTotal)} |`);
    }
    const notes: string[] = [];
    if (free > 0) notes.push(ar ? `السنة الأولى تستثني ${free === 1 ? "الشهر" : `${free} من الأشهر`} المعفى من الإيجار الأساسي.` : `Year 1 leaves out the free ${plural(free, "month", "months")}${free === 1 ? "" : ` (${free})`}.`);
    if (plan.rows.some((r) => r.renewal)) notes.push(ar ? "الصفوف المسماة «التجديد» تسري فقط إذا مارس المستأجر خيار التجديد." : "Rows marked Renewal apply only if Tenant renews.");
    table = lines.join("\n") + (notes.length ? `\n\n${notes.join(" ")}` : "");
  }

  let renewal = "";
  const terms = renewalTerms(a);
  if (terms.length) {
    const ry = Math.floor(num(a.renewalYears) ?? 0); const rc = terms.length; const days = Math.floor(num(a.renewalNoticeDays) ?? 90);
    const list = terms.map((t) => `${shortDate(t.from, ar)} – ${shortDate(t.to, ar)}`).join(ar ? "؛ " : "; ");
    const mode = renewalMode(a);
    const full = (t: string) => { const x = t.trim(); return /[.!?]$/.test(x) ? x : `${x}.`; };
    const rp = num(a.renewalIncreasePercent) ?? 0, ra = num(a.renewalIncreaseAmount) ?? 0;
    const ownRent = String(a.renewalRentTerms ?? "").trim() || String(a.renewalTerms ?? "").trim();
    let rentLine = "";
    if (mode === "same") rentLine = increaseType(a) === "none"
      ? (ar ? " ويبقى الإيجار الأساسي خلال مدة التجديد كما كان في آخر سنة من المدة الأولى." : " Base Rent during a renewal term stays the same as in the last year of the initial term.")
      : (ar ? " ويستمر الإيجار الأساسي في الزيادة خلال مدة التجديد على النحو المبيَّن في جدول الإيجار." : " Base Rent during a renewal term continues to change as shown in the rent schedule.");
    else if (mode === "flat") rentLine = ar ? " ويبقى الإيجار الأساسي خلال مدة التجديد كما كان في آخر سنة من المدة الأولى." : " Base Rent during a renewal term stays the same as in the last year of the initial term.";
    else if (mode === "percent") rentLine = ar ? ` ويزداد الإيجار الأساسي خلال مدة التجديد كل سنة، بدءًا من أول سنة فيها، بنسبة ${rp}% من الإيجار الأساسي المعمول به في السنة السابقة، على النحو المبيَّن في جدول الإيجار.` : ` Base Rent during a renewal term increases each year, beginning with its first year, by ${rp}% of the Base Rent in effect the year before, as shown in the rent schedule.`;
    else if (mode === "amount") rentLine = ar ? ` ويزداد الإيجار الأساسي خلال مدة التجديد كل سنة، بدءًا من أول سنة فيها، بمبلغ ${money(ra)} شهريًا، على النحو المبيَّن في جدول الإيجار.` : ` Base Rent during a renewal term increases each year, beginning with its first year, by ${money(ra)} per month, as shown in the rent schedule.`;
    else if (ownRent) rentLine = ar ? ` الإيجار الأساسي خلال مدة التجديد: ${full(ownRent)}` : ` Base Rent during a renewal term: ${full(ownRent)}`;
    // Anything else the parties agreed about renewing (when it is not the rent sentence above) is printed as its own sentence.
    const other = String(a.renewalTerms ?? "").trim();
    if (other && other !== ownRent) rentLine += ar ? ` شروط التجديد الأخرى: ${full(other)}` : ` Other renewal terms: ${full(other)}`;
    renewal = ar
      ? `يجوز للمستأجر تجديد هذا العقد ${rc === 1 ? `لمدة إضافية واحدة مدتها ${arYears(ry)}` : `لمدد متتالية عددها ${rc}، مدة كل منها ${arYears(ry)}`} بإشعار كتابي إلى المؤجِّر قبل انتهاء المدة السارية بـ ${days} يومًا على الأقل، بشرط ألا يكون المستأجر مخلًّا وقت ذلك. وتمتد مدد التجديد: ${list}.${rentLine}`
      : `Tenant may renew this Lease for ${rc === 1 ? `one additional term of ${ry} ${plural(ry, "year", "years")}` : `${rc} successive terms of ${ry} ${plural(ry, "year", "years")} each`}, by giving Landlord written notice at least ${days} days before the term then in effect ends, but only if Tenant is not in default at that time. The ${plural(rc, "renewal term would run", "renewal terms would run")}: ${list}.${rentLine}`;
  }
  void longDate;
  // Maryland (Real Property 3-101): a first term or any renewal term longer than seven years has to be recorded (or a memorandum of lease).
  const st = parseIso(a.startDate), en = parseIso(a.endDate);
  const firstLong = Boolean(st && en && en.getTime() > addDays(addYearsMonths(st, 7, 0), -1).getTime());
  const renewLong = a.renewal === true && (num(a.renewalYears) ?? 0) > 7;
  return { rentIncreaseText: increase ? `${increase} ` : "", rentTable: table, renewalText: renewal, longTerm: firstLong || renewLong ? "yes" : "" };
}
