import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * The "Minimum Fee Schedule" — direct owner request, 2026-08-26: every
 * subscription service is its own row here (fee, group, active flag), and
 * both the client-profile checklist and the subscription price/tier
 * calculation read from it live, so editing a fee here immediately applies
 * to every client who has that service checked. Read access is any
 * authenticated staff user (the client-profile checklist needs it); writes
 * are admin-only, matching Firm Settings / Tax Rates conventions elsewhere.
 */
export const serviceCatalogRouter = Router();

serviceCatalogRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_service_catalog ORDER BY sort_order ASC, label ASC`);
  res.json({ services: rows });
}));

serviceCatalogRouter.patch("/:serviceKey", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { serviceKey } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_service_catalog WHERE service_key = $1`, [serviceKey]);
  if (!existing) return res.status(404).json({ error: "Service not found." });

  const body = req.body || {};
  const label = body.label !== undefined ? String(body.label).trim() : existing.label;
  const groupName = body.groupName !== undefined ? String(body.groupName).trim() : existing.group_name;
  const minFee = body.minFee !== undefined ? (body.minFee === null || body.minFee === "" ? null : Number(body.minFee)) : existing.min_fee;
  const active = body.active !== undefined ? Boolean(body.active) : existing.active;
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sort_order;
  if (!label) return res.status(400).json({ error: "Label is required." });

  await query(
    `UPDATE altax.v3_service_catalog
        SET label = $2, group_name = $3, min_fee = $4, active = $5, sort_order = $6, updated_at = now(), updated_by = $7
      WHERE service_key = $1`,
    [serviceKey, label, groupName, minFee, active, sortOrder, req.user!.email]
  );
  await logAudit("Billing", "EDIT_SERVICE_CATALOG", serviceKey, "MinFee", String(existing.min_fee ?? "—"), String(minFee ?? "—"),
    `Fee schedule entry "${label}" edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));

/**
 * Add a brand-new service to the catalog — deliberately restricted to
 * `addon` or `one_time` (never `core_pillar`): the subscription-tier
 * decision table in subscriptionPricing.ts is hardcoded to the 4 original
 * pillar keys, so a new row here can never affect tier assignment even if
 * mislabeled — only price (addon) or nothing (one_time).
 */
serviceCatalogRouter.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const label = String(body.label || "").trim();
  const groupName = String(body.groupName || "").trim();
  const role = body.role === "one_time" ? "one_time" : "addon";
  if (!label) return res.status(400).json({ error: "Label is required." });
  if (!groupName) return res.status(400).json({ error: "Group is required." });

  const serviceKey = String(body.serviceKey || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!serviceKey) return res.status(400).json({ error: "Could not derive a service key from the label." });
  const existing = await queryOne<any>(`SELECT service_key FROM altax.v3_service_catalog WHERE service_key = $1`, [serviceKey]);
  if (existing) return res.status(409).json({ error: `A service with key "${serviceKey}" already exists.` });

  // One-time services CAN carry a price too — a reference/starting fee shown
  // on the schedule and the client checklist, just never summed into the
  // subscription total (computeSubscriptionFee skips role='one_time' rows
  // unconditionally regardless of whether min_fee is set).
  const minFee = body.minFee === null || body.minFee === undefined || body.minFee === "" ? null : Number(body.minFee);
  const maxSort = await queryOne<any>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM altax.v3_service_catalog`);

  await query(
    `INSERT INTO altax.v3_service_catalog (service_key, label, group_name, role, min_fee, sort_order, active, legacy, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, true, false, now(), $7)`,
    [serviceKey, label, groupName, role, minFee, Number(maxSort?.m || 0) + 10, req.user!.email]
  );
  await logAudit("Billing", "CREATE_SERVICE_CATALOG", serviceKey, "", "", label, `Fee schedule entry "${label}" created by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, serviceKey });
}));

serviceCatalogRouter.get("/tiers", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_subscription_tiers ORDER BY sort_order ASC`);
  res.json({ tiers: rows });
}));

serviceCatalogRouter.patch("/tiers/:tierKey", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { tierKey } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_subscription_tiers WHERE tier_key = $1`, [tierKey]);
  if (!existing) return res.status(404).json({ error: "Tier not found." });

  const body = req.body || {};
  const tierName = body.tierName !== undefined ? String(body.tierName).trim() : existing.tier_name;
  const description = body.description !== undefined ? String(body.description) : existing.description;
  if (!tierName) return res.status(400).json({ error: "Tier name is required." });

  await query(
    `UPDATE altax.v3_subscription_tiers SET tier_name = $2, description = $3, updated_at = now(), updated_by = $4 WHERE tier_key = $1`,
    [tierKey, tierName, description, req.user!.email]
  );
  await logAudit("Billing", "EDIT_SUBSCRIPTION_TIER", tierKey, "TierName", existing.tier_name, tierName,
    `Subscription tier renamed/edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
}));
