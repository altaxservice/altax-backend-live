import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";

const TEMPLATE_DIR = path.join(__dirname, "..", "assets", "health-forms");
const templateCache = new Map<string, Buffer>();

function loadTemplateBytes(filename: string): Buffer {
  if (!templateCache.has(filename)) {
    templateCache.set(filename, fs.readFileSync(path.join(TEMPLATE_DIR, filename)));
  }
  return templateCache.get(filename)!;
}

/** Loads a real government PDF template — same load-then-fill pattern as src/common/pdfForms.ts's IRS-form loader. */
export async function loadHealthFormTemplate(filename: string): Promise<PDFDocument> {
  const bytes = loadTemplateBytes(filename);
  return PDFDocument.load(bytes);
}

/** Reads a real government PDF's raw bytes unmodified — for documents that are generic guidance, not a form with blanks to fill. */
export function readHealthFormBytes(filename: string): Uint8Array {
  return loadTemplateBytes(filename);
}
