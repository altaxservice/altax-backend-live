import { Router, Request, Response } from "express";
import { createHash, randomBytes, randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { query, queryOne, withTransaction } from "../../config/db";
import { AuthedRequest } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";
import { rateLimit } from "../../common/rateLimit";
import { writeUploadBlob, readUploadBlob } from "../../common/uploadBlobStorage";
import { scanFileForMalware } from "../../common/malwareScan";
import { sendEmail, sendSms } from "../../common/notifications";
import { wrapEmailHtml } from "../../common/emailTemplate";
import { escapeHtml } from "../../common/html";
import { getFirmProfile } from "../../common/firmProfile";
import { generateContractPdf } from "../contracts/contractPdf";
import { appendStandardAttachments, templateKeyOfService } from "./standardAttachments";
import { getDocTemplate } from "./templates";
import { suggestSigners, NEEDS_NOTARY } from "./signerSpec";
import { canAccessDoc } from "./access";

/**
 * Multi-party e-signing for Document Builder documents. Each signer gets a private link (/public/sign/:token) and signs by typing
 * their name (optionally drawing it too) after agreeing to sign electronically; time, network address and device are recorded.
 * The document (a v3_client_contracts row) turns Signed only when every signer has signed.
 */
const newId = (p: string) => `${p}-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);


const MAX_FILE_BYTES = 8 * 1024 * 1024;

/** The original PDF for an uploaded document, or null when the document was built from a template. */
async function loadOriginalPdf(docId: string): Promise<{ bytes: Buffer; name: string; pages: number; sha256: string } | null> {
  const f = await queryOne<any>(`SELECT * FROM altax.v3_esign_files WHERE doc_id = $1`, [docId]);
  if (!f) return null;
  const b64 = await readUploadBlob(`ESIGN-${docId}`, f.file_data, f.blob_backend);
  return { bytes: Buffer.from(b64, "base64"), name: f.file_name, pages: f.page_count, sha256: f.sha256 };
}

async function loadDoc(req: AuthedRequest, res: Response, docId: string) {
  const doc = await queryOne<any>(
    `SELECT d.*, c.status AS contract_status, c.title AS contract_title, c.rendered_body, c.effective_date, c.created_by, cl.client_name
       FROM altax.v3_doc_builder_docs d JOIN altax.v3_client_contracts c ON c.contract_id = d.contract_id LEFT JOIN altax.v3_clients cl ON cl.client_id = d.client_id
      WHERE d.doc_id = $1`, [docId]);
  if (!doc) { res.status(404).json({ error: "Document not found." }); return null; }
  if (!(await canAccessDoc(req, doc.client_id, doc.created_by))) { res.status(403).json({ error: "You do not have access to this document." }); return null; }
  return doc;
}

const signerView = (r: any, withLink: boolean, base: string) => ({
  signerId: r.signer_id, role: r.role_label, name: r.signer_name, email: r.email, phone: r.phone, delivery: r.delivery, status: r.status,
  sentAt: iso(r.sent_at), viewedAt: iso(r.viewed_at), signedAt: iso(r.signed_at), declinedAt: iso(r.declined_at), declineReason: r.decline_reason,
  reminders: r.reminder_count, link: withLink && r.share_token ? `${base}/public/sign/${r.share_token}` : null,
});

function emailBody(signerName: string, title: string, requestedBy: string, link: string, reminder: boolean) {
  const button = `<p style="text-align:center; margin:24px 0;"><a href="${link}" style="display:inline-block; background:#0f766e; color:#ffffff; text-decoration:none; font-weight:700; font-size:15px; padding:12px 28px; border-radius:8px;">Review &amp; Sign &nbsp;·&nbsp; <bdi dir="rtl">مراجعة وتوقيع</bdi></a></p>
    <p style="font-size:12px; color:#6b7280;">Or copy this link into your browser: <bdi dir="ltr"><a href="${link}">${link}</a></bdi></p>`;
  return `<div dir="ltr" style="text-align:left;"><p>Hello ${escapeHtml(signerName)},</p>
    <p>${reminder ? "This is a reminder: " : ""}${escapeHtml(requestedBy)} has asked you to review and sign <strong>${escapeHtml(title)}</strong>. Use the button below — you can read the whole document first, and sign from your phone or computer.</p></div>
    <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;">
    <div dir="rtl" style="text-align:right;"><p>مرحباً ${escapeHtml(signerName)}،</p>
    <p>${reminder ? "تذكير: " : ""}يرجى مراجعة وتوقيع المستند: <strong>${escapeHtml(title)}</strong>. استخدموا الزر أدناه لقراءته كاملاً ثم التوقيع من هاتفكم أو حاسوبكم.</p></div>${button}`;
}

async function deliver(req: AuthedRequest | null, s: any, token: string, doc: any, base: string, requestedBy: string, reminder: boolean) {
  const link = `${base}/public/sign/${token}`;
  const result: { emailed: boolean; texted: boolean; error: string | null } = { emailed: false, texted: false, error: null };
  const wantsEmail = s.delivery === "email" || s.delivery === "both";
  const wantsSms = s.delivery === "sms" || s.delivery === "both";
  const firm = (await getFirmProfile()).firmName;
  if (wantsEmail && s.email) {
    const subject = `${reminder ? "Reminder: " : ""}${doc.contract_title} — please review and sign`;
    try {
      await sendEmail({ to: s.email, subject, html: await wrapEmailHtml(emailBody(s.signer_name, doc.contract_title, requestedBy, link, reminder), req as any) });
      result.emailed = true;
    } catch (e: any) { result.error = e?.message || "Could not send the email."; }
    await query(
      `INSERT INTO altax.v3_communications (communication_id, client_id, client_name, related_task_id, direction, channel, subject, message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
       VALUES ($1,$2,$3,NULL,'Outbound','Email',$4,$5,'',$6,$7,now(),$8,'DocSign',$9)`,
      [newId("COM"), doc.client_id, doc.client_name, subject, `${doc.contract_title} sent to ${s.signer_name} (${s.role_label}) for signature.`, s.email, requestedBy, result.emailed ? "Saved + Sent" : `Saved — ${result.error}`, s.signer_id]
    ).catch(() => {});
  }
  if (wantsSms && s.phone) {
    try { await sendSms({ to: s.phone, body: `${firm}: ${s.signer_name}, "${doc.contract_title}" is ready for your signature: ${link}` }); result.texted = true; }
    catch (e: any) { result.error = result.error || e?.message || "Could not send the text."; }
  }
  return { ...result, link };
}

/** Staff-side routes, added to the Document Builder router (which already requires an admin/staff login). */
export function registerSigningRoutes(router: Router) {
  router.get("/docs/:docId/signing", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    const rows = await query<any>(`SELECT * FROM altax.v3_doc_signers WHERE doc_id = $1 ORDER BY sort_order, created_at`, [doc.doc_id]);
    const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
    const tpl = getDocTemplate(doc.template_key);
    const { _lang, ...answers } = (doc.answers || {}) as Record<string, any>;
    const uploaded = doc.template_key === "uploaded";
    res.json({
      doc: { docId: doc.doc_id, title: doc.contract_title, clientId: doc.client_id, clientName: doc.client_name, contractId: doc.contract_id, status: doc.contract_status, lang: _lang || "en", templateKey: doc.template_key, body: doc.rendered_body },
      signers: rows.map((r) => signerView(r, true, base)),
      suggestions: rows.length ? [] : uploaded ? (doc.client_name ? [{ role: "Client", name: doc.client_name }] : []) : suggestSigners(doc.template_key, answers),
      file: uploaded ? { name: answers.fileName || "document.pdf", pages: answers.pages || null } : null,
      needsNotary: NEEDS_NOTARY.has(doc.template_key), templateTitle: tpl?.title || doc.title,
      locked: rows.some((r) => r.status === "Signed" || r.status === "Declined") || doc.contract_status === "Signed" || doc.contract_status === "Void",
    });
  }));


  /** Upload a PDF to be signed (the E-Sign tab). It becomes a draft document for the chosen client, ready to add signers and send. */
  router.post("/esign/upload", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const clientId = String(req.body?.clientId || "").trim();
    const external = !clientId; // a client is optional — with none, the document is for outside parties
    let client: any = null;
    if (!external) {
      if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
      client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
      if (!client) return res.status(404).json({ error: "Client not found." });
    }
    const fileName = String(req.body?.fileName || "document.pdf").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 200);
    const b64 = String(req.body?.fileBase64 || "").replace(/^data:[^,]*,/, "");
    if (!b64) return res.status(400).json({ error: "Choose a PDF to upload." });
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length > MAX_FILE_BYTES) return res.status(400).json({ error: "That file is larger than 8 MB. Reduce its size and try again." });
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return res.status(400).json({ error: "Only PDF files can be uploaded for signing. Save a Word document as PDF first." });
    const scan = await scanFileForMalware(bytes, fileName);
    if (scan.scanned && !scan.clean) return res.status(400).json({ error: "This file was flagged by malware scanning and was not uploaded." });
    let pages = 0;
    try { pages = (await PDFDocument.load(bytes)).getPageCount(); }
    catch { return res.status(400).json({ error: "This PDF could not be read — it may be password-protected or damaged. Remove the password or re-save it, then try again." }); }
    if (pages < 1) return res.status(400).json({ error: "This PDF has no pages." });
    const title = String(req.body?.title || "").trim().slice(0, 200) || fileName.replace(/\.pdf$/i, "");
    const sha = createHash("sha256").update(bytes).digest("hex");
    const docId = newId("DOC"), contractId = newId("CT");
    const blob = await writeUploadBlob(`ESIGN-${docId}`, bytes.toString("base64"));
    await query(`INSERT INTO altax.v3_client_contracts (contract_id, client_id, service_key, title, rendered_body, status, created_by) VALUES ($1,$2,'doc_upload',$3,$4,'Draft',$5)`,
      [contractId, external ? null : clientId, title, `Uploaded document: ${fileName} (${pages} page${pages === 1 ? "" : "s"}).`, req.user!.email]);
    await query(`INSERT INTO altax.v3_doc_builder_docs (doc_id, client_id, template_key, title, answers, contract_id, created_by) VALUES ($1,$2,'uploaded',$3,$4,$5,$6)`,
      [docId, external ? null : clientId, title, JSON.stringify({ fileName, pages, sha256: sha, _lang: "en" }), contractId, req.user!.email]);
    await query(`INSERT INTO altax.v3_esign_files (doc_id, file_name, size_bytes, page_count, sha256, file_data, blob_backend, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [docId, fileName, bytes.length, pages, sha, blob.fileData, blob.blobBackend, req.user!.email]);
    await logAudit("Contracts", "ESIGN_UPLOAD", contractId, "file", "", fileName, `"${title}" (${fileName}, ${pages} pages) uploaded for e-signature for ${client ? client.client_name : "an outside party (no client)"} by ${req.user!.email}.`, req.user!.email);
    res.status(201).json({ ok: true, docId, contractId, pages });
  }));

  /** The original uploaded PDF, for staff. */
  router.get("/docs/:docId/file", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    const f = await loadOriginalPdf(doc.doc_id);
    if (!f) return res.status(404).json({ error: "This document has no uploaded file." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${f.name.replace(/"/g, "")}"`);
    res.send(f.bytes);
  }));

  /** Everything out for signature or finished — documents built from templates and uploaded PDFs together — for the E-Sign tab. */
  router.get("/esign/list", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const status = String(req.query.status || "all");
    const rows = await query<any>(
      `SELECT d.doc_id, d.title, d.template_key, d.client_id, cl.client_name, c.status, c.created_at, c.sent_at, c.signed_at, d.created_by,
              (SELECT count(*) FROM altax.v3_doc_signers s WHERE s.doc_id = d.doc_id AND s.status <> 'Cancelled') AS total,
              (SELECT count(*) FROM altax.v3_doc_signers s WHERE s.doc_id = d.doc_id AND s.status = 'Signed') AS signed,
              (SELECT count(*) FROM altax.v3_doc_signers s WHERE s.doc_id = d.doc_id AND s.status = 'Declined') AS declined
         FROM altax.v3_doc_builder_docs d JOIN altax.v3_client_contracts c ON c.contract_id = d.contract_id LEFT JOIN altax.v3_clients cl ON cl.client_id = d.client_id
        WHERE c.status <> 'Void' ${status === "waiting" ? "AND c.status = 'Sent'" : status === "completed" ? "AND c.status = 'Signed'" : status === "draft" ? "AND c.status = 'Draft'" : ""}
        ORDER BY GREATEST(c.updated_at, c.created_at) DESC LIMIT 300`);
    const allowed = new Map<string, boolean>();
    const out: any[] = [];
    for (const r of rows) {
      const key = `${r.client_id || ""}|${r.client_id ? "" : r.created_by}`;
      if (!allowed.has(key)) allowed.set(key, await canAccessDoc(req, r.client_id, r.created_by));
      if (!allowed.get(key)) continue;
      out.push({ docId: r.doc_id, title: r.title, uploaded: r.template_key === "uploaded", clientId: r.client_id, clientName: r.client_name, status: r.status, createdAt: iso(r.created_at), sentAt: iso(r.sent_at), signedAt: iso(r.signed_at), createdBy: r.created_by, total: Number(r.total), signed: Number(r.signed), declined: Number(r.declined) });
    }
    res.json({ docs: out });
  }));

  router.post("/docs/:docId/signing/send", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    if (doc.contract_status === "Signed") return res.status(400).json({ error: "This document is already signed by everyone." });
    if (doc.contract_status === "Void") return res.status(400).json({ error: "This document has been voided." });
    const existing = await query<any>(`SELECT status FROM altax.v3_doc_signers WHERE doc_id = $1`, [doc.doc_id]);
    if (existing.some((e) => e.status === "Signed" || e.status === "Declined")) return res.status(400).json({ error: "Someone has already signed or declined, so the list of signers can no longer be changed. Cancel the request and make a new copy to change it." });
    const raw = Array.isArray(req.body?.signers) ? req.body.signers : [];
    if (raw.length < 1 || raw.length > 12) return res.status(400).json({ error: "Add between 1 and 12 people who need to sign." });
    const signers = raw.map((x: any, i: number) => ({
      role: String(x?.role || "Signer").trim().slice(0, 120) || "Signer", name: String(x?.name || "").trim().slice(0, 255), email: String(x?.email || "").trim().toLowerCase().slice(0, 255) || null,
      phone: String(x?.phone || "").trim().slice(0, 50) || null, delivery: ["email", "sms", "both", "link"].includes(x?.delivery) ? x.delivery : "email", order: i,
    }));
    for (const s of signers) {
      if (!s.name) return res.status(400).json({ error: "Every signer needs a name." });
      if ((s.delivery === "email" || s.delivery === "both") && !/^\S+@\S+\.\S+$/.test(s.email || "")) return res.status(400).json({ error: `Enter a valid email address for ${s.name}.` });
      if ((s.delivery === "sms" || s.delivery === "both") && !s.phone) return res.status(400).json({ error: `Enter a phone number for ${s.name}.` });
    }
    const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
    const inserted: any[] = [];
    await withTransaction(async (db) => {
      await db.query(`DELETE FROM altax.v3_doc_signers WHERE doc_id = $1`, [doc.doc_id]);
      for (const s of signers) {
        const id = newId("SIG"), token = randomBytes(24).toString("hex");
        await db.query(
          `INSERT INTO altax.v3_doc_signers (signer_id, doc_id, contract_id, sort_order, role_label, signer_name, email, phone, delivery, share_token, status, sent_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Sent',now())`,
          [id, doc.doc_id, doc.contract_id, s.order, s.role, s.name, s.email, s.phone, s.delivery, token]);
        inserted.push({ signer_id: id, role_label: s.role, signer_name: s.name, email: s.email, phone: s.phone, delivery: s.delivery, token });
      }
      await db.query(`UPDATE altax.v3_client_contracts SET status = 'Sent', sent_at = now(), updated_at = now() WHERE contract_id = $1`, [doc.contract_id]);
    });
    const results: any[] = [];
    for (const s of inserted) results.push({ signerId: s.signer_id, ...(await deliver(req, s, s.token, doc, base, req.user!.email, false)) });
    await logAudit("Contracts", "DOC_SIGN_SEND", doc.contract_id, "signers", "", String(inserted.length), `"${doc.contract_title}" sent for signature to ${inserted.map((s) => s.signer_name).join(", ")} by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true, results });
  }));

  router.post("/docs/:docId/signing/remind", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    const onlyId = String(req.body?.signerId || "").trim();
    const rows = await query<any>(`SELECT * FROM altax.v3_doc_signers WHERE doc_id = $1 AND status IN ('Sent','Viewed') ${onlyId ? "AND signer_id = $2" : ""}`, onlyId ? [doc.doc_id, onlyId] : [doc.doc_id]);
    if (!rows.length) return res.status(400).json({ error: "Nobody is waiting to sign." });
    const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
    const out: any[] = []; const skipped: string[] = [];
    for (const r of rows) {
      if (r.last_reminder_at && Date.now() - new Date(r.last_reminder_at).getTime() < 60 * 60 * 1000) { skipped.push(r.signer_name); continue; }
      if (r.delivery === "link") { skipped.push(r.signer_name); continue; }
      out.push({ signerId: r.signer_id, name: r.signer_name, ...(await deliver(req, r, r.share_token, doc, base, req.user!.email, true)) });
      await query(`UPDATE altax.v3_doc_signers SET reminder_count = reminder_count + 1, last_reminder_at = now() WHERE signer_id = $1`, [r.signer_id]);
    }
    await logAudit("Contracts", "DOC_SIGN_REMIND", doc.contract_id, "signers", "", String(out.length), `Signature reminder sent for "${doc.contract_title}" by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true, reminded: out.length, skipped });
  }));

  router.post("/docs/:docId/signing/cancel", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    if (doc.contract_status === "Signed") return res.status(400).json({ error: "Everyone has already signed this document." });
    await query(`UPDATE altax.v3_doc_signers SET status = 'Cancelled' WHERE doc_id = $1 AND status IN ('Pending','Sent','Viewed')`, [doc.doc_id]);
    await query(`UPDATE altax.v3_client_contracts SET status = 'Draft', updated_at = now() WHERE contract_id = $1 AND status = 'Sent'`, [doc.contract_id]);
    await logAudit("Contracts", "DOC_SIGN_CANCEL", doc.contract_id, "status", doc.contract_status, "Draft", `Signing of "${doc.contract_title}" cancelled by ${req.user!.email}.`, req.user!.email);
    res.json({ ok: true });
  }));

  router.get("/docs/:docId/signed-pdf", asyncHandler(async (req: AuthedRequest, res: Response) => {
    const doc = await loadDoc(req, res, req.params.docId); if (!doc) return;
    const bytes = await buildSignedPdf(doc.contract_id);
    if (!bytes) return res.status(404).json({ error: "Document not found." });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${doc.contract_id}.pdf"`);
    res.send(Buffer.from(bytes));
  }));
}

async function buildSignedPdf(contractId: string): Promise<Uint8Array | null> {
  const c = await queryOne<any>(`SELECT c.*, cl.client_name FROM altax.v3_client_contracts c LEFT JOIN altax.v3_clients cl ON cl.client_id = c.client_id WHERE c.contract_id = $1`, [contractId]);
  if (!c) return null;
  const signers = await query<any>(`SELECT * FROM altax.v3_doc_signers WHERE contract_id = $1 AND status <> 'Cancelled' ORDER BY sort_order, created_at`, [contractId]);
  // An uploaded PDF is kept exactly as it was received; the signatures go on a certificate page added after its last page.
  const docRow = await queryOne<any>(`SELECT doc_id FROM altax.v3_doc_builder_docs WHERE contract_id = $1`, [contractId]);
  const original = docRow ? await loadOriginalPdf(docRow.doc_id) : null;
  const certBody = original ? `Signature page for the attached document "${original.name}" (${original.pages} page${original.pages === 1 ? "" : "s"}).\n\nDocument fingerprint (SHA-256), so any later change to the pages above can be detected:\n${original.sha256}` : null;
  const cert = await generateContractPdf({
    contractId: c.contract_id, title: c.title, clientName: c.client_name || "", clientId: c.client_id, renderedBody: certBody ?? c.rendered_body, effectiveDate: c.effective_date, status: c.status,
    signerName: null, signerTitle: null, signedAt: c.signed_at, signerIp: null, signatureMethod: "Online", recordedBy: null, headerLabel: "DOCUMENT",
    signers: signers.map((s) => ({ role: s.role_label, name: s.signed_name || s.signer_name, status: s.status, signedAt: iso(s.signed_at), ip: s.signer_ip, image: s.signature_image })),
  });
  if (!original) return appendStandardAttachments(cert, templateKeyOfService(c.service_key));
  const merged = await PDFDocument.create();
  const src = await PDFDocument.load(original.bytes);
  (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
  const certDoc = await PDFDocument.load(cert);
  (await merged.copyPages(certDoc, certDoc.getPageIndices())).forEach((p) => merged.addPage(p));
  merged.setTitle(c.title);
  return merged.save();
}

/* ───────────── Public side: what a signer sees and does with their private link ───────────── */
export const publicSignRouter = Router();
const signLimiter = rateLimit({ name: "public-doc-sign", windowMs: 15 * 60 * 1000, max: 40 });

async function findSigner(token: string) {
  const s = await queryOne<any>(`SELECT * FROM altax.v3_doc_signers WHERE share_token = $1`, [token]);
  if (!s) return null;
  const c = await queryOne<any>(`SELECT c.*, cl.client_name FROM altax.v3_client_contracts c LEFT JOIN altax.v3_clients cl ON cl.client_id = c.client_id WHERE c.contract_id = $1`, [s.contract_id]);
  return c ? { s, c } : null;
}

publicSignRouter.get("/:token", signLimiter, asyncHandler(async (req: Request, res: Response) => {
  const f = await findSigner(req.params.token);
  if (!f) return res.status(404).json({ error: "This link is invalid or has expired." });
  const { s, c } = f;
  if (c.status === "Void") return res.status(410).json({ error: "This document has been voided and is no longer available for signature." });
  if (s.status === "Cancelled") return res.status(410).json({ error: "This signing request was cancelled." });
  if (s.status === "Sent") await query(`UPDATE altax.v3_doc_signers SET status = 'Viewed', viewed_at = now() WHERE signer_id = $1 AND status = 'Sent'`, [s.signer_id]);
  const others = await query<any>(`SELECT signer_id, role_label, signer_name, status, signed_at FROM altax.v3_doc_signers WHERE contract_id = $1 AND status <> 'Cancelled' ORDER BY sort_order, created_at`, [s.contract_id]);
  const firm = await getFirmProfile();
  const upload = await queryOne<any>(`SELECT f.file_name, f.page_count FROM altax.v3_esign_files f JOIN altax.v3_doc_builder_docs d ON d.doc_id = f.doc_id WHERE d.contract_id = $1`, [s.contract_id]);
  res.json({
    file: upload ? { name: upload.file_name, pages: upload.page_count } : null,
    doc: { title: c.title, body: c.rendered_body, effectiveDate: c.effective_date, clientName: c.client_name || "", status: c.status, firmName: firm.firmName, completed: c.status === "Signed" },
    signer: { name: s.signer_name, role: s.role_label, status: s.status === "Sent" ? "Viewed" : s.status, signedAt: iso(s.signed_at), signedName: s.signed_name },
    others: others.map((o) => ({ role: o.role_label, name: o.signer_name, status: o.status, signedAt: iso(o.signed_at), isYou: o.signer_id === s.signer_id })),
  });
}));

publicSignRouter.post("/:token/sign", signLimiter, asyncHandler(async (req: Request, res: Response) => {
  const f = await findSigner(req.params.token);
  if (!f) return res.status(404).json({ error: "This link is invalid or has expired." });
  const { s, c } = f;
  if (c.status === "Void") return res.status(410).json({ error: "This document has been voided and can no longer be signed." });
  if (s.status === "Signed") return res.status(400).json({ error: "You have already signed this document." });
  if (s.status === "Cancelled" || s.status === "Declined") return res.status(410).json({ error: "This signing request is no longer open." });
  const typed = String(req.body?.signerName || "").trim().slice(0, 255);
  if (!typed) return res.status(400).json({ error: "Please type your full legal name to sign." });
  if (!req.body?.agreed) return res.status(400).json({ error: "Please confirm that you have read the document and agree to sign it electronically." });
  let image: string | null = null;
  const rawImg = String(req.body?.signatureImage || "");
  if (rawImg) {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(rawImg) || rawImg.length > 400_000) return res.status(400).json({ error: "The drawn signature could not be read — please clear it and draw again, or just type your name." });
    image = rawImg;
  }
  const ip = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const ua = String(req.headers["user-agent"] || "").slice(0, 500) || null;
  // Atomic claim: only the request that flips this signer away from Sent/Viewed wins, so a double-submit can't overwrite the first record.
  const claimed = await query<{ signer_id: string }>(
    `UPDATE altax.v3_doc_signers SET status = 'Signed', signed_at = now(), signed_name = $2, signature_image = $3, signer_ip = $4, signer_user_agent = $5
      WHERE signer_id = $1 AND status IN ('Sent','Viewed','Pending') RETURNING signer_id`, [s.signer_id, typed, image, ip, ua]);
  if (!claimed.length) return res.status(400).json({ error: "You have already signed this document." });

  const all = await query<any>(`SELECT status, signer_name, email FROM altax.v3_doc_signers WHERE contract_id = $1 AND status <> 'Cancelled'`, [s.contract_id]);
  const completed = all.length > 0 && all.every((x) => x.status === "Signed");
  if (completed) {
    await query(`UPDATE altax.v3_client_contracts SET status = 'Signed', signed_at = now(), signer_name = $2, agreed = true, updated_at = now() WHERE contract_id = $1 AND status <> 'Void'`, [s.contract_id, all.map((x) => x.signer_name).join(", ").slice(0, 250)]);
  }
  await logAudit("Contracts", completed ? "DOC_SIGN_COMPLETE" : "DOC_SIGN", s.contract_id, "signer", "", s.role_label, `"${c.title}" signed electronically by "${typed}" (${s.role_label}) from IP ${ip || "unknown"}.${completed ? " All parties have now signed." : ""}`, typed);

  // Tell the person who prepared it; when everyone has signed, send each signer their copy link. Failures here never undo the signature.
  try {
    const firm = await getFirmProfile();
    const base = `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
    const creator = String(c.created_by || "").includes("@") ? c.created_by : null;
    if (creator) {
      await sendEmail({ to: creator, subject: completed ? `Fully signed: ${c.title}` : `${typed} signed: ${c.title}`, html: await wrapEmailHtml(`<p>${escapeHtml(typed)} (${escapeHtml(s.role_label)}) signed <strong>${escapeHtml(c.title)}</strong>${c.client_name ? ` for ${escapeHtml(c.client_name)}` : ""}.${completed ? " Everyone has now signed — the document is complete." : ` ${all.filter((x) => x.status !== "Signed").length} signature(s) still to come.`}</p>`) });
    }
    if (completed) {
      const sig = await query<any>(`SELECT signer_name, email, share_token FROM altax.v3_doc_signers WHERE contract_id = $1 AND status = 'Signed' AND email IS NOT NULL`, [s.contract_id]);
      for (const x of sig) {
        await sendEmail({ to: x.email, subject: `Signed copy: ${c.title}`, html: await wrapEmailHtml(`<p>Hello ${escapeHtml(x.signer_name)},</p><p>Everyone has signed <strong>${escapeHtml(c.title)}</strong>. You can view, print or save the signed copy any time here: <a href="${base}/public/sign/${x.share_token}">${base}/public/sign/${x.share_token}</a></p><p>— ${escapeHtml(firm.firmName)}</p>`) }).catch(() => {});
      }
    }
  } catch { /* email isn't configured or failed — the signature stands */ }
  res.json({ ok: true, completed });
}));

publicSignRouter.post("/:token/decline", signLimiter, asyncHandler(async (req: Request, res: Response) => {
  const f = await findSigner(req.params.token);
  if (!f) return res.status(404).json({ error: "This link is invalid or has expired." });
  const { s, c } = f;
  if (s.status === "Signed") return res.status(400).json({ error: "You have already signed this document." });
  const reason = String(req.body?.reason || "").trim().slice(0, 1000) || null;
  const r = await query(`UPDATE altax.v3_doc_signers SET status = 'Declined', declined_at = now(), decline_reason = $2 WHERE signer_id = $1 AND status IN ('Sent','Viewed','Pending') RETURNING signer_id`, [s.signer_id, reason]);
  if (!r.length) return res.status(400).json({ error: "This signing request is no longer open." });
  await logAudit("Contracts", "DOC_SIGN_DECLINE", s.contract_id, "signer", "", s.role_label, `"${s.signer_name}" (${s.role_label}) declined to sign "${c.title}"${reason ? `: ${reason}` : ""}.`, s.signer_name);
  try {
    const creator = String(c.created_by || "").includes("@") ? c.created_by : null;
    if (creator) await sendEmail({ to: creator, subject: `Declined: ${c.title}`, html: await wrapEmailHtml(`<p>${escapeHtml(s.signer_name)} (${escapeHtml(s.role_label)}) declined to sign <strong>${escapeHtml(c.title)}</strong>.${reason ? ` Reason: ${escapeHtml(reason)}` : ""}</p>`) });
  } catch { /* ignore */ }
  res.json({ ok: true });
}));

publicSignRouter.get("/:token/file", signLimiter, asyncHandler(async (req: Request, res: Response) => {
  const f = await findSigner(req.params.token);
  if (!f) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (f.c.status === "Void" || f.s.status === "Cancelled") return res.status(410).json({ error: "This document is no longer available." });
  const d = await queryOne<any>(`SELECT doc_id FROM altax.v3_doc_builder_docs WHERE contract_id = $1`, [f.s.contract_id]);
  const orig = d ? await loadOriginalPdf(d.doc_id) : null;
  if (!orig) return res.status(404).json({ error: "No file." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${orig.name.replace(/"/g, "")}"`);
  res.send(orig.bytes);
}));

publicSignRouter.get("/:token/pdf", signLimiter, asyncHandler(async (req: Request, res: Response) => {
  const f = await findSigner(req.params.token);
  if (!f) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (f.c.status === "Void") return res.status(410).json({ error: "This document has been voided." });
  const bytes = await buildSignedPdf(f.s.contract_id);
  if (!bytes) return res.status(404).json({ error: "Document not found." });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${f.s.contract_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));
