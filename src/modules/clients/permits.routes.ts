/**
 * Permit tracker — the approvals a business needs before (and while) it operates at a location, each with a
 * status, number, issue/expiry date and notes: zoning use permit, certificate of occupancy, fire marshal
 * inspection, health permit, trader's license and tobacco license.
 *
 * The permit NUMBERS live on v3_clients (use_and_occupancy_number, fire_dept_permit_number, ...), the same
 * columns the Client Profile edits and the Health Permits generator reads, so a number is typed once and shows
 * everywhere. v3_client_permits only stores progress (status, dates, notes). See sql/179_client_permit_tracker.sql.
 */
import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { canAccessClient } from "../../common/assignment";
import { logAudit } from "../../common/audit";

export const permitsRouter = Router();

export const PERMIT_STATUSES = ["Not Started", "Applied", "Scheduled", "Issued", "Not Required"] as const;

/** Display order matches the real sequence: zoning first, then the certificate of occupancy and inspections, then the operating licenses. */
export const PERMIT_DEFS: { key: string; label: string; column: string; hint: string }[] = [
  { key: "zoning_use", label: "Zoning Use Permit", column: "zoning_use_permit_number", hint: "Issued by the County zoning office; it names the approved use of the space." },
  { key: "occupancy", label: "Certificate of Occupancy (Use & Occupancy)", column: "use_and_occupancy_number", hint: "The commercial certificate of occupancy for the address. Printed on the City's Plan Review Application." },
  { key: "fire_inspection", label: "Fire Marshal Inspection / Permit", column: "fire_dept_permit_number", hint: "Schedule with the Fire Marshal's Office after the zoning and occupancy approvals." },
  { key: "health", label: "Health Permit", column: "health_permit_license_number", hint: "County Food Service Facility Permit or City Food Facility License." },
  { key: "traders", label: "Trader's License", column: "traders_license_number", hint: "Issued by the Clerk of the Circuit Court." },
  { key: "tobacco", label: "Tobacco License", column: "tobacco_license_number", hint: "Maryland license — only if the store sells tobacco." },
];
const BY_KEY = new Map(PERMIT_DEFS.map((d) => [d.key, d]));

function isoOrNull(v: unknown): string | null {
  if (!v) return null;
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

permitsRouter.get("/:clientId/permits", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = await queryOne<any>(
    `SELECT ${PERMIT_DEFS.map((d) => d.column).join(", ")} FROM altax.v3_clients WHERE client_id = $1`, [clientId]
  );
  if (!client) return res.status(404).json({ error: "Client not found." });
  const rows = await query<any>(
    `SELECT permit_key, status, issued_date::text AS issued_date, expires_date::text AS expires_date, notes, updated_by, updated_at
       FROM altax.v3_client_permits WHERE client_id = $1`, [clientId]
  );
  const byKey = new Map(rows.map((r: any) => [r.permit_key, r]));
  const openTask = await queryOne<any>(
    `SELECT task_id FROM altax.v3_tasks WHERE client_id = $1 AND source_system = 'Permit Tracker' AND source_record_id = $2
        AND lower(status) NOT IN ('completed','void','closed','archived') LIMIT 1`,
    [clientId, `${clientId}:fire_inspection`]
  );
  res.json({
    permits: PERMIT_DEFS.map((d) => {
      const r = byKey.get(d.key);
      const number = client[d.column] ? String(client[d.column]) : "";
      // Having a number but no recorded status means it was entered on the profile before this tracker existed.
      const status = r?.status || (number ? "Issued" : "Not Started");
      return { key: d.key, label: d.label, hint: d.hint, number, status, issuedDate: r?.issued_date || null, expiresDate: r?.expires_date || null, notes: r?.notes || "", updatedBy: r?.updated_by || null, updatedAt: r?.updated_at || null };
    }),
    statuses: PERMIT_STATUSES,
    fireInspectionTaskOpen: Boolean(openTask),
  });
}));

permitsRouter.put("/:clientId/permits/:permitKey", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, permitKey } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const def = BY_KEY.get(permitKey);
  if (!def) return res.status(400).json({ error: "Unknown permit." });
  const body = req.body || {};
  const status = String(body.status || "Not Started");
  if (!(PERMIT_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: "Unknown status." });
  const number = String(body.number ?? "").trim().slice(0, 255);
  const issuedDate = isoOrNull(body.issuedDate);
  const expiresDate = isoOrNull(body.expiresDate);
  if (body.issuedDate && !issuedDate) return res.status(400).json({ error: "Issue date must be YYYY-MM-DD." });
  if (body.expiresDate && !expiresDate) return res.status(400).json({ error: "Expiry date must be YYYY-MM-DD." });
  if (status === "Issued" && !number && permitKey !== "fire_inspection") {
    return res.status(400).json({ error: "Enter the permit number before marking it Issued." });
  }

  const before = await queryOne<any>(`SELECT ${def.column} AS value FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!before) return res.status(404).json({ error: "Client not found." });

  await query(`UPDATE altax.v3_clients SET ${def.column} = $2, updated_at = now() WHERE client_id = $1`, [clientId, number || null]);
  await query(
    `INSERT INTO altax.v3_client_permits (client_id, permit_key, status, issued_date, expires_date, notes, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (client_id, permit_key) DO UPDATE SET status = EXCLUDED.status, issued_date = EXCLUDED.issued_date,
       expires_date = EXCLUDED.expires_date, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [clientId, permitKey, status, issuedDate, expiresDate, String(body.notes ?? "").trim() || null, req.user!.email]
  );
  await logAudit("Clients", "PERMIT_TRACKER_UPDATED", clientId, def.label, String(before.value || ""), number,
    `${def.label}: ${status}${number ? ` (${number})` : ""} updated by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

/** Creates the "schedule the fire inspection" task once (a second click returns the one already open). */
permitsRouter.post("/:clientId/permits/fire-inspection-task", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  if (!(await canAccessClient(req.user!, clientId))) return res.status(403).json({ error: "You do not have access to this client." });
  const client = await queryOne<any>(
    `SELECT client_name, assigned_to, street_address, city, zip_code, use_and_occupancy_number, zoning_use_permit_number FROM altax.v3_clients WHERE client_id = $1`, [clientId]
  );
  if (!client) return res.status(404).json({ error: "Client not found." });
  const sourceRecordId = `${clientId}:fire_inspection`;
  const existing = await queryOne<any>(
    `SELECT task_id FROM altax.v3_tasks WHERE client_id = $1 AND source_system = 'Permit Tracker' AND source_record_id = $2
        AND lower(status) NOT IN ('completed','void','closed','archived') LIMIT 1`, [clientId, sourceRecordId]
  );
  if (existing) return res.json({ ok: true, taskId: existing.task_id, created: false });

  const taskId = `TASK-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
  const refs = [client.zoning_use_permit_number ? `Zoning Use Permit ${client.zoning_use_permit_number}` : "", client.use_and_occupancy_number ? `Certificate of Occupancy ${client.use_and_occupancy_number}` : ""].filter(Boolean).join("; ");
  await query(
    `INSERT INTO altax.v3_tasks
       (task_id, client_id, client_name, service_line, task_name, period, status, assigned_to, notes, source_system, source_record_id)
     VALUES ($1,$2,$3,'Compliance','Schedule fire inspection with the Fire Marshal''s Office','New Occupancy','Not Started',$4,$5,'Permit Tracker',$6)`,
    [taskId, clientId, client.client_name, client.assigned_to || req.user!.email,
      `Contact the Fire Marshal's Office to schedule the fire inspection for the new occupancy at ${[client.street_address, client.city, client.zip_code].filter(Boolean).join(", ") || "the business address"}.` +
        `${refs ? ` Attach/reference: ${refs}.` : ""} When the inspection or permit number is issued, enter it in this client's Permits & Compliance tab.`,
      sourceRecordId]
  );
  await logAudit("Clients", "PERMIT_FIRE_INSPECTION_TASK_CREATED", clientId, "", "", taskId, `Fire inspection task created by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, taskId, created: true });
}));
