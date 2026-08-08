/**
 * Form 2553 (S-Corp election) has a real, hard, and easily-missed IRS
 * deadline that nothing in this app tracked before this file: per the
 * Instructions for Form 2553 ("When to Make the Election"), the election
 * must be filed no more than 2 months and 15 days after the beginning of
 * the tax year it's to take effect — for a brand-new entity, that "tax
 * year" begins on its formation date, which this app already collects
 * (date_of_formation) but never used for this. Miss it, and the entity is
 * taxed as its default classification (a multi-member LLC as a
 * partnership, a single-member LLC as disregarded) for the whole year —
 * a real, often-costly self-employment-tax consequence, not a paperwork
 * inconvenience.
 *
 * If the plain deadline is missed, Rev. Proc. 2013-30 offers late-election
 * relief when the request is filed within 3 years and 75 days of the
 * intended effective date (plus reasonable-cause and a few other
 * conditions this app has no way to verify) — so a missed deadline isn't
 * automatically a dead end, and that distinction is worth surfacing too.
 *
 * Only LLC and C-Corp are treated as eligible here — an S-Corp has already
 * elected, and Partnership/Sole Proprietorship/Nonprofit/Individual can't
 * make this election without first converting entity type (out of scope
 * for a same-entity deadline calculator).
 *
 * This is a computed ESTIMATE flagging risk, not a substitute for reading
 * the actual instructions on a specific client's facts — same "clearly
 * labeled estimate" discipline as this app's payroll-withholding and
 * cash-balance figures elsewhere.
 */

const SCORP_ELIGIBLE_ENTITY_TYPES = new Set(["LLC", "C-Corp"]);

export interface ScorpElectionStatus {
  deadline: string; // YYYY-MM-DD — the plain 2-month-15-day deadline
  daysUntilDeadline: number; // negative once past
  pastDeadline: boolean;
  lateReliefDeadline: string; // YYYY-MM-DD — 3 years + 75 days out
  lateReliefAvailable: boolean; // true only when past the plain deadline but still inside the relief window
}

function addMonthsAndDays(iso: string, months: number, days: number): Date {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Returns null when this client isn't a fit for the calculation at all
 * (ineligible entity type, no formation date on file, or a 2553 already
 * exists for them — `has2553Filing` covers Draft/Signed/Submitted alike,
 * since even a Draft means someone's already on it).
 */
export function computeScorpElectionStatus(
  entityType: string | null,
  dateOfFormation: string | null,
  has2553Filing: boolean,
  asOf: Date = new Date()
): ScorpElectionStatus | null {
  if (!entityType || !SCORP_ELIGIBLE_ENTITY_TYPES.has(entityType)) return null;
  if (has2553Filing) return null;
  if (!dateOfFormation) return null;

  const formationIso = String(dateOfFormation).slice(0, 10);
  // Guards against a caller passing something that isn't a clean
  // YYYY-MM-DD string (e.g. a raw JS Date's default toString()) — this is
  // shared, cross-cutting logic (dashboard + SWOT findings both call it),
  // so a malformed date here should degrade to "nothing to flag," not take
  // down the whole route with an uncaught RangeError.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formationIso) || Number.isNaN(new Date(`${formationIso}T00:00:00`).getTime())) return null;
  const deadline = addMonthsAndDays(formationIso, 2, 15);
  const daysUntilDeadline = Math.round((deadline.getTime() - asOf.getTime()) / 86400000);
  const pastDeadline = daysUntilDeadline < 0;
  const lateReliefDeadlineDate = new Date(`${formationIso}T00:00:00`);
  lateReliefDeadlineDate.setFullYear(lateReliefDeadlineDate.getFullYear() + 3);
  lateReliefDeadlineDate.setDate(lateReliefDeadlineDate.getDate() + 75);
  const lateReliefAvailable = pastDeadline && asOf.getTime() <= lateReliefDeadlineDate.getTime();

  return {
    deadline: deadline.toISOString().slice(0, 10),
    daysUntilDeadline,
    pastDeadline,
    lateReliefDeadline: lateReliefDeadlineDate.toISOString().slice(0, 10),
    lateReliefAvailable,
  };
}
