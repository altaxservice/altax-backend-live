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
import { DOC_TEMPLATES, getDocTemplate } from "./templates";
import "./templatesAr";
import { canAccessDoc } from "./access";
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

function summary(t: DocTemplate) { return { key: t.key, title: t.title, titleAr: t.titleAr || null, category: t.category, description: t.description, reviewNote: t.reviewNote || null, steps: t.steps.length, hasArabic: hasArabic(t) }; }

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
  const row = await queryOne<any>(`SELECT client_id, client_name, address, email, phone FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!row) { res.status(404).json({ error: "Client not found." }); return undefined; }
  return decryptClientPii(row);
}

async function prefillValues(client: any | null): Promise<Record<PrefillKey, string>> {
  const firm = await getFirmProfile();
  return {
    clientName: client?.client_name || "", clientAddress: String(client?.address || "").replace(/\s*\n\s*/g, ", "), clientEmail: client?.email || "", clientPhone: client?.phone || "",
    firmName: firm.firmName, firmAddress: [firm.addressLine1, firm.addressLine2].filter(Boolean).join(", "), today: new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
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
    if (q.prefill && pre[q.prefill]) answers[q.id] = pre[q.prefill];
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
  const p = prep(req, res); if (!p) return;
  res.json({ body: renderDocument(p.t, p.answers, p.lang), missing: missingAnswers(p.t, p.answers) });
}));

/** A PDF of the document as it stands, without saving anything — for printing or checking. */
docBuilderRouter.post("/pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return;
  const client = await loadClient(req, res, String(req.body?.clientId || "").trim());
  if (client === undefined) return;
  const bytes = await generateContractPdf({
    contractId: "PREVIEW", title: p.t.title, clientName: client?.client_name || "", clientId: client?.client_id || "", renderedBody: renderDocument(p.t, p.answers, p.lang),
    effectiveDate: null, status: "Draft", signerName: null, signerTitle: null, signedAt: null, signerIp: null, signatureMethod: "Online", recordedBy: null, legal: true,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${p.t.key}.pdf"`);
  res.send(Buffer.from(bytes));
}));

/** A Word (.docx) copy of the document as it stands, without saving anything. */
docBuilderRouter.post("/docx", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const p = prep(req, res); if (!p) return;
  const client = await loadClient(req, res, String(req.body?.clientId || "").trim());
  if (client === undefined) return;
  const buf = await buildDocumentDocx({ title: docTitle(p.t, p.lang), body: renderDocument(p.t, p.answers, p.lang), footerNote: "Draft" });
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
  const body = renderDocument(p.t, p.answers, p.lang);
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

registerSigningRoutes(docBuilderRouter);
