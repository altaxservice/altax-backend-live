import type { CSSProperties } from "react";

// Mirrors contractPdf.ts's ARABIC_RE — same script-detection logic, kept in sync
// manually since one runs in the browser and one in the PDF renderer.
const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/**
 * Renders a contract's rendered_body one paragraph at a time with dir="auto" on
 * each — needed because the immigration template mixes an English section
 * followed by a full Arabic translation in the same text blob (see
 * contractContent.ts). A single pre-wrap block would pick one direction for
 * the whole thing (based on whichever script appears first); rendering
 * paragraph-by-paragraph lets each one align itself correctly, English
 * left-to-right and Arabic right-to-left, in both the public sign page (where
 * a client actually has to read and understand this to give real consent) and
 * the staff preview in the Contracts section.
 *
 * text-align is set explicitly per paragraph rather than left to the
 * dir="auto"-driven "start" default — confirmed live that this browser
 * resolves the default to a literal "left" regardless of the paragraph's own
 * resolved direction, which visually left-aligned the Arabic paragraphs even
 * though their characters correctly flowed right-to-left internally.
 */
export function ContractBodyText({ text, style }: { text: string; style?: CSSProperties }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <div style={style}>
      {paragraphs.map((p, i) => {
        const isArabic = ARABIC_RE.test(p);
        // A table: every line looks like "| a | b | c |" (the rent schedule in a lease); the first row is the header.
        const rowLines = p.split("\n");
        if (rowLines.length > 1 && rowLines.every((l) => /^\|.+\|$/.test(l.trim()))) {
          const rows = rowLines.map((l) => l.trim().slice(1, -1).split("|").map((x) => x.trim()));
          const num = (col: number) => rows.slice(1).every((r) => /^[\s$\d,.%()\-–—]*$/.test(r[col] || ""));
          return (
            <div key={i} style={{ margin: i === paragraphs.length - 1 ? 0 : "0 0 14px", overflowX: "auto" }}>
              <table dir={isArabic ? "rtl" : "ltr"} style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.92em" }}>
                <thead><tr>{rows[0].map((h, ci) => <th key={ci} style={{ border: "1px solid #999", padding: "4px 8px", background: "#f3f3f3", textAlign: num(ci) ? "right" : "start" }}>{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(1).map((r, ri) => {
                    const total = /^total/i.test(r[0] || "");
                    return (
                      <tr key={ri}>
                        {rows[0].map((_, ci) => (
                          <td key={ci} style={{ border: "1px solid #999", padding: "4px 8px", textAlign: num(ci) ? "right" : "start", fontWeight: total ? 700 : 400, background: total ? "#f3f3f3" : undefined, fontVariantNumeric: "tabular-nums" }}>{r[ci] || ""}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }
        return (
          <p
            key={i}
            dir="auto"
            style={{
              margin: i === paragraphs.length - 1 ? 0 : "0 0 14px",
              whiteSpace: "pre-wrap",
              textAlign: isArabic ? "right" : "left",
            }}
          >
            {p}
          </p>
        );
      })}
    </div>
  );
}
