/**
 * Invoice delivery status and activity timeline: created, sent (and failed sends), opened by the client, reminders,
 * payments, void. Sends and views are stored as events (v3_invoice_events); reminders live in v3_communications and
 * payments in v3_payments, so the timeline merges all three.
 */
import crypto from "crypto";
import { query, queryOne } from "../config/db";

export type InvoiceEventType = "sent" | "send_failed" | "viewed";

export async function recordInvoiceEvent(
  invoiceId: string, type: InvoiceEventType,
  opts: { channel?: string | null; sentTo?: string | null; detail?: string | null; actor?: string | null } = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO altax.v3_invoice_events (event_id, invoice_id, event_type, channel, sent_to, detail, actor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [`EVT-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`, invoiceId, type,
        opts.channel ? opts.channel.toLowerCase() : null, opts.sentTo || null, opts.detail || null, opts.actor || null]
    );
  } catch (err) {
    // A status trail must never break sending or viewing an invoice.
    // eslint-disable-next-line no-console
    console.error("[invoiceEvents] could not record event:", err);
  }
}

/** A client's repeat visits within this window count as one view. */
const VIEW_DEBOUNCE_MINUTES = 30;

export async function recordInvoiceView(invoiceId: string): Promise<void> {
  const recent = await queryOne<any>(
    `SELECT 1 FROM altax.v3_invoice_events WHERE invoice_id = $1 AND event_type = 'viewed' AND occurred_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [invoiceId, String(VIEW_DEBOUNCE_MINUTES)]
  ).catch(() => null);
  if (!recent) await recordInvoiceEvent(invoiceId, "viewed", { actor: "Client" });
}

export interface ActivityItem {
  type: "created" | "sent" | "send_failed" | "viewed" | "reminder" | "payment" | "void";
  at: string;
  title: string;
  detail?: string;
  actor?: string | null;
  ok?: boolean;
}

export interface InvoiceActivity {
  items: ActivityItem[];
  summary: {
    sentCount: number; firstSentAt: string | null; lastSentAt: string | null; lastSentTo: string | null; lastSentChannel: string | null;
    viewCount: number; firstViewedAt: string | null; lastViewedAt: string | null;
    reminderCount: number; lastReminderAt: string | null;
    daysOverdue: number;
    /** One plain-language stage, furthest along first: Void, Paid, Partially paid, Overdue, Reminder sent, Viewed by client, Sent, Not sent yet. */
    stage: string;
  };
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const money = (n: unknown) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** SQL fragments for the invoices list: per-invoice counts without loading every event. */
export const INVOICE_STATUS_COLUMNS = `
  (SELECT MIN(e.occurred_at) FROM altax.v3_invoice_events e WHERE e.invoice_id = i.invoice_id AND e.event_type = 'sent') AS first_sent_at,
  (SELECT MIN(e.occurred_at) FROM altax.v3_invoice_events e WHERE e.invoice_id = i.invoice_id AND e.event_type = 'viewed') AS first_viewed_at,
  (SELECT COUNT(*)::int FROM altax.v3_communications c WHERE c.source_system = 'Reminders'
      AND (c.source_record_id = 'PAYREM-' || i.invoice_id OR c.source_record_id LIKE 'PAYREM-MANUAL-' || i.invoice_id || '-%')) AS reminder_count`;

export async function loadInvoiceActivity(invoice: any): Promise<InvoiceActivity> {
  const id = invoice.invoice_id;
  const [events, reminders, payments] = await Promise.all([
    query<any>(`SELECT * FROM altax.v3_invoice_events WHERE invoice_id = $1 ORDER BY occurred_at ASC`, [id]),
    query<any>(
      `SELECT channel, subject, sent_to, sent_by, sent_at, status, source_record_id FROM altax.v3_communications
        WHERE source_system = 'Reminders' AND (source_record_id = $1 OR source_record_id LIKE $2) ORDER BY sent_at ASC`,
      [`PAYREM-${id}`, `PAYREM-MANUAL-${id}-%`]
    ),
    query<any>(`SELECT payment_date, actual_amount, method, status FROM altax.v3_payments WHERE invoice_id = $1 ORDER BY payment_date ASC NULLS LAST`, [id]),
  ]);

  const items: ActivityItem[] = [];
  if (invoice.created_at) items.push({ type: "created", at: iso(invoice.created_at)!, title: "Invoice created", detail: invoice.source_system && invoice.source_system !== "Node Web App" ? `From ${invoice.source_system}` : undefined });

  for (const e of events) {
    if (e.event_type === "sent") {
      items.push({ type: "sent", at: iso(e.occurred_at)!, title: `Sent by ${e.channel || "email"}`, detail: e.sent_to ? `to ${e.sent_to}` : undefined, actor: e.actor, ok: true });
    } else if (e.event_type === "send_failed") {
      items.push({ type: "send_failed", at: iso(e.occurred_at)!, title: `Sending by ${e.channel || "email"} failed`, detail: e.detail || undefined, actor: e.actor, ok: false });
    } else if (e.event_type === "viewed") {
      items.push({ type: "viewed", at: iso(e.occurred_at)!, title: "Opened by the client", detail: "Viewed the invoice online" });
    }
  }
  for (const r of reminders) {
    const failed = /^(failed|saved\s*—)/i.test(String(r.status || ""));
    const manual = String(r.source_record_id).startsWith("PAYREM-MANUAL-");
    const urgent = /^\[urgent\]/i.test(String(r.subject || ""));
    items.push({
      type: "reminder", at: iso(r.sent_at)!, ok: !failed,
      title: `${urgent ? "Urgent reminder" : "Payment reminder"} ${failed ? "failed" : "sent"} by ${String(r.channel || "email").toLowerCase()}`,
      detail: [manual ? "Sent manually" : "Automatic reminder", r.sent_to ? `to ${r.sent_to}` : ""].filter(Boolean).join(" ") || undefined, actor: r.sent_by,
    });
  }
  for (const p of payments) {
    if (String(p.status || "").toLowerCase().startsWith("revers")) continue;
    items.push({ type: "payment", at: iso(p.payment_date) || iso(invoice.updated_at)!, title: `Payment of ${money(p.actual_amount)} received`, detail: p.method || undefined, ok: true });
  }
  if (String(invoice.status || "").toLowerCase() === "void") items.push({ type: "void", at: iso(invoice.updated_at)!, title: "Invoice voided" });
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const sends = events.filter((e: any) => e.event_type === "sent");
  const views = events.filter((e: any) => e.event_type === "viewed");
  const okReminders = reminders.filter((r: any) => !/^(failed|saved\s*—)/i.test(String(r.status || "")));
  const lastSend = sends[sends.length - 1];
  const due = invoice.due_date ? new Date(invoice.due_date) : null;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const daysOverdue = due && Number(invoice.balance_due) > 0 ? Math.max(0, Math.floor((today.getTime() - new Date(due.toISOString().slice(0, 10)).getTime()) / 86400000)) : 0;

  const status = String(invoice.status || "").toLowerCase();
  const stage = status === "void" ? "Void"
    : Number(invoice.balance_due) <= 0 ? "Paid"
    : Number(invoice.amount_paid) > 0 ? "Partially paid"
    : daysOverdue > 0 ? "Overdue"
    : okReminders.length ? "Reminder sent"
    : views.length ? "Viewed by client"
    : sends.length ? "Sent"
    : "Not sent yet";

  return {
    items,
    summary: {
      sentCount: sends.length, firstSentAt: iso(sends[0]?.occurred_at), lastSentAt: iso(lastSend?.occurred_at), lastSentTo: lastSend?.sent_to || null, lastSentChannel: lastSend?.channel || null,
      viewCount: views.length, firstViewedAt: iso(views[0]?.occurred_at), lastViewedAt: iso(views[views.length - 1]?.occurred_at),
      reminderCount: okReminders.length, lastReminderAt: iso(okReminders[okReminders.length - 1]?.sent_at),
      daysOverdue, stage,
    },
  };
}

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 — easy to read aloud and retype

/** Short invoice number for new invoices: INV-YYMMDD-XXXXX (e.g. INV-261008-K7M2Q). Older long numbers stay as they are. */
export function newInvoiceId(): string {
  const d = new Date();
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const bytes = crypto.randomBytes(5);
  let tail = "";
  for (let i = 0; i < 5; i++) tail += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return `INV-${yymmdd}-${tail}`;
}
