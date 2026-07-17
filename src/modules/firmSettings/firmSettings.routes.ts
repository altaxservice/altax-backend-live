import { Router, Response, Request } from "express";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { getFirmProfile, getFirmLogo, updateFirmProfile } from "../../common/firmProfile";

export const firmSettingsRouter = Router();

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];

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
      return res.status(400).json({ error: "Logo must be a PNG, JPEG, or SVG image." });
    }
    // Roughly 3 chars of base64 per 2 bytes — this keeps a saved logo well under the
    // 8MB raw upload ceiling documents.routes.ts already established for this app.
    if (base64.length > 2_000_000) {
      return res.status(400).json({ error: "Logo image is too large — please use a file under 1.5MB." });
    }
    logoData = base64;
    logoContentType = contentType;
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
    updatedBy: req.user!.email,
  });

  await logAudit("System", "UPDATE_FIRM_SETTINGS", "FIRM-1", "", "", "", "Firm profile updated.", req.user!.email);

  res.json(await getFirmProfile());
}));
