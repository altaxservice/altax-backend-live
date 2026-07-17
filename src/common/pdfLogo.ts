import { PDFDocument, PDFImage } from "pdf-lib";
import type { FirmProfile } from "./firmProfile";

/**
 * Embeds the firm's logo into a pdf-lib document, if one is set and pdf-lib can
 * actually embed it — PNG/JPEG only. SVG logos (allowed for the web UI, where a
 * browser renders them natively) are silently skipped here; the letterhead just
 * falls back to text-only, same as having no logo at all.
 */
export async function embedFirmLogo(doc: PDFDocument, profile: FirmProfile): Promise<PDFImage | null> {
  if (!profile.logoDataUrl) return null;
  const match = /^data:([^;]+);base64,(.+)$/.exec(profile.logoDataUrl);
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
