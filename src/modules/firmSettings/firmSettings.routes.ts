import { Router, Response, Request } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { getFirmProfile, getFirmLogo, updateFirmProfile } from "../../common/firmProfile";
import { scanFileForMalware } from "../../common/malwareScan";

export const firmSettingsRouter = Router();

// SVG dropped (SEC-004, hard audit 2026-08-13) — it's the one script-capable image
// format accepted anywhere in this app's upload surface, and a logo has no real use
// for one that PNG/JPEG doesn't already cover. Malware scanning below doesn't
// substitute for this: it targets known-malware signatures, not a hand-crafted
// <script> payload inside an otherwise well-formed SVG.
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];

/** Any authed user can read — every portal's branding (sidebar, PDFs a client downloads) depends on it. */
firmSettingsRouter.get("/", requireAuth, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json(await getFirmProfile());
}));

/**
 * Public, unauthenticated — the login screen and invite-acceptance screen render the
 * firm's logo before anyone has signed in, so it can't sit behind requireAuth. A logo
 * is public-facing branding by nature (it's on the login screen either way), not
 * sensitive data, so this is a deliberate, narrow exception to this app's normal
 * auth-everywhere rule.
 */
firmSettingsRouter.get("/logo", asyncHandler(async (_req: Request, res: Response) => {
  const logo = await getFirmLogo();
  if (!logo) return res.status(404).json({ error: "No logo set." });
  res.setHeader("Content-Type", logo.contentType);
  res.setHeader("Cache-Control", "no-cache");
  // helmet() defaults Cross-Origin-Resource-Policy to same-origin, which silently
  // blocks the <img> tag in FirmLogo.tsx from loading this cross-origin (frontend
  // and backend run on different ports in dev, and likely different subdomains in
  // production) — this is public branding, not sensitive, so it's safe to open up.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.send(logo.data);
}));

/**
 * Update firm identity — admin-only (this affects every client-facing PDF and email
 * the whole firm sends). Logo accepted as a base64 data URL from the frontend's file
 * input; logoData: null explicitly clears the logo, omitting it leaves it untouched.
 */
// Zelle QR is a photo/screenshot from the firm's bank app, not vector art — SVG isn't useful here the way it can be for a logo.
const ALLOWED_QR_TYPES = ["image/png", "image/jpeg"];

firmSettingsRouter.patch("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  let logoData: string | null | undefined;
  let logoContentType: string | null | undefined;

  if (body.logoDataUrl === null) {
    logoData = null;
    logoContentType = null;
  } else if (typeof body.logoDataUrl === "string" && body.logoDataUrl.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(body.logoDataUrl);
    if (!match) return res.status(400).json({ error: "Invalid logo image data." });
    const [, contentType, base64] = match;
    if (!ALLOWED_LOGO_TYPES.includes(contentType)) {
      return res.status(400).json({ error: "Logo must be a PNG or JPEG image." });
    }
    // Roughly 3 chars of base64 per 2 bytes — this keeps a saved logo well under the
    // 8MB raw upload ceiling documents.routes.ts already established for this app.
    if (base64.length > 2_000_000) {
      return res.status(400).json({ error: "Logo image is too large — please use a file under 1.5MB." });
    }
    // SEC-004 (hard audit 2026-08-13): this was the one upload path in the app not
    // routed through malware scanning, same as every other upload (documents,
    // bank statements, payroll/sales imports, message attachments).
    const scan = await scanFileForMalware(Buffer.from(base64, "base64"), "firm-logo");
    if (scan.scanned && !scan.clean) {
      return res.status(400).json({ error: `This file was flagged by malware scanning${scan.foundViruses?.length ? ` (${scan.foundViruses.join(", ")})` : ""} and was not uploaded.` });
    }
    logoData = base64;
    logoContentType = contentType;
  }

  let zelleQrData: string | null | undefined;
  let zelleQrContentType: string | null | undefined;

  if (body.zelleQrDataUrl === null) {
    zelleQrData = null;
    zelleQrContentType = null;
  } else if (typeof body.zelleQrDataUrl === "string" && body.zelleQrDataUrl.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(body.zelleQrDataUrl);
    if (!match) return res.status(400).json({ error: "Invalid Zelle QR image data." });
    const [, contentType, base64] = match;
    if (!ALLOWED_QR_TYPES.includes(contentType)) {
      return res.status(400).json({ error: "Zelle QR code must be a PNG or JPEG image." });
    }
    if (base64.length > 2_000_000) {
      return res.status(400).json({ error: "Zelle QR image is too large — please use a file under 1.5MB." });
    }
    const qrScan = await scanFileForMalware(Buffer.from(base64, "base64"), "zelle-qr");
    if (qrScan.scanned && !qrScan.clean) {
      return res.status(400).json({ error: `This file was flagged by malware scanning${qrScan.foundViruses?.length ? ` (${qrScan.foundViruses.join(", ")})` : ""} and was not uploaded.` });
    }
    zelleQrData = base64;
    zelleQrContentType = contentType;
  }

  await updateFirmProfile({
    firmName: typeof body.firmName === "string" ? body.firmName.trim() : undefined,
    street: typeof body.street === "string" ? body.street.trim() : undefined,
    city: typeof body.city === "string" ? body.city.trim() : undefined,
    state: typeof body.state === "string" ? body.state.trim() : undefined,
    zipCode: typeof body.zipCode === "string" ? body.zipCode.trim() : undefined,
    phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    logoData, logoContentType,
    zelleQrData, zelleQrContentType,
    updatedBy: req.user!.email,
  });

  await logAudit("System", "UPDATE_FIRM_SETTINGS", "FIRM-1", "", "", "", "Firm profile updated.", req.user!.email);

  res.json(await getFirmProfile());
}));
