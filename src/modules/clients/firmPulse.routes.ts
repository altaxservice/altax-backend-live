import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { auditLabel, auditLink } from "./workTrail.routes";

/**
 * Firm Pulse — the "see the whole firm from the top" feed behind the Command Center's top band (admin only):
 * per-person status + what they last did + their load, the next two days of the calendar with who is booked and
 * whether the client confirmed, and a live firm-wide activity feed. Everything derives from data the app already
 * records (audit log, tasks, appointments, time/daily logs, client visits) — nobody types anything for this.
 */
export const firmPulseRouter = Router();

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const TERMINAL = ["completed", "void", "closed", "archived"];
const NOISE_MODULES = ["Security", "System"];

interface Resolved { clientId: string | null; clientName: string | null; detail: string | null }

/** audit record_id → client (+ a short detail like the task name), by id prefix. */
async function resolveRecords(ids: string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  const pick = (prefix: RegExp) => Array.from(new Set(ids.filter((i) => prefix.test(i))));
  const clients = pick(/^C-/);
  const tasks = pick(/^T-/);
  const invoices = pick(/^INV-/);
  const appts = pick(/^APT-/);
  const ests = pick(/^EST-/);
  const comms = pick(/^COM-/);
  const sales = pick(/^SALE-/);
  const pays = pick(/^PAY-/);
  if (clients.length) for (const r of await query<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = ANY($1::text[])`, [clients])) out.set(r.client_id, { clientId: r.client_id, clientName: r.client_name, detail: null });
  if (tasks.length) for (const r of await query<any>(`SELECT t.task_id, t.task_name, t.client_id, c.client_name FROM altax.v3_tasks t LEFT JOIN altax.v3_clients c ON c.client_id = t.client_id WHERE t.task_id = ANY($1::text[])`, [tasks])) out.set(r.task_id, { clientId: r.client_id, clientName: r.client_name, detail: r.task_name });
  if (invoices.length) for (const r of await query<any>(`SELECT i.invoice_id, i.client_id, c.client_name FROM altax.v3_invoices i LEFT JOIN altax.v3_clients c ON c.client_id = i.client_id WHERE i.invoice_id = ANY($1::text[])`, [invoices])) out.set(r.invoice_id, { clientId: r.client_id, clientName: r.client_name, detail: r.invoice_id });
  if (appts.length) for (const r of await query<any>(`SELECT a.appointment_id, a.client_id, a.title, COALESCE(c.client_name, a.contact_name) AS client_name FROM altax.v3_appointments a LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id WHERE a.appointment_id = ANY($1::text[])`, [appts])) out.set(r.appointment_id, { clientId: r.client_id, clientName: r.client_name, detail: r.title });
  if (ests.length) for (const r of await query<any>(`SELECT e.estimate_id, e.client_id, c.client_name FROM altax.v3_estimates e LEFT JOIN altax.v3_clients c ON c.client_id = e.client_id WHERE e.estimate_id = ANY($1::text[])`, [ests])) out.set(r.estimate_id, { clientId: r.client_id, clientName: r.client_name, detail: null });
  if (comms.length) for (const r of await query<any>(`SELECT communication_id, client_id, client_name, subject FROM altax.v3_communications WHERE communication_id = ANY($1::text[])`, [comms])) out.set(r.communication_id, { clientId: r.client_id, clientName: r.client_name, detail: r.subject });
  if (sales.length) for (const r of await query<any>(`SELECT sale_id, client_id, client_name FROM altax.v3_sales_input WHERE sale_id = ANY($1::text[])`, [sales])) out.set(r.sale_id, { clientId: r.client_id, clientName: r.client_name, detail: null });
  if (pays.length) for (const r of await query<any>(`SELECT p.payment_id, p.client_id, c.client_name, p.invoice_id FROM altax.v3_payments p LEFT JOIN altax.v3_clients c ON c.client_id = p.client_id WHERE p.payment_id = ANY($1::text[])`, [pays])) out.set(r.payment_id, { clientId: r.client_id, clientName: r.client_name, detail: r.invoice_id });
  return out;
}

firmPulseRouter.get("/", requireAuth, requireRole("admin"), asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startTomorrow = new Date(startToday); startTomorrow.setDate(startToday.getDate() + 1);
  const endTomorrow = new Date(startToday); endTomorrow.setDate(startToday.getDate() + 3); // through the end of tomorrow+1 → "next 2 days"
  const ymdToday = `${startToday.getFullYear()}-${String(startToday.getMonth() + 1).padStart(2, "0")}-${String(startToday.getDate()).padStart(2, "0")}`;

  const staffAll = await query<any>(`SELECT user_id, email, name, role, last_login FROM altax.v3_users WHERE active = true AND lower(role) IN ('admin','staff') ORDER BY (lower(role) = 'admin') DESC, name`);
  // Two logins can share one email (an admin and a staff login for the same person) — show each person once.
  const seenEmail = new Set<string>();
  const staff = staffAll.filter((u) => { const e = norm(u.email); if (!e || seenEmail.has(e)) return false; seenEmail.add(e); return true; });
  const staffEmails = staff.map((u) => norm(u.email));
  const aliasOf = new Map<string, string>(); // alias → staff email
  for (const u of staff) for (const a of [u.email, u.name, u.user_id]) if (norm(a)) aliasOf.set(norm(a), norm(u.email));

  const [openTasks, apptRows, timeRows, logRows, lastActs, visits, feedRows] = await Promise.all([
    query<any>(`SELECT assigned_to, agency_due_date FROM altax.v3_tasks WHERE COALESCE(is_parked,false) = false AND lower(COALESCE(status,'')) <> ALL($1::text[])`, [TERMINAL]),
    query<any>(
      `SELECT a.appointment_id, a.title, a.client_id, a.contact_name, a.start_time, a.end_time, a.location, a.assigned_to, a.status, a.appointment_type_name,
              a.confirmation_request_sent_at, a.client_confirmed_at, c.client_name
         FROM altax.v3_appointments a LEFT JOIN altax.v3_clients c ON c.client_id = a.client_id
        WHERE a.start_time >= $1 AND a.start_time < $2 AND a.status IN ('Scheduled','Cancelled')
        ORDER BY a.start_time`, [startToday.toISOString(), endTomorrow.toISOString()]),
    query<any>(`SELECT lower(user_email) AS email, SUM(hours) AS hours FROM altax.v3_time_entries WHERE entry_date = $1 GROUP BY 1`, [ymdToday]),
    query<any>(`SELECT lower(author_email) AS email, COUNT(*) AS entries, COALESCE(SUM(time_spent_minutes),0) AS minutes FROM altax.v3_daily_logs WHERE logged_at >= $1 GROUP BY 1`, [startToday.toISOString()]),
    query<any>(
      `SELECT DISTINCT ON (lower(user_email)) lower(user_email) AS email, module, action, field, note, record_id, created_at
         FROM altax.v3_audit_log
        WHERE lower(user_email) = ANY($1::text[]) AND created_at > now() - interval '30 days' AND module <> ALL($2::text[])
        ORDER BY lower(user_email), created_at DESC`, [staffEmails, NOISE_MODULES]),
    query<any>(
      `SELECT DISTINCT ON (lower(v.user_email)) lower(v.user_email) AS email, v.client_id, c.client_name, v.last_visit_at
         FROM altax.v3_client_visits v JOIN altax.v3_clients c ON c.client_id = v.client_id
        WHERE lower(v.user_email) = ANY($1::text[]) ORDER BY lower(v.user_email), v.last_visit_at DESC`, [staffEmails]),
    query<any>(
      `SELECT module, action, field, note, record_id, user_email, created_at FROM altax.v3_audit_log
        WHERE created_at > now() - interval '3 days' AND user_email NOT ILIKE 'system%' AND module <> ALL($1::text[])
        ORDER BY created_at DESC LIMIT 30`, [NOISE_MODULES]),
  ]);

  const resolved = await resolveRecords(Array.from(new Set([...lastActs, ...feedRows].map((r) => String(r.record_id || "")).filter(Boolean))));
  const nameByEmail = new Map(staff.map((u) => [norm(u.email), u.name || u.email]));

  const lastActOf = (r: any) => {
    const rec = resolved.get(String(r.record_id || ""));
    return {
      label: auditLabel(r), detail: rec?.detail || null, clientId: rec?.clientId || null, clientName: rec?.clientName || null,
      link: auditLink(String(r.record_id || ""), r.action) || (rec?.clientId ? `/clients/${rec.clientId}` : null), at: new Date(r.created_at).toISOString(),
    };
  };

  const load = new Map<string, { open: number; overdue: number; dueToday: number }>();
  for (const e of staffEmails) load.set(e, { open: 0, overdue: 0, dueToday: 0 });
  for (const t of openTasks) {
    const email = aliasOf.get(norm(t.assigned_to));
    if (!email) continue;
    const l = load.get(email)!;
    l.open += 1;
    if (t.agency_due_date) {
      const d = new Date(t.agency_due_date); d.setHours(0, 0, 0, 0);
      const diff = Math.round((d.getTime() - startToday.getTime()) / 86400000);
      if (diff < 0) l.overdue += 1; else if (diff === 0) l.dueToday += 1;
    }
  }

  const apptTodayBy = new Map<string, number>();
  const schedule = apptRows.map((a) => {
    const email = aliasOf.get(norm(a.assigned_to)) || null;
    const start = new Date(a.start_time);
    const day = start < startTomorrow ? "today" : "later";
    if (day === "today" && a.status === "Scheduled" && email) apptTodayBy.set(email, (apptTodayBy.get(email) || 0) + 1);
    return {
      id: a.appointment_id, title: a.appointment_type_name || a.title, clientId: a.client_id, clientName: a.client_name || a.contact_name || null,
      startTime: new Date(a.start_time).toISOString(), endTime: new Date(a.end_time).toISOString(), location: a.location,
      assignedTo: email, assignedName: email ? nameByEmail.get(email) : (a.assigned_to || null), status: a.status, day,
      confirmed: !!a.client_confirmed_at, confirmationRequested: !!a.confirmation_request_sent_at, confirmedAt: a.client_confirmed_at ? new Date(a.client_confirmed_at).toISOString() : null,
    };
  });
  const live = schedule.filter((a) => a.status === "Scheduled");
  const todays = live.filter((a) => a.day === "today");

  const timeBy = new Map(timeRows.map((r) => [r.email, Number(r.hours) || 0]));
  const logBy = new Map(logRows.map((r) => [r.email, { entries: Number(r.entries), minutes: Number(r.minutes) }]));
  const actBy = new Map(lastActs.map((r) => [r.email, r]));
  const visitBy = new Map(visits.map((r) => [r.email, r]));

  const team = staff.map((u) => {
    const email = norm(u.email);
    const act = actBy.get(email);
    const lastAt = act ? new Date(act.created_at).getTime() : 0;
    const mins = lastAt ? (now.getTime() - lastAt) / 60000 : Infinity;
    const l = load.get(email)!;
    const visit = visitBy.get(email);
    const lg = logBy.get(email);
    return {
      userId: u.user_id, name: u.name || u.email, email: u.email, role: u.role,
      presence: mins <= 15 ? "active" : mins <= 180 ? "recent" : lastAt >= startToday.getTime() ? "today" : "away",
      lastLogin: u.last_login ? new Date(u.last_login).toISOString() : null,
      openTasks: l.open, overdueTasks: l.overdue, dueToday: l.dueToday, appointmentsToday: apptTodayBy.get(email) || 0,
      hoursToday: Math.round(((timeBy.get(email) || 0) + 0) * 100) / 100, logEntriesToday: lg?.entries || 0, logMinutesToday: lg?.minutes || 0,
      lastAction: act ? lastActOf(act) : null,
      lastClient: visit ? { clientId: visit.client_id, clientName: visit.client_name, at: new Date(visit.last_visit_at).toISOString() } : null,
    };
  }).sort((a, b) => ({ active: 0, recent: 1, today: 2, away: 3 }[a.presence] as number) - ({ active: 0, recent: 1, today: 2, away: 3 }[b.presence] as number) || b.openTasks - a.openTasks);

  const feed = feedRows.map((r) => {
    const who = norm(r.user_email);
    const a = lastActOf(r);
    return {
      ...a, by: r.user_email, byName: nameByEmail.get(who) || (/public manage link|^client$/i.test(String(r.user_email)) ? "Client (online)" : r.user_email),
      isClient: /public manage link|^client$/i.test(String(r.user_email)),
    };
  });

  res.json({
    generatedAt: now.toISOString(),
    team,
    schedule: {
      today: todays.length,
      confirmedToday: todays.filter((a) => a.confirmed).length,
      awaitingConfirmationToday: todays.filter((a) => !a.confirmed).length,
      upcoming: live.filter((a) => a.day === "later").length,
      cancelled: schedule.filter((a) => a.status === "Cancelled").length,
      items: schedule,
    },
    feed,
  });
}));
