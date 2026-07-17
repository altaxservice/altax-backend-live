import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { getUserAliases } from "../../common/assignment";

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
  if (q.length < 2) return res.json({ clients: [], tasks: [], invoices: [], documents: [] });
  const like = `%${q}%`;

  const isAdmin = req.user!.role === "admin";
  const aliases = isAdmin ? [] : Array.from(await getUserAliases(req.user!.email));

  const clientScopeSql = isAdmin
    ? ""
    : `AND client_id IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($2::text[]))`;
  const taskScopeSql = isAdmin ? "" : `AND lower(assigned_to) = ANY($2::text[])`;

  const params = isAdmin ? [like] : [like, aliases];

  const [clients, tasks, invoices, documents] = await Promise.all([
    query(
      `SELECT client_id, client_name, email, phone, status FROM altax.v3_clients
        WHERE (client_name ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1) ${clientScopeSql}
        ORDER BY client_name ASC LIMIT ${RESULT_LIMIT}`,
      params
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
    query(
      `SELECT request_id, client_id, client_name, requested_item, status FROM altax.v3_document_requests
        WHERE (requested_item ILIKE $1 OR client_name ILIKE $1) ${clientScopeSql}
        ORDER BY request_date DESC NULLS LAST LIMIT ${RESULT_LIMIT}`,
      params
    ),
  ]);

  res.json({ clients, tasks, invoices, documents });
}));
