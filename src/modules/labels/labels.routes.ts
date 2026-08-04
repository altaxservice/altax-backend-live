import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient, getUserAliases } from "../../common/assignment";

/**
 * Firm-wide colored labels (name + hex color), reusable across any record type —
 * Tasks and Clients to start. The label palette itself (v3_labels) is admin-managed,
 * same "firm-wide config, admin edits it" shape as List Settings; assigning an
 * existing label to a record is open to admin+staff, same as everything else they
 * already edit day to day. entity_type is a free short code ('task', 'client', ...)
 * rather than a hard enum, so wiring in a new entity type later needs no schema
 * change — only a new frontend call site.
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
  const labels = await query(`SELECT label_id, name, color FROM altax.v3_labels ORDER BY name ASC`);
  res.json({ labels });
}));

labelsRouter.post("/", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
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
  await logAudit("Labels", "LABEL_CREATED", labelId, "Name", "", name, "Label created.", req.user!.email);
  res.status(201).json({ ok: true, labelId });
}));

labelsRouter.patch("/:labelId", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { labelId } = req.params;
  const old = await queryOne<any>(`SELECT * FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  if (!old) return res.status(404).json({ error: "Label not found." });

  const name = req.body?.name !== undefined ? String(req.body.name).trim() : old.name;
  const color = req.body?.color !== undefined ? String(req.body.color).trim() : old.color;
  if (!name) return res.status(400).json({ error: "Label name is required." });
  if (!HEX_COLOR.test(color)) return res.status(400).json({ error: "Color must be a hex value like #0f2d3e." });

  const dupe = await queryOne<any>(`SELECT label_id FROM altax.v3_labels WHERE lower(name) = lower($1) AND label_id <> $2`, [name, labelId]);
  if (dupe) return res.status(409).json({ error: `A label named "${name}" already exists.` });

  await query(`UPDATE altax.v3_labels SET name = $2, color = $3, updated_at = now() WHERE label_id = $1`, [labelId, name, color]);
  await logAudit("Labels", "LABEL_UPDATED", labelId, "Name", old.name, name, "Label updated.", req.user!.email);
  res.json({ ok: true });
}));

labelsRouter.post("/:labelId/delete", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { labelId } = req.params;
  const old = await queryOne<any>(`SELECT name FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  if (!old) return res.status(404).json({ error: "Label not found." });
  await query(`DELETE FROM altax.v3_labels WHERE label_id = $1`, [labelId]);
  await logAudit("Labels", "LABEL_DELETED", labelId, "Name", old.name, "", "Label deleted (removed from every record it was on).", req.user!.email);
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

  // 'client' and 'task' assignments are client-scoped; a non-admin staff user
  // only gets back the rows for clients they can actually access (same rule
  // as canAccessClient's task-assignment check), not every client's labels.
  if (entityType === "client" && req.user!.role !== "admin") {
    const aliases = await getUserAliases(req.user!.email);
    const rows = await query(
      `SELECT el.entity_id, el.label_id, l.name, l.color
         FROM altax.v3_entity_labels el
         JOIN altax.v3_labels l ON l.label_id = el.label_id
        WHERE el.entity_type = 'client'
          AND el.entity_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id IS NOT NULL)
        ORDER BY l.name ASC`,
      [Array.from(aliases)]
    );
    return res.json({ assignments: rows });
  }
  if (entityType === "task" && req.user!.role !== "admin") {
    const aliases = await getUserAliases(req.user!.email);
    const rows = await query(
      `SELECT el.entity_id, el.label_id, l.name, l.color
         FROM altax.v3_entity_labels el
         JOIN altax.v3_labels l ON l.label_id = el.label_id
         JOIN altax.v3_tasks t ON t.task_id = el.entity_id
        WHERE el.entity_type = 'task'
          AND t.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($1::text[]) AND client_id IS NOT NULL)
        ORDER BY l.name ASC`,
      [Array.from(aliases)]
    );
    return res.json({ assignments: rows });
  }

  const rows = await query(
    `SELECT el.entity_id, el.label_id, l.name, l.color
       FROM altax.v3_entity_labels el
       JOIN altax.v3_labels l ON l.label_id = el.label_id
      WHERE el.entity_type = $1
      ORDER BY l.name ASC`,
    [entityType]
  );
  res.json({ assignments: rows });
}));

labelsRouter.get("/for/:entityType/:entityId", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId } = req.params;
  if (!(await canAccessLabelEntity(req.user, entityType, entityId))) {
    return res.status(403).json({ error: "You do not have access to this record." });
  }
  const rows = await query(
    `SELECT l.label_id, l.name, l.color
       FROM altax.v3_entity_labels el
       JOIN altax.v3_labels l ON l.label_id = el.label_id
      WHERE el.entity_type = $1 AND el.entity_id = $2
      ORDER BY l.name ASC`,
    [entityType, entityId]
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
     VALUES ($1,$2,$3,$4) ON CONFLICT (entity_type, entity_id, label_id) DO NOTHING`,
    [entityType, entityId, labelId, req.user!.email]
  );
  res.json({ ok: true });
}));

labelsRouter.post("/for/:entityType/:entityId/:labelId/remove", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { entityType, entityId, labelId } = req.params;
  if (!(await canAccessLabelEntity(req.user, entityType, entityId))) {
    return res.status(403).json({ error: "You do not have access to this record." });
  }
  await query(
    `DELETE FROM altax.v3_entity_labels WHERE entity_type = $1 AND entity_id = $2 AND label_id = $3`,
    [entityType, entityId, labelId]
  );
  res.json({ ok: true });
}));
