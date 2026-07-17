import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * Products & Services catalog — new in this app, no legacy equivalent (legacy invoices
 * store one free-text description + one total, no line-item table). Added to support
 * QuickBooks-style itemized invoicing: a reusable catalog of billable items with a
 * default rate/taxability, so a line item can be picked instead of retyped every time.
 * Admin/staff manage the catalog; any authenticated staff-side user can read it (needed
 * to populate the line-item picker on invoice create/edit).
 */
export const productsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

productsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const rows = await query(`SELECT * FROM altax.v3_products_services ORDER BY active DESC, name ASC`);
  res.json({ products: rows });
}));

productsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });

  const productId = String(body.productId || "").trim() || `PS-${idSuffix()}`;
  const existing = await queryOne<any>(`SELECT product_id FROM altax.v3_products_services WHERE product_id = $1`, [productId]);
  const fields = [
    name, String(body.category || "").trim() || null, String(body.description || "").trim() || null,
    Number(body.rate) || 0, body.taxable === undefined ? true : Boolean(body.taxable),
    body.active === undefined ? true : Boolean(body.active),
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_products_services SET name=$2, category=$3, description=$4, rate=$5, taxable=$6, active=$7, updated_at=now() WHERE product_id=$1`,
      [productId, ...fields]
    );
    await logAudit("Billing", "EDIT_PRODUCT", productId, "", "", name, `Product/service edited by ${req.user!.email}.`, req.user!.email);
  } else {
    await query(
      `INSERT INTO altax.v3_products_services (product_id, name, category, description, rate, taxable, active, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Node Web App',$1)`,
      [productId, ...fields]
    );
    await logAudit("Billing", "CREATE_PRODUCT", productId, "", "", name, `Product/service created by ${req.user!.email}.`, req.user!.email);
  }

  res.status(existing ? 200 : 201).json({ ok: true, productId });
}));
