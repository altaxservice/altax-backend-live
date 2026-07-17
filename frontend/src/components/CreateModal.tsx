import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

interface Tile {
  label: string;
  description: string;
  to?: string;
  roles?: string[];
}

const TILES: Tile[] = [
  { label: "New Work Item", description: "Create one task or request and assign it to clients.", to: "/tasks" },
  { label: "Create Batch Tasks", description: "Create rule-based tasks for selected clients.", to: "/rules", roles: ["admin", "staff"] },
  { label: "Create Invoice", description: "Create a firm invoice for a client.", to: "/billing", roles: ["admin", "staff"] },
  { label: "Record Payment", description: "Record payment against an open invoice.", to: "/billing", roles: ["admin", "staff"] },
  { label: "Add Client", description: "Create a new client profile.", to: "/clients?new=1", roles: ["admin", "staff"] },
  { label: "Portal User", description: "Invite or update portal access.", to: "/users", roles: ["admin"] },
  { label: "Sales Input", description: "Enter sales tax period data.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Create Paycheck", description: "Open payroll check entry.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Manual JE", description: "Create a manual journal entry.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "COA Account", description: "Add a chart of accounts item.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Tax Rate", description: "Update payroll or sales tax rates.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Task Rule", description: "Create or update recurring task rules.", to: "/rules", roles: ["admin", "staff"] },
  { label: "Add Employee", description: "Add an employee and payroll defaults.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "Payment Method", description: "Add ACH or check bank profile.", to: "/clients", roles: ["admin", "staff"] },
  { label: "Template", description: "Create or edit app message templates.", to: "/templates", roles: ["admin", "staff"] },
  { label: "W-2 Print/View", description: "Prepare employee W-2 preview.", to: "/accounting", roles: ["admin", "staff"] },
  { label: "1099 Print/View", description: "Prepare contractor 1099 preview.", to: "/accounting", roles: ["admin", "staff"] },
];

const UNAVAILABLE: Tile[] = [
  { label: "MICR Calibration", description: "Open check alignment settings." },
  { label: "Check Designer", description: "Preview bottom-check layout." },
];

export function CreateModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const available = TILES.filter((t) => !t.roles || (user && t.roles.includes(user.role)));

  function go(to: string) {
    navigate(to);
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Create</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>Choose what to create or open.</p>
        <div className="create-grid">
          {available.map((t) => (
            <button key={t.label} type="button" className="create-tile" onClick={() => go(t.to!)}>
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </button>
          ))}
          {UNAVAILABLE.map((t) => (
            <div key={t.label} className="create-tile create-tile-disabled" title="Not built yet in the new system.">
              <strong>{t.label}</strong>
              <span>{t.description}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
