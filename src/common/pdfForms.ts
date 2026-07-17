import { PDFDocument, PDFTextField, PDFCheckBox } from "pdf-lib";
import fs from "fs";
import path from "path";

const TEMPLATE_DIR = path.join(__dirname, "..", "assets", "tax-forms");
const templateCache = new Map<string, Buffer>();

function loadTemplateBytes(filename: string): Buffer {
  if (!templateCache.has(filename)) {
    templateCache.set(filename, fs.readFileSync(path.join(TEMPLATE_DIR, filename)));
  }
  return templateCache.get(filename)!;
}

export function money2(v: unknown): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "";
  return n.toFixed(2);
}

/** Sets text on a field, silently truncating to the field's max length rather than throwing — official IRS fields cap some boxes (e.g. Box 12 codes) at 2 chars. */
function setTextSafe(doc: PDFDocument, fieldName: string, value: string) {
  if (!value) return;
  try {
    const field = doc.getForm().getField(fieldName);
    if (!(field instanceof PDFTextField)) return;
    const max = field.getMaxLength();
    field.setText(max ? value.slice(0, max) : value);
  } catch {
    // Field not present on this revision of the form — skip rather than fail the whole document.
  }
}

/**
 * Fills one "copy" (page) of an IRS fillable form. `fields` maps semantic box
 * names to values; `fieldPaths` maps those same semantic names to the exact
 * AcroForm field path for the given copy (built by substituting the copy
 * segment into a canonical CopyB-based template — see w2.ts/nec1099.ts).
 */
export function fillCopy(doc: PDFDocument, fieldPaths: Record<string, string>, values: Record<string, string>) {
  for (const [key, path] of Object.entries(fieldPaths)) {
    const value = values[key];
    if (value) setTextSafe(doc, path, value);
  }
}

/** Checks a checkbox field by its exact AcroForm path, skipping silently if absent (form revision changed) or not a checkbox. */
export function checkBox(doc: PDFDocument, fieldName: string) {
  try {
    const field = doc.getForm().getField(fieldName);
    if (field instanceof PDFCheckBox) field.check();
  } catch {
    // Field not present on this revision of the form — skip rather than fail the whole document.
  }
}

/** Loads a template, letting the caller fill multiple copies (pages) before extracting a subset to return. */
export async function loadTemplate(filename: string): Promise<PDFDocument> {
  const bytes = loadTemplateBytes(filename);
  return PDFDocument.load(bytes);
}

/** Extracts specific 0-indexed pages from a filled document into a new standalone PDF, flattening form fields so the result is a plain, print-ready document. */
export async function extractFlattenedPages(doc: PDFDocument, pageIndexes: number[]): Promise<Uint8Array> {
  doc.getForm().updateFieldAppearances();
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, pageIndexes);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}
