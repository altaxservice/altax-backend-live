import { Router, Response } from "express";
import { randomBytes } from "crypto";
import { PDFDocument } from "pdf-lib";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { getFirmProfile } from "../../common/firmProfile";
import { sendEmail } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { escapeHtml } from "../../common/html";
import { substitutePlaceholders } from "../templates/templates.routes";
import { generateContractPdf } from "./contractPdf";
import {
  FIRM_SERVICES, SERVICE_LABEL, GENERAL_TERMS_KEY, GENERAL_TERMS_TITLE, GENERAL_TERMS_BODY,
  BUILT_IN_CONTRACT_TEMPLATES, POA_RELEASE_SERVICE_KEY, buildAuthorizedFilingsList,
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
const ALL_TEMPLATE_KEYS = [...FIRM_SERVICES.map((s) => s.key), POA_RELEASE_SERVICE_KEY, GENERAL_TERMS_KEY];

/** poa_release is a real, generatable contract service key but deliberately not a FIRM_SERVICES entry (see contractContent.ts) — this is the one place that distinction has to be bridged. */
function isKnownServiceKey(key: string): boolean {
  return FIRM_SERVICES.some((s) => s.key === key) || key === POA_RELEASE_SERVICE_KEY;
}

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
            share_token, signer_name, signed_at, sent_at, signature_method, created_at
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
  if (!isKnownServiceKey(serviceKey)) return { contractId: "", skipped: true, reason: "Unknown service." };

  const existing = await queryOne<any>(
    `SELECT contract_id FROM altax.v3_client_contracts WHERE client_id = $1 AND service_key = $2 AND status <> 'Void' LIMIT 1`,
    [clientId, serviceKey]
  );
  if (existing) return { contractId: existing.contract_id, skipped: true, reason: "A contract for this service already exists." };

  const client = await queryOne<any>(`SELECT client_id, client_name, services FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return { contractId: "", skipped: true, reason: "Client not found." };

  // poa_release's body needs a per-client {{authorizedFilings}} checklist —
  // built from whichever of the covered services this client actually has,
  // never a blanket grant. No covered service selected means there is
  // nothing for this document to authorize, so generation is skipped rather
  // than producing an authorization that grants nothing.
  let authorizedFilings: string | null = null;
  if (serviceKey === POA_RELEASE_SERVICE_KEY) {
    authorizedFilings = buildAuthorizedFilingsList(Array.isArray(client.services) ? client.services : []);
    if (!authorizedFilings) return { contractId: "", skipped: true, reason: "No covered service selected for this client." };
  }

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
    ...(authorizedFilings ? { authorizedFilings } : {}),
  };
  const scopeText = substitutePlaceholders(scope.body, client, extra);
  // General Terms carries an "electronic signature consent" clause (fees,
  // liability, e-sign) written for a paid services engagement — appending it
  // to poa_release would directly contradict that document's own clause 6
  // ("must be signed by hand... an electronic or typed signature does not
  // satisfy this requirement"). poa_release's body is already
  // self-contained (scope, release, termination, governing law, signature
  // requirement), so it skips the shared block entirely rather than getting
  // a self-contradicting document.
  const generalText = general && serviceKey !== POA_RELEASE_SERVICE_KEY ? substitutePlaceholders(general.body, client, extra) : "";
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
  if (!serviceKey || !isKnownServiceKey(serviceKey)) return res.status(400).json({ error: "Unknown or missing service." });

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

/** Shared by the single-contract PDF route and the combined signing-packet route below. */
async function buildOneContractPdf(contract: any): Promise<Uint8Array> {
  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  return generateContractPdf({
    contractId: contract.contract_id, title: contract.title, clientName: client?.client_name || "", clientId: contract.client_id,
    renderedBody: contract.rendered_body, effectiveDate: contract.effective_date, status: contract.status,
    signerName: contract.signer_name, signerTitle: contract.signer_title, signedAt: contract.signed_at, signerIp: contract.signer_ip,
    signatureMethod: contract.signature_method, recordedBy: contract.recorded_by,
  });
}

contractsRouter.get("/:contractId/pdf", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await loadContractForUser(req, req.params.contractId);
  if (contract === null) return res.status(404).json({ error: "Contract not found." });
  if (contract === "forbidden") return res.status(403).json({ error: "You do not have access to this contract." });

  const bytes = await buildOneContractPdf(contract);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${contract.contract_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/**
 * The "sign everything in one sitting" packet — merges every document a
 * client still needs to sign for one engagement (the ordinary engagement
 * letter AND the Authorization to Act/Release of Information, generated
 * together at the same trigger point) into a single PDF, so staff print or
 * hand over ONE file instead of chasing the client through several separate
 * documents across several visits. Defaults to every Draft/Sent (i.e., not
 * yet Signed, not Void) contract for the client; an explicit `ids` query
 * param narrows it to a specific set when staff only want some of them.
 */
contractsRouter.get("/client/:clientId/packet", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to these contracts." });

  const requestedIds = String(req.query.ids || "").split(",").map((s) => s.trim()).filter(Boolean);
  const contracts = requestedIds.length
    ? await query<any>(
        `SELECT * FROM altax.v3_client_contracts WHERE client_id = $1 AND contract_id = ANY($2) ORDER BY created_at ASC`,
        [clientId, requestedIds]
      )
    : await query<any>(
        `SELECT * FROM altax.v3_client_contracts WHERE client_id = $1 AND status IN ('Draft','Sent') ORDER BY created_at ASC`,
        [clientId]
      );
  if (!contracts.length) return res.status(404).json({ error: "No documents to combine." });

  const combined = await PDFDocument.create();
  for (const contract of contracts) {
    const bytes = await buildOneContractPdf(contract);
    const source = await PDFDocument.load(bytes);
    const pages = await combined.copyPages(source, source.getPageIndices());
    pages.forEach((p) => combined.addPage(p));
  }
  const merged = await combined.save();

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Signing_Packet_${clientId}.pdf"`);
  res.send(Buffer.from(merged));
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

  const client = await queryOne<any>(`SELECT client_name, email, phone, sms_allowed FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  let emailed = false, emailError: string | null = null;
  let smsed = false;
  // Always derive from the request's own protocol+host rather than
  // FRONTEND_BASE_URL/PORTAL_BASE_URL — confirmed live that a real email went
  // out with a bare "http://localhost:5173" link (from a local dev server's
  // .env still pointing at itself), completely unreachable from any other
  // device, including the client's phone. server.ts serves the frontend from
  // the same origin as this API in every real deployment, so whichever host
  // actually received this request is always the right one — no environment
  // variable to misconfigure, nothing that can silently drift from reality.
  const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
  const link = `${base}/public/contract/${shareToken}`;
  if (client?.email) {
    // Bulletproof HTML-email button pattern (padding+background+border-radius
    // on the <a> itself) — a plain blue underlined link is easy to miss or
    // mistake for something already visited on a phone; a real-looking button
    // is unambiguous.
    const buttonHtml = `<p style="text-align:center; margin:24px 0;">
        <a href="${link}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:12px 28px; border-radius:8px;">
          Review &amp; Sign &nbsp;·&nbsp; <bdi dir="rtl">مراجعة وتوقيع</bdi>
        </a>
      </p>
      <p style="font-size:12px; color:#6b7280;">
        Or copy this link into your browser: <bdi dir="ltr"><a href="${link}">${link}</a></bdi><br>
        <bdi dir="rtl">أو انسخوا هذا الرابط في متصفحكم:</bdi> <bdi dir="ltr"><a href="${link}">${link}</a></bdi>
      </p>`;
    let providerMessageId: string | null = null;
    try {
      const result = await sendEmail({
        to: client.email,
        subject: `${contract.title} — please review and sign`,
        html: await wrapEmailHtml(
          `<div dir="ltr" style="text-align:left;">
             <p>Hello ${escapeHtml(client.client_name)},</p>
             <p>A document is ready for your review and signature: <strong>${escapeHtml(contract.title)}</strong>. Please use the button below to review it and sign electronically.</p>
           </div>
           <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;">
           <div dir="rtl" style="text-align:right;">
             <p>مرحباً ${escapeHtml(client.client_name)}،</p>
             <p>هناك مستند بانتظار مراجعتكم وتوقيعكم: <strong>${escapeHtml(contract.title)}</strong>. يرجى استخدام الزر أدناه لمراجعته وتوقيعه إلكترونياً.</p>
           </div>
           ${buttonHtml}
           <p style="text-align:center; color:#6b7280; font-size:12px;">Thank you. &nbsp;·&nbsp; <bdi dir="rtl">شكراً لكم.</bdi></p>`,
          req
        ),
      });
      providerMessageId = result.providerMessageId;
      emailed = true;
    } catch (err) {
      emailError = err instanceof Error ? err.message : "Could not send the email.";
    }

    // Previously this send never wrote a v3_communications row — it only
    // reached the audit log below, which has no client_id, so a signature
    // request never appeared on the client's own Activity Timeline.
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,NULL,'Outbound','Email',$4,$5,'',$6,$7,now(),$8,'Contract',$1,$9)`,
      [`COM-${idSuffix()}`, contract.client_id, client.client_name, `${contract.title} — please review and sign`,
        `A document is ready for your review and signature: ${contract.title}.`, client.email,
        req.user!.email, emailed ? "Saved + Sent" : `Saved — ${emailError}`, providerMessageId]
    );
  }

  if (client?.sms_allowed && client?.phone) {
    const smsBody = `AL TAX SERVICE: "${contract.title}" is ready for your review and signature: ${link}`;
    let smsProviderMessageId: string | null = null;
    let smsStatus = "Sent";
    try {
      const { sendSms } = await import("../../common/notifications");
      const result = await sendSms({ to: client.phone, body: smsBody });
      smsProviderMessageId = result.providerMessageId;
      smsed = true;
    } catch (err) {
      smsStatus = `Failed — ${err instanceof Error ? err.message : "SMS failed"}`;
    }
    await query(
      `INSERT INTO altax.v3_communications
         (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
          message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id, provider_message_id)
       VALUES ($1,$2,$3,NULL,'Outbound','SMS',$4,$5,'',$6,$7,now(),$8,'Contract',$1,$9)`,
      [`COM-${idSuffix()}`, contract.client_id, client.client_name, `${contract.title} — please review and sign`,
        smsBody, client.phone, req.user!.email, smsStatus, smsProviderMessageId]
    );
  }

  await logAudit("Contracts", "SEND", contract.contract_id, "status", contract.status, "Sent",
    `Contract sent by ${req.user!.email}.${emailed ? " Emailed to client." : ""}${smsed ? " Texted to client." : ""}`, req.user!.email);

  res.json({ ok: true, shareToken, emailed, emailError, smsed });
}));

/**
 * Records that a client signed a physical/paper copy in the office rather than
 * through the emailed public link — for the case where a client is present in
 * person and prefers a wet-ink signature over typing their name on a screen.
 * Marks the contract Signed exactly like the electronic flow (so it behaves the
 * same everywhere else: Contracts tab, PDF footer, void rules), but stamps
 * signature_method='In-Person' and records which staff member logged it instead
 * of a client IP/user-agent (there isn't one for a paper signature).
 */
contractsRouter.post("/:contractId/sign-in-person", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE contract_id = $1`, [req.params.contractId]);
  if (!contract) return res.status(404).json({ error: "Contract not found." });
  if (!(await canAccessClient(req.user!, contract.client_id))) return res.status(403).json({ error: "You do not have access to this contract." });
  if (contract.status === "Signed") return res.status(400).json({ error: "This contract is already signed." });
  if (contract.status === "Void") return res.status(400).json({ error: "This contract has been voided." });

  const body = req.body || {};
  const signerName = String(body.signerName || "").trim();
  const signerTitle = String(body.signerTitle || "").trim() || null;
  if (!signerName) return res.status(400).json({ error: "The signer's full legal name is required." });

  await query(
    `UPDATE altax.v3_client_contracts
        SET status='Signed', signer_name=$2, signer_title=$3, agreed=true, signed_at=now(),
            signature_method='In-Person', recorded_by=$4, updated_at=now()
      WHERE contract_id=$1`,
    [contract.contract_id, signerName, signerTitle, req.user!.email]
  );
  await logAudit("Contracts", "SIGN_IN_PERSON", contract.contract_id, "status", contract.status, "Signed",
    `Recorded as signed in person by "${signerName}", logged by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true });
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

/**
 * Hard delete — admin only, and only while still a Draft. Anything the client
 * has already been sent or signed is a record of what actually happened;
 * Void (above) is the correct way to retract one of those, same reasoning as
 * every other financial/legal record in this app that gets voided rather than
 * deleted. A Draft nobody has seen yet is just a mistake worth erasing.
 */
contractsRouter.post("/:contractId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const contract = await queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE contract_id = $1`, [req.params.contractId]);
  if (!contract) return res.status(404).json({ error: "Contract not found." });
  if (!(await canAccessClient(req.user!, contract.client_id))) return res.status(403).json({ error: "You do not have access to this contract." });
  if (contract.status !== "Draft") {
    return res.status(400).json({ error: "Only a Draft contract can be deleted — this one has been sent or signed, so void it instead." });
  }

  await query(`DELETE FROM altax.v3_client_contracts WHERE contract_id = $1`, [contract.contract_id]);
  await logAudit("Contracts", "DELETE", contract.contract_id, "", contract.title, "",
    `Draft contract deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));
