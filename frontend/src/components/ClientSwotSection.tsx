import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";
import { fmtDateOnly } from "../utils/date";

interface ClientSwot {
  overview: string; strengths: string; weaknesses: string; opportunities: string; threats: string;
  taxRecommendations: string; staffingRecommendations: string; marketingRecommendations: string; growthRecommendations: string;
  additionalNotes: string;
  updatedBy: string | null; updatedAt: string | null;
}

const EMPTY_SWOT: ClientSwot = {
  overview: "", strengths: "", weaknesses: "", opportunities: "", threats: "",
  taxRecommendations: "", staffingRecommendations: "", marketingRecommendations: "", growthRecommendations: "",
  additionalNotes: "", updatedBy: null, updatedAt: null,
};

/**
 * Per-client business advisory analysis — a living document staff write and
 * revisit over time, not a dated log. Broader than a classic 4-box SWOT by
 * explicit ask: alongside Strengths/Weaknesses/Opportunities/Threats, staff
 * record concrete recommendations (tax savings + penalty/interest avoidance,
 * staffing, marketing, growth) and an open "Additional Notes" intake card
 * for anything else supporting the strategy. Edit -> Save/Cancel (not
 * auto-save), so a half-written analysis can't accidentally overwrite a
 * finished one — same shape ContractsSection uses elsewhere on this page.
 */
export function ClientSwotSection({ clientId }: { clientId: string }) {
  const toast = useToast();
  const notify = useNotify();
  const [swot, setSwot] = useState<ClientSwot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientSwot>(EMPTY_SWOT);
  const [saving, setSaving] = useState(false);

  function load() {
    setError(null);
    api.get<{ swot: ClientSwot }>(`/clients/${clientId}/swot`)
      .then((res) => setSwot(res.swot))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the business advisory analysis."));
  }
  useEffect(load, [clientId]);

  function startEditing() {
    setForm(swot || EMPTY_SWOT);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.patch(`/clients/${clientId}/swot`, form);
      toast("Business advisory analysis saved.");
      setEditing(false);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this analysis.");
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof ClientSwot, label: string, rows = 4) {
    return (
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={`swot-${key}`}>{label}</label>
        {editing ? (
          <textarea
            id={`swot-${key}`}
            rows={rows}
            value={(form[key] as string) || ""}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          />
        ) : (
          <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{(swot?.[key] as string) || <span className="muted">Not yet written.</span>}</p>
        )}
      </div>
    );
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!swot) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 15, margin: 0 }}>SWOT Analysis &amp; Business Advisory</h2>
          {swot.updatedBy && swot.updatedAt && (
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Last updated by {swot.updatedBy} on {fmtDateOnly(swot.updatedAt)}</p>
          )}
        </div>
        {!editing ? (
          <button type="button" className="btn btn-sm" onClick={startEditing}>Edit</button>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <div className="form-section-title">Business Overview</div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Where the business stands today.</p>
          {field("overview", "Overview", 3)}
        </div>

        <div>
          <div className="form-section-title">SWOT</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {field("strengths", "Strengths")}
            {field("weaknesses", "Weaknesses")}
            {field("opportunities", "Opportunities")}
            {field("threats", "Threats")}
          </div>
        </div>

        <div>
          <div className="form-section-title">Advisory Recommendations</div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Where the client can improve, save money, and grow.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {field("taxRecommendations", "Tax Strategy & Savings (incl. avoiding penalties & interest)")}
            {field("staffingRecommendations", "Staffing & Employees")}
            {field("marketingRecommendations", "Marketing")}
            {field("growthRecommendations", "Growth Plan")}
          </div>
        </div>

        <div>
          <div className="form-section-title">Additional Notes</div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Anything else supporting this strategy that doesn't fit above.</p>
          {field("additionalNotes", "Additional Notes", 5)}
        </div>
      </div>
    </div>
  );
}
