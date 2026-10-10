import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { getUserAliases, resolveActiveClientId } from "../../common/assignment";

/**
 * Live counts for the sidebar — one cheap round trip that answers "what needs me?" per page, so the nav itself
 * shows where the work is instead of making people open each page to find out. Each count follows the same
 * visibility rules as the page it decorates (staff: their assigned clients; client: the selected business).
 * Only counts above zero are returned. Keys are route paths.
 */
export const navBadgesRouter = Router();

const TERMINAL_TASK = ["completed", "void", "closed", "archived"];
const UPLOADED = ["received", "file uploaded", "ready for review"];
const DOC_DONE = ["closed", "completed", "void", "archived"];

navBadgesRouter.get("/", requireAuth, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const role = req.user!.role;
  const out: Record<string, { count: number; tone: "red" | "amber" | "blue" }> = {};
  const put = (path: string, count: number, tone: "red" | "amber" | "blue") => { if (count > 0) out[path] = { count, tone }; };
  const n = async (sql: string, params: any[] = []) => Number((await query<any>(sql, params))[0]?.n || 0);

  if (role === "admin" || role === "staff") {
    const isAdmin = role === "admin";
    const aliases = isAdmin ? [] : Array.from(await getUserAliases(req.user!.email));
    const scope = (col: string, idx: number) => (isAdmin ? "" : `AND ${col} IN (SELECT DISTINCT client_id FROM altax.v3_tasks WHERE lower(assigned_to) = ANY($${idx}::text[]))`);
    const [overdueTasks, docsReview, overdueInv, apptsToday] = await Promise.all([
      n(`SELECT COUNT(*) AS n FROM altax.v3_tasks WHERE COALESCE(is_parked,false) = false AND lower(COALESCE(status,'')) <> ALL($1::text[])
           AND agency_due_date IS NOT NULL AND agency_due_date < date_trunc('day', now()) ${isAdmin ? "" : "AND lower(assigned_to) = ANY($2::text[])"}`,
        isAdmin ? [TERMINAL_TASK] : [TERMINAL_TASK, aliases]),
      n(`SELECT COUNT(*) AS n FROM altax.v3_document_requests WHERE lower(COALESCE(status,'')) = ANY($1::text[]) ${scope("client_id", 2)}`,
        isAdmin ? [UPLOADED] : [UPLOADED, aliases]),
      n(`SELECT COUNT(*) AS n FROM altax.v3_invoices WHERE lower(COALESCE(status,'')) NOT IN ('paid','void') AND due_date IS NOT NULL AND due_date < current_date ${scope("client_id", 1)}`,
        isAdmin ? [] : [aliases]),
      n(`SELECT COUNT(*) AS n FROM altax.v3_appointments WHERE status = 'Scheduled' AND start_time >= date_trunc('day', now()) AND start_time < date_trunc('day', now()) + interval '1 day'
           ${isAdmin ? "" : "AND lower(assigned_to) = ANY($1::text[])"}`,
        isAdmin ? [] : [aliases]),
    ]);
    put("/tasks", overdueTasks, "red");
    put("/documents", docsReview, "blue");
    put("/billing", overdueInv, "amber");
    put("/calendar", apptsToday, "blue");
  } else if (role === "client") {
    const clientId = await resolveActiveClientId(req.user!, req.query.clientId);
    if (clientId) {
      const [docs, inv] = await Promise.all([
        n(`SELECT COUNT(*) AS n FROM altax.v3_document_requests WHERE client_id = $1 AND lower(COALESCE(status,'')) <> ALL($2::text[])`, [clientId, [...UPLOADED, ...DOC_DONE]]),
        n(`SELECT COUNT(*) AS n FROM altax.v3_invoices WHERE client_id = $1 AND lower(COALESCE(status,'')) NOT IN ('paid','void')`, [clientId]),
      ]);
      put("/documents", docs, "amber");
      put("/billing", inv, "amber");
    }
  } else if (role === "employee" && req.user!.employeeId) {
    const forms = await n(`SELECT COUNT(*) AS n FROM altax.v3_gov_form_filings WHERE employee_id = $1 AND sent_to_employee_at IS NOT NULL AND status = 'Draft'`, [req.user!.employeeId]);
    put("/my-tax-forms", forms, "amber");
  }
  res.json({ badges: out });
}));
