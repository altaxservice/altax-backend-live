import crypto from "crypto";
import { query, queryOne } from "../../config/db";

const INTERNAL_CLIENT_ID = "C-ALTAX70";
const INTERNAL_CLIENT_NAME = "AL TAX SERVICE";

// Mirrors eftpsStaffTasks.ts's idSuffix() — this also inserts several rows
// (one per checklist item) within a single request, so it needs the same
// higher-entropy UUID-derived suffix to avoid same-second collisions.
function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Duplicated from tasks.routes.ts's ensureInternalClient() — not exported there, and this is the established pattern (see eftpsStaffTasks.ts) for firm-internal, non-client task generation. */
async function ensureInternalClient(): Promise<{ client_id: string; client_name: string; assigned_to: string | null }> {
  const existing = await queryOne<any>(`SELECT client_id, client_name, assigned_to FROM altax.v3_clients WHERE client_id = $1`, [INTERNAL_CLIENT_ID]);
  if (existing) return existing;
  await query(
    `INSERT INTO altax.v3_clients (client_id, client_name, entity_type, status, state, assigned_to, client_type, service_type, portal_enabled)
     VALUES ($1,$2,'Internal','Active','MD','AL','Internal','Internal',false)
     ON CONFLICT (client_id) DO NOTHING`,
    [INTERNAL_CLIENT_ID, INTERNAL_CLIENT_NAME]
  );
  return { client_id: INTERNAL_CLIENT_ID, client_name: INTERNAL_CLIENT_NAME, assigned_to: "AL" };
}

interface ChecklistItem {
  key: string;
  taskName: string;
  notes: string;
  dueInDays: number;
}

const ONBOARDING_CHECKLIST: ChecklistItem[] = [
  { key: "nda", taskName: "Get confidentiality/NDA agreement signed", notes: "Required before this person accesses any client SSN/financial data.", dueInDays: 1 },
  { key: "security-briefing", taskName: "Walk through the firm's WISP (Written Information Security Plan)", notes: "Download/review the WISP from Firm Settings > Compliance Documents, then have them acknowledge it there — required under IRS Pub. 4557 / FTC Safeguards Rule.", dueInDays: 2 },
  { key: "2fa", taskName: "Confirm 2FA is enrolled (AL TAX Nexus login + company email)", notes: "Do not grant client-data access until both are enrolled.", dueInDays: 2 },
  { key: "device-policy", taskName: "Get device policy signed (passcode/encryption/remote-wipe)", notes: "Covers company-issued and BYOD devices that will touch client data.", dueInDays: 2 },
  { key: "antivirus", taskName: "Confirm antivirus/anti-malware is installed on their device", notes: "", dueInDays: 3 },
  { key: "app-training", taskName: "Walk through AL TAX Nexus (Tasks, Daily Log/Notes, client assignment, relevant modules, Firm Portals vault)", notes: "", dueInDays: 5 },
  { key: "tech-training", taskName: "Shadow real client work before independent ownership", notes: "Review firm workflow end-to-end; confirm PTIN on file and explain representation limits if this person is a preparer.", dueInDays: 10 },
  { key: "check-in-30d", taskName: "Hold 30-day new-hire check-in", notes: "", dueInDays: 30 },
];

const OFFBOARDING_CHECKLIST: ChecklistItem[] = [
  { key: "reassign-open-work", taskName: "Reassign this person's open tasks and active clients", notes: "", dueInDays: 0 },
  { key: "revoke-email", taskName: "Revoke company email and any other shared SaaS/portal accounts", notes: "", dueInDays: 0 },
  { key: "retrieve-device", taskName: "Retrieve company-issued device(s)", notes: "", dueInDays: 1 },
  { key: "wipe-device", taskName: "Wipe/reset company-owned device before reissue", notes: "", dueInDays: 1 },
  { key: "return-property", taskName: "Confirm firm property returned (keys, access cards, etc.)", notes: "", dueInDays: 1 },
];

async function ensureChecklistTasks(
  sourceSystem: "NewHireOnboarding" | "StaffOffboarding",
  serviceLine: string,
  userId: string,
  personLabel: string,
  items: ChecklistItem[],
  assignedTo: string
): Promise<number> {
  const client = await ensureInternalClient();
  const now = new Date();
  let created = 0;

  for (const item of items) {
    const sourceRecordId = `${userId}:${item.key}`;
    const existing = await queryOne<any>(
      `SELECT task_id FROM altax.v3_tasks WHERE source_system = $1 AND source_record_id = $2`,
      [sourceSystem, sourceRecordId]
    );
    if (existing) continue;

    const due = new Date(now.getTime() + item.dueInDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await query(
      `INSERT INTO altax.v3_tasks
         (task_id, client_id, client_name, service_line, task_name, status, assigned_to,
          staff_due_date, agency_due_date, notes, source_system, source_record_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,'Not Started',$6,$7,$7,$8,$9,$10, now(), now())`,
      [`T-${idSuffix()}`, client.client_id, client.client_name, serviceLine,
        `${item.taskName} — ${personLabel}`, assignedTo || client.assigned_to || "AL",
        due, item.notes, sourceSystem, sourceRecordId]
    );
    created++;
  }
  return created;
}

/**
 * Runs once, at the moment a real Staff user is created (users.routes.ts's
 * POST / "no existing row" branch). Idempotent per (userId, checklist item) —
 * safe to call more than once for the same user without duplicating tasks.
 */
export async function ensureStaffOnboardingTasks(
  user: { user_id: string; email: string; name: string },
  createdBy: string
): Promise<number> {
  return ensureChecklistTasks(
    "NewHireOnboarding", "Staff Onboarding", user.user_id,
    `${user.name} (${user.email})`, ONBOARDING_CHECKLIST, createdBy
  );
}

/**
 * Runs once, right after POST /:userId/deactivate flips a Staff user
 * inactive. openAssignedTasks/assignedActiveClients are the same counts
 * that route already computes for its response — surfaced here in the
 * "reassign open work" task's notes so the admin doesn't have to look
 * them up twice.
 */
export async function ensureStaffOffboardingTasks(
  user: { user_id: string; email: string; name: string },
  deactivatedBy: string,
  openAssignedTasks: number,
  assignedActiveClients: number
): Promise<number> {
  const items = OFFBOARDING_CHECKLIST.map((item) =>
    item.key === "reassign-open-work"
      ? { ...item, notes: `${openAssignedTasks} open task(s) and ${assignedActiveClients} active client(s) were still assigned to this person at deactivation.` }
      : item
  );
  return ensureChecklistTasks(
    "StaffOffboarding", "Staff Offboarding", user.user_id,
    `${user.name} (${user.email})`, items, deactivatedBy
  );
}
