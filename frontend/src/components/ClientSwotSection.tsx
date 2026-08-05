import { useState, useEffect } from "react";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useNotify } from "./ConfirmProvider";
import { fmtDateOnly } from "../utils/date";

interface ClientSwot {
  overview: string; strengths: string; weaknesses: string; opportunities: string; threats: string;
  taxRecommendations: string; staffingRecommendations: string; marketingRecommendations: string; growthRecommendations: string;
  additionalNotes: string;
  // Business Intake — qualitative context no transaction in this system can
  // infer, gathered directly from the client/staff conversation.
  targetMarket: string; competitors: string; businessGoals: string; knownChallenges: string;
  updatedBy: string | null; updatedAt: string | null;
}

const EMPTY_SWOT: ClientSwot = {
  overview: "", strengths: "", weaknesses: "", opportunities: "", threats: "",
  taxRecommendations: "", staffingRecommendations: "", marketingRecommendations: "", growthRecommendations: "",
  additionalNotes: "", targetMarket: "", competitors: "", businessGoals: "", knownChallenges: "",
  updatedBy: null, updatedAt: null,
};

/** The 6 fields the "Auto-Fill" backend route can compute from real data — kept as a
 * const array (not hardcoded per call site) so the merge-only-blank-fields logic below
 * can't accidentally list a field the route doesn't actually return. */
const AUTO_DRAFT_FIELDS = ["overview", "strengths", "weaknesses", "opportunities", "threats", "taxRecommendations", "growthRecommendations"] as const;

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
  const [printBusy, setPrintBusy] = useState<"view" | "download" | null>(null);
  const [autoDrafting, setAutoDrafting] = useState(false);

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

  /**
   * Pulls draft text for the 6 data-backed fields (see AUTO_DRAFT_FIELDS)
   * from the deterministic auto-draft route and merges it into `form` —
   * but ONLY for fields that are currently blank. A field with existing
   * staff-written text is never touched, so this can never destroy work;
   * nothing saves until the normal Save click either. Entering edit mode
   * first (if not already) so staff see exactly what was filled in before
   * it's persisted.
   */
  async function handleAutoDraft() {
    setAutoDrafting(true);
    try {
      const res = await api.post<{ draft: Partial<ClientSwot> }>(`/clients/${clientId}/swot/autodraft`, {});
      const base = editing ? form : (swot || EMPTY_SWOT);
      const merged = { ...base };
      let filledCount = 0;
      for (const key of AUTO_DRAFT_FIELDS) {
        if (!base[key] && res.draft[key]) {
          merged[key] = res.draft[key] as string;
          filledCount++;
        }
      }
      setForm(merged);
      setEditing(true);
      toast(filledCount > 0 ? `Draft filled in ${filledCount} field${filledCount === 1 ? "" : "s"} — review and save.` : "No new data-backed observations to add right now — existing fields already have content, or there isn't enough data yet.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate a draft.");
    } finally {
      setAutoDrafting(false);
    }
  }

  async function handlePrint(mode: "view" | "download") {
    setPrintBusy(mode);
    try {
      if (mode === "view") await viewFile(`/reports/pdf/client-swot/${clientId}`);
      else await downloadFile(`/reports/pdf/client-swot/${clientId}`, `BusinessAdvisory_${clientId}.pdf`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate the report.");
    } finally {
      setPrintBusy(null);
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
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={handleAutoDraft} disabled={autoDrafting} title="Fills in Overview/Strengths/Weaknesses/Opportunities/Threats/Tax Strategy/Growth from real numbers already in the system — never overwrites a field that already has text.">{autoDrafting ? "Analyzing…" : "Auto-Fill from Business Data"}</button>
            <button type="button" className="btn btn-sm" onClick={() => handlePrint("view")} disabled={printBusy !== null}>{printBusy === "view" ? "Opening…" : "View Report"}</button>
            <button type="button" className="btn btn-sm" onClick={() => handlePrint("download")} disabled={printBusy !== null}>{printBusy === "download" ? "Downloading…" : "Download PDF"}</button>
            <button type="button" className="btn btn-sm" onClick={startEditing}>Edit</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={handleAutoDraft} disabled={autoDrafting}>{autoDrafting ? "Analyzing…" : "Auto-Fill from Business Data"}</button>
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
          <div className="form-section-title">Business Intake</div>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
            Context nothing in this system can compute — capture this directly from the client, it informs the Marketing/Staffing recommendations below.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {field("targetMarket", "Target Market")}
            {field("competitors", "Competitors")}
            {field("businessGoals", "Business Goals")}
            {field("knownChallenges", "Known Challenges")}
          </div>
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
          <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>Where the client can improve, save money, and grow. Tax Strategy and Growth Plan can be auto-filled above; Staffing and Marketing can't — the system tracks no staffing or marketing performance data, so use the Business Intake answers and your own judgment for those two.</p>
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
