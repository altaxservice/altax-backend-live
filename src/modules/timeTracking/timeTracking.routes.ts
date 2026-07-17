import { Router, Response } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";

/**
 * Staff time tracking + leave requests — Phase 9, a genuinely new feature (no
 * legacy Code.gs equivalent to port). Firm-internal only: this tracks AL TAX's
 * own staff hours/leave, distinct from v3_Employees/v3_Paychecks which pay a
 * CLIENT's workers. Deliberately minimal for a first cut, per direct
 * discussion with the user: time entries are daily/weekly hours (not
 * clock-in/out punches), and leave requests are a request-and-decide log with
 * no PTO accrual-balance tracking — that needs a real accrual policy decided
 * first, so it's left for a later pass rather than guessed at here. Not wired
 * into payroll's regularHours field yet: that assumes a 1:1 staff-user ->
 * client-employee-record mapping that isn't established for every AL TAX
 * staff member.
 */
export const timeTrackingRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

timeTrackingRouter.use(requireAuth, requireRole("admin", "staff"));

// ---- Time Entries ----

/** Log a day's hours. Always recorded under the caller's own email — no one logs time on another user's behalf. */
timeTrackingRouter.post("/entries", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const entryDate = String(body.entryDate || "").trim();
  const hours = Number(body.hours);
  if (!entryDate) return res.status(400).json({ error: "Entry date is required." });
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: "Hours must be a positive number." });

  const clientId = String(body.clientId || "").trim() || null;
  let clientName: string | null = null;
  if (clientId) {
    const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
    if (!client) return res.status(404).json({ error: "Client not found." });
    clientName = client.client_name;
  }

  const timeEntryId = `TIME-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_time_entries
       (time_entry_id, user_email, entry_date, client_id, client_name, hours, description, status,
        source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Submitted','Node Web App',$1)`,
    [timeEntryId, req.user!.email, entryDate, clientId, clientName, hours, String(body.description || "").trim() || null]
  );

  await logAudit("Time Tracking", "CREATE_ENTRY", timeEntryId, "", "", String(hours),
    `Time entry logged by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, timeEntryId });
}));

/** List time entries — staff see only their own; admin sees everyone's, optionally filtered by ?userEmail=. */
timeTrackingRouter.get("/entries", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const filterEmail = isAdmin ? String(req.query.userEmail || "").trim() : req.user!.email;

  const conditions: string[] = [];
  const params: any[] = [];
  if (filterEmail) { params.push(filterEmail); conditions.push(`user_email = $${params.length}`); }
  const start = String(req.query.start || "").trim();
  const end = String(req.query.end || "").trim();
  if (start) { params.push(start); conditions.push(`entry_date >= $${params.length}::date`); }
  if (end) { params.push(end); conditions.push(`entry_date <= $${params.length}::date`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<any>(`SELECT * FROM altax.v3_time_entries ${where} ORDER BY entry_date DESC, created_at DESC`, params);
  res.json({ timeEntries: rows });
}));

/** Edit a time entry — the owner may correct it while still Submitted; admin may edit any entry regardless of status. */
timeTrackingRouter.patch("/entries/:timeEntryId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { timeEntryId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_time_entries WHERE time_entry_id = $1`, [timeEntryId]);
  if (!existing) return res.status(404).json({ error: "Time entry not found." });

  const isAdmin = req.user!.role === "admin";
  const isOwner = existing.user_email === req.user!.email;
  if (!isAdmin && !isOwner) return res.status(403).json({ error: "You do not have access to this time entry." });
  if (!isAdmin && existing.status !== "Submitted") {
    return res.status(400).json({ error: "This entry has already been decided and can no longer be edited." });
  }

  const body = req.body || {};
  const entryDate = body.entryDate !== undefined ? String(body.entryDate).trim() : existing.entry_date;
  const hours = body.hours !== undefined ? Number(body.hours) : Number(existing.hours);
  if (!Number.isFinite(hours) || hours <= 0) return res.status(400).json({ error: "Hours must be a positive number." });
  const description = body.description !== undefined ? (String(body.description).trim() || null) : existing.description;

  await query(
    `UPDATE altax.v3_time_entries SET entry_date=$2, hours=$3, description=$4, updated_at = now() WHERE time_entry_id = $1`,
    [timeEntryId, entryDate, hours, description]
  );

  await logAudit("Time Tracking", "EDIT_ENTRY", timeEntryId, "Hours", String(existing.hours ?? ""), String(hours),
    `Time entry edited by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, timeEntryId });
}));

/** Approve a time entry — admin only. */
timeTrackingRouter.post("/entries/:timeEntryId/approve", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { timeEntryId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_time_entries WHERE time_entry_id = $1`, [timeEntryId]);
  if (!existing) return res.status(404).json({ error: "Time entry not found." });

  await query(
    `UPDATE altax.v3_time_entries SET status = 'Approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE time_entry_id = $1`,
    [timeEntryId, req.user!.email]
  );
  await logAudit("Time Tracking", "APPROVE_ENTRY", timeEntryId, "Status", existing.status || "", "Approved",
    `Time entry approved by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, timeEntryId, status: "Approved" });
}));

/** Reject a time entry — admin only. */
timeTrackingRouter.post("/entries/:timeEntryId/reject", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { timeEntryId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_time_entries WHERE time_entry_id = $1`, [timeEntryId]);
  if (!existing) return res.status(404).json({ error: "Time entry not found." });

  await query(
    `UPDATE altax.v3_time_entries SET status = 'Rejected', approved_by = $2, approved_at = now(), updated_at = now() WHERE time_entry_id = $1`,
    [timeEntryId, req.user!.email]
  );
  await logAudit("Time Tracking", "REJECT_ENTRY", timeEntryId, "Status", existing.status || "", "Rejected",
    `Time entry rejected by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, timeEntryId, status: "Rejected" });
}));

// ---- Leave Requests ----

/** Submit a leave request. Always under the caller's own email. */
timeTrackingRouter.post("/leave-requests", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const leaveType = String(body.leaveType || "").trim();
  const startDate = String(body.startDate || "").trim();
  const endDate = String(body.endDate || "").trim();
  if (!leaveType) return res.status(400).json({ error: "Leave type is required." });
  if (!startDate || !endDate) return res.status(400).json({ error: "Start and end dates are required." });
  if (new Date(endDate) < new Date(startDate)) return res.status(400).json({ error: "End date cannot be before start date." });

  const leaveRequestId = `LEAVE-${idSuffix()}`;
  await query(
    `INSERT INTO altax.v3_leave_requests
       (leave_request_id, user_email, leave_type, start_date, end_date, reason, status, source_system, source_record_id)
     VALUES ($1,$2,$3,$4,$5,$6,'Pending','Node Web App',$1)`,
    [leaveRequestId, req.user!.email, leaveType, startDate, endDate, String(body.reason || "").trim() || null]
  );

  await logAudit("Leave", "REQUEST", leaveRequestId, "", "", leaveType,
    `Leave request submitted by ${req.user!.email}.`, req.user!.email);

  res.status(201).json({ ok: true, leaveRequestId });
}));

/** List leave requests — staff see only their own; admin sees everyone's, optionally filtered by ?userEmail= or ?status=. */
timeTrackingRouter.get("/leave-requests", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const isAdmin = req.user!.role === "admin";
  const filterEmail = isAdmin ? String(req.query.userEmail || "").trim() : req.user!.email;
  const status = String(req.query.status || "").trim();

  const conditions: string[] = [];
  const params: any[] = [];
  if (filterEmail) { params.push(filterEmail); conditions.push(`user_email = $${params.length}`); }
  if (status) { params.push(status); conditions.push(`lower(status) = lower($${params.length})`); }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = await query<any>(`SELECT * FROM altax.v3_leave_requests ${where} ORDER BY start_date DESC, created_at DESC`, params);
  res.json({ leaveRequests: rows });
}));

/** Cancel a pending leave request — owner only, only while still Pending. */
timeTrackingRouter.post("/leave-requests/:leaveRequestId/cancel", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { leaveRequestId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_leave_requests WHERE leave_request_id = $1`, [leaveRequestId]);
  if (!existing) return res.status(404).json({ error: "Leave request not found." });
  if (existing.user_email !== req.user!.email) return res.status(403).json({ error: "You do not have access to this leave request." });
  if (existing.status !== "Pending") return res.status(400).json({ error: "Only a pending request can be cancelled." });

  await query(`UPDATE altax.v3_leave_requests SET status = 'Cancelled', updated_at = now() WHERE leave_request_id = $1`, [leaveRequestId]);
  await logAudit("Leave", "CANCEL", leaveRequestId, "Status", existing.status || "", "Cancelled",
    `Leave request cancelled by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, leaveRequestId, status: "Cancelled" });
}));

/** Approve a leave request — admin only. */
timeTrackingRouter.post("/leave-requests/:leaveRequestId/approve", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { leaveRequestId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_leave_requests WHERE leave_request_id = $1`, [leaveRequestId]);
  if (!existing) return res.status(404).json({ error: "Leave request not found." });
  if (existing.status !== "Pending") return res.status(400).json({ error: "Only a pending request can be approved." });

  await query(
    `UPDATE altax.v3_leave_requests SET status = 'Approved', approved_by = $2, approved_at = now(), decision_note = $3, updated_at = now() WHERE leave_request_id = $1`,
    [leaveRequestId, req.user!.email, String((req.body || {}).decisionNote || "").trim() || null]
  );
  await logAudit("Leave", "APPROVE", leaveRequestId, "Status", existing.status || "", "Approved",
    `Leave request approved by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, leaveRequestId, status: "Approved" });
}));

/** Deny a leave request — admin only. */
timeTrackingRouter.post("/leave-requests/:leaveRequestId/deny", requireRole("admin"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { leaveRequestId } = req.params;
  const existing = await queryOne<any>(`SELECT * FROM altax.v3_leave_requests WHERE leave_request_id = $1`, [leaveRequestId]);
  if (!existing) return res.status(404).json({ error: "Leave request not found." });
  if (existing.status !== "Pending") return res.status(400).json({ error: "Only a pending request can be denied." });

  await query(
    `UPDATE altax.v3_leave_requests SET status = 'Denied', approved_by = $2, approved_at = now(), decision_note = $3, updated_at = now() WHERE leave_request_id = $1`,
    [leaveRequestId, req.user!.email, String((req.body || {}).decisionNote || "").trim() || null]
  );
  await logAudit("Leave", "DENY", leaveRequestId, "Status", existing.status || "", "Denied",
    `Leave request denied by ${req.user!.email}.`, req.user!.email);

  res.json({ ok: true, leaveRequestId, status: "Denied" });
}));
