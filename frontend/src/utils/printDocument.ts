/** Opens the finished text in a clean printable page (the browser shapes Arabic correctly, which the server PDF cannot) and starts printing. */
export function printText(title: string, body: string) {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const arabic = /[\u0600-\u06FF]/;
  const paras = body.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p dir="auto" style="text-align:${arabic.test(p) ? "right" : "left"}">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    @page { margin: 0.9in; } body { font: 12pt/1.55 Georgia, 'Times New Roman', 'Geeza Pro', 'Noto Naskh Arabic', 'Arial', serif; color: #111; }
    p { margin: 0 0 12pt; white-space: normal; }
  </style></head><body>${paras}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}


