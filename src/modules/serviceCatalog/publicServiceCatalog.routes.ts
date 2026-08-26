/**
 * Public, no-login view of the Subscription Plans brochure — the SMS-send
 * link target (SMS can't carry a PDF attachment, so the text message links
 * here instead; see serviceCatalog.routes.ts POST /brochure/send). No
 * client-specific or sensitive data is in this document — it's the firm's
 * own generic pricing sheet — so unlike publicInvoice.routes.ts this needs
 * no opaque per-recipient token, just a rate limit against abuse.
 */
import { Router, Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { rateLimit } from "../../common/rateLimit";
import { generateSubscriptionBrochurePdf } from "./subscriptionBrochurePdf";

export const publicServiceCatalogRouter = Router();

const brochureLimiter = rateLimit({ name: "public-subscription-brochure", windowMs: 15 * 60 * 1000, max: 60 });

publicServiceCatalogRouter.get("/subscription-brochure.pdf", brochureLimiter, asyncHandler(async (_req: Request, res: Response) => {
  const pdfBytes = await generateSubscriptionBrochurePdf();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Subscription_Plans.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));
