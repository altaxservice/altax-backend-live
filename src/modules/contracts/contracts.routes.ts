import { Router, Response } from "express";
import { randomBytes } from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { getFirmProfile } from "../../common/firmProfile";
import { sendEmail } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { substitutePlaceholders } from "../templates/templates.routes";
import { generateContractPdf } from "./contractPdf";
import {
  FIRM_SERVICES, SERVICE_LABEL, GENERAL_TERMS_KEY, GENERAL_TERMS_TITLE, GENERAL_TERMS_BODY,
  BUILT_IN_CONTRACT_TEMPLATES,
} from "./contractContent";

export const contractsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

/**
 * Bakes the fee description into the same token as the amount (rather than a
 * separate {{feeDescriptionClause}} placeholder) — substitutePlaceholders leaves
 * a placeholder untouched when its value resolves to an empty string (it can't
 * tell "intentionally blank" from "unknown token"), so a second optional token
 * would render as a literal "{{feeDescriptionClause}}" whenever no description
 * was given. Confirmed live before this was written this way.
 */
function money(v: unknown, description?: string | null): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "to be agreed separately";
  const amount = `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return description ? `${amount} (${description})` : amount;
}
function fmtDate(v: unknown): string {
  const d = v ? new Date(v as string) : new Date();
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

/** All service keys, including the always-appended general_terms entry, for the template-admin list. */
const ALL_TEMPLATE_KEYS = [...FIRM_SERVICES.map((s) => s.key), GENERAL_TERMS_KEY];

interface ResolvedContractTemplate { serviceKey: string; title: string; body: string; active: boolean; source: "Custom override" | "Built-in default" }

async function resolveContractTemplate(serviceKey: string): Promise<ResolvedContractTemplate | null> {
  const override = await queryOne<any>(`SELECT * FROM altax.v3_contract_templates WHERE service_key = $1`, [serviceKey]);
  if (override) return { serviceKey, title: override.title, body: override.body, active: override.active, source: "Custom override" };
  if (serviceKey === GENERAL_TERMS_KEY) return { serviceKey, title: GENERAL_TERMS_TITLE, body: GENERAL_TERMS_BODY, active: true, source: "Built-in default" };
  const builtIn = BUILT_IN_CONTRACT_TEMPLATES.find((t) => t.serviceKey === serviceKey);
  if (!builtIn) return null;
  return { serviceKey, title: builtIn.title, body: builtIn.body, active: true, source: "Built-in default" };
}

/** GET effective contract templates (built-in + overrides resolved), for the admin editor on TemplatesPage. */
contractsRouter.get("/templates", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const templates = await Promise.all(ALL_TEMPLATE_KEYS.map((k) => resolveContractTemplate(k)));
  res.json({ templates: templates.filter(Boolean) });
}));

contractsRouter.get("/templates/:serviceKey", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const resolved = await resolveContractTemplate(req.params.serviceKey);
  if (!resolved) return res.status(404).json({ error: "Unknown service." });
  res.json({ template: resolved });
}));

/** Save/override a contract template's wording — admin-only (legal language), unlike message templates which staff can also edit. */
contractsRouter.post("/templates", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const serviceKey = String(body.serviceKey || "").trim();
  if (!serviceKey || !ALL_TEMPLATE_KEYS.includes(serviceKey)) return res.status(400).json({ error: "Unknown service key." });
  const title = String(body.title || "").trim();
  const text = String(body.body || "").trim();
  if (!title || !text) return res.status(400).json({ error: "Title and body are required." });

  const existing = await queryOne<any>(`SELECT template_id FROM altax.v3_contract_templates WHERE service_key = $1`, [serviceKey]);
  const templateId = existing?.template_id || `CTPL-${idSuffix()}`;
  const active = body.active === undefined ? true : Boolean(body.active);
  const notes = String(body.notes || "").trim() || null;

  if (existing) {
    await query(
      `UPDATE altax.v3_contract_templates SET title=$2, body=$3, active=$4, notes=$5, updated_by=$6, updated_at=now() WHERE service_key=$1`,
      [serviceKey, title, text, active, notes, req.user!.email]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_contract_templates (template_id, service_key, title, body, active, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [templateId, serviceKey, title, text, active, notes, req.user!.email]
    );
  }
  await logAudit("Contracts", existing ? "TEMPLATE_EDIT" : "TEMPLATE_CREATE", templateId, "service_key", "", serviceKey,
    `Contract template for "${serviceKey}" saved by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true, templateId });
}));

/** List contracts for a client — admin/staff (assignment-scoped) or the client themselves via the portal. Employees never see their employer's contracts (mirrors clients.routes.ts's own-profile exclusion). */
contractsRouter.get("/client/:clientId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to these contracts." });
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const contracts = await query<any>(
    `SELECT contract_id, client_id, service_key, title, fee_amount, fee_description, effective_date, status,
            share_token, signer_name, signed_at, sent_at, created_at
       FROM altax.v3_client_contracts WHERE client_id = $1 ORDER BY created_at DESC`,
    [clientId]
  );
  res.json({ contracts });
}));

export interface GenerateContractParams {
  clientId: string; serviceKey: string; createdBy: string;
  feeAmount?: number | null; feeDescription?: string | null; effectiveDate?: Date;
}
export interface GenerateContractResult { contractId: string; skipped: boolean; reason?: string }

/**
 * Generates a Draft contract for one client + service from that service's
 * effective template, snapshotting the fully-merged text into rendered_body
 * (which never changes again even if the template is edited later). Shared by
 * the manual "Generate Contract" route below AND clients.routes.ts, which calls
 * this automatically the moment a service is newly checked on a client (create
 * or edit) — that's the actual "system suggests the appropriate contract"
 * behavior; the manual route remains as a fallback (e.g. re-generating after a
 * Void, or setting a fee up front) and as the one this function was extracted
 * from. Silently no-ops (skipped: true) if an active (non-Void) contract for
 * this client+service already exists, so calling it opportunistically from a
 * client save is always safe — it can never create duplicates.
 */
export async function generateContractForService(params: GenerateContractParams): Promise<GenerateContractResult> {
  const { clientId, serviceKey, createdBy } = params;
  if (!FIRM_SERVICES.some((s) => s.key === serviceKey)) return { contractId: "", skipped: true, reason: "Unknown service." };

  const existing = await queryOne<any>(
    `SELECT contract_id FROM altax.v3_client_contracts WHERE client_id = $1 AND service_key = $2 AND status <> 'Void' LIMIT 1`,
    [clientId, serviceKey]
  );
  if (existing) return { contractId: existing.contract_id, skipped: true, reason: "A contract for this service already exists." };

  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { contractId: "", skipped: true, reason: "Client not found." };

  const [scope, general] = await Promise.all([resolveContractTemplate(serviceKey), resolveContractTemplate(GENERAL_TERMS_KEY)]);
  if (!scope) return { contractId: "", skipped: true, reason: "No contract template for this service." };

  const feeAmount = params.feeAmount ?? null;
  const feeDescription = params.feeDescription ?? null;
  const effectiveDate = params.effectiveDate || new Date();
  const profile = await getFirmProfile();

  const extra = {
    firmName: profile.firmName,
    effectiveDate: fmtDate(effectiveDate),
    feeAmount: money(feeAmount, feeDescription),
  };
  const scopeText = substitutePlaceholders(scope.body, client, extra);
  const generalText = general ? substitutePlaceholders(general.body, client, extra) : "";
  const renderedBody = [scopeText, generalText].filter(Boolean).join("\n\n\n");

  // template_id isn't stored: built-in templates have no DB row, and rendered_body
  // above is the immutable, fully-merged legal text this contract will always show —
  // service_key + title already give full traceability back to which template
  // family was used, without implying a live link to something that may later change.
  const contractId = `CT-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_client_contracts
       (contract_id, client_id, service_key, title, rendered_body, fee_amount, fee_description, effective_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Draft',$9)`,
    [contractId, clientId, serviceKey, scope.title, renderedBody,
     feeAmount, feeDescription, effectiveDate, createdBy]
  );
  await logAudit("Contracts", "GENERATE", contractId, "service_key", "", serviceKey,
    `${SERVICE_LABEL[serviceKey]} contract generated for ${client.client_name} by ${createdBy}.`, createdBy);

  return { contractId, skipped: false };
}

contractsRouter.post("/client/:clientId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });

  const body = req.body || {};
  const serviceKey = String(body.serviceKey || "").trim();
  if (!serviceKey || !FIRM_SERVICES.some((s) => s.key === serviceKey)) return res.status(400).json({ error: "Unknown or missing service." });

  const result = await generateContractForService({
    clientId, serviceKey, createdBy: req.user!.email,
    feeAmount: body.feeAmount !== undefined && body.feeAmount !== "" ? Number(body.feeAmount) : null,
    feeDescription: String(body.feeDescription || "").trim() || null,
    effectiveDate: body.effectiveDate ? new Date(body.effectiveDate) : new Date(),
  });
  if (result.skipped) return res.status(409).json({ error: result.reason || "Could not generate this contract." });

  res.status(201).json({ ok: true, contractId: result.contractId });
}));

async function loadContractForUser(req: AuthedRequest, contractId: string) {
  const contract = await queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE contract_id = $1`, [contractId]);
  if (!contract) return null;
  if (req.user!.role === "employee") return "forbidden";
  if (!(await canAccessClient(req.user!, contract.client_id))) return "forbidden";
  return contract;
}

contractsRouter.get("/:contractId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await loadContractForUser(req, req.params.contractId);
  if (contract === null) return res.status(404).json({ error: "Contract not found." });
  if (contract === "forbidden") return res.status(403).json({ error: "You do not have access to this contract." });
  res.json({ contract });
}));

contractsRouter.get("/:contractId/pdf", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await loadContractForUser(req, req.params.contractId);
  if (contract === null) return res.status(404).json({ error: "Contract not found." });
  if (contract === "forbidden") return res.status(403).json({ error: "You do not have access to this contract." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  const bytes = await generateContractPdf({
    contractId: contract.contract_id, title: contract.title, clientName: client?.client_name || "", clientId: contract.client_id,
    renderedBody: contract.rendered_body, effectiveDate: contract.effective_date, status: contract.status,
    signerName: contract.signer_name, signerTitle: contract.signer_title, signedAt: contract.signed_at, signerIp: contract.signer_ip,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${contract.contract_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/** Marks a Draft contract Sent, mints a share token if needed, and emails the client a signing link. */
contractsRouter.post("/:contractId/send", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE contract_id = $1`, [req.params.contractId]);
  if (!contract) return res.status(404).json({ error: "Contract not found." });
  if (!(await canAccessClient(req.user!, contract.client_id))) return res.status(403).json({ error: "You do not have access to this contract." });
  if (contract.status === "Signed") return res.status(400).json({ error: "This contract is already signed." });
  if (contract.status === "Void") return res.status(400).json({ error: "This contract has been voided." });

  const shareToken = contract.share_token || randomBytes(24).toString("hex");
  await query(
    `UPDATE altax.v3_client_contracts SET status='Sent', share_token=$2, sent_at=now(), updated_at=now() WHERE contract_id=$1`,
    [contract.contract_id, shareToken]
  );

  const client = await queryOne<any>(`SELECT client_name, email FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  let emailed = false, emailError: string | null = null;
  if (client?.email) {
    // FRONTEND_BASE_URL/PORTAL_BASE_URL are easy to leave unset (or pointed at a local
    // dev URL) in a deployed environment's config — when that happens this used to build
    // a broken link (bare "/public/contract/..." with no host, or a localhost URL only
    // reachable on the sender's own machine), which the client's email client can't open.
    // server.ts serves the frontend from the same origin as this API, so falling back to
    // the request's own protocol+host is always correct there and needs no separate config.
    const base = (process.env.FRONTEND_BASE_URL || process.env.PORTAL_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
    const link = `${base}/public/contract/${shareToken}`;
    try {
      await sendEmail({
        to: client.email,
        subject: `${contract.title} — please review and sign`,
        html: await wrapEmailHtml(`<p>Hello ${client.client_name},</p><p>Please review and sign your <strong>${contract.title}</strong>:</p><p><a href="${link}">${link}</a></p><p>Thank you.</p>`),
      });
      emailed = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : "Could not send the email.";
    }
  }

  await logAudit("Contracts", "SEND", contract.contract_id, "status", contract.status, "Sent",
    `Contract sent by ${req.user!.email}.${emailed ? " Emailed to client." : ""}`, req.user!.email);

  res.json({ ok: true, shareToken, emailed, emailError });
}));

contractsRouter.post("/:contractId/void", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE contract_id = $1`, [req.params.contractId]);
  if (!contract) return res.status(404).json({ error: "Contract not found." });
  if (!(await canAccessClient(req.user!, contract.client_id))) return res.status(403).json({ error: "You do not have access to this contract." });

  const reason = String((req.body || {}).reason || "").trim();
  if (!reason) return res.status(400).json({ error: "A reason is required to void a contract." });

  await query(
    `UPDATE altax.v3_client_contracts SET status='Void', voided_at=now(), voided_reason=$2, updated_at=now() WHERE contract_id=$1`,
    [contract.contract_id, reason]
  );
  await logAudit("Contracts", "VOID", contract.contract_id, "status", contract.status, "Void",
    `Contract voided by ${req.user!.email}: ${reason}`, req.user!.email);
  res.json({ ok: true });
}));
