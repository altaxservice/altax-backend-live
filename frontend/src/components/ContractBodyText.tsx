import type { CSSProperties } from "react";

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
 */
export function ContractBodyText({ text, style }: { text: string; style?: CSSProperties }) {
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  return (
    <div style={style}>
      {paragraphs.map((p, i) => (
        <p key={i} dir="auto" style={{ margin: i === paragraphs.length - 1 ? 0 : "0 0 14px", whiteSpace: "pre-wrap" }}>{p}</p>
      ))}
    </div>
  );
}
