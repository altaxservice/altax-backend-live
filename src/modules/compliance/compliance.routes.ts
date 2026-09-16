import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { generateWispPdf } from "./wispPdf";
import { writeUploadBlob, readUploadBlob } from "../../common/uploadBlobStorage";

export const complianceRouter = Router();

/**
 * Singleton row, same pattern as firmProfile.ts's v3_firm_settings. Every call
 * also ensures the CURRENT version has a frozen snapshot on file — cheap to
 * call every time since ensureWispSnapshot no-ops once one exists — so a
 * settings row from before snapshotting existed (or a snapshot write that
 * somehow never landed) self-heals instead of leaving /wisp/pdf 404ing.
 */
async function ensureWispSettings(): Promise<{ coordinator_names: string; adopted_date: string; last_reviewed_date: string }> {
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_wisp_settings WHERE id = 'WISP-1'`);
  const settings = existing || (await queryOne<any>(
    `INSERT INTO altax.v3_wisp_settings (id) VALUES ('WISP-1') ON CONFLICT (id) DO NOTHING RETURNING *`
  )) || (await queryOne<any>(`SELECT * FROM altax.v3_wisp_settings WHERE id = 'WISP-1'`));
  await ensureWispSnapshot(toDateStr(settings.last_reviewed_date), settings, "system");
  return settings;
}

function toDateStr(v: any): string {
  return v ? new Date(v).toISOString().slice(0, 10) : "";
}

/**
 * Freezes the exact PDF bytes for a version if no snapshot exists yet — an
 * acknowledgment always points at one of these, never at a live-regenerated
 * PDF, so a later edit to the policy text can't silently change what an
 * earlier acknowledgment appears to cover. No-ops if this version was
 * already frozen (idempotent, matching every other "ensure" helper in this
 * codebase — e.g. eftpsStaffTasks.ts's ensureEftpsStaffTasks).
 */
async function ensureWispSnapshot(
  version: string,
  settings: { coordinator_names: string; adopted_date: string },
  createdBy: string
): Promise<void> {
  const existing = await queryOne<any>(`SELECT version FROM altax.v3_wisp_snapshots WHERE version = $1`, [version]);
  if (existing) return;
  const pdfBytes = await generateWispPdf({
    coordinatorNames: settings.coordinator_names,
    adoptedDate: toDateStr(settings.adopted_date),
    lastReviewedDate: version,
  });
  const base64 = Buffer.from(pdfBytes).toString("base64");
  const { fileData, blobBackend } = await writeUploadBlob(`wisp-${version}`, base64);
  await query(
    `INSERT INTO altax.v3_wisp_snapshots (version, file_data, blob_backend, file_size, created_by)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (version) DO NOTHING`,
    [version, fileData, blobBackend, pdfBytes.length, createdBy]
  );
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

/**
 * Admin-only: edit the coordinator names, and/or bump last_reviewed_date to today
 * (the annual-review action). Editing coordinator names alone does NOT freeze a new
 * snapshot or reset acknowledgments — it only takes effect in the frozen record the
 * next time the plan is actually marked reviewed, so an already-acknowledged version
 * can never be rewritten out from under the people who signed off on it.
 */
complianceRouter.patch("/wisp/settings", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const existing = await ensureWispSettings();
  const coordinatorNames = String(body.coordinatorNames ?? existing.coordinator_names ?? "").trim() || existing.coordinator_names;
  const lastReviewedDate = body.markReviewedToday ? new Date().toISOString().slice(0, 10) : toDateStr(existing.last_reviewed_date);

  await query(
    `UPDATE altax.v3_wisp_settings SET coordinator_names = $1, last_reviewed_date = $2, updated_at = now(), updated_by = $3 WHERE id = 'WISP-1'`,
    [coordinatorNames, lastReviewedDate, req.user!.email]
  );
  if (body.markReviewedToday) {
    await ensureWispSnapshot(lastReviewedDate, { coordinator_names: coordinatorNames, adopted_date: existing.adopted_date }, req.user!.email);
  }
  await logAudit("Compliance", "EDIT", "WISP-1", "LastReviewedDate", toDateStr(existing.last_reviewed_date), lastReviewedDate,
    `WISP settings updated by ${req.user!.email}.${body.markReviewedToday ? " Marked reviewed today — new version frozen, staff must re-acknowledge." : ""}`, req.user!.email);

  res.json({ ok: true, coordinatorNames, adoptedDate: toDateStr(existing.adopted_date), lastReviewedDate });
}));

/** Any staff/admin acknowledges having read the current (frozen) version of the WISP. Idempotent — re-acknowledging the same version just no-ops. */
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

/**
 * Serves a frozen WISP snapshot — the current version by default, or a specific
 * past version via ?version=YYYY-MM-DD (admin only, for pulling up proof of what
 * an earlier acknowledgment actually covered). Never regenerates the PDF live;
 * ensureWispSnapshot guarantees the current version always has one on file.
 */
complianceRouter.get("/wisp/pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const settings = await ensureWispSettings();
  const currentVersion = toDateStr(settings.last_reviewed_date);
  const requestedVersion = String(req.query.version || "").trim();

  if (requestedVersion && requestedVersion !== currentVersion && req.user!.role !== "admin") {
    return res.status(403).json({ error: "Only an admin can view a past version of the WISP." });
  }
  const version = requestedVersion || currentVersion;

  const snapshot = await queryOne<any>(`SELECT * FROM altax.v3_wisp_snapshots WHERE version = $1`, [version]);
  if (!snapshot) return res.status(404).json({ error: `No WISP version found for ${version}.` });

  const base64 = await readUploadBlob(`wisp-${version}`, snapshot.file_data, snapshot.blob_backend);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="WISP_${version}.pdf"`);
  res.send(Buffer.from(base64, "base64"));
}));

/** Admin-only: every past version on file, with who acknowledged it and when — the audit trail for "who signed off on what, and when." */
complianceRouter.get("/wisp/history", requireAuth, requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const snapshots = await query<any>(`SELECT version, file_size, created_at, created_by FROM altax.v3_wisp_snapshots ORDER BY version DESC`);
  const staffCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM altax.v3_users WHERE lower(role) IN ('admin','staff') AND active = true`
  );
  const acks = await query<any>(`SELECT version, COUNT(*)::int AS count FROM altax.v3_wisp_acknowledgments GROUP BY version`);
  const ackCountByVersion = new Map(acks.map((a) => [toDateStr(a.version), Number(a.count)]));

  res.json({
    totalStaff: Number(staffCount?.count || 0),
    versions: snapshots.map((s) => ({
      version: toDateStr(s.version),
      fileSize: s.file_size,
      createdAt: s.created_at,
      createdBy: s.created_by,
      acknowledgedCount: ackCountByVersion.get(toDateStr(s.version)) || 0,
    })),
  });
}));
