import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";

/**
 * Document checklist templates — an internal "did we collect everything we
 * need" tracker per engagement type, distinct from Document Requests (which
 * ask the CLIENT to upload something). Admin manages templates here; the
 * per-client progress tracker lives in clients.routes.ts-adjacent territory
 * but is served from this module since it's the same data model.
 */
export const checklistsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

async function loadTemplates(activeOnly = false) {
  const checklists = await query<any>(
    `SELECT * FROM altax.v3_document_checklists ${activeOnly ? "WHERE active = true" : ""} ORDER BY name ASC`
  );
  const items = await query<any>(`SELECT * FROM altax.v3_document_checklist_items ORDER BY sort_order ASC, created_at ASC`);
  return checklists.map((c: any) => ({ ...c, items: items.filter((i: any) => i.checklist_id === c.checklist_id) }));
}

/* ------------------------------------------------------------------ */
/* Templates (admin-managed)                                          */
/* ------------------------------------------------------------------ */

checklistsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  res.json({ checklists: await loadTemplates() });
}));

checklistsRouter.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const b = req.body || {};
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  const checklistId = `CHK-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_document_checklists (checklist_id, name, client_type, service_key, active) VALUES ($1,$2,$3,$4,true)`,
    [checklistId, name, String(b.clientType || "").trim() || null, String(b.serviceKey || "").trim() || null]
  );
  await logAudit("Checklists", "CREATE_TEMPLATE", checklistId, "", "", name, `Checklist template created by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, checklistId });
}));

checklistsRouter.post("/:checklistId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { checklistId } = req.params;
  const existing = await queryOne<any>(`SELECT name FROM altax.v3_document_checklists WHERE checklist_id = $1`, [checklistId]);
  if (!existing) return res.status(404).json({ error: "Checklist not found." });
  await query(`DELETE FROM altax.v3_document_checklists WHERE checklist_id = $1`, [checklistId]);
  await logAudit("Checklists", "DELETE_TEMPLATE", checklistId, "", existing.name, "", `Checklist template deleted by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

checklistsRouter.post("/:checklistId/items", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { checklistId } = req.params;
  const documentName = String(req.body?.documentName || "").trim();
  if (!documentName) return res.status(400).json({ error: "Document name is required." });
  const checklist = await queryOne<any>(`SELECT checklist_id FROM altax.v3_document_checklists WHERE checklist_id = $1`, [checklistId]);
  if (!checklist) return res.status(404).json({ error: "Checklist not found." });
  const countRow = await queryOne<any>(`SELECT COUNT(*)::int AS n FROM altax.v3_document_checklist_items WHERE checklist_id = $1`, [checklistId]);
  const itemId = `CHKI-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_document_checklist_items (item_id, checklist_id, document_name, sort_order) VALUES ($1,$2,$3,$4)`,
    [itemId, checklistId, documentName, Number(countRow?.n || 0)]
  );
  res.status(201).json({ ok: true, itemId });
}));

checklistsRouter.post("/:checklistId/items/:itemId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { checklistId, itemId } = req.params;
  await query(`DELETE FROM altax.v3_document_checklist_items WHERE item_id = $1 AND checklist_id = $2`, [itemId, checklistId]);
  res.json({ ok: true });
}));

/* ------------------------------------------------------------------ */
/* Per-client progress                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lazily syncs this client's progress rows against every currently-matching
 * active template (client_type match-or-NULL, service_key match-or-NULL
 * against the client's own `services` text[]) before reading them back — so
 * editing a template, or changing which services a client is checked for,
 * is reflected the next time this tracker is opened, without a separate
 * "apply" action or a save-time hook to keep in sync.
 */
async function syncAndLoadProgress(clientId: string) {
  const client = await queryOne<any>(`SELECT client_type, services FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return null;
  const clientServices: string[] = Array.isArray(client.services) ? client.services : [];

  const templates = await loadTemplates(true);
  const matching = templates.filter((t: any) => {
    const typeOk = !t.client_type || t.client_type === client.client_type;
    const serviceOk = !t.service_key || clientServices.includes(t.service_key);
    return typeOk && serviceOk;
  });

  for (const t of matching) {
    for (const item of t.items) {
      await query(
        `INSERT INTO altax.v3_client_checklist_progress (progress_id, client_id, checklist_id, item_id, checked)
         VALUES ($1,$2,$3,$4,false)
         ON CONFLICT (client_id, item_id) DO NOTHING`,
        [`PROG-${idSuffix()}-${Math.floor(Math.random() * 1000)}`, clientId, t.checklist_id, item.item_id]
      );
    }
  }

  const rows = await query<any>(
    `SELECT p.*, i.document_name, i.checklist_id AS item_checklist_id, c.name AS checklist_name,
            u.file_name AS linked_file_name, u.uploaded_at AS linked_uploaded_at
       FROM altax.v3_client_checklist_progress p
       JOIN altax.v3_document_checklist_items i ON i.item_id = p.item_id
       JOIN altax.v3_document_checklists c ON c.checklist_id = i.checklist_id
       LEFT JOIN altax.v3_document_uploads u ON u.upload_id = p.linked_upload_id
      WHERE p.client_id = $1
      ORDER BY c.name ASC, i.sort_order ASC`,
    [clientId]
  );
  return rows;
}

checklistsRouter.get("/clients/:clientId/checklist", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "Not authorized for this client." });
  const rows = await syncAndLoadProgress(clientId);
  if (rows === null) return res.status(404).json({ error: "Client not found." });
  res.json({ progress: rows });
}));

/** Feeds the "link an existing document" picker on the toggle-checked flow — kept as its own small, client-scoped query here rather than widening documents.routes.ts's shared /uploads listing. */
checklistsRouter.get("/clients/:clientId/available-uploads", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "Not authorized for this client." });
  const rows = await query<any>(
    `SELECT upload_id, file_name, uploaded_at FROM altax.v3_document_uploads WHERE client_id = $1 AND status <> 'Removed' ORDER BY uploaded_at DESC NULLS LAST`,
    [clientId]
  );
  res.json({ uploads: rows });
}));

/**
 * TAX-008 (Hard Audit, 2026-08-13) — the checklist tracker was entirely
 * disconnected from real evidence: checking an item was a bare boolean flip,
 * and the schema's own linked_upload_id column (sql/018) was defined but
 * never read or written anywhere. Staff toggling this "collected" checkbox
 * had no way to prove it, and a client's actual uploaded document never
 * reflected back onto it. This wires that column: an optional linkedUploadId
 * is validated against this same client's own v3_document_uploads before
 * being stored, so a checked item can now point at a real file. Linking
 * stays optional (not required) — some items are legitimately confirmed by
 * other means (a phone call, a paper copy on file) — but when a real upload
 * exists, staff can now attach it instead of the checkbox floating free.
 */
checklistsRouter.post("/clients/:clientId/checklist/:progressId/toggle", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, progressId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "Not authorized for this client." });
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_checklist_progress WHERE progress_id = $1 AND client_id = $2`, [progressId, clientId]);
  if (!row) return res.status(404).json({ error: "Checklist item not found for this client." });
  const checked = !row.checked;

  let linkedUploadId: string | null = null;
  if (checked) {
    const requested = String(req.body?.linkedUploadId || "").trim();
    if (requested) {
      const upload = await queryOne<any>(`SELECT upload_id FROM altax.v3_document_uploads WHERE upload_id = $1 AND client_id = $2`, [requested, clientId]);
      if (!upload) return res.status(400).json({ error: "That document isn't on file for this client." });
      linkedUploadId = requested;
    }
  }

  await query(
    `UPDATE altax.v3_client_checklist_progress SET checked = $2, checked_at = $3, checked_by = $4, linked_upload_id = $5 WHERE progress_id = $1`,
    [progressId, checked, checked ? new Date() : null, checked ? req.user!.email : null, linkedUploadId]
  );
  res.json({ ok: true, checked, linkedUploadId });
}));
