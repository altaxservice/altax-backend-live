import { Router, Response } from "express";
import crypto from "crypto";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { getFirmProfile } from "../../common/firmProfile";
import { decryptClientPii } from "../../common/encryption";
import { generateContractPdf } from "../contracts/contractPdf";
import { buildDocumentDocx } from "./docx";
import { renderDocumentHtml } from "./htmlDoc";
import { DOC_TEMPLATES, getDocTemplate } from "./templates";
import "./templatesAr";
import { canAccessDoc } from "./access";
import { problemsFor } from "./checks";
import { READINESS } from "./readiness";
import { appendStandardAttachments, attachmentStatuses, inspectPdf, specFor } from "./standardAttachments";
import { scanFileForMalware } from "../../common/malwareScan";
import { registerSigningRoutes } from "./esign";
import { cleanAnswers, docTitle, fmtLongDate, hasArabic, missingAnswers, parseLang, renderDocument, type Answers, type DocLang, type DocTemplate, type PrefillKey } from "./engine";

/**
 * Document Builder — guided questionnaires that produce a finished document for a client. The finished text is stored as a Draft
 * contract (service_key "doc_<template>"), so sending it, e-signing it, signing it in person and printing its PDF all reuse the
 * existing contract flows. What was answered is kept in v3_doc_builder_docs so a document can be re-opened or duplicated.
 */
export const docBuilderRouter = Router();
docBuilderRouter.use(requireAuth, requireRole("admin", "staff"));

const newId = (p: string) => `${p}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

/** Everything in the app that already produces a document, so the Builder is one place to start from. */
const EXISTING_TOOLS = [
  { title: "Service contracts & e-signing", description: "Engagement letters and General Terms are created from a client's services; send, sign online or in person.", path: "/clients", hint: "Open a client → Contracts" },
  { title: "IRS 2848 / 8821 and Maryland 548", description: "Official power-of-attorney and tax-information authorization forms, filled in from the client's record.", path: "/clients", hint: "Open a client → Authorization forms" },
  { title: "Government forms", description: "SS-4, 2553, W-9, 8832, W-4, CRA and 8822-B, prepared for each client.", path: "/clients", hint: "Open a client → Government forms" },
  { title: "Message & email templates", description: "Reusable client emails and texts, in English and Arabic.", path: "/templates", hint: "Templates" },
  { title: "Estimates", description: "Priced proposals sent to prospects and clients.", path: "/estimates", hint: "Estimates" },
  { title: "Invoices & statements", description: "Client invoices, payment links and account statements.", path: "/billing", hint: "Billing" },
  { title: "Document requests & checklists", description: "Ask clients for the documents you need and track what arrived.", path: "/documents", hint: "Documents" },
  { title: "Health permit (HACCP) plans", description: "Food-safety plan documents for health permit applications.", path: "/haccp", hint: "Health Permits" },
];

function summary(t: DocTemplate) { return { key: t.key, title: t.title, titleAr: t.titleAr || null, category: t.category, description: t.description, reviewNote: t.reviewNote || null, steps: t.steps.length, hasArabic: hasArabic(t), readiness: READINESS[t.key] || null }; }

docBuilderRouter.get("/templates", asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ templates: DOC_TEMPLATES.map(summary), categories: Array.from(new Set(DOC_TEMPLATES.map((t) => t.category))), existingTools: EXISTING_TOOLS });
}));

docBuilderRouter.get("/templates/:key", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const t = getDocTemplate(req.params.key);
  if (!t) return res.status(404).json({ error: "Unknown document." });
  res.json({ template: { ...summary(t), stepList: t.steps } });
}));

async function loadClient(req: AuthedRequest, res: Response, clientId: string) {
  if (!clientId) return null;
  if (!(await canAccessClient(req.user!, clientId))) { res.status(403).json({ error: "You do not have access to this client." }); return undefined; }
  const row = await queryOne<any>(`SELECT client_id, client_name, address, email, phone, entity_type, state, ein, company_contact_name, company_contact_title, company_contact_email, company_contact_phone, date_of_formation, dba_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!row) { res.status(404).json({ error: "Client not found." }); return undefined; }
  return decryptClientPii(row);
}

const STATE_NAMES: Record<string, string> = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };

/** The client's entity type as one of: llc, scorp, corp, partnership, sole, other ("" when unknown). */
function entityKind(raw: unknown): string {
  const t = String(raw || "").toLowerCase();
  if (!t) return "";
  if (/llc|limited liability/.test(t)) return "llc";
  if (/s[\s-]?corp/.test(t)) return "scorp";
  if (/corp|inc/.test(t)) return "corp";
  if (/partner/.test(t)) return "partnership";
  if (/sole|individual/.test(t)) return "sole";
  return "other";
}

async function prefillValues(client: any | null): Promise<Record<PrefillKey, string>> {
  const firm = await getFirmProfile();
  const stateName = STATE_NAMES[String(client?.state || "").toUpperCase()] || "";
  const kind = entityKind(client?.entity_type);
  const word = ({ llc: "limited liability company", scorp: "corporation", corp: "corporation", partnership: "partnership", sole: "sole proprietorship" } as Record<string, string>)[kind] || "";
  const ownerName = String(client?.company_contact_name || "").trim();
  const ownerTitle = String(client?.company_contact_title || "").trim();
  const ein = String(client?.ein || "").replace(/\D/g, "");
  const formed = /^\d{4}-\d{2}-\d{2}/.exec(client?.date_of_formation instanceof Date ? client.date_of_formation.toISOString() : String(client?.date_of_formation || ""))?.[0] || "";
  return {
    clientName: client?.client_name || "", clientAddress: String(client?.address || "").replace(/\s*\n\s*/g, ", "), clientEmail: client?.email || "", clientPhone: client?.phone || "",
    firmName: firm.firmName, firmAddress: [firm.addressLine1, firm.addressLine2].filter(Boolean).join(", "), today: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    ownerName, ownerTitle, ownerNameTitle: [ownerName, ownerTitle].filter(Boolean).join(", "), ownerEmail: client?.company_contact_email || "", ownerPhone: client?.company_contact_phone || "",
    entityType: kind, entityDesc: word ? `a ${stateName ? `${stateName} ` : ""}${word}` : "", stateName,
    einLast4: ein.length >= 4 ? ein.slice(-4) : "", formationDate: formed, dbaName: client?.dba_name || "",
  };
}

/** Starting answers for a document: defaults, then values pulled from the client's record. */
docBuilderRouter.get("/templates/:key/start", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const t = getDocTemplate(req.params.key);
  if (!t) return res.status(404).json({ error: "Unknown document." });
  const client = await loadClient(req, res, String(req.query.clientId || "").trim());
  if (client === undefined) return;
  const pre = await prefillValues(client);
  const answers: Answers = {};
  for (const q of t.steps.flatMap((s) => s.questions)) {
    let pv = q.prefill ? pre[q.prefill] : "";
    if (pv && q.type === "select") { const vals = (q.options || []).map((o) => o.value); if (!vals.includes(pv)) pv = pv === "scorp" && vals.includes("corp") ? "corp" : ""; }
    if (pv) answers[q.id] = pv;
    else if (q.default !== undefined) answers[q.id] = q.default;
    else if (q.type === "yesno") answers[q.id] = false;
    else if (q.type === "list") answers[q.id] = [];
  }
  res.json({ answers });
}));

function prep(req: AuthedRequest, res: Response): { t: DocTemplate; answers: Answers; lang: DocLang } | null {
  const t = getDocTemplate(String(req.body?.templateKey || ""));
  if (!t) { res.status(404).json({ error: "Unknown document." }); return null; }
  return { t, answers: cleanAnswers(t, req.body?.answers), lang: hasArabic(t) ? parseLang(req.body?.lang) : "en" };
}

docBuilderRouter.post("/preview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return; const firmName = (await getFirmProfile()).firmName;
  res.json({ body: renderDocument(p.t, p.answers, p.lang, { placeholders: true, firmName }), missing: missingAnswers(p.t, p.answers), problems: problemsFor(p.t.key, p.answers) });
}));

/** Official PDFs kept once and appended to the PDF of certain documents (e.g. the Maryland Tenants' Bill of Rights on a lease). Anyone on staff can see them; only an admin replaces one. */
docBuilderRouter.get("/attachments", asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ attachments: await attachmentStatuses() });
}));

docBuilderRouter.post("/attachments/:key", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const spec = specFor(req.params.key);
  if (!spec) return res.status(404).json({ error: "Unknown attachment." });
  const base64 = String(req.body?.fileBase64 || "").replace(/^data:[^,]*,/, "");
  const fileName = String(req.body?.fileName || "").replace(/[\\/"\r\n]/g, "").trim().slice(0, 200) || `${spec.key}.pdf`;
  const editionLabel = String(req.body?.editionLabel || "").trim().slice(0, 100);
  const validFrom = String(req.body?.validFrom || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || Number.isNaN(new Date(`${validFrom}T00:00:00Z`).getTime())) return res.status(400).json({ error: "Enter the date this edition took effect (for the Bill of Rights, October 1 of the year)." });
  if (!base64) return res.status(400).json({ error: "Choose the PDF to upload." });
  const bytes = Buffer.from(base64, "base64");
  let info: { pages: number; sha256: string };
  try { info = await inspectPdf(bytes); } catch (e: any) { return res.status(400).json({ error: e.message }); }
  const scan = await scanFileForMalware(bytes, "standard-attachment");
  if (scan.scanned && !scan.clean) return res.status(400).json({ error: `This file was flagged by malware scanning${scan.foundViruses?.length ? ` (${scan.foundViruses.join(", ")})` : ""} and was not uploaded.` });
  const before = await queryOne<any>(`SELECT edition_label FROM altax.v3_standard_attachments WHERE attach_key = $1`, [spec.key]);
  await query(
    `INSERT INTO altax.v3_standard_attachments (attach_key, file_name, edition_label, valid_from, content, sha256, page_count, uploaded_by, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (attach_key) DO UPDATE SET file_name = EXCLUDED.file_name, edition_label = EXCLUDED.edition_label, valid_from = EXCLUDED.valid_from,
       content = EXCLUDED.content, sha256 = EXCLUDED.sha256, page_count = EXCLUDED.page_count, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
    [spec.key, fileName, editionLabel, validFrom, bytes, info.sha256, info.pages, req.user!.email]
  );
  await logAudit("Contracts", "STANDARD_ATTACHMENT_SET", spec.key, "edition", before?.edition_label || "", editionLabel || validFrom, `${spec.title} replaced by ${req.user!.email}: "${fileName}", ${info.pages} pages, effective ${validFrom}.`, req.user!.email);
  res.json({ ok: true, attachments: await attachmentStatuses() });
}));

/** A PDF of the document as it stands, without saving anything — for printing or checking. */
docBuilderRouter.post("/pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return; const firmName = (await getFirmProfile()).firmName;
  const client = await loadClient(req, res, String(req.body?.clientId || "").trim());
  if (client === undefined) return;
  const bytes = await generateContractPdf({
    contractId: "PREVIEW", title: p.t.title, clientName: client?.client_name || "", clientId: client?.client_id || "", renderedBody: renderDocument(p.t, p.answers, p.lang, { placeholders: true, firmName }),
    effectiveDate: null, status: "Draft", signerName: null, signerTitle: null, signedAt: null, signerIp: null, signatureMethod: "Online", recordedBy: null, legal: true, bodySize: p.t.pdfFontSize,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${p.t.key}.pdf"`);
  res.send(Buffer.from(await appendStandardAttachments(bytes, p.t.key)));
}));

/** A printable page (HTML, same layout as the PDF/Word file) of the document as it stands — Arabic and bilingual documents print through the browser. */
docBuilderRouter.post("/html", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return; const firmName = (await getFirmProfile()).firmName;
  const client = await loadClient(req, res, String(req.body?.clientId || "").trim());
  if (client === undefined) return;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderDocumentHtml({ title: docTitle(p.t, p.lang), body: renderDocument(p.t, p.answers, p.lang, { placeholders: true, firmName }), autoPrint: Boolean(req.body?.print) }));
}));

/** A Word (.docx) copy of the document as it stands, without saving anything. */
docBuilderRouter.post("/docx", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return; const firmName = (await getFirmProfile()).firmName;
  const client = await loadClient(req, res, String(req.body?.clientId || "").trim());
  if (client === undefined) return;
  const buf = await buildDocumentDocx({ title: docTitle(p.t, p.lang), body: renderDocument(p.t, p.answers, p.lang, { placeholders: true, firmName }), footerNote: "Draft" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="${p.t.key}.docx"`);
  res.send(buf);
}));

/** Saves the finished document as a Draft contract for the client (ready to send, sign or print) and keeps the answers. */
docBuilderRouter.post("/create", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return;
  const clientId = String(req.body?.clientId || "").trim();
  const external = !clientId; // a client is optional — with none, the document is for outside parties
  const client = external ? null : await loadClient(req, res, clientId);
  if (!external && !client) return;
  const missing = missingAnswers(p.t, p.answers);
  if (missing.length) return res.status(400).json({ error: `Please fill in: ${missing.slice(0, 6).join("; ")}${missing.length > 6 ? "…" : ""}`, missing });
  const problems = problemsFor(p.t.key, p.answers);
  if (problems.length) return res.status(400).json({ error: `Please fix: ${problems.slice(0, 4).join(" ")}`, problems });
  const body = renderDocument(p.t, p.answers, p.lang, { firmName: (await getFirmProfile()).firmName });
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(String(p.answers.effectiveDate || "")) ? String(p.answers.effectiveDate) : null;
  const title = String(req.body?.title || "").trim().slice(0, 200) || docTitle(p.t, p.lang);

  const contractId = newId("CT");
  await query(
    `INSERT INTO altax.v3_client_contracts (contract_id, client_id, service_key, title, rendered_body, effective_date, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'Draft',$7)`,
    [contractId, external ? null : clientId, `doc_${p.t.key}`, title, body, effective, req.user!.email]
  );
  const docId = newId("DOC");
  await query(
    `INSERT INTO altax.v3_doc_builder_docs (doc_id, client_id, template_key, title, answers, contract_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [docId, external ? null : clientId, p.t.key, title, JSON.stringify({ ...p.answers, _lang: p.lang }), contractId, req.user!.email]
  );
  await logAudit("Contracts", "DOC_BUILDER_CREATE", contractId, "template", "", p.t.key, `"${title}" built for ${client ? client.client_name : "an outside party (no client)"} by ${req.user!.email}.`, req.user!.email);
  // The unfinished draft this came from is finished now — remove it (only the creator's own).
  const fromDraft = String(req.body?.draftId || "").trim();
  if (fromDraft) await query(`DELETE FROM altax.v3_doc_builder_drafts WHERE draft_id = $1 AND lower(created_by) = lower($2)`, [fromDraft, req.user!.email]).catch(() => {});
  res.status(201).json({ ok: true, docId, contractId });
}));

/** Documents already built for a client (newest first), so one can be re-opened as a starting point. */
docBuilderRouter.get("/history", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const clientId = String(req.query.clientId || "").trim();
  const client = await loadClient(req, res, clientId);
  if (client === undefined) return;
  const rows = clientId
    ? await query<any>(`SELECT d.doc_id, d.template_key, d.title, d.contract_id, d.created_by, d.created_at, c.status FROM altax.v3_doc_builder_docs d LEFT JOIN altax.v3_client_contracts c ON c.contract_id = d.contract_id WHERE d.client_id = $1 ORDER BY d.created_at DESC LIMIT 100`, [clientId])
    : await query<any>(`SELECT d.doc_id, d.template_key, d.title, d.contract_id, d.created_by, d.created_at, c.status, d.client_id, cl.client_name FROM altax.v3_doc_builder_docs d LEFT JOIN altax.v3_client_contracts c ON c.contract_id = d.contract_id LEFT JOIN altax.v3_clients cl ON cl.client_id = d.client_id ORDER BY d.created_at DESC LIMIT 200`);
  const visible: any[] = [];
  if (!clientId) { const seen = new Map<string, boolean>(); for (const r of rows) { const k = `${r.client_id || ""}|${r.client_id ? "" : r.created_by}`; if (!seen.has(k)) seen.set(k, await canAccessDoc(req, r.client_id, r.created_by)); if (seen.get(k)) visible.push(r); if (visible.length >= 50) break; } }
  res.json({ docs: (clientId ? rows : visible).map((r: any) => ({ docId: r.doc_id, templateKey: r.template_key, title: r.title, contractId: r.contract_id, status: r.status || null, createdBy: r.created_by, createdAt: r.created_at, clientId: r.client_id || clientId, clientName: r.client_name || null })) });
}));

docBuilderRouter.get("/docs/:docId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT doc_id, client_id, template_key, title, answers, contract_id, created_by FROM altax.v3_doc_builder_docs WHERE doc_id = $1`, [req.params.docId]);
  if (!row) return res.status(404).json({ error: "Document not found." });
  if (!(await canAccessDoc(req, row.client_id, row.created_by))) return res.status(403).json({ error: "You do not have access to this document." });
  res.json({ docId: row.doc_id, clientId: row.client_id, templateKey: row.template_key, title: row.title, answers: row.answers, contractId: row.contract_id, fmtDate: fmtLongDate(String(row.answers?.effectiveDate || "")) });
}));

/* ───────────── Unfinished documents (drafts) ───────────── */

const isDraftOwner = (req: AuthedRequest, createdBy: string) => req.user!.role === "admin" || String(createdBy || "").toLowerCase() === req.user!.email.toLowerCase();
const stepTitles = (t: DocTemplate) => ["Client", ...t.steps.map((s) => s.title), "Review"];

/** Unfinished documents: your own (admins see everyone's), newest first. */
docBuilderRouter.get("/drafts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const admin = req.user!.role === "admin";
  const rows = await query<any>(
    `SELECT d.draft_id, d.template_key, d.client_id, d.lang, d.step, d.created_by, d.updated_at, c.client_name
       FROM altax.v3_doc_builder_drafts d LEFT JOIN altax.v3_clients c ON c.client_id = d.client_id
      ${admin ? "" : "WHERE lower(d.created_by) = lower($1)"} ORDER BY d.updated_at DESC LIMIT 100`,
    admin ? [] : [req.user!.email]
  );
  const drafts = rows.map((r: any) => {
    const t = getDocTemplate(r.template_key); if (!t) return null;
    const titles = stepTitles(t);
    return { draftId: r.draft_id, templateKey: r.template_key, title: t.title, clientId: r.client_id, clientName: r.client_name || null, lang: r.lang, step: r.step, stepCount: titles.length, stepTitle: titles[Math.min(r.step, titles.length - 1)], createdBy: r.created_by, updatedAt: r.updated_at };
  }).filter(Boolean);
  res.json({ drafts });
}));

docBuilderRouter.get("/drafts/:draftId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT draft_id, template_key, client_id, lang, answers, step, created_by FROM altax.v3_doc_builder_drafts WHERE draft_id = $1`, [req.params.draftId]);
  if (!row || !isDraftOwner(req, row.created_by)) return res.status(404).json({ error: "That unfinished document was not found." });
  res.json({ draftId: row.draft_id, templateKey: row.template_key, clientId: row.client_id || "", lang: row.lang, answers: row.answers || {}, step: row.step });
}));

/** Saves (or updates) an unfinished document. Nothing is validated beyond the document and client — it is allowed to be incomplete. */
docBuilderRouter.post("/drafts", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const t = getDocTemplate(String(req.body?.templateKey || ""));
  if (!t) return res.status(404).json({ error: "Unknown document." });
  const clientId = String(req.body?.clientId || "").trim();
  if (clientId) { const client = await loadClient(req, res, clientId); if (!client) return; }
  const answers = cleanAnswers(t, req.body?.answers);
  const lang = hasArabic(t) ? parseLang(req.body?.lang) : "en";
  const step = Math.max(0, Math.min(Number(req.body?.step) || 0, t.steps.length + 1));
  let draftId = String(req.body?.draftId || "").trim();
  if (draftId) {
    const row = await queryOne<any>(`SELECT created_by FROM altax.v3_doc_builder_drafts WHERE draft_id = $1`, [draftId]);
    if (!row || !isDraftOwner(req, row.created_by)) draftId = "";
  }
  if (draftId) {
    await query(`UPDATE altax.v3_doc_builder_drafts SET client_id = $2, lang = $3, answers = $4, step = $5, updated_at = now() WHERE draft_id = $1`, [draftId, clientId || null, lang, JSON.stringify(answers), step]);
  } else {
    draftId = newId("DRF");
    await query(`INSERT INTO altax.v3_doc_builder_drafts (draft_id, template_key, client_id, lang, answers, step, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [draftId, t.key, clientId || null, lang, JSON.stringify(answers), step, req.user!.email]);
  }
  res.json({ ok: true, draftId, updatedAt: new Date().toISOString() });
}));

docBuilderRouter.post("/drafts/:draftId/delete", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT created_by FROM altax.v3_doc_builder_drafts WHERE draft_id = $1`, [req.params.draftId]);
  if (!row || !isDraftOwner(req, row.created_by)) return res.status(404).json({ error: "That unfinished document was not found." });
  await query(`DELETE FROM altax.v3_doc_builder_drafts WHERE draft_id = $1`, [req.params.draftId]);
  res.json({ ok: true });
}));

registerSigningRoutes(docBuilderRouter);
