/**
 * Turns a rendered Document Builder text into layout blocks — title, clause headings, paragraphs, bullets, signature forms and
 * notary acknowledgments — so the PDF, the Word file and the printable page all draw the signing section the same, uncrowded way
 * (real signature lines with the label underneath, a boxed notary block) instead of typed underscores.
 * Pure text in, plain data out; no drawing happens here.
 */
export interface FormField { label: string }
export type FormItem =
  /** A sentence; underscore runs inside it are fill-in blanks. */
  | { k: "text"; text: string; bold?: boolean }
  | { k: "row"; fields: FormField[]; caption?: string; note?: string };
export type Block =
  | { t: "title"; text: string; rtl: boolean }
  | { t: "subtitle"; text: string; rtl: boolean }
  | { t: "heading"; text: string; rtl: boolean }
  | { t: "subheading"; text: string; rtl: boolean }
  | { t: "para"; text: string; rtl: boolean }
  | { t: "bullet"; text: string; rtl: boolean }
  | { t: "form"; items: FormItem[]; notary: boolean; rtl: boolean }
  | { t: "break" };

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const HEADING = /^\d+\.\s+[A-Z؀-ۿ][A-Z؀-ۿ0-9 &,'\/()\-،]+$/;
const ROLE_LINE = /^[A-Z][A-Z ()'\/&.,-]{2,}(:.*)?$/;
const NOTARY_RE = /notary|كاتب العدل/i;
const FILL = /_{4,}/;

/** A line like "Signature: ____   Date: ____" → its labelled fields; null when it is really a sentence with a blank in it. */
function parseRow(line: string): FormItem | null {
  if (!/_{6,}/.test(line)) return null;
  const parts = line.split(/_{4,}/);
  const trailing = parts[parts.length - 1].trim();
  if (trailing.length > 45) return null;
  const fields: FormField[] = []; const captions: string[] = [];
  if (parts.length === 2 && !parts[0].trim()) return { k: "row", fields: [{ label: "" }], note: trailing || undefined };
  for (let i = 0; i < parts.length - 1; i++) {
    const pieces = parts[i].split(/\s{3,}/).map((x) => x.trim()).filter(Boolean);
    let labelRaw = (pieces.pop() || "").replace(/:\s*$/, "").trim();
    // "If this member is a company — By" → caption "If this member is a company", label "By"
    const dash = labelRaw.split(/\s[—–-]\s/); if (dash.length > 1) { labelRaw = dash.pop()!.trim(); pieces.push(dash.join(" — ").trim()); }
    if (labelRaw.length > 62 || (labelRaw && !/:\s*$/.test(parts[i].trimEnd()) && labelRaw.length > 30)) return null;
    captions.push(...pieces);
    fields.push({ label: labelRaw });
  }
  if (!fields.length) return null;
  return { k: "row", fields, caption: captions.join("  ") || undefined, note: trailing || undefined };
}

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  const lines = body.replace(/\r/g, "").split("\n");
  let i = 0, blankRun = 0, first = true, afterBreak = false;
  let cur: string[] = [];
  const flush = () => {
    if (!cur.length) return;
    const rtl = cur.some((l) => ARABIC_RE.test(l));
    if (cur.some((l) => FILL.test(l))) {
      const items: FormItem[] = [];
      for (const l of cur) {
        if (!FILL.test(l)) { items.push({ k: "text", text: l, bold: ROLE_LINE.test(l) && l.length < 90 }); continue; }
        const row = parseRow(l);
        if (row) items.push(row);
        else items.push({ k: "text", text: l });
      }
      blocks.push({ t: "form", items, notary: NOTARY_RE.test(cur[0]) && /^(ACKNOWLEDGMENT|NOTARY|Notary|إقرار|كاتب)/.test(cur[0]), rtl });
    } else {
      for (const l of cur) {
        if (/^• /.test(l)) blocks.push({ t: "bullet", text: l.slice(2), rtl: ARABIC_RE.test(l) });
        else if (HEADING.test(l)) blocks.push({ t: "heading", text: l, rtl: ARABIC_RE.test(l) });
        else if (/^[A-Z][A-Z ()'\/&.,-]{4,60}$/.test(l)) blocks.push({ t: "subheading", text: l, rtl: false });
        else blocks.push({ t: "para", text: l, rtl: ARABIC_RE.test(l) });
      }
    }
    cur = [];
  };
  for (i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) { flush(); blankRun += 1; continue; }
    if (line.trim() === "[page break]") { flush(); blocks.push({ t: "break" }); afterBreak = true; blankRun = 0; continue; }
    const rtl = ARABIC_RE.test(line);
    if (afterBreak && !cur.length) { blocks.push({ t: "title", text: line, rtl }); afterBreak = false; blankRun = 0; continue; }
    if (first) { blocks.push({ t: "title", text: line, rtl }); first = false; blankRun = 0; continue; }
    if (!cur.length && blocks[blocks.length - 1]?.t === "title" && /^\(.{3,120}\)$/.test(line)) { blocks.push({ t: "subtitle", text: line.slice(1, -1), rtl }); blankRun = 0; continue; }
    if (blankRun >= 2 && rtl && !cur.length) { blocks.push({ t: "break" }); blocks.push({ t: "title", text: line, rtl }); blankRun = 0; continue; }
    // A heading line and the sentence under it are separate lines of the same paragraph; forms keep all their lines together.
    cur.push(line); blankRun = 0;
    if (!FILL.test(line) && cur.length && !cur.some((l) => FILL.test(l))) { /* plain paragraph — flushed when a blank line arrives */ }
  }
  flush();
  return blocks;
}
