export interface CompanyCheckInfo {
  status: "match" | "mismatch" | "unknown";
  detectedName: string | null;
  reasons: string[];
  employees: { total: number; matched: number; clientHasEmployees: boolean };
  suggestedClients: { clientId: string; clientName: string; reason: string }[];
}

/** True when the import must stay blocked until staff tick the confirmation. */
export function companyCheckNeedsConfirm(check: CompanyCheckInfo | null | undefined, confirmed: boolean): boolean {
  return Boolean(check && check.status !== "match" && !confirmed);
}

/**
 * Shown on every payroll import preview: tells staff whether the file actually
 * belongs to the client they selected. A clear match stays out of the way; a
 * mismatch or a file that can't be identified blocks the import until it's
 * explicitly confirmed, and offers a one-click switch to the client the file
 * seems to belong to (matched by company name or by its employees).
 */
export function CompanyCheckBanner({ check, clientName, confirmed, onConfirmedChange, onSwitchClient }: {
  check: CompanyCheckInfo | null | undefined;
  clientName: string;
  confirmed: boolean;
  onConfirmedChange: (v: boolean) => void;
  onSwitchClient?: (clientId: string) => void;
}) {
  if (!check) return null;
  if (check.status === "match") {
    return (
      <div style={{ margin: "0 0 12px", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--teal)", background: "var(--surface-2, #f0f7f6)", fontSize: 13 }}>
        <strong style={{ color: "var(--teal)" }}>✓ Matches {clientName}.</strong>{" "}
        {check.detectedName ? `The file is for "${check.detectedName}".` : `${check.employees.matched} of ${check.employees.total} employee(s) in the file are already on this client's payroll.`}
        {check.reasons.map((r) => <div key={r} className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r}</div>)}
      </div>
    );
  }
  const mismatch = check.status === "mismatch";
  const color = mismatch ? "var(--red)" : "var(--amber)";
  return (
    <div role="alert" style={{ margin: "0 0 12px", padding: 14, borderRadius: 8, border: `2px solid ${color}`, background: mismatch ? "rgba(220, 38, 38, 0.06)" : "rgba(217, 119, 6, 0.07)" }}>
      <strong style={{ color, fontSize: 14 }}>
        {mismatch ? "This file may belong to a different client" : "Couldn't confirm which client this file is for"}
      </strong>
      {check.reasons.map((r) => <p key={r} style={{ fontSize: 13, margin: "6px 0 0" }}>{r}</p>)}
      {check.suggestedClients.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Looks like it belongs to:</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {check.suggestedClients.map((s) => (
              <div key={s.clientId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {onSwitchClient && <button type="button" className="btn btn-sm btn-primary" onClick={() => onSwitchClient(s.clientId)}>Switch to {s.clientName}</button>}
                <span className="muted" style={{ fontSize: 12 }}>{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 12, cursor: "pointer" }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirmedChange(e.target.checked)} />
        <span>I've checked — this file is for <strong>{clientName}</strong>. Import it anyway.</span>
      </label>
    </div>
  );
}
