import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";

/**
 * Firm-wide colored labels (name + hex color), reusable across any record type —
 * Tasks and Clients to start. entity_type is a free short code ('task', 'client', ...)
 * rather than a hard enum, so wiring in a new entity type later needs no schema
 * change — only a new frontend call site.
 *
 * The label palette (v3_labels) itself was admin-managed until 2026-09-14 —
 * real owner request that day: staff should be able to create their own
 * label TYPES too ("label the way they want"), not just apply ones admin
 * made. Creating is open to admin+staff; editing/deleting a specific label
 * is admin OR whoever created it (created_by), same "you manage what you
 * made" rule this file already applies to assignments below — a staff
 * member can't rename or delete a colleague's or admin's label type.
 * Deleting a label still cascades everywhere it's been assigned (by
 * anyone), same as it always has for admin.
 */
export const labelsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Labels are assignable to any entity_type, but only 'client' and 'task' are
 * actually client-scoped today (a task belongs to a client; a client is
 * itself the client). Everything else (e.g. a future firm-wide entity type)
 * has no client-scoping model, so it's left unrestricted rather than guessed at.
 */
async function resolveLabelEntityClientId(entityType: string, entityId: string): Promise<string | null> {
  if (entityType === "client") return entityId;
  if (entityType === "task") {
    const task = await queryOne<any>(`SELECT client_id FROM altax.v3_tasks WHERE task_id = $1`, [entityId]);
    return task?.client_id || null;
  }
  return null;
}

async function canAccessLabelEntity(user: AuthedRequest["user"], entityType: string, entityId: string): Promise<boolean> {
  const clientId = await resolveLabelEntityClientId(entityType, entityId);
  if (!clientId) return true;
  return canAccessClient(user!, clientId);
}

labelsRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const labels = await query(`SELECT label_id, name, color, created_by FROM altax.v3_labels ORDER BY name ASC`);
  res.json({ labels });
}));

labelsRouter.post("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const name = String(req.body?.name || "").trim();
  const color = String(req.body?.color || "").trim();
  if (!name) return res.status(400).json({ error: "Label name is required." });
  if (!HEX_COLOR.test(color)) return res.status(400).json({ error: "Color must be a hex value like #0f2d3e." });

  const dupe = await queryOne<any>(`SELECT label_id FROM altax.v3_labels WHERE lower(name) = lower($1)`, [name]);
  if (dupe) return res.status(409).json({ error: `A label named "${name}" already exists.` });

  const labelId = `LBL-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_labels (label_id, name, color, created_by) VALUES ($1,$2,$3,$4)`,
    [labelId, name, color, req.user!.email]
  );
  await logAudit("Labels", "LABEL_CREATED", labelId, "Name", "", name, `Label created by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, labelId });
}));

labelsRouter.patch("/:labelId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { labelId } = req.params;
  const isAdmin = req.user!.role === "admin";
  const old = await queryOne<any>(`SELECT * FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  if (!old) return res.status(404).json({ error: "Label not found." });
  if (!isAdmin && old.created_by !== req.user!.email) {
    return res.status(403).json({ error: "Only the label's creator or an admin can edit it." });
  }

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : old.name;
  const color = req.body?.color !== undefined ? String(req.body.color).trim() : old.color;
  if (!name) return res.status(400).json({ error: "Label name is required." });
  if (!HEX_COLOR.test(color)) return res.status(400).json({ error: "Color must be a hex value like #0f2d3e." });

  const dupe = await queryOne<any>(`SELECT label_id FROM altax.v3_labels WHERE lower(name) = lower($1) AND label_id <> $2`, [name, labelId]);
  if (dupe) return res.status(409).json({ error: `A label named "${name}" already exists.` });

  await query(`UPDATE altax.v3_labels SET name = $2, color = $3, updated_at = now() WHERE label_id = $1`, [labelId, name, color]);
  await logAudit("Labels", "LABEL_UPDATED", labelId, "Name", old.name, name, `Label updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

labelsRouter.post("/:labelId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { labelId } = req.params;
  const isAdmin = req.user!.role === "admin";
  const old = await queryOne<any>(`SELECT name, created_by FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  if (!old) return res.status(404).json({ error: "Label not found." });
  if (!isAdmin && old.created_by !== req.user!.email) {
    return res.status(403).json({ error: "Only the label's creator or an admin can delete it." });
  }
  await query(`DELETE FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  await logAudit("Labels", "LABEL_DELETED", labelId, "Name", old.name, "", `Label deleted by ${req.user!.email} (removed from every record it was on).`, req.user!.email);
  res.json({ ok: true });
}));

/**
 * Every label assignment for an entire entity type in one call, e.g.
 * GET /labels/for/task — the frontend builds an entity_id -> labels[] map
 * client-side rather than this route taking N ids, so a list page (Tasks,
 * Clients) needs exactly one request no matter how many rows it's showing.
 */
labelsRouter.get("/for/:entityType", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType } = req.params;
  const isAdmin = req.user!.role === "admin";

  // 'client' and 'task' assignments are client-scoped; a non-admin staff user
  // only gets back the rows for clients they can actually access (same rule
  // as canAccessClient's task-assignment check), not every client's labels.
  // Real owner request, 2026-09-14: on top of that, a staff member only ever
  // sees labels THEY assigned — not another staff member's or admin's tags
  // on the same record. Admin still sees every assignment from everyone.
  if (entityType === "client" && !isAdmin) {
    const aliases = await getUserAliases(req.user!.email);
    const rows = await query(
      `SELECT el.entity_id, el.label_id, l.name, l.color, el.assigned_by, el.assigned_at
         FROM altax.v3_entity_labels el
         JOIN altax.v3_labels l ON l.label_id = el.label_id
        WHERE el.entity_type = 'client' AND el.assigned_by = $2
          AND el.entity_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id IS NOT NULL)
        ORDER BY l.name ASC`,
      [Array.from(aliases), req.user!.email]
    );
    return res.json({ assignments: rows });
  }
  if (entityType === "task" && !isAdmin) {
    const aliases = await getUserAliases(req.user!.email);
    const rows = await query(
      `SELECT el.entity_id, el.label_id, l.name, l.color, el.assigned_by, el.assigned_at
         FROM altax.v3_entity_labels el
         JOIN altax.v3_labels l ON l.label_id = el.label_id
         JOIN altax.v3_tasks t ON t.task_id = el.entity_id
        WHERE el.entity_type = 'task' AND el.assigned_by = $2
          AND t.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id IS NOT NULL)
        ORDER BY l.name ASC`,
      [Array.from(aliases), req.user!.email]
    );
    return res.json({ assignments: rows });
  }

  const params: any[] = [entityType];
  let where = `el.entity_type = $1`;
  if (!isAdmin) { params.push(req.user!.email); where += ` AND el.assigned_by = $${params.length}`; }
  const rows = await query(
    `SELECT el.entity_id, el.label_id, l.name, l.color, el.assigned_by, el.assigned_at
       FROM altax.v3_entity_labels el
       JOIN altax.v3_labels l ON l.label_id = el.label_id
      WHERE ${where}
      ORDER BY l.name ASC`,
    params
  );
  res.json({ assignments: rows });
}));

labelsRouter.get("/for/:entityType/:entityId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId } = req.params;
  const isAdmin = req.user!.role === "admin";
  if (!(await canAccessLabelEntity(req.user, entityType, entityId))) {
    return res.status(403).json({ error: "You do not have access to this record." });
  }
  const params: any[] = [entityType, entityId];
  let where = `el.entity_type = $1 AND el.entity_id = $2`;
  // Same author-only scoping as the bulk route above — a staff member only
  // sees the labels they themselves put on this record.
  if (!isAdmin) { params.push(req.user!.email); where += ` AND el.assigned_by = $${params.length}`; }
  const rows = await query(
    `SELECT l.label_id, l.name, l.color, el.assigned_by, el.assigned_at
       FROM altax.v3_entity_labels el
       JOIN altax.v3_labels l ON l.label_id = el.label_id
      WHERE ${where}
      ORDER BY l.name ASC`,
    params
  );
  res.json({ labels: rows });
}));

labelsRouter.post("/for/:entityType/:entityId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId } = req.params;
  if (!(await canAccessLabelEntity(req.user, entityType, entityId))) {
    return res.status(403).json({ error: "You do not have access to this record." });
  }
  const labelId = String(req.body?.labelId || "").trim();
  if (!labelId) return res.status(400).json({ error: "labelId is required." });
  const label = await queryOne<any>(`SELECT label_id FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  if (!label) return res.status(404).json({ error: "Label not found." });

  await query(
    `INSERT INTO altax.v3_entity_labels (entity_type, entity_id, label_id, assigned_by)
     VALUES ($1,$2,$3,$4) ON CONFLICT (entity_type, entity_id, label_id, assigned_by) DO NOTHING`,
    [entityType, entityId, labelId, req.user!.email]
  );
  res.json({ ok: true });
}));

labelsRouter.post("/for/:entityType/:entityId/:labelId/remove", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId, labelId } = req.params;
  const isAdmin = req.user!.role === "admin";
  if (!(await canAccessLabelEntity(req.user, entityType, entityId))) {
    return res.status(403).json({ error: "You do not have access to this record." });
  }
  // A staff member can only remove a label THEY assigned — they can't see
  // another staff member's or admin's tag on this record (GET routes above
  // already scope that out), so they shouldn't be able to blindly delete it
  // by label id either. Since two different people can now independently
  // tag the same entity with the same label (the primary key widened to
  // include assigned_by — sql/155), admin passes back WHICH assignment to
  // remove (the chip it clicked carries its own assignedBy); omitting it
  // falls back to removing every assignment of that label on this record,
  // for any caller that hasn't been updated to send it.
  const targetAssignedBy = String(req.body?.assignedBy || "").trim() || null;
  const params: any[] = [entityType, entityId, labelId];
  let where = `entity_type = $1 AND entity_id = $2 AND label_id = $3`;
  if (!isAdmin) { params.push(req.user!.email); where += ` AND assigned_by = $${params.length}`; }
  else if (targetAssignedBy) { params.push(targetAssignedBy); where += ` AND assigned_by = $${params.length}`; }
  await query(`DELETE FROM altax.v3_entity_labels WHERE ${where}`, params);
  res.json({ ok: true });
}));
