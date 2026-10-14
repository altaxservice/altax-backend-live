/**
 * Printable page (HTML) for a Document Builder document: the same layout as the PDF and Word file — centered title, bold clauses,
 * uncrowded signing section with real lines to sign on and a boxed notary block — but drawn by the browser, which shapes Arabic
 * correctly (the server's PDF writer cannot). Used for Arabic and "English + Arabic" documents, and for any "view / print" of a document.
 */
import { parseBlocks, type Block, type FormItem } from "./layout";

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const richText = (t: string) => esc(t).replace(/_{4,}/g, '<span class="blank"></span>');
const dir = (rtl: boolean) => (rtl ? ' dir="rtl"' : "");

function itemsHtml(items: FormItem[], rtl: boolean): string {
  return items.map((it) => {
    if (it.k === "text") return `<p class="${it.bold ? "role" : "line"}"${dir(rtl)}>${richText(it.text)}</p>`;
    const weights = it.fields.map((f) => (/signature|seal|التوقيع|ختم/i.test(f.label) ? 2.3 : /date|التاريخ/i.test(f.label) ? 1 : 1.5));
    const cells = it.fields.map((f, i) => `<div class="sigfield" style="flex:${weights[i]}"><span>${esc(`${f.label}${i === it.fields.length - 1 && it.note ? ` ${it.note}` : ""}`.trim())}</span></div>`).join("");
    return `${it.caption ? `<p class="line"${dir(rtl)}>${esc(it.caption)}</p>` : ""}<div class="sigrow"${dir(rtl)}>${cells}</div>`;
  }).join("");
}

function blocksHtml(blocks: Block[]): string {
  const out: string[] = []; let forms = 0; let first = true;
  for (const b of blocks) {
    switch (b.t) {
      case "break": out.push('<div class="pb"></div>'); forms = 0; break;
      case "title": out.push(`<h1${dir(b.rtl)}>${esc(b.text)}</h1>`); first = false; break;
      case "heading": out.push(`<h2${dir(b.rtl)}>${esc(b.text)}</h2>`); break;
      case "subheading": out.push(`<h3${dir(b.rtl)}>${esc(b.text)}</h3>`); break;
      case "bullet": out.push(`<p class="bullet"${dir(b.rtl)}>${richText(b.text)}</p>`); break;
      case "para": out.push(`<p${dir(b.rtl)}>${richText(b.text)}</p>`); break;
      case "form": {
        forms += 1;
        if (b.notary) {
          const text = b.items.filter((i) => i.k !== "row").map((it, i) => (i === 0 && it.k === "text" ? { ...it, bold: true } : it)) as FormItem[];
          const rows = b.items.filter((i) => i.k === "row");
          out.push(`<section class="notary"${dir(b.rtl)}>${itemsHtml(text, b.rtl)}<div class="nrow"><div class="nfields">${itemsHtml(rows, b.rtl)}</div><div class="seal">${b.rtl ? "الختم" : "Seal"}</div></div></section>`);
        } else {
          if (forms === 1) out.push(`<div class="siglabel">${b.rtl ? "التوقيعات" : "SIGNATURES"}</div>`);
          out.push(`<section class="sign"${dir(b.rtl)}>${itemsHtml(b.items, b.rtl)}</section>`);
        }
        break;
      }
    }
  }
  void first;
  return out.join("\n");
}

export function renderDocumentHtml(opts: { title: string; body: string; autoPrint?: boolean }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title><style>
@page { size: Letter; margin: 1in; }
* { box-sizing: border-box; }
body { margin: 0; color: #171717; font: 11.5pt/1.55 "Times New Roman", Georgia, "Geeza Pro", "Noto Naskh Arabic", "Arial", serif; background: #fff; }
.page { max-width: 6.5in; margin: 0 auto; padding: 0.5in 0.25in; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 22pt; padding-bottom: 10pt; border-bottom: 1px solid #999; }
h2 { font-size: 11.5pt; margin: 18pt 0 5pt; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 16pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; text-align: justify; }
p.bullet { padding-inline-start: 22pt; text-indent: -12pt; }
p.bullet::before { content: "• "; }
.blank { display: inline-block; min-width: 1.3in; border-bottom: 1px solid #333; margin: 0 3pt; height: 0.9em; }
.siglabel { text-align: center; font-weight: 700; font-size: 10.5pt; margin: 26pt 0 4pt; padding-bottom: 4pt; border-bottom: 1px solid #999; break-after: avoid; }
section.sign { margin: 14pt 0 6pt; break-inside: avoid; }
section.sign p.role, section.notary p.role { font-weight: 700; margin: 0 0 2pt; text-align: start; }
p.line { margin: 0 0 3pt; text-align: start; }
.sigrow { display: flex; gap: 0.25in; margin: 0 0 6pt; }
.sigfield { min-height: 0.5in; display: flex; align-items: flex-end; }
.sigfield span { display: block; width: 100%; border-top: 1px solid #333; padding-top: 3pt; font-size: 8.5pt; color: #666; margin-top: 0.38in; }
section.notary { margin: 22pt 0 10pt; border: 1px solid #888; background: #f7f7f7; padding: 14pt 16pt; break-inside: avoid; }
.nrow { display: flex; gap: 0.25in; align-items: flex-start; }
.nfields { flex: 1; }
.nfields .sigrow { margin-bottom: 2pt; }
.seal { width: 1.15in; height: 1.15in; border: 1px dashed #999; display: flex; align-items: center; justify-content: center; font-size: 9pt; color: #999; flex: none; }
.pb { break-after: page; height: 0; }
.hint { position: fixed; top: 8px; inset-inline-end: 8px; font: 12px Arial, sans-serif; background: #fff8dc; border: 1px solid #e0c97a; padding: 6px 10px; border-radius: 4px; }
@media print { .page { padding: 0; max-width: none; } .hint { display: none; } }
</style></head><body><div class="page">
${blocksHtml(parseBlocks(opts.body))}
</div>${opts.autoPrint ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},350)})</script>" : '<div class="hint">Press Cmd/Ctrl+P to print or save as PDF</div>'}</body></html>`;
}
