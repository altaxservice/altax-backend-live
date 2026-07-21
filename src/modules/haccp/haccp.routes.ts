import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { generateHaccpPdf } from "./haccpPdf";
import {
  HACCP_BUSINESS_TYPES, HACCP_BUSINESS_TYPE_LABEL, HACCP_MENU_CATEGORIES, HACCP_EQUIPMENT_ITEMS,
  GENERAL_HANDLING_KEY, GENERAL_HANDLING_TITLE, GENERAL_HANDLING_BODY, BUILT_IN_HACCP_TEMPLATES,
} from "./haccpContent";

export const haccpRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

/**
 * Flat-values placeholder substitution, separate from templates.routes.ts's
 * substitutePlaceholders — that function expects a v3_clients-shaped "client"
 * row (client_name/email/phone); a HACCP plan is usually for a business that
 * isn't an AL TAX client at all, so it needs its own plain key/value merge
 * rather than being force-fit through a client-row parameter.
 */
function substituteHaccpPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => (values[key] !== undefined ? values[key] : match));
}

const ALL_TEMPLATE_KEYS = [...HACCP_BUSINESS_TYPES.map((t) => t.key), GENERAL_HANDLING_KEY];

interface ResolvedHaccpTemplate { businessTypeKey: string; title: string; body: string; active: boolean; source: "Custom override" | "Built-in default" }

async function resolveHaccpTemplate(businessTypeKey: string): Promise<ResolvedHaccpTemplate | null> {
  const override = await queryOne<any>(`SELECT * FROM altax.v3_haccp_templates WHERE business_type_key = $1`, [businessTypeKey]);
  if (override) return { businessTypeKey, title: override.title, body: override.body, active: override.active, source: "Custom override" };
  if (businessTypeKey === GENERAL_HANDLING_KEY) return { businessTypeKey, title: GENERAL_HANDLING_TITLE, body: GENERAL_HANDLING_BODY, active: true, source: "Built-in default" };
  const builtIn = BUILT_IN_HACCP_TEMPLATES.find((t) => t.businessTypeKey === businessTypeKey);
  if (!builtIn) return null;
  return { businessTypeKey, title: builtIn.title, body: builtIn.body, active: true, source: "Built-in default" };
}

/** Everything the generator form needs in one call: business types, menu checklist, equipment checklist. */
haccpRouter.get("/options", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ businessTypes: HACCP_BUSINESS_TYPES, menuCategories: HACCP_MENU_CATEGORIES, equipmentItems: HACCP_EQUIPMENT_ITEMS });
}));

/** GET effective HACCP templates (built-in + overrides resolved), for the admin editor. */
haccpRouter.get("/templates", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const templates = await Promise.all(ALL_TEMPLATE_KEYS.map((k) => resolveHaccpTemplate(k)));
  res.json({ templates: templates.filter(Boolean) });
}));

haccpRouter.get("/templates/:businessTypeKey", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const resolved = await resolveHaccpTemplate(req.params.businessTypeKey);
  if (!resolved) return res.status(404).json({ error: "Unknown business type." });
  res.json({ template: resolved });
}));

/** Save/override a HACCP template's wording — admin-only, since this is the legal/regulatory content a client's health inspection depends on. */
haccpRouter.post("/templates", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const businessTypeKey = String(body.businessTypeKey || "").trim();
  if (!businessTypeKey || !ALL_TEMPLATE_KEYS.includes(businessTypeKey)) return res.status(400).json({ error: "Unknown business type key." });
  const title = String(body.title || "").trim();
  const text = String(body.body || "").trim();
  if (!title || !text) return res.status(400).json({ error: "Title and body are required." });

  const existing = await queryOne<any>(`SELECT template_id FROM altax.v3_haccp_templates WHERE business_type_key = $1`, [businessTypeKey]);
  const templateId = existing?.template_id || `HTPL-${idSuffix()}`;
  const active = body.active === undefined ? true : Boolean(body.active);
  const notes = String(body.notes || "").trim() || null;

  if (existing) {
    await query(
      `UPDATE altax.v3_haccp_templates SET title=$2, body=$3, active=$4, notes=$5, updated_by=$6, updated_at=now() WHERE business_type_key=$1`,
      [businessTypeKey, title, text, active, notes, req.user!.email]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_haccp_templates (template_id, business_type_key, title, body, active, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [templateId, businessTypeKey, title, text, active, notes, req.user!.email]
    );
  }
  await logAudit("Haccp", existing ? "TEMPLATE_EDIT" : "TEMPLATE_CREATE", templateId, "business_type_key", "", businessTypeKey,
    `HACCP template for "${businessTypeKey}" saved by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, templateId });
}));

/** List saved plans — optionally filtered by clientId or a business-name search, for reprint/renewal reuse. */
haccpRouter.get("/plans", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const search = String(req.query.search || "").trim();
  const clauses: string[] = [];
  const params: any[] = [];
  if (clientId) { params.push(clientId); clauses.push(`client_id = $${params.length}`); }
  if (search) { params.push(`%${search.toLowerCase()}%`); clauses.push(`lower(business_name) LIKE $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const plans = await query<any>(
    `SELECT plan_id, client_id, business_name, business_type_key, jurisdiction, city, state, created_by, created_at, updated_at
       FROM altax.v3_haccp_plans ${where} ORDER BY updated_at DESC LIMIT 200`,
    params
  );
  res.json({ plans });
}));

async function loadPlanForUser(req: AuthedRequest, planId: string) {
  const plan = await queryOne<any>(`SELECT * FROM altax.v3_haccp_plans WHERE plan_id = $1`, [planId]);
  if (!plan) return null;
  if (plan.client_id && !(await canAccessClient(req.user!, plan.client_id))) return "forbidden";
  return plan;
}

haccpRouter.get("/plans/:planId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (plan === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });
  res.json({ plan });
}));

interface PlanInput {
  businessName: string; businessTypeKey: string; jurisdiction: string;
  streetAddress?: string; city?: string; state?: string; zipCode?: string;
  phone?: string; email?: string; contactPerson?: string; licenseNumber?: string;
  clientId?: string | null; selectedMenuItems: string[]; selectedEquipment: string[];
}

async function renderPlanBody(input: PlanInput): Promise<{ title: string; renderedBody: string } | { error: string }> {
  const businessType = HACCP_BUSINESS_TYPES.find((t) => t.key === input.businessTypeKey);
  if (!businessType) return { error: "Unknown business type." };

  const [scope, general] = await Promise.all([resolveHaccpTemplate(input.businessTypeKey), resolveHaccpTemplate(GENERAL_HANDLING_KEY)]);
  if (!scope) return { error: "No HACCP template for this business type." };

  const offPremisesClause = "None; all service is on-site."; // v1: no off-premises/catering distribution modeled yet.
  const values: Record<string, string> = {
    businessName: input.businessName,
    jurisdiction: input.jurisdiction,
    offPremisesClause,
  };
  const scopeText = substituteHaccpPlaceholders(scope.body, values);
  const generalText = general ? substituteHaccpPlaceholders(general.body, values) : "";

  const menuLines = HACCP_MENU_CATEGORIES.map((cat) => {
    const checked = cat.items.filter((i) => input.selectedMenuItems.includes(i.key));
    if (!checked.length) return null;
    return `${cat.category}:\n${checked.map((i) => `  - ${i.label}`).join("\n")}`;
  }).filter(Boolean).join("\n\n");
  const equipmentLines = HACCP_EQUIPMENT_ITEMS.filter((e) => input.selectedEquipment.includes(e.key)).map((e) => `  - ${e.label}`).join("\n");

  const checklistText = `MENU\n\n${menuLines || "(none selected)"}\n\nEQUIPMENT LIST\n\n${equipmentLines || "(none selected)"}`;
  const renderedBody = [scopeText, generalText, checklistText].filter(Boolean).join("\n\n\n");
  return { title: scope.title, renderedBody };
}

/** Create (or overwrite, via PATCH below) a HACCP plan. clientId is optional — this tool must work for businesses that aren't AL TAX clients yet. */
haccpRouter.post("/plans", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const businessName = String(body.businessName || "").trim();
  if (!businessName) return res.status(400).json({ error: "Business name is required." });
  const businessTypeKey = String(body.businessTypeKey || "").trim();
  if (!HACCP_BUSINESS_TYPES.some((t) => t.key === businessTypeKey)) return res.status(400).json({ error: "Unknown or missing business type." });
  const clientId = String(body.clientId || "").trim() || null;
  if (clientId && !(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const input: PlanInput = {
    businessName, businessTypeKey,
    jurisdiction: String(body.jurisdiction || "Baltimore City").trim(),
    streetAddress: String(body.streetAddress || "").trim() || undefined,
    city: String(body.city || "").trim() || undefined,
    state: String(body.state || "MD").trim() || undefined,
    zipCode: String(body.zipCode || "").trim() || undefined,
    phone: String(body.phone || "").trim() || undefined,
    email: String(body.email || "").trim() || undefined,
    contactPerson: String(body.contactPerson || "").trim() || undefined,
    licenseNumber: String(body.licenseNumber || "").trim() || undefined,
    clientId,
    selectedMenuItems: Array.isArray(body.selectedMenuItems) ? body.selectedMenuItems.map(String) : [],
    selectedEquipment: Array.isArray(body.selectedEquipment) ? body.selectedEquipment.map(String) : [],
  };

  const rendered = await renderPlanBody(input);
  if ("error" in rendered) return res.status(400).json({ error: rendered.error });

  const planId = `HCP-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_haccp_plans
       (plan_id, client_id, business_name, business_type_key, jurisdiction, street_address, city, state, zip_code,
        phone, email, contact_person, license_number, selected_menu_items, selected_equipment, rendered_body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [planId, clientId, businessName, businessTypeKey, input.jurisdiction, input.streetAddress || null, input.city || null,
     input.state || null, input.zipCode || null, input.phone || null, input.email || null, input.contactPerson || null,
     input.licenseNumber || null, JSON.stringify(input.selectedMenuItems), JSON.stringify(input.selectedEquipment),
     rendered.renderedBody, req.user!.email]
  );
  await logAudit("Haccp", "GENERATE", planId, "business_type_key", "", businessTypeKey,
    `HACCP plan generated for ${businessName} by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, planId });
}));

/** Edit and regenerate an existing plan — the renewal-reuse path: pull up an old plan, tweak business info/selections, regenerate. */
haccpRouter.patch("/plans/:planId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const existing = await loadPlanForUser(req, req.params.planId);
  if (existing === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (existing === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });

  const body = req.body || {};
  const businessName = String(body.businessName ?? existing.business_name).trim();
  const businessTypeKey = String(body.businessTypeKey ?? existing.business_type_key).trim();
  if (!HACCP_BUSINESS_TYPES.some((t) => t.key === businessTypeKey)) return res.status(400).json({ error: "Unknown business type." });
  const clientId = body.clientId !== undefined ? (String(body.clientId || "").trim() || null) : existing.client_id;
  if (clientId && !(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const input: PlanInput = {
    businessName, businessTypeKey,
    jurisdiction: String(body.jurisdiction ?? existing.jurisdiction).trim(),
    streetAddress: String(body.streetAddress ?? existing.street_address ?? "").trim() || undefined,
    city: String(body.city ?? existing.city ?? "").trim() || undefined,
    state: String(body.state ?? existing.state ?? "MD").trim() || undefined,
    zipCode: String(body.zipCode ?? existing.zip_code ?? "").trim() || undefined,
    phone: String(body.phone ?? existing.phone ?? "").trim() || undefined,
    email: String(body.email ?? existing.email ?? "").trim() || undefined,
    contactPerson: String(body.contactPerson ?? existing.contact_person ?? "").trim() || undefined,
    licenseNumber: String(body.licenseNumber ?? existing.license_number ?? "").trim() || undefined,
    clientId,
    selectedMenuItems: Array.isArray(body.selectedMenuItems) ? body.selectedMenuItems.map(String) : existing.selected_menu_items || [],
    selectedEquipment: Array.isArray(body.selectedEquipment) ? body.selectedEquipment.map(String) : existing.selected_equipment || [],
  };

  const rendered = await renderPlanBody(input);
  if ("error" in rendered) return res.status(400).json({ error: rendered.error });

  await query(
    `UPDATE altax.v3_haccp_plans SET
       client_id=$2, business_name=$3, business_type_key=$4, jurisdiction=$5, street_address=$6, city=$7, state=$8,
       zip_code=$9, phone=$10, email=$11, contact_person=$12, license_number=$13, selected_menu_items=$14,
       selected_equipment=$15, rendered_body=$16, updated_at=now()
     WHERE plan_id=$1`,
    [req.params.planId, clientId, businessName, businessTypeKey, input.jurisdiction, input.streetAddress || null,
     input.city || null, input.state || null, input.zipCode || null, input.phone || null, input.email || null,
     input.contactPerson || null, input.licenseNumber || null, JSON.stringify(input.selectedMenuItems),
     JSON.stringify(input.selectedEquipment), rendered.renderedBody]
  );
  await logAudit("Haccp", "REGENERATE", req.params.planId, "business_type_key", existing.business_type_key, businessTypeKey,
    `HACCP plan updated/regenerated for ${businessName} by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, planId: req.params.planId });
}));

haccpRouter.get("/plans/:planId/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (plan === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });

  const businessType = HACCP_BUSINESS_TYPES.find((t) => t.key === plan.business_type_key);
  const bytes = await generateHaccpPdf({
    planId: plan.plan_id,
    businessName: plan.business_name,
    businessTypeLabel: HACCP_BUSINESS_TYPE_LABEL[plan.business_type_key] || plan.business_type_key,
    jurisdiction: plan.jurisdiction,
    streetAddress: plan.street_address, city: plan.city, state: plan.state, zipCode: plan.zip_code,
    phone: plan.phone, email: plan.email, contactPerson: plan.contact_person, licenseNumber: plan.license_number,
    riskPriority: businessType?.riskPriority || "Moderate",
    renderedBody: plan.rendered_body,
    createdAt: plan.created_at,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="HACCP_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));
