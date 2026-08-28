import type { ReactNode } from "react";

/**
 * Section header inside a detail card — small caps label + hairline rule,
 * matching .form-section-title's visual language but for read-only detail
 * cards (Task/Client/Employee/etc "Details" views) rather than forms. Wrap
 * its DetailField children in .detail-field-grid yourself so a section can
 * mix a two-up field grid with a full-width block (e.g. a notes box) below it.
 */
export function DetailSectionHead({ children }: { children: ReactNode }) {
  return <div className="detail-section-head">{children}</div>;
}

/** One field: label above value, not label-left/value-right — see .detail-field-* in index.css. */
export function DetailField({
  label,
  value,
  link,
  multiline,
  wide,
}: {
  label: string;
  value: string | null | undefined;
  link?: boolean;
  multiline?: boolean;
  wide?: boolean;
}) {
  const href = link && value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : null;
  return (
    <div className={`detail-field${wide ? " detail-field-wide" : ""}`}>
      <span className="detail-field-label">{label}</span>
      <span className={`detail-field-value${multiline ? " detail-field-multiline" : ""}`}>
        {href ? <a href={href} target="_blank" rel="noreferrer">{value}</a> : (value || "—")}
      </span>
    </div>
  );
}
