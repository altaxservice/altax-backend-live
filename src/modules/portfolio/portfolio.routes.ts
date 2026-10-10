import { Router, Response } from "express";
import { query } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { loadClientNotices } from "../clients/clients.routes";
import { computeClientBooksPl } from "../accounting/accounting.routes";

/**
 * Portfolio — one row per business a client login is linked to, answering "which of my businesses needs me first?"
 * Everything here is the same data the single-business dashboard already shows (client-visible notices, open document
 * requests, unpaid invoices, tax payments, tasks, month-to-date books), just gathered for every linked business at once.
 * Scoped strictly to the caller's own v3_user_clients links. Client role only.
 */
export const portfolioRouter = Router();

const UPLOADED = ["received", "file uploaded", "ready for review"];
const DOC_DONE = ["closed", "completed", "void", "archived"];
const WAITING_STATUSES = ["waiting docs", "waiting on client", "pending", "additional information required"];
const TERMINAL = ["completed", "closed", "archived", "void"];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

portfolioRouter.get("/mine", requireAuth, requireRole("client"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const linked = await query<{ client_id: string; client_name: string }>(
    `SELECT uc.client_id, c.client_name FROM altax.v3_user_clients uc
       JOIN altax.v3_clients c ON c.client_id = uc.client_id
      WHERE uc.user_id = $1 AND (c.status IS NULL OR lower(c.status) NOT IN ('inactive', 'archived'))
      ORDER BY c.client_name ASC`,
    [req.user!.sub]
  );
  const now = new Date();
  const today = ymd(now);
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));

  const businesses = await Promise.all(linked.map(async (l) => {
    const id = l.client_id;
    const [docs, inv, tax, tasks, sale, notices, pl] = await Promise.all([
      query<any>(`SELECT due_from_client FROM altax.v3_document_requests WHERE client_id = $1 AND lower(COALESCE(status,'')) <> ALL($2::text[])`, [id, [...UPLOADED, ...DOC_DONE]]),
      query<any>(`SELECT balance_due, due_date FROM altax.v3_invoices WHERE client_id = $1 AND lower(COALESCE(status,'')) NOT IN ('paid','void')`, [id]),
      query<any>(`SELECT payment_amount, agency_due_date, task_name FROM altax.v3_tasks WHERE client_id = $1 AND payment_required = true AND paid_date IS NULL AND lower(COALESCE(status,'')) <> ALL($2::text[])`, [id, TERMINAL]),
      query<any>(`SELECT task_name, status, agency_due_date FROM altax.v3_tasks WHERE client_id = $1 AND lower(COALESCE(status,'')) <> ALL($2::text[]) ORDER BY agency_due_date ASC NULLS LAST`, [id, TERMINAL]),
      query<any>(
        `SELECT GREATEST((SELECT MAX(sale_date) FROM altax.v3_client_sales_drafts WHERE client_id = $1 AND status != 'Dismissed'),
                         (SELECT MAX(sale_date) FROM altax.v3_sales_input WHERE client_id = $1)) AS last_sale_date,
                (SELECT COUNT(*) FROM altax.v3_client_sales_drafts WHERE client_id = $1 AND status = 'Pending') AS pending_count`, [id]),
      loadClientNotices(id).catch(() => []),
      computeClientBooksPl(id, monthStart, today).catch(() => null),
    ]);

    const daysTo = (v: any) => (v ? Math.round((new Date(String(v).slice(0, 10) + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000) : null);
    const docsOverdue = docs.filter((d) => { const x = daysTo(d.due_from_client); return x !== null && x < 0; }).length;
    const invOverdue = inv.filter((i) => { const x = daysTo(i.due_date); return x !== null && x < 0; });
    const taxOverdue = tax.filter((t) => { const x = daysTo(t.agency_due_date); return x !== null && x < 0; }).length;
    const waiting = tasks.filter((t) => WAITING_STATUSES.includes(String(t.status || "").toLowerCase())).length;
    const redNotices = notices.filter((n) => n.color === "red");
    const amberNotices = notices.filter((n) => n.color === "amber");
    const next = tasks.find((t) => t.agency_due_date);
    const lastSale = sale[0]?.last_sale_date ? ymd(new Date(sale[0].last_sale_date)) : null;
    const salesGapDays = lastSale ? Math.round((new Date(today + "T00:00:00").getTime() - new Date(lastSale + "T00:00:00").getTime()) / 86400000) : null;
    const top = redNotices[0] || amberNotices[0] || null;

    const attention =
      redNotices.length * 50 + amberNotices.length * 15 + invOverdue.length * 30 + taxOverdue * 30 + docsOverdue * 20 +
      docs.length * 8 + waiting * 8 + (salesGapDays !== null && salesGapDays > 3 ? 10 : 0);

    return {
      clientId: id, clientName: l.client_name, attention,
      needs: {
        docs: docs.length, docsOverdue, waiting,
        noticesRed: redNotices.length, noticesAmber: amberNotices.length,
        topNotice: top ? { labelEn: top.labelEn, labelAr: top.labelAr, color: top.color } : null,
      },
      money: {
        invoiceBalance: inv.reduce((s, i) => s + Number(i.balance_due || 0), 0), invoiceCount: inv.length, invoiceOverdue: invOverdue.length,
        taxDue: tax.reduce((s, t) => s + Number(t.payment_amount || 0), 0), taxCount: tax.length, taxOverdue,
      },
      nextDeadline: next ? { date: ymd(new Date(next.agency_due_date)), name: next.task_name, days: daysTo(ymd(new Date(next.agency_due_date))) } : null,
      books: {
        lastSaleDate: lastSale, salesGapDays, pendingCount: Number(sale[0]?.pending_count || 0),
        monthNet: pl ? pl.netIncome : null, monthIncome: pl ? pl.totalIncome : null, monthExpenses: pl ? pl.totalExpenses : null,
      },
    };
  }));

  res.json({ businesses });
}));
