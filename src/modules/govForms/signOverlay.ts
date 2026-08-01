/**
 * Burns a typed-name electronic signature onto a generated W-4 or W-9 PDF, at
 * the real signature line printed on the official form (page 1, same page
 * generateW4/generateW9 already return). Neither form's AcroForm has a real
 * signature field (see w4.ts/w9.ts doc comments — the line is print-only),
 * so this draws text directly onto the page at fixed coordinates instead of
 * filling a field.
 *
 * Coordinates were determined the same way every other field placement in
 * this module was: rendered the blank form to an image, measured the
 * signature line's position, then rendered a test overlay and visually
 * confirmed it sits cleanly above the line without touching the "Step 5"/
 * "Sign Here" label column or the printed "Employee's signature"/"Signature
 * of U.S. person"/"Date" captions.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type SignableFormType = "W4" | "W9";

interface SignaturePosition {
  nameX: number;
  dateX: number;
  y: number;
  fontSize: number;
}

// Both forms share the same page size (611.976 x 791.968 — US Letter) and
// the same signature-row height, coincidentally, but each form's line sits
// at a different position on the page (W-4's is a standalone line near the
// bottom; W-9's is a table row higher up).
const SIGNATURE_POSITIONS: Record<SignableFormType, SignaturePosition> = {
  W4: { nameX: 98, dateX: 396, y: 99, fontSize: 10 },
  W9: { nameX: 129, dateX: 440, y: 201, fontSize: 10 },
};

/**
 * `pdfBytes` must already be the generated (flattened) single-page PDF from
 * generateW4/generateW9. Returns new bytes with "/s/ {signerName}" and the
 * signed date drawn onto the signature line — the same "/s/ Full Name"
 * convention used on e-filed government documents to represent a typed
 * signature.
 */
export async function applySignatureOverlay(
  formType: SignableFormType,
  pdfBytes: Uint8Array,
  signerName: string,
  signedAt: Date
): Promise<Uint8Array> {
  const pos = SIGNATURE_POSITIONS[formType];
  const doc = await PDFDocument.load(pdfBytes);
  const font = await doc.embedFont(StandardFonts.HelveticaOblique);
  const page = doc.getPage(0);
  const dateLabel = signedAt.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });

  page.drawText(`/s/ ${signerName}`, { x: pos.nameX, y: pos.y, size: pos.fontSize, font, color: rgb(0, 0, 0.6) });
  page.drawText(dateLabel, { x: pos.dateX, y: pos.y, size: pos.fontSize, font, color: rgb(0, 0, 0.6) });

  return doc.save();
}
