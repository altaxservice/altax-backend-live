import { Fragment } from "react";

export interface SummaryTableRow { label: string; labelAr: string; value: string }
export interface SummaryTableSection { title: string; titleAr: string; rows: SummaryTableRow[] }

/**
 * Real bilingual English/Arabic table for a client's period figures (sales tax +
 * payroll) — used by both the Reports "Client Message" tab and the Sales, Tax &
 * Payroll report, so the two always render the same data the same way. Every row
 * carries its own real Arabic translation (from computeClientPeriodSummaryTable on
 * the backend) rather than the same English text shown twice under an Arabic
 * heading, which is what the plain-text version did before this existed.
 */
export function SummaryTable({ sections }: { sections: SummaryTableSection[] }) {
  if (sections.length === 0) return null;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: "50%" }}>English</th>
            <th style={{ width: "50%", textAlign: "right" }} dir="rtl">العربية (Arabic)</th>
          </tr>
        </thead>
        <tbody>
          {sections.map((s, i) => (
            <Fragment key={i}>
              <tr style={{ background: "var(--surface)" }}>
                <th style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.03em" }}>{s.title}</th>
                <th style={{ fontSize: 11, textTransform: "uppercase", textAlign: "right" }} dir="rtl">{s.titleAr}</th>
              </tr>
              {s.rows.map((r, j) => (
                <tr key={j}>
                  <td>{r.label}{r.value ? `: ${r.value}` : ""}</td>
                  <td dir="rtl" style={{ textAlign: "right" }}>{r.labelAr}{r.value ? `: ${r.value}` : ""}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
