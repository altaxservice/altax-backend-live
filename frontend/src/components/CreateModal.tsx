import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, ListPlus, Layers, Repeat, UserPlus, KeyRound, CreditCard,
  Receipt, Wallet, FileSpreadsheet, Banknote, BookOpen, FolderTree,
  Percent, Users, Printer, MessageSquareText, Settings2, PenTool,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface Tile {
  label: string;
  description: string;
  icon: typeof UserPlus;
  category: string;
  to?: string;
  roles?: string[];
  disabled?: boolean;
}

/** Soft-badge colors per category, reusing the app's existing semantic tokens (index.css :root) rather than introducing new ones. */
const CATEGORY_COLOR: Record<string, { fg: string; bg: string }> = {
  "Tasks & Rules": { fg: "var(--purple)", bg: "var(--purple-soft)" },
  Clients: { fg: "var(--blue)", bg: "var(--blue-soft)" },
  Billing: { fg: "var(--green)", bg: "var(--green-soft)" },
  Accounting: { fg: "var(--teal)", bg: "var(--teal-soft)" },
  Tools: { fg: "var(--amber)", bg: "var(--amber-soft)" },
  "Coming Soon": { fg: "var(--muted)", bg: "var(--surface)" },
};
/** Category order — deliberate (most-used first), not alphabetical. */
const CATEGORY_ORDER = ["Tasks & Rules", "Clients", "Billing", "Accounting", "Tools", "Coming Soon"];

const TILES: Tile[] = [
  { label: "New Work Item", description: "Create one task or request and assign it to clients.", icon: ListPlus, category: "Tasks & Rules", to: "/tasks" },
  { label: "Create Batch Tasks", description: "Create rule-based tasks for selected clients.", icon: Layers, category: "Tasks & Rules", to: "/rules", roles: ["admin", "staff"] },
  { label: "Task Rule", description: "Create or update recurring task rules.", icon: Repeat, category: "Tasks & Rules", to: "/rules", roles: ["admin", "staff"] },

  { label: "Add Client", description: "Create a new client profile.", icon: UserPlus, category: "Clients", to: "/clients?new=1", roles: ["admin", "staff"] },
  { label: "Portal User", description: "Invite or update portal access.", icon: KeyRound, category: "Clients", to: "/users", roles: ["admin"] },
  { label: "Payment Method", description: "Add ACH or check bank profile.", icon: CreditCard, category: "Clients", to: "/clients", roles: ["admin", "staff"] },

  { label: "Create Invoice", description: "Create a firm invoice for a client.", icon: Receipt, category: "Billing", to: "/billing", roles: ["admin", "staff"] },
  { label: "Record Payment", description: "Record payment against an open invoice.", icon: Wallet, category: "Billing", to: "/billing", roles: ["admin", "staff"] },

  { label: "Sales Input", description: "Enter sales tax period data.", icon: FileSpreadsheet, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Create Paycheck", description: "Open payroll check entry.", icon: Banknote, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Manual JE", description: "Create a manual journal entry.", icon: BookOpen, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "COA Account", description: "Add a chart of accounts item.", icon: FolderTree, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Tax Rate", description: "Update payroll or sales tax rates.", icon: Percent, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Add Employee", description: "Add an employee and payroll defaults.", icon: Users, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "W-2 Print/View", description: "Prepare employee W-2 preview.", icon: Printer, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },
  { label: "1099 Print/View", description: "Prepare contractor 1099 preview.", icon: Printer, category: "Accounting", to: "/accounting", roles: ["admin", "staff"] },

  { label: "Template", description: "Create or edit app message templates.", icon: MessageSquareText, category: "Tools", to: "/templates", roles: ["admin", "staff"] },

  { label: "MICR Calibration", description: "Open check alignment settings.", icon: Settings2, category: "Coming Soon", disabled: true },
  { label: "Check Designer", description: "Preview bottom-check layout.", icon: PenTool, category: "Coming Soon", disabled: true },
];

export function CreateModal({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const available = useMemo(() => TILES.filter((t) => !t.roles || (user && t.roles.includes(user.role))), [user]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? available.filter((t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
    : available;

  const byCategory = useMemo(() => {
    const map = new Map<string, Tile[]>();
    for (const t of filtered) {
      if (!map.has(t.category)) map.set(t.category, []);
      map.get(t.category)!.push(t);
    }
    return map;
  }, [filtered]);

  function go(t: Tile) {
    if (t.disabled || !t.to) return;
    navigate(t.to);
    onClose();
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) (onClose)(); }}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-modal-title"
        style={{ width: "min(860px, 100%)", padding: 0, overflow: "hidden", maxHeight: "82vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid var(--line)" }}>
          <div className="modal-header" style={{ marginBottom: 10 }}>
            <h2 id="create-modal-title">Create</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, border: "1px solid var(--line)", borderRadius: 8, padding: "8px 12px", background: "var(--surface)" }}>
            <Search size={16} color="var(--muted)" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search what to create or open…"
              style={{ flex: 1, border: "none", outline: "none", fontSize: 14, background: "transparent", color: "var(--ink)" }}
            />
          </div>
        </div>

        <div style={{ padding: "14px 24px 22px", overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <p className="muted" style={{ padding: "24px 0", textAlign: "center", fontSize: 13 }}>No matches for "{query}".</p>
          ) : (
            CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => {
              const colors = CATEGORY_COLOR[category] || CATEGORY_COLOR.Tools;
              return (
                <div key={category} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
                    {category}
                  </div>
                  <div className="create-grid">
                    {byCategory.get(category)!.map((t) => {
                      const Icon = t.icon;
                      return (
                        <button
                          key={t.label}
                          type="button"
                          className={`create-tile${t.disabled ? " create-tile-disabled" : ""}`}
                          disabled={t.disabled}
                          title={t.disabled ? "Not built yet in the new system." : undefined}
                          onClick={() => go(t)}
                        >
                          <span
                            className="create-tile-icon"
                            style={{ background: colors.bg, color: colors.fg }}
                            aria-hidden="true"
                          >
                            <Icon size={17} />
                          </span>
                          <span className="create-tile-text">
                            <strong>{t.label}</strong>
                            <span>{t.description}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
