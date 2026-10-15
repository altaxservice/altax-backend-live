import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { getUserAliases } from "../../common/assignment";
import { loadScope, loadDismissed } from "../clientGroups/clientGroups.routes";
import { relatedTo } from "../clientGroups/relatedClients";

/**
 * Global cross-table search — powers the "Search All" header button, which
 * previously only filtered the already-loaded Clients list client-side (see
 * ClientsListPage's `?search=` param) and never touched tasks/invoices/
 * documents. Admin/staff only, same visibility rule each module's own list
 * route already applies: admin sees everything; staff is scoped to clients
 * they have at least one task assignment for (mirrors clients.routes.ts).
 */
export const searchRouter = Router();

const RESULT_LIMIT = 8;

searchRouter.get("/", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.json({ clients: [], connected: [], tasks: [], invoices: [], documents: [], employees: [] });
  const like = `%${q}%`;

  const isAdmin = req.user!.role === "admin";
  const aliases = isAdmin ? [] : Array.from(await getUserAliases(req.user!.email));

  const clientScopeSql = isAdmin
    ? ""
    : `AND client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($2::text[]))`;
  const taskScopeSql = isAdmin ? "" : `AND lower(assigned_to) = ANY($2::text[])`;

  const params = isAdmin ? [like] : [like, aliases];
  const digits = q.replace(/\D/g, "");

  const [clients, tasks, invoices, documents, employees] = await Promise.all([
    // Also searches the OWNER's name, phone and email (not just the company's), and phone numbers by their digits so "(929) 589-9350",
    // "929-589-9350" and "9295899350" all find the same record.
    query(
      `SELECT client_id, client_name, email, phone, status, company_contact_name, company_contact_phone, company_contact_email FROM altax.v3_clients
        WHERE (client_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR company_contact_name ILIKE $1 OR company_contact_email ILIKE $1 OR company_contact_phone ILIKE $1
               ${digits.length >= 7 ? `OR regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE $${params.length + 1} OR regexp_replace(coalesce(company_contact_phone,''), '\\D', '', 'g') LIKE $${params.length + 1}` : ""}) ${clientScopeSql}
        ORDER BY client_name ASC LIMIT 12`,
      digits.length >= 7 ? [...params, `%${digits}%`] : params
    ),
    query(
      `SELECT task_id, task_name, client_id, client_name, status, agency_due_date FROM altax.v3_tasks
        WHERE (task_name ILIKE $1 OR client_name ILIKE $1) ${taskScopeSql}
        ORDER BY agency_due_date DESC NULLS LAST LIMIT ${RESULT_LIMIT}`,
      params
    ),
    query(
      `SELECT invoice_id, client_id, description, total_amount, status FROM altax.v3_invoices
        WHERE (invoice_id ILIKE $1 OR description ILIKE $1) ${clientScopeSql}
        ORDER BY invoice_date DESC NULLS LAST LIMIT ${RESULT_LIMIT}`,
      params
    ),
    // Document REQUESTS and uploaded file NAMES both count as "documents" here — a
    // search for a filename someone remembered (e.g. "W2 2025") previously found
    // nothing at all, since only the request's requested_item was ever indexed.
    query(
      `(SELECT request_id, client_id, client_name, requested_item, status, 'request' AS kind FROM altax.v3_document_requests
         WHERE (requested_item ILIKE $1 OR client_name ILIKE $1) ${clientScopeSql}
         ORDER BY request_date DESC NULLS LAST LIMIT ${RESULT_LIMIT})
       UNION ALL
       (SELECT u.upload_id AS request_id, u.client_id, u.client_name, u.file_name AS requested_item, u.status, 'upload' AS kind FROM altax.v3_document_uploads u
         WHERE u.file_name ILIKE $1 AND lower(u.status) NOT IN ('removed','replaced') ${isAdmin ? "" : "AND u.client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($2::text[]))"}
         ORDER BY u.uploaded_at DESC NULLS LAST LIMIT ${RESULT_LIMIT})`,
      params
    ),
    // Employees weren't searchable at all before — a staffer looking up someone by
    // name (e.g. to find their paystub or W-2) had no way to jump there from search.
    query(
      `SELECT employee_id, employee_name, client_id, client_name, status FROM altax.v3_employees
        WHERE (employee_name ILIKE $1 OR client_name ILIKE $1) ${clientScopeSql}
        ORDER BY employee_name ASC LIMIT ${RESULT_LIMIT}`,
      params
    ),
  ]);

  // Why each client matched, and the other companies connected to the people found (same owner phone / email / name, or a confirmed group).
  const ql = q.toLowerCase();
  const hit = (v: unknown) => String(v ?? "").toLowerCase().includes(ql) || (digits.length >= 7 && String(v ?? "").replace(/\D/g, "").includes(digits));
  const shaped = (clients as any[]).map((c) => {
    const via: string[] = [];
    if (hit(c.company_contact_name) && !hit(c.client_name)) via.push("owner name");
    if (hit(c.company_contact_phone) && !hit(c.phone)) via.push("owner phone");
    if (hit(c.company_contact_email) && !hit(c.email)) via.push("owner email");
    return { client_id: c.client_id, client_name: c.client_name, email: c.email, phone: c.phone, status: c.status, owner: c.company_contact_name || null, matchedVia: via };
  });
  let connected: { clientId: string; clientName: string; status: string | null; via: string; groupName: string | null }[] = [];
  if (shaped.length) {
    const scope = await loadScope(req.user!);
    const dismissed = await loadDismissed();
    const byId = new Map(scope.map((c) => [c.client_id, c]));
    const matched = new Set(shaped.map((c) => c.client_id));
    const found = new Map<string, { clientId: string; clientName: string; status: string | null; via: string; groupName: string | null }>();
    const groupRows = await query<any>(`SELECT m.client_id, m.group_id, g.group_name FROM altax.v3_client_group_members m JOIN altax.v3_client_groups g ON g.group_id = m.group_id`);
    const groupOfClient = new Map<string, { id: string; name: string }>(groupRows.map((r) => [r.client_id, { id: r.group_id, name: r.group_name }]));
    for (const m of shaped.slice(0, 6)) {
      const target = byId.get(m.client_id); if (!target) continue;
      const g = groupOfClient.get(m.client_id);
      if (g) for (const r of groupRows) if (r.group_id === g.id && !matched.has(r.client_id) && byId.has(r.client_id) && !found.has(r.client_id)) {
        const c = byId.get(r.client_id)!; found.set(c.client_id, { clientId: c.client_id, clientName: c.client_name, status: c.status, via: `same owner group as ${target.client_name}`, groupName: g.name });
      }
      for (const f of relatedTo(target, scope, dismissed)) {
        if (matched.has(f.client.client_id) || found.has(f.client.client_id) || f.score < 2) continue;
        found.set(f.client.client_id, { clientId: f.client.client_id, clientName: f.client.client_name, status: f.client.status, via: `${f.reasons[0].kind} shared with ${target.client_name}`, groupName: groupOfClient.get(f.client.client_id)?.name || null });
      }
    }
    connected = [...found.values()].slice(0, 20);
  }

  res.json({ clients: shaped, connected, tasks, invoices, documents, employees });
}));
