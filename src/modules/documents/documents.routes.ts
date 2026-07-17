import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases, isAssignedToUser, normalizeText } from "../../common/assignment";

/**
 * Documents module — Phase 4 slice covering the plan's five stated test scenarios:
 * firm requests a document, client uploads/links a file, admin/staff review status,
 * client visibility rules, and hidden-from-client behavior. Ported from
 * alTaxV3CreateDocumentRequest_, alTaxPortalUpdateDocumentRequest,
 * alTaxPortalUpdateDocumentStatus/alTaxV3UpdateDocumentStatus,
 * alTaxPortalSaveDocumentUpload (link-only — see note below),
 * alTaxPortalRemoveDocumentFile, alTaxPortalHideClientDocumentUploads, and the
 * visibility predicates alTaxV5IsClientVisibleDocumentRequest_ /
 * alTaxV5IsClientVisibleDocumentUpload_.
 *
 * alTaxPortalDeleteDocumentRequest is now ported (POST /requests/:requestId/delete and
 * /requests/bulk-delete below) — previously skipped like every other hard-delete this
 * session, now built at the user's explicit request with a typed-confirmation gate
 * added as extra safety beyond legacy's ungated version.
 *
 * Deliberately NOT ported:
 * - The base64-upload branch of alTaxPortalSaveDocumentUpload (DriveApp.createFile):
 *   this backend has no Drive integration. Only the "paste a document link" path is
 *   ported — callers must already have a fileUrl (Drive link or otherwise).
 *
 * Task-only uploads (a file attached to a task with no document request) are supported
 * via POST /uploads with taskId instead of requestId — admin/staff only, always internal
 * (hidden_from_client=true, direction='Internal'), since there's no client-facing request
 * context to hang visibility rules off of the way isClientVisibleUpload does for the
 * normal request-backed path.
 */
export const documentsRouter = Router();

function nextRequestId(): string {
  return `WEB-REQ-${idSuffix()}`;
}
function nextUploadId(): string {
  return `DOC-${idSuffix()}`;
}
function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

/** Mirrors alTaxV5IsClientVisibleDocumentRequest_. */
function isClientVisibleRequest(row: any): boolean {
  const status = normalizeText(row.status || "Open");
  if (["void", "deleted", "archived", "internal"].includes(status)) return false;
  const combined = [row.direction, row.request_type, row.source_system].map(normalizeText).join(" ");
  if (combined.includes("internal") || combined.includes("staff only")) return false;
  return true;
}

/** Mirrors alTaxV5IsClientVisibleDocumentUpload_. allowedRequestIds = client-visible request IDs for this client. */
function isClientVisibleUpload(row: any, allowedRequestIds: Set<string>): boolean {
  const status = normalizeText(row.status || "Uploaded");
  if (["removed", "replaced", "deleted", "archived", "void"].includes(status)) return false;
  if (normalizeText(row.hidden_from_client) === "yes" || row.hidden_from_client === true) return false;
  const direction = normalizeText(row.direction);
  if (direction.includes("internal") || direction.includes("staff")) return false;
  const requestId = String(row.request_id || "").trim();
  if (requestId) return allowedRequestIds.has(requestId);
  return !String(row.task_id || "").trim();
}

/**
 * Mirrors the clientAllowed || assignedAllowed check used by every document-request
 * mutation in legacy. Employees are explicitly excluded rather than falling through
 * to canAccessClient — that helper matches an employee against their own linked
 * clientId (correct for things like their own paystub), but document requests belong
 * to the client/employer relationship, not the employee. Same bug class as
 * billing.routes.ts's canMutateInvoice, found live: an employee who had or guessed a
 * request ID could view (via GET /requests/:requestId) and even change the status of
 * (via POST /requests/:requestId/status) their employer's document requests, despite
 * the request list correctly showing them nothing.
 */
async function canAccessDocumentRequest(user: NonNullable<AuthedRequest["user"]>, request: any): Promise<boolean> {
  if (user.role === "employee") return false;
  if (await canAccessClient(user, request.client_id)) return true;
  const aliases = await getUserAliases(user.email);
  return isAssignedToUser(request.assigned_to, aliases);
}

function nextCommunicationId(): string {
  return `COM-${idSuffix()}`;
}

/**
 * Ported from alTaxV5NotifyDocumentRequest_: logs a bilingual (English +
 * Arabic) communications note whenever a document request is created, so
 * the other party has a record of it — this was a real gap, found by the
 * parity audit: request creation wrote the request row but never touched
 * v3_communications at all. Matches legacy's direction logic (client-facing
 * "Outbound" from firm vs. "Inbound" client-to-firm) and message templates;
 * doesn't send anything (no email infra), same as every other communication
 * in this app — it's a log entry, not a delivery.
 *
 * related_task_id is only set when the request itself is linked to a real
 * task — legacy stuffed the *request* ID into that field with no validation
 * (Sheets has no foreign keys), but v3_communications.related_task_id has a
 * real FK to v3_tasks here, so the request ID doesn't belong there.
 */
async function notifyDocumentRequest(
  actorEmail: string,
  actorRole: string,
  client: { client_id: string; client_name: string; email: string | null },
  data: { requestId: string; taskId: string | null; requestedItem: string; direction: string; dueDate: string | null }
): Promise<void> {
  const inbound = actorRole === "client" || normalizeText(data.direction).includes("client to firm") || normalizeText(data.direction) === "inbound";
  const sentTo = inbound ? null : (client.email || null);
  const clientName = client.client_name || client.client_id;
  const dueText = data.dueDate ? `\nDue: ${data.dueDate}` : "";
  const dueTextAr = data.dueDate ? `\nتاريخ الاستحقاق: ${data.dueDate}` : "";

  const subject = inbound
    ? `${clientName} requested document: ${data.requestedItem} (${data.requestId})`
    : `AL TAX requested document: ${data.requestedItem} (${data.requestId})`;
  const messageEnglish = inbound
    ? `${actorEmail} requested a document from AL TAX for ${clientName}.\n\nRequested item: ${data.requestedItem}${dueText}`
    : `AL TAX requested ${data.requestedItem} from ${clientName}.\n\nPlease upload it from the Client Portal > Documents.${dueText}`;
  const messageArabic = inbound
    ? `تم طلب مستند من AL TAX.\n\nالمستند المطلوب: ${data.requestedItem}${dueTextAr}`
    : `طلبت AL TAX ${data.requestedItem}.\n\nيرجى رفعه من بوابة العميل > المستندات.${dueTextAr}`;

  await query(
    `INSERT INTO altax.v3_communications
       (communication_id, client_id, client_name, related_task_id, direction, channel, subject,
        message_english, message_arabic, sent_to, sent_by, sent_at, status, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,'Portal Note',$6,$7,$8,$9,$10,now(),'Saved','Document Request',$1)`,
    [nextCommunicationId(), client.client_id, clientName, data.taskId, inbound ? "Inbound" : "Outbound",
      subject, messageEnglish, messageArabic, sentTo, actorEmail]
  );
}

/**
 * Create a document request — ported from alTaxV3CreateDocumentRequest_. Admin/staff
 * only: this is the "firm requests a document from the client" direction.
 */
documentsRouter.post("/requests", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const clientId = String(body.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId is required." });

  const client = await queryOne<any>(`SELECT client_id, client_name, email, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: `Client not found: ${clientId}` });

  const requestedItem = String(body.requestedItem || body.notes || "").trim();
  if (!requestedItem) return res.status(400).json({ error: "Requested item / notes is required." });

  const requestId = nextRequestId();
  const direction = String(body.direction || "Outbound").trim();
  const dueDate = String(body.dueDate || "").trim() || null;
  const taskId = String(body.taskId || "").trim() || null;

  await query(
    `INSERT INTO altax.v3_document_requests
       (request_id, task_id, client_id, client_name, requested_item, request_date, due_from_client,
        status, assigned_to, priority, request_type, direction, attachment_link, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10,$11,$12,'Node Web App',$1)`,
    [
      requestId, taskId, client.client_id, client.client_name, requestedItem,
      dueDate, String(body.status || "Requested").trim(),
      String(body.assignedTo || client.assigned_to || "").trim() || null, String(body.priority || "Normal").trim(),
      String(body.requestType || "Document Request").trim(), direction, String(body.attachmentLink || "").trim() || null,
    ]
  );

  await notifyDocumentRequest(req.user!.email, req.user!.role, client, { requestId, taskId, requestedItem, direction, dueDate });

  await logAudit("Documents", "CREATE", requestId, "", "", "Requested", "Document request created from web app.", req.user!.email);

  res.status(201).json({ ok: true, requestId, clientId: client.client_id });
}));

/**
 * List document requests — mirrors the role branches used elsewhere: admin sees
 * everything; client sees only their own client's client-visible requests
 * (isClientVisibleRequest); staff/general see requests assigned to them or tied to a
 * client they have task access to; employee sees none (not populated for that role
 * in the legacy portal filter either).
 */
const REQUEST_FILE_COLUMNS = `
  (SELECT COUNT(*) FROM altax.v3_document_uploads u WHERE u.request_id = r.request_id AND lower(u.status) NOT IN ('removed','replaced'))::int AS file_count,
  (SELECT u.file_name FROM altax.v3_document_uploads u WHERE u.request_id = r.request_id AND lower(u.status) NOT IN ('removed','replaced') ORDER BY u.uploaded_at DESC NULLS LAST LIMIT 1) AS first_file_name,
  (SELECT u.file_url FROM altax.v3_document_uploads u WHERE u.request_id = r.request_id AND lower(u.status) NOT IN ('removed','replaced') ORDER BY u.uploaded_at DESC NULLS LAST LIMIT 1) AS first_file_url
`;

documentsRouter.get("/requests", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;

  if (role === "admin") {
    const rows = await query(`SELECT r.*, ${REQUEST_FILE_COLUMNS} FROM altax.v3_document_requests r ORDER BY r.request_date DESC NULLS LAST`);
    return res.json({ requests: rows });
  }

  if (role === "client") {
    const rows = await query(`SELECT r.*, ${REQUEST_FILE_COLUMNS} FROM altax.v3_document_requests r WHERE r.client_id = $1 ORDER BY r.request_date DESC NULLS LAST`, [req.user!.clientId]);
    return res.json({ requests: rows.filter(isClientVisibleRequest) });
  }

  if (role === "employee") {
    return res.json({ requests: [] });
  }

  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT r.*, ${REQUEST_FILE_COLUMNS} FROM altax.v3_document_requests r
      WHERE lower(r.assigned_to) = ANY($1::text[])
         OR r.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
      ORDER BY r.request_date DESC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ requests: rows });
}));

/** Single document request — access-checked via canAccessDocumentRequest, plus the client-visibility rule for client role. */
documentsRouter.get("/requests/:requestId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const request = await queryOne<any>(`SELECT * FROM altax.v3_document_requests WHERE request_id = $1`, [req.params.requestId]);
  if (!request) return res.status(404).json({ error: "Request not found." });

  if (!(await canAccessDocumentRequest(req.user!, request))) {
    return res.status(403).json({ error: "You do not have access to this request." });
  }
  if (req.user!.role === "client" && !isClientVisibleRequest(request)) {
    return res.status(403).json({ error: "You do not have access to this request." });
  }

  res.json({ request });
}));

const REQUEST_UPDATABLE_FIELDS: Record<string, string> = {
  requestedItem: "requested_item",
  dueFromClient: "due_from_client",
  status: "status",
  receivedDate: "received_date",
  assignedTo: "assigned_to",
  priority: "priority",
  requestType: "request_type",
  direction: "direction",
  attachmentLink: "attachment_link",
};

/**
 * Edit a document request — ported from alTaxPortalUpdateDocumentRequest: allow-listed
 * fields, per-field audit diff. Client role is blocked entirely in legacy ("Client
 * portal cannot edit document request rows."), matching requireRole here.
 */
documentsRouter.patch("/requests/:requestId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { requestId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
  if (!old) return res.status(404).json({ error: "Request not found." });

  if (!(await canAccessDocumentRequest(req.user!, old))) {
    return res.status(403).json({ error: "You do not have access to this request." });
  }

  const body = req.body || {};
  const fields: Record<string, any> = {};
  for (const [key, column] of Object.entries(REQUEST_UPDATABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(body, key)) fields[column] = body[key];
  }
  if (Object.keys(fields).length === 0) return res.status(400).json({ error: "No request fields received." });

  const setClause = Object.keys(fields).map((col, i) => `${col} = $${i + 2}`).join(", ");
  await query(`UPDATE altax.v3_document_requests SET ${setClause}, updated_at = now() WHERE request_id = $1`, [requestId, ...Object.values(fields)]);

  for (const [col, newValue] of Object.entries(fields)) {
    const oldValue = old[col];
    if (String(oldValue ?? "") !== String(newValue ?? "")) {
      await logAudit("Documents", "EDIT", requestId, col, String(oldValue ?? ""), String(newValue ?? ""),
        "Document request edited from web app.", req.user!.email);
    }
  }

  res.json({ ok: true });
}));

/**
 * Change a document request's status — ported from alTaxPortalUpdateDocumentStatus /
 * alTaxV3UpdateDocumentStatus. Unlike the general edit route, this is reachable by
 * client role too (they need to be able to mark things Received), but legacy caps
 * what a client can set it to; ReceivedDate auto-stamps on Received/Completed/Closed.
 */
documentsRouter.post("/requests/:requestId/status", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { requestId } = req.params;
  const newStatus = String((req.body || {}).status || "").trim();
  if (!newStatus) return res.status(400).json({ error: "New status is required." });

  const old = await queryOne<any>(`SELECT * FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
  if (!old) return res.status(404).json({ error: "Request not found." });

  if (!(await canAccessDocumentRequest(req.user!, old))) {
    return res.status(403).json({ error: "You do not have access to this request." });
  }
  if (req.user!.role === "client" && !["Received", "Open", "Requested"].includes(newStatus)) {
    return res.status(400).json({ error: "Client portal can only mark requests as Received, Open, or Requested." });
  }

  const stampReceived = ["Received", "Completed", "Closed"].includes(newStatus);
  await query(
    stampReceived
      ? `UPDATE altax.v3_document_requests SET status = $2, received_date = now(), updated_at = now() WHERE request_id = $1`
      : `UPDATE altax.v3_document_requests SET status = $2, updated_at = now() WHERE request_id = $1`,
    [requestId, newStatus]
  );
  await logAudit("Documents", "STATUS", requestId, "Status", old.status || "", newStatus,
    "Request status updated from web app.", req.user!.email);

  res.json({ ok: true, requestId, status: newStatus });
}));

/**
 * Delete a document request row — legacy's alTaxPortalDeleteDocumentRequest was
 * deliberately NOT ported earlier this session (see module doc comment: hard delete,
 * admin-only, no confirm gate). Now ported at the user's explicit request, with a
 * typed-confirmation gate added as extra safety beyond what legacy had, matching the
 * same pattern used for Tasks' hard-delete. v3_document_uploads.request_id is
 * ON DELETE SET NULL, so any linked files survive as orphaned (request-less) upload
 * rows rather than being silently destroyed.
 */
documentsRouter.post("/requests/:requestId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { requestId } = req.params;
  if (String((req.body || {}).confirm || "").trim() !== "DELETE DOCUMENT") {
    return res.status(400).json({ error: 'Type "DELETE DOCUMENT" to confirm this permanent action.' });
  }
  const old = await queryOne<any>(`SELECT * FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
  if (!old) return res.status(404).json({ error: "Request not found." });

  await query(`DELETE FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
  await logAudit("Documents", "DELETE", requestId, "RequestedItem", old.requested_item || "", "",
    `Document request permanently deleted by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, requestId });
}));

/** Bulk delete — same typed-confirmation gate, used by "Delete Selected Rows" on the Documents list. */
documentsRouter.post("/requests/bulk-delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  if (String(body.confirm || "").trim() !== "DELETE SELECTED") {
    return res.status(400).json({ error: 'Type "DELETE SELECTED" to confirm this permanent action.' });
  }
  const requestIds: string[] = Array.isArray(body.requestIds) ? body.requestIds.map((v: any) => String(v).trim()).filter(Boolean) : [];
  if (!requestIds.length) return res.status(400).json({ error: "No document requests selected." });

  let deleted = 0;
  for (const requestId of requestIds) {
    const old = await queryOne<any>(`SELECT requested_item FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
    if (!old) continue;
    await query(`DELETE FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
    await logAudit("Documents", "DELETE", requestId, "RequestedItem", old.requested_item || "", "",
      `Document request permanently deleted by ${req.user!.email} (bulk).`, req.user!.email);
    deleted += 1;
  }

  res.json({ ok: true, deleted });
}));

/**
 * Upload/link a file — ported from alTaxPortalSaveDocumentUpload, link-only (see module
 * doc comment). Any authenticated role may call this as long as canAccessDocumentRequest
 * passes for the target request, matching legacy's alTaxV5RequirePortalUser_(email, false)
 * (any authenticated user, access enforced per-record rather than per-role). Marks the
 * parent request Received when a client uploads, or when direction is "Client to Firm",
 * or when the caller explicitly asks via markReceived — same as legacy.
 *
 * Also accepts a task-only attachment (taskId instead of requestId) — a file attached
 * directly to a task with no formal document request behind it. Previously out of scope
 * (see module doc comment history); isClientVisibleUpload already anticipated this shape
 * (an upload with a task_id and no request_id is treated as internal-only unless a
 * future need says otherwise), it just had no creation path. Admin/staff only for the
 * task-only case, matching who can otherwise touch a task (canAccessTask's own rule).
 */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8MB raw — mirrors legacy's own small-file-gets-embedded / large-file-gets-a-link split

/**
 * Resolves a real file upload (browsed from disk, sent as base64) vs. a pasted
 * link — legacy did the same split (alTaxPortalSaveDocumentUpload embeds small
 * files as base64 in the sheet, only requiring a pasted Drive link for large
 * ones). Returns the file_url to store: either the caller's pasted link
 * unchanged, or our own download route once the bytes are saved, so every
 * existing consumer of file_url (Command Center's file cell, task attachments,
 * document detail) keeps working without special-casing where the bytes live.
 */
function resolveUploadFile(body: any): { fileUrl: string; fileName: string; fileData: string | null; mimeType: string | null; fileSize: number | null } | { error: string } {
  const fileName = String(body.fileName || "").trim();
  const fileData = String(body.fileData || "").trim();
  if (fileData) {
    const sizeBytes = Math.ceil((fileData.length * 3) / 4);
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      return { error: `That file is too large (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Files over 8MB need to be shared as a link instead.` };
    }
    return { fileUrl: "", fileName: fileName || "Uploaded file", fileData, mimeType: String(body.mimeType || "").trim() || "application/octet-stream", fileSize: sizeBytes };
  }
  const fileUrl = String(body.fileUrl || body.attachmentLink || "").trim();
  if (!fileUrl) return { error: "Choose a file to upload, or paste a document link." };
  return { fileUrl, fileName: fileName || "Linked document", fileData: null, mimeType: null, fileSize: null };
}

documentsRouter.post("/uploads", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const requestId = String(body.requestId || "").trim();
  const taskId = String(body.taskId || "").trim();
  if (!requestId && !taskId) return res.status(400).json({ error: "requestId or taskId is required." });

  const resolved = resolveUploadFile(body);
  if ("error" in resolved) return res.status(400).json({ error: resolved.error });
  const { fileName, fileData, mimeType, fileSize } = resolved;
  let fileUrl = resolved.fileUrl;
  const uploadId = nextUploadId();
  if (fileData) fileUrl = `/documents/uploads/${uploadId}/download`;

  if (requestId) {
    const request = await queryOne<any>(`SELECT * FROM altax.v3_document_requests WHERE request_id = $1`, [requestId]);
    if (!request) return res.status(404).json({ error: `Request not found: ${requestId}` });
    if (!(await canAccessDocumentRequest(req.user!, request))) {
      return res.status(403).json({ error: "You do not have access to this document request." });
    }

    const direction = String(body.direction || (req.user!.role === "client" ? "Client to Firm" : "Firm to Client")).trim();
    await query(
      `INSERT INTO altax.v3_document_uploads
         (upload_id, request_id, task_id, client_id, client_name, file_name, file_url, file_data, mime_type, file_size,
          uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,false,'Node Web App',$1)`,
      [
        uploadId, requestId, request.task_id || null, request.client_id, request.client_name,
        fileName, fileUrl, fileData, mimeType, fileSize, req.user!.email, direction, String(body.status || "Uploaded").trim(),
        String(body.notes || "").trim() || null,
      ]
    );

    const shouldMarkReceived = req.user!.role === "client" || direction.toLowerCase() === "client to firm" || String(body.markReceived || "").toLowerCase() === "yes";
    await query(
      shouldMarkReceived
        ? `UPDATE altax.v3_document_requests SET attachment_link = $2, status = 'Received', received_date = now(), updated_at = now() WHERE request_id = $1`
        : `UPDATE altax.v3_document_requests SET attachment_link = $2, updated_at = now() WHERE request_id = $1`,
      [requestId, fileUrl]
    );
  } else {
    if (!["admin", "staff"].includes(req.user!.role)) {
      return res.status(403).json({ error: "Only AL TAX staff can attach files directly to a task." });
    }
    const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
    if (!task) return res.status(404).json({ error: `Task not found: ${taskId}` });
    const aliases = await getUserAliases(req.user!.email);
    const taskAllowed = req.user!.role === "admin" || isAssignedToUser(task.assigned_to, aliases) || (await canAccessClient(req.user!, task.client_id));
    if (!taskAllowed) return res.status(403).json({ error: "You do not have access to this task." });

    await query(
      `INSERT INTO altax.v3_document_uploads
         (upload_id, request_id, task_id, client_id, client_name, file_name, file_url, file_data, mime_type, file_size,
          uploaded_by, uploaded_at, direction, status, notes, hidden_from_client, source_system, source_record_id)
       VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),'Internal',$11,$12,true,'Node Web App',$1)`,
      [
        uploadId, taskId, task.client_id, task.client_name, fileName, fileUrl, fileData, mimeType, fileSize, req.user!.email,
        String(body.status || "Uploaded").trim(), String(body.notes || "").trim() || null,
      ]
    );
  }

  await logAudit("Documents", "UPLOAD", uploadId, "FileURL", "", fileUrl, "Document uploaded/linked from web app.", req.user!.email);

  res.status(201).json({ ok: true, uploadId, fileUrl });
}));

/**
 * Serves an uploaded file's actual bytes. Deliberately unauthenticated (no
 * requireAuth) — the same trust model legacy used for pasted Drive links
 * ("anyone with the link"), and the uploadId itself is an unguessable
 * timestamp+random string, not a sequential/enumerable ID. This keeps every
 * existing "Open Attachment"/"View File" link working as a plain <a href>
 * across the app without needing bearer-token-aware download logic everywhere.
 */
documentsRouter.get("/uploads/:uploadId/download", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const row = await queryOne<any>(`SELECT file_name, file_data, mime_type FROM altax.v3_document_uploads WHERE upload_id = $1`, [req.params.uploadId]);
  if (!row || !row.file_data) return res.status(404).json({ error: "File not found." });

  res.setHeader("Content-Type", row.mime_type || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${(row.file_name || "file").replace(/"/g, "")}"`);
  res.send(Buffer.from(row.file_data, "base64"));
}));

/**
 * Files attached directly to a task (no document request) — powers the task detail
 * page's attachment list. Tasks are an admin/staff/client concept; employees have no
 * legitimate task visibility at all (tasks.routes.ts's own list route returns [] for
 * the employee role by design), so employee is excluded explicitly here rather than
 * falling through to canAccessClient, which would otherwise match an employee against
 * their own employer's clientId — the same bug class as the billing/document-request
 * fixes, and notably these task-direct uploads default to hidden_from_client=true,
 * meaning this route could otherwise leak internal-only staff attachments.
 */
documentsRouter.get("/uploads/task/:taskId", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (req.user!.role === "employee") return res.status(403).json({ error: "You do not have access to this task." });
  const { taskId } = req.params;
  const task = await queryOne<any>(`SELECT * FROM altax.v3_tasks WHERE task_id = $1`, [taskId]);
  if (!task) return res.status(404).json({ error: "Task not found." });

  const aliases = await getUserAliases(req.user!.email);
  const taskAllowed = req.user!.role === "admin" || isAssignedToUser(task.assigned_to, aliases) || (await canAccessClient(req.user!, task.client_id));
  if (!taskAllowed) return res.status(403).json({ error: "You do not have access to this task." });

  const rows = await query(
    `SELECT * FROM altax.v3_document_uploads WHERE task_id = $1 AND request_id IS NULL ORDER BY uploaded_at DESC NULLS LAST`,
    [taskId]
  );
  res.json({ uploads: rows });
}));

/**
 * List document uploads — client gets only isClientVisibleUpload rows for their own
 * client (computed against their own client-visible requests); staff/general get
 * uploads tied to accessible requests/clients; admin gets everything; employee none.
 */
documentsRouter.get("/uploads", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;
  const requestIdFilter = String(req.query.requestId || "").trim();
  const scoped = (rows: any[]) => (requestIdFilter ? rows.filter((u) => u.request_id === requestIdFilter) : rows);

  if (role === "admin") {
    const rows = await query(`SELECT * FROM altax.v3_document_uploads ORDER BY uploaded_at DESC NULLS LAST`);
    return res.json({ uploads: scoped(rows) });
  }

  if (role === "client") {
    const requests = await query<any>(`SELECT request_id, status, direction, request_type, source_system FROM altax.v3_document_requests WHERE client_id = $1`, [req.user!.clientId]);
    const allowedRequestIds = new Set(requests.filter(isClientVisibleRequest).map((r) => String(r.request_id)));
    const rows = await query<any>(`SELECT * FROM altax.v3_document_uploads WHERE client_id = $1 ORDER BY uploaded_at DESC NULLS LAST`, [req.user!.clientId]);
    return res.json({ uploads: scoped(rows.filter((u) => isClientVisibleUpload(u, allowedRequestIds))) });
  }

  if (role === "employee") {
    return res.json({ uploads: [] });
  }

  const aliases = await getUserAliases(req.user!.email);
  const rows = await query(
    `SELECT u.* FROM altax.v3_document_uploads u
      WHERE lower(u.uploaded_by) = ANY($1::text[])
         OR u.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]))
         OR u.request_id IN (SELECT request_id FROM altax.v3_document_requests WHERE lower(assigned_to) = ANY($1::text[]))
      ORDER BY u.uploaded_at DESC NULLS LAST`,
    [Array.from(aliases)]
  );
  res.json({ uploads: scoped(rows) });
}));

/**
 * Soft-remove an uploaded file — ported from alTaxPortalRemoveDocumentFile. Legacy is
 * already a soft operation (Status=Removed, FileURL cleared, not a row delete), so
 * unlike the hard-delete functions skipped elsewhere, this is safe to port as-is.
 * Client role is blocked ("Client portal cannot delete shared files.").
 */
documentsRouter.post("/uploads/:uploadId/remove", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { uploadId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_document_uploads WHERE upload_id = $1`, [uploadId]);
  if (!old) return res.status(404).json({ error: "Upload not found." });

  if (!(await canAccessClient(req.user!, old.client_id))) {
    return res.status(403).json({ error: "You do not have access to this file." });
  }

  await query(`UPDATE altax.v3_document_uploads SET file_url = '', status = 'Removed', updated_at = now() WHERE upload_id = $1`, [uploadId]);

  if (old.request_id) {
    const nextUpload = await queryOne<any>(
      `SELECT file_url FROM altax.v3_document_uploads
        WHERE request_id = $1 AND upload_id <> $2 AND status NOT IN ('Removed','Replaced','Deleted','Archived') AND file_url <> ''
        ORDER BY uploaded_at DESC LIMIT 1`,
      [old.request_id, uploadId]
    );
    await query(`UPDATE altax.v3_document_requests SET attachment_link = $2, updated_at = now() WHERE request_id = $1`,
      [old.request_id, nextUpload?.file_url || ""]);
  }

  await logAudit("Documents", "REMOVE_FILE", uploadId, "FileURL", old.file_url || "", "",
    "Single document file removed from web app.", req.user!.email);

  res.json({ ok: true, uploadId });
}));

/**
 * Client self-hide — ported from alTaxPortalHideClientDocumentUploads. This is a
 * client-only declutter action on their OWN portal view (sets HiddenFromClient=Yes),
 * not a staff-controlled visibility restriction — legacy explicitly rejects any
 * non-client caller ("Only the client portal can hide files from client view.").
 */
documentsRouter.post("/uploads/hide", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const uploadIds: string[] = Array.isArray((req.body || {}).uploadIds) ? req.body.uploadIds.map((v: any) => String(v).trim()).filter(Boolean) : [];
  if (!uploadIds.length) return res.status(400).json({ error: "No document files selected." });

  const rows = await query<any>(
    `SELECT upload_id, client_id, status FROM altax.v3_document_uploads WHERE upload_id = ANY($1::text[])`,
    [uploadIds]
  );

  let hidden = 0;
  for (const row of rows) {
    if (row.client_id !== req.user!.clientId) continue;
    if (["removed", "deleted", "archived"].includes(normalizeText(row.status))) continue;
    await query(`UPDATE altax.v3_document_uploads SET hidden_from_client = true, updated_at = now() WHERE upload_id = $1`, [row.upload_id]);
    await logAudit("Documents", "CLIENT_HIDE_FILE", row.upload_id, "HiddenFromClient", "", "Yes",
      "Client hid document file from portal view.", req.user!.email);
    hidden += 1;
  }

  res.json({ ok: true, hidden });
}));
