import { useEffect, useState } from "react";
import { api } from "../api/client";

export interface InvoiceActivityItem {
  type: "created" | "sent" | "send_failed" | "viewed" | "reminder" | "payment" | "void";
  at: string;
  title: string;
  detail?: string;
  actor?: string | null;
  ok?: boolean;
}

export interface InvoiceActivitySummary {
  sentCount: number; firstSentAt: string | null; lastSentAt: string | null; lastSentTo: string | null; lastSentChannel: string | null;
  viewCount: number; firstViewedAt: string | null; lastViewedAt: string | null;
  reminderCount: number; lastReminderAt: string | null;
  daysOverdue: number;
  stage: string;
}

interface ActivityResponse { items: InvoiceActivityItem[]; summary: InvoiceActivitySummary }

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const DOT_COLOR: Record<string, string> = {
  created: "var(--muted)", sent: "var(--blue)", viewed: "var(--teal)", reminder: "var(--amber)",
  payment: "var(--green)", void: "var(--red)", send_failed: "var(--red)",
};

const CHIP: Record<string, { bg: string; fg: string }> = {
  blue: { bg: "var(--blue-soft)", fg: "var(--blue)" },
  teal: { bg: "var(--teal-soft)", fg: "var(--teal)" },
  amber: { bg: "var(--amber-soft)", fg: "var(--amber)" },
  red: { bg: "var(--red-soft)", fg: "var(--red)" },
  gray: { bg: "var(--surface)", fg: "var(--muted)" },
};

function Chip({ tone, children }: { tone: keyof typeof CHIP; children: React.ReactNode }) {
  const c = CHIP[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Delivery chips for the invoice header: Sent, Viewed by client, Reminders, Overdue. */
export function InvoiceStatusChips({ summary }: { summary: InvoiceActivitySummary | null }) {
  if (!summary) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {summary.sentCount > 0
        ? <Chip tone="blue">Sent {fmtDay(summary.lastSentAt)}{summary.lastSentChannel ? ` · ${summary.lastSentChannel}` : ""}</Chip>
        : <Chip tone="gray">Not sent yet</Chip>}
      {summary.viewCount > 0
        ? <Chip tone="teal">Viewed by client {fmtDay(summary.firstViewedAt)}</Chip>
        : summary.sentCount > 0 && <Chip tone="gray">Not viewed yet</Chip>}
      {summary.reminderCount > 0 && <Chip tone="amber">{summary.reminderCount === 1 ? "1 reminder sent" : `${summary.reminderCount} reminders sent`}</Chip>}
      {summary.daysOverdue > 0 && <Chip tone="red">Overdue {summary.daysOverdue} {summary.daysOverdue === 1 ? "day" : "days"}</Chip>}
    </div>
  );
}

export function useInvoiceActivity(invoiceId: string | undefined, refreshKey: unknown): ActivityResponse | null {
  const [data, setData] = useState<ActivityResponse | null>(null);
  useEffect(() => {
    if (!invoiceId) return;
    let live = true;
    api.get<ActivityResponse>(`/billing/invoices/${invoiceId}/activity`)
      .then((r) => { if (live) setData(r); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [invoiceId, refreshKey]);
  return data;
}

export function InvoiceActivityCard({ items }: { items: InvoiceActivityItem[] }) {
  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Activity</h2>
      {items.length === 0 ? <p className="muted" style={{ margin: 0 }}>No activity yet.</p> : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((it, i) => (
            <li key={`${it.type}-${it.at}-${i}`} style={{ display: "grid", gridTemplateColumns: "14px 1fr", columnGap: 12, paddingBottom: i === items.length - 1 ? 0 : 14, position: "relative" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: "50%", background: DOT_COLOR[it.type] || "var(--muted)", marginTop: 5, justifySelf: "center", zIndex: 1 }} />
              {i < items.length - 1 && <span aria-hidden="true" style={{ position: "absolute", left: 6, top: 15, bottom: -2, width: 2, background: "var(--line)" }} />}
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: it.type === "send_failed" || it.ok === false ? "var(--red)" : "var(--ink)" }}>{it.title}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {fmtWhen(it.at)}{it.detail ? ` · ${it.detail}` : ""}{it.actor ? ` · by ${it.actor}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
