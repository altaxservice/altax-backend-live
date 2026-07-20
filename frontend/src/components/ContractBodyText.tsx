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
