import { PDFDocument, PDFImage } from "pdf-lib";
import type { FirmProfile } from "./firmProfile";

/** Shared by embedFirmLogo/embedFirmZelleQr — PNG/JPEG only (pdf-lib can't embed SVG); returns null rather than throwing on anything it can't handle, so a bad/unsupported image just falls back to no image at all. */
async function embedDataUrlImage(doc: PDFDocument, dataUrl: string | null): Promise<PDFImage | null> {
  if (!dataUrl) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const [, contentType, base64] = match;
  const bytes = Buffer.from(base64, "base64");
  try {
    if (contentType === "image/png") return await doc.embedPng(bytes);
    if (contentType === "image/jpeg") return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

/**
 * Embeds the firm's logo into a pdf-lib document, if one is set and pdf-lib can
 * actually embed it — PNG/JPEG only. SVG logos (allowed for the web UI, where a
 * browser renders them natively) are silently skipped here; the letterhead just
 * falls back to text-only, same as having no logo at all.
 */
export async function embedFirmLogo(doc: PDFDocument, profile: FirmProfile): Promise<PDFImage | null> {
  return embedDataUrlImage(doc, profile.logoDataUrl);
}

/** Embeds the firm's "Scan to pay" Zelle QR image, if one is set on file. */
export async function embedFirmZelleQr(doc: PDFDocument, profile: FirmProfile): Promise<PDFImage | null> {
  return embedDataUrlImage(doc, profile.zelleQrDataUrl);
}
