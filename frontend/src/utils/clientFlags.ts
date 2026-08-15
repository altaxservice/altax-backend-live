export interface ClientFlag {
  flagId: string | null;
  key: string;
  flagType: "BalancePastDue" | "AgencyPastDue" | "SalesTaxFilingDue" | "SalesTaxBalanceDue" | "Credit" | "Custom";
  amount: number | null;
  note: string | null;
  color: "red" | "green" | "amber";
  createdAt: string | null;
  createdBy: string | null;
  resolvable: boolean;
  linkTaskId?: string;
  linkUrl?: string;
  category?: string | null;
  details?: string | null;
  dueDate?: string | null;
  shareWithClient: boolean;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
}

export function fmtMoney(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "$0.00";
}

export function fmtDateOnly(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function flagLabel(f: ClientFlag): string {
  if (f.flagType === "BalancePastDue") return `Balance Past Due: ${fmtMoney(f.amount)}`;
  if (f.flagType === "AgencyPastDue") return `${f.note} Past Due${f.amount !== null ? `: ${fmtMoney(f.amount)}` : ""}`;
  if (f.flagType === "SalesTaxFilingDue") return `Sales Tax Filing ${f.note}`;
  if (f.flagType === "SalesTaxBalanceDue") return `Sales Tax Balance Due ${f.note}${f.amount !== null ? `: ${fmtMoney(f.amount)}` : ""}`;
  if (f.flagType === "Credit") return `Credit: ${fmtMoney(f.amount)}${f.note ? ` — ${f.note}` : ""}`;
  const label = f.category || f.note;
  return `${label}${f.amount !== null ? ` (${fmtMoney(f.amount)})` : ""}${f.dueDate ? ` — ${fmtDateOnly(f.dueDate)}` : ""}`;
}
