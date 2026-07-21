import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { generateHaccpPdf } from "./haccpPdf";
import {
  generateFoodLicenseApplicationPdf, generatePlanReviewApplicationPdf,
  generateCountyFoodServicePermitApplicationPdf, generateCountyPlansReviewGuidePdf,
  type LicenseApplicationData,
} from "./licenseApplicationsPdf";
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

/**
 * The admin template editor operates on CCP *profiles*, not every descriptive
 * business-type label — several labels (e.g. "Grocery & Deli (Cold Cuts
 * Only)") share one profile's content via ccpProfileKey, so editing that
 * profile once correctly updates every label built on it rather than needing
 * a duplicate edit per label.
 */
const ALL_TEMPLATE_KEYS = [...new Set(HACCP_BUSINESS_TYPES.map((t) => t.ccpProfileKey || t.key)), GENERAL_HANDLING_KEY];

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

/**
 * key/label/quantity rather than a bare key — needed for two reasons: (1) a
 * custom item typed via "Add Item" has no entry in HACCP_EQUIPMENT_ITEMS to
 * resolve a label from, so the label has to travel with the selection itself;
 * (2) quantity (e.g. "3x 4-Door Commercial Beverage Cooler") is per-selection,
 * not a property of the master list item. Always carrying the label (even for
 * master-list items, where it's redundant with HACCP_EQUIPMENT_ITEMS) keeps
 * rendering uniform and means a saved plan's checklist never breaks if the
 * master list's wording changes later — same immutable-snapshot reasoning as
 * rendered_body itself.
 */
export interface EquipmentSelection { key: string; label: string; quantity: number }

function parseEquipmentSelection(raw: unknown): EquipmentSelection[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item: any, i: number) => {
    const key = String(item?.key || `custom-${i}`).trim();
    const label = String(item?.label || "").trim();
    const quantity = Number(item?.quantity);
    return { key, label, quantity: Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1 };
  }).filter((item) => item.label);
}

interface PlanInput {
  businessName: string; businessTypeKey: string; jurisdiction: string;
  streetAddress?: string; city?: string; state?: string; zipCode?: string;
  phone?: string; email?: string; contactPerson?: string; licenseNumber?: string;
  clientId?: string | null; selectedMenuItems: string[]; selectedEquipment: EquipmentSelection[];
  licenseApplicationData: LicenseApplicationData;
}

function parseLicenseApplicationData(raw: unknown): LicenseApplicationData {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    officerTitle: String(d.officerTitle || "").trim() || undefined,
    tradeName: String(d.tradeName || "").trim() || undefined,
    ownerHomeStreet: String(d.ownerHomeStreet || "").trim() || undefined,
    ownerHomeCity: String(d.ownerHomeCity || "").trim() || undefined,
    ownerHomeZip: String(d.ownerHomeZip || "").trim() || undefined,
    ownerHomePhone: String(d.ownerHomePhone || "").trim() || undefined,
    mailingAddress: String(d.mailingAddress || "").trim() || undefined,
    wasteHaulerOption: ["under3", "contract", "smallHauler"].includes(String(d.wasteHaulerOption)) ? (d.wasteHaulerOption as LicenseApplicationData["wasteHaulerOption"]) : undefined,
    smallHaulerLicenseNumber: String(d.smallHaulerLicenseNumber || "").trim() || undefined,
    sellsTobacco: Boolean(d.sellsTobacco),
    tobaccoLicenseNumber: String(d.tobaccoLicenseNumber || "").trim() || undefined,
    ownerEntityType: ["Incorporated", "LLC", "Other"].includes(String(d.ownerEntityType)) ? (d.ownerEntityType as LicenseApplicationData["ownerEntityType"]) : undefined,
    useAndOccupancyNumber: String(d.useAndOccupancyNumber || "").trim() || undefined,
    permitsApplied: Array.isArray(d.permitsApplied) ? d.permitsApplied.map(String) : ["retailFood"],
    facilityTypeOverride: String(d.facilityTypeOverride || "").trim() || undefined,
    county: parseCountyPermitData(d.county),
  };
}

function parseCountyPermitData(raw: unknown): LicenseApplicationData["county"] {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const managers = Array.isArray(d.certifiedFoodManagers)
    ? d.certifiedFoodManagers.map((m: any) => ({
        name: String(m?.name || "").trim() || undefined,
        idNumber: String(m?.idNumber || "").trim() || undefined,
        expirationDate: String(m?.expirationDate || "").trim() || undefined,
      })).filter((m: any) => m.name || m.idNumber || m.expirationDate)
    : undefined;
  return {
    facilityId: String(d.facilityId || "").trim() || undefined,
    cateringServiceProvided: Boolean(d.cateringServiceProvided),
    cateringId: String(d.cateringId || "").trim() || undefined,
    facilityClassification: String(d.facilityClassification || "").trim() || undefined,
    numberOfSeats: String(d.numberOfSeats || "").trim() || undefined,
    waterService: String(d.waterService || "").trim() || undefined,
    sewageDisposal: String(d.sewageDisposal || "").trim() || undefined,
    majorMenuChanges: d.majorMenuChanges === undefined ? undefined : Boolean(d.majorMenuChanges),
    certifiedFoodManagers: managers && managers.length ? managers : undefined,
    daysOfOperation: String(d.daysOfOperation || "").trim() || undefined,
    hoursOfOperation: String(d.hoursOfOperation || "").trim() || undefined,
    numberOfEmployees: String(d.numberOfEmployees || "").trim() || undefined,
    residentAgentName: String(d.residentAgentName || "").trim() || undefined,
    residentAgentPhone: String(d.residentAgentPhone || "").trim() || undefined,
    sendCorrespondenceTo: ["trade", "owner"].includes(String(d.sendCorrespondenceTo)) ? (d.sendCorrespondenceTo as "trade" | "owner") : undefined,
  };
}

async function renderPlanBody(input: PlanInput): Promise<{ title: string; renderedBody: string } | { error: string }> {
  const businessType = HACCP_BUSINESS_TYPES.find((t) => t.key === input.businessTypeKey);
  if (!businessType) return { error: "Unknown business type." };

  const [scope, general] = await Promise.all([resolveHaccpTemplate(businessType.ccpProfileKey || businessType.key), resolveHaccpTemplate(GENERAL_HANDLING_KEY)]);
  if (!scope) return { error: "No HACCP template for this business type." };

  const offPremisesClause = "None; all service is on-site."; // v1: no off-premises/catering distribution modeled yet.
  const values: Record<string, string> = {
    businessName: input.businessName,
    jurisdiction: input.jurisdiction,
    offPremisesClause,
  };
  const scopeText = substituteHaccpPlaceholders(scope.body, values);
  const generalText = general ? substituteHaccpPlaceholders(general.body, values) : "";

  // Menu/equipment checklist is no longer embedded in the text snapshot — it's
  // rendered as its own structured page directly from selected_menu_items/
  // selected_equipment (see groupMenuItems below + the /pdf route), which are
  // already immutable-snapshot-safe on their own (equipment carries its own
  // label). rendered_body is CCP content only from here on.
  const renderedBody = [scopeText, generalText].filter(Boolean).join("\n\n\n");
  return { title: scope.title, renderedBody };
}

export interface MenuGroup { category: string; items: string[] }

/**
 * Groups a plan's selected menu-item keys by master-list category for the
 * PDF's dedicated Menu/Equipment page. Anything typed via "Add Item" won't
 * match a master-list key — rather than silently dropping it, it's grouped
 * under "Other (Added)" so a custom item is exactly as visible on the printed
 * plan as a checked one.
 */
export function groupMenuItems(selected: string[]): MenuGroup[] {
  const knownMenuKeys = new Set(HACCP_MENU_CATEGORIES.flatMap((cat) => cat.items.map((i) => i.key)));
  const groups: MenuGroup[] = HACCP_MENU_CATEGORIES.map((cat) => ({
    category: cat.category,
    items: cat.items.filter((i) => selected.includes(i.key)).map((i) => i.label),
  })).filter((g) => g.items.length);
  const customMenuItems = selected.filter((v) => !knownMenuKeys.has(v));
  if (customMenuItems.length) groups.push({ category: "Other (Added)", items: customMenuItems });
  return groups;
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
    selectedEquipment: parseEquipmentSelection(body.selectedEquipment),
    licenseApplicationData: parseLicenseApplicationData(body.licenseApplicationData),
  };

  const rendered = await renderPlanBody(input);
  if ("error" in rendered) return res.status(400).json({ error: rendered.error });

  const planId = `HCP-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_haccp_plans
       (plan_id, client_id, business_name, business_type_key, jurisdiction, street_address, city, state, zip_code,
        phone, email, contact_person, license_number, selected_menu_items, selected_equipment, rendered_body,
        license_application_data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [planId, clientId, businessName, businessTypeKey, input.jurisdiction, input.streetAddress || null, input.city || null,
     input.state || null, input.zipCode || null, input.phone || null, input.email || null, input.contactPerson || null,
     input.licenseNumber || null, JSON.stringify(input.selectedMenuItems), JSON.stringify(input.selectedEquipment),
     rendered.renderedBody, JSON.stringify(input.licenseApplicationData), req.user!.email]
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
    selectedEquipment: body.selectedEquipment !== undefined ? parseEquipmentSelection(body.selectedEquipment) : parseEquipmentSelection(existing.selected_equipment),
    licenseApplicationData: parseLicenseApplicationData(body.licenseApplicationData !== undefined ? body.licenseApplicationData : existing.license_application_data),
  };

  const rendered = await renderPlanBody(input);
  if ("error" in rendered) return res.status(400).json({ error: rendered.error });

  await query(
    `UPDATE altax.v3_haccp_plans SET
       client_id=$2, business_name=$3, business_type_key=$4, jurisdiction=$5, street_address=$6, city=$7, state=$8,
       zip_code=$9, phone=$10, email=$11, contact_person=$12, license_number=$13, selected_menu_items=$14,
       selected_equipment=$15, rendered_body=$16, license_application_data=$17, updated_at=now()
     WHERE plan_id=$1`,
    [req.params.planId, clientId, businessName, businessTypeKey, input.jurisdiction, input.streetAddress || null,
     input.city || null, input.state || null, input.zipCode || null, input.phone || null, input.email || null,
     input.contactPerson || null, input.licenseNumber || null, JSON.stringify(input.selectedMenuItems),
     JSON.stringify(input.selectedEquipment), rendered.renderedBody, JSON.stringify(input.licenseApplicationData)]
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
    menuGroups: groupMenuItems(plan.selected_menu_items || []),
    equipment: (plan.selected_equipment || []).map((e: EquipmentSelection) => ({ label: e.label, quantity: e.quantity })),
    createdAt: plan.created_at,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="HACCP_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

function toLicensePdfInput(plan: any) {
  const businessType = HACCP_BUSINESS_TYPES.find((t) => t.key === plan.business_type_key);
  return {
    planId: plan.plan_id,
    businessName: plan.business_name,
    businessTypeLabel: HACCP_BUSINESS_TYPE_LABEL[plan.business_type_key] || plan.business_type_key,
    riskPriority: businessType?.riskPriority || ("Moderate" as const),
    streetAddress: plan.street_address, city: plan.city, state: plan.state, zipCode: plan.zip_code,
    phone: plan.phone, email: plan.email, contactPerson: plan.contact_person,
    applicationData: (plan.license_application_data || {}) as LicenseApplicationData,
  };
}

/**
 * The two remaining pieces of "the whole package" alongside the HACCP plan
 * above, each rendering that jurisdiction's own real form — Baltimore City's
 * Food Facility License Application vs. Baltimore County's Food Service
 * Facility Permit Application and Fee Statement (structurally different
 * forms, not the same form reskinned). See licenseApplicationsPdf.ts for why
 * the "plan-review-pdf" route renders a submission guide rather than a
 * fabricated application for County plans, which has no such form.
 */
haccpRouter.get("/plans/:planId/license-pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (plan === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });

  const isCounty = plan.jurisdiction === "Baltimore County";
  const bytes = isCounty
    ? await generateCountyFoodServicePermitApplicationPdf(toLicensePdfInput(plan))
    : await generateFoodLicenseApplicationPdf(toLicensePdfInput(plan));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${isCounty ? "FoodServicePermitApplication" : "FoodLicenseApplication"}_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

haccpRouter.get("/plans/:planId/plan-review-pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (plan === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });

  const isCounty = plan.jurisdiction === "Baltimore County";
  const bytes = isCounty
    ? await generateCountyPlansReviewGuidePdf(toLicensePdfInput(plan))
    : await generatePlanReviewApplicationPdf(toLicensePdfInput(plan));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${isCounty ? "PlansReviewGuide" : "PlanReviewApplication"}_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/** Sanitizes a business name into a filesystem-safe filename fragment, for both download filenames and saved-Document names. */
function fileSafeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 120) || "Business";
}

/**
 * Attaches the plan's generated PDFs to the linked client's Documents tab, so
 * staff don't have to separately download-then-manually-upload — reuses the
 * same v3_document_uploads base64 storage every other Document already goes
 * through, direct-inserted (not via POST /documents/uploads) since that route
 * requires a requestId or taskId, neither of which naturally exists for a
 * plan generated ad hoc; request_id/task_id are nullable columns and the
 * client-scoped uploads list already reads by client_id/uploaded_by with no
 * such requirement. hidden_from_client=true — this is internal firm work
 * product for the permit application, not something to surface to the client
 * portal automatically.
 */
haccpRouter.post("/plans/:planId/save-to-documents", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) return res.status(404).json({ error: "HACCP plan not found." });
  if (plan === "forbidden") return res.status(403).json({ error: "You do not have access to this plan." });
  if (!plan.client_id) return res.status(400).json({ error: "Link this plan to a client before saving to Documents." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [plan.client_id]);
  const isCounty = plan.jurisdiction === "Baltimore County";
  const baseName = fileSafeName(plan.business_name);

  const docs: { label: string; bytes: Uint8Array }[] = [
    { label: `${baseName} - HACCP Plan.pdf`, bytes: await generateHaccpPdf({
        planId: plan.plan_id, businessName: plan.business_name,
        businessTypeLabel: HACCP_BUSINESS_TYPE_LABEL[plan.business_type_key] || plan.business_type_key,
        jurisdiction: plan.jurisdiction,
        streetAddress: plan.street_address, city: plan.city, state: plan.state, zipCode: plan.zip_code,
        phone: plan.phone, email: plan.email, contactPerson: plan.contact_person, licenseNumber: plan.license_number,
        riskPriority: HACCP_BUSINESS_TYPES.find((t) => t.key === plan.business_type_key)?.riskPriority || "Moderate",
        renderedBody: plan.rendered_body,
        menuGroups: groupMenuItems(plan.selected_menu_items || []),
        equipment: (plan.selected_equipment || []).map((e: EquipmentSelection) => ({ label: e.label, quantity: e.quantity })),
        createdAt: plan.created_at,
      }) },
    { label: `${baseName} - ${isCounty ? "Food Service Permit Application" : "Food License Application"}.pdf`,
      bytes: isCounty ? await generateCountyFoodServicePermitApplicationPdf(toLicensePdfInput(plan)) : await generateFoodLicenseApplicationPdf(toLicensePdfInput(plan)) },
    { label: `${baseName} - ${isCounty ? "Plans Review Guide" : "Plan Review Application"}.pdf`,
      bytes: isCounty ? await generateCountyPlansReviewGuidePdf(toLicensePdfInput(plan)) : await generatePlanReviewApplicationPdf(toLicensePdfInput(plan)) },
  ];

  const uploadIds: string[] = [];
  for (const doc of docs) {
    const uploadId = `DOC-${idSuffix()}`;
    const fileData = Buffer.from(doc.bytes).toString("base64");
    await query(
      `INSERT INTO altax.v3_document_uploads
         (upload_id, request_id, task_id, client_id, client_name, file_name, file_url, file_data, mime_type, file_size,
          uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id)
       VALUES ($1,NULL,NULL,$2,$3,$4,$5,$6,'application/pdf',$7,$8,now(),'Internal','Generated',$9,true,'Node Web App',$1)`,
      [uploadId, plan.client_id, client?.client_name || plan.business_name, doc.label, `/documents/uploads/${uploadId}/download`,
       fileData, doc.bytes.length, req.user!.email, `Generated from HACCP plan ${plan.plan_id}.`]
    );
    uploadIds.push(uploadId);
  }

  await logAudit("Haccp", "SAVE_TO_DOCUMENTS", plan.plan_id, "client_id", "", plan.client_id,
    `HACCP package (3 PDFs) saved to Documents for ${plan.business_name} by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, uploadIds });
}));
