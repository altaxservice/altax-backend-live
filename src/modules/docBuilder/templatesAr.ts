import { DOC_TEMPLATES } from "./templates";
import { AR_PART1 } from "./templatesAr1";
import { AR_PART2 } from "./templatesAr2";
import { AR_PART3 } from "./templatesAr3";
import { AR_PART4 } from "./templatesAr4";

/** An Arabic edition of a template: its title, its body (same {{markup}} and question ids) and Arabic labels for choice answers. */
export interface ArabicEdition { title: string; body: string; options?: Record<string, Record<string, string>> }

const EDITIONS: Record<string, ArabicEdition> = { ...AR_PART1, ...AR_PART2, ...AR_PART3, ...AR_PART4 };

/** Attaches each Arabic edition to its template (done once, at load). */
for (const t of DOC_TEMPLATES) {
  const ar = EDITIONS[t.key];
  if (!ar) continue;
  t.titleAr = ar.title;
  t.bodyAr = ar.body;
  for (const q of t.steps.flatMap((s) => s.questions)) {
    const labels = ar.options?.[q.id];
    if (labels && q.options) for (const o of q.options) if (labels[o.value]) o.labelAr = labels[o.value];
  }
}
