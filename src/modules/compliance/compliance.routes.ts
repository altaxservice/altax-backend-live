import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { generateWispPdf } from "./wispPdf";

export const complianceRouter = Router();

/** Singleton row, same pattern as firmProfile.ts's v3_firm_settings — created on first read if it doesn't exist yet. */
async function ensureWispSettings(): Promise<{ coordinator_names: string; adopted_date: string; last_reviewed_date: string }> {
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_wisp_settings WHERE id = 'WISP-1'`);
  if (existing) return existing;
  const created = await queryOne<any>(
    `INSERT INTO altax.v3_wisp_settings (id) VALUES ('WISP-1') ON CONFLICT (id) DO NOTHING RETURNING *`
  );
  return created || (await queryOne<any>(`SELECT * FROM altax.v3_wisp_settings WHERE id = 'WISP-1'`));
}

function toDateStr(v: any): string {
  return v ? new Date(v).toISOString().slice(0, 10) : "";
}

/**
 * Returns the current WISP settings, the caller's own acknowledgment status for the
 * current version (version = last_reviewed_date — bumping that date via "Mark
 * Reviewed Today" requires everyone to re-acknowledge), and — admin only — the full
 * staff roster's acknowledgment status, so an admin can see at a glance who still
 * needs to read it.
 */
complianceRouter.get("/wisp/meta", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const settings = await ensureWispSettings();
  const version = toDateStr(settings.last_reviewed_date);

  const myAck = await queryOne<any>(
    `SELECT acknowledged_at FROM altax.v3_wisp_acknowledgments WHERE user_id = $1 AND version = $2`,
    [req.user!.sub, version]
  );

  let roster: any[] | undefined;
  if (req.user!.role === "admin") {
    const staff = await query<any>(
      `SELECT user_id, name, email, role FROM altax.v3_users WHERE lower(role) IN ('admin','staff') AND active = true ORDER BY name ASC`
    );
    const acks = await query<any>(
      `SELECT user_id, acknowledged_at FROM altax.v3_wisp_acknowledgments WHERE version = $1`,
      [version]
    );
    const ackByUser = new Map(acks.map((a) => [a.user_id, a.acknowledged_at]));
    roster = staff.map((u) => ({
      userId: u.user_id, name: u.name, email: u.email, role: u.role,
      acknowledged: ackByUser.has(u.user_id),
      acknowledgedAt: ackByUser.get(u.user_id) || null,
    }));
  }

  res.json({
    coordinatorNames: settings.coordinator_names,
    adoptedDate: toDateStr(settings.adopted_date),
    lastReviewedDate: version,
    myAcknowledgment: { acknowledged: Boolean(myAck), acknowledgedAt: myAck?.acknowledged_at || null },
    roster,
  });
}));

/** Admin-only: edit the coordinator names, and/or bump last_reviewed_date to today (the annual-review action, which requires everyone to re-acknowledge). */
complianceRouter.patch("/wisp/settings", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const existing = await ensureWispSettings();
  const coordinatorNames = String(body.coordinatorNames ?? existing.coordinator_names ?? "").trim() || existing.coordinator_names;
  const lastReviewedDate = body.markReviewedToday ? new Date().toISOString().slice(0, 10) : toDateStr(existing.last_reviewed_date);

  await query(
    `UPDATE altax.v3_wisp_settings SET coordinator_names = $1, last_reviewed_date = $2, updated_at = now(), updated_by = $3 WHERE id = 'WISP-1'`,
    [coordinatorNames, lastReviewedDate, req.user!.email]
  );
  await logAudit("Compliance", "EDIT", "WISP-1", "LastReviewedDate", toDateStr(existing.last_reviewed_date), lastReviewedDate,
    `WISP settings updated by ${req.user!.email}.${body.markReviewedToday ? " Marked reviewed today — staff must re-acknowledge." : ""}`, req.user!.email);

  res.json({ ok: true, coordinatorNames, adoptedDate: toDateStr(existing.adopted_date), lastReviewedDate });
}));

/** Any staff/admin acknowledges having read the current version of the WISP. Idempotent — re-acknowledging the same version just no-ops. */
complianceRouter.post("/wisp/acknowledge", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const settings = await ensureWispSettings();
  const version = toDateStr(settings.last_reviewed_date);
  await query(
    `INSERT INTO altax.v3_wisp_acknowledgments (user_id, version, acknowledged_at) VALUES ($1,$2, now())
     ON CONFLICT (user_id, version) DO NOTHING`,
    [req.user!.sub, version]
  );
  await logAudit("Compliance", "WISP_ACKNOWLEDGE", req.user!.sub, "", "", version,
    `${req.user!.email} acknowledged the WISP (version ${version}).`, req.user!.email);
  res.json({ ok: true, version });
}));

/** Generates the WISP PDF fresh on every request from the current firm profile + WISP settings, so it's always in sync — no separate stored copy to go stale. */
complianceRouter.get("/wisp/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const settings = await ensureWispSettings();
  const pdfBytes = await generateWispPdf({
    coordinatorNames: settings.coordinator_names,
    adoptedDate: toDateStr(settings.adopted_date),
    lastReviewedDate: toDateStr(settings.last_reviewed_date),
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="WISP.pdf"`);
  res.send(Buffer.from(pdfBytes));
}));
