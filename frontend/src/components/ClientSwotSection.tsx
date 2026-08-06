import { useState, useEffect, Fragment } from "react";
import { api, ApiError, viewFile, downloadFile } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useToast } from "./Toast";
import { useNotify, useConfirm } from "./ConfirmProvider";
import { fmtDateOnly } from "../utils/date";

interface ClientSwot {
  overview: string; strengths: string; weaknesses: string; opportunities: string; threats: string;
  taxRecommendations: string; staffingRecommendations: string; marketingRecommendations: string; growthRecommendations: string;
  additionalNotes: string;
  // Business Intake — 12 specific questions across 6 categories, gathered
  // directly from the client/staff conversation. Nothing in this system can
  // compute these; they inform the Staffing/Marketing/Growth Plan fields below.
  typicalCustomer: string; serviceArea: string;
  topCompetitors: string; competitiveEdge: string;
  customerAcquisition: string; currentMarketing: string;
  staffingLevel: string; staffingChallenges: string;
  topGoal: string; expansionPlans: string;
  dailyChallenge: string; financialConcerns: string;
  updatedBy: string | null; updatedAt: string | null;
}

const EMPTY_SWOT: ClientSwot = {
  overview: "", strengths: "", weaknesses: "", opportunities: "", threats: "",
  taxRecommendations: "", staffingRecommendations: "", marketingRecommendations: "", growthRecommendations: "",
  additionalNotes: "",
  typicalCustomer: "", serviceArea: "", topCompetitors: "", competitiveEdge: "",
  customerAcquisition: "", currentMarketing: "", staffingLevel: "", staffingChallenges: "",
  topGoal: "", expansionPlans: "", dailyChallenge: "", financialConcerns: "",
  updatedBy: null, updatedAt: null,
};

/** One category of the Business Intake Q&A — grouped rendering, question text shown as the field label instead of a generic name. */
const INTAKE_CATEGORIES: { title: string; questions: { key: keyof ClientSwot; label: string }[] }[] = [
  { title: "Target Market & Customers", questions: [
    { key: "typicalCustomer", label: "Who is your typical customer? (age, income level, what they need)" },
    { key: "serviceArea", label: "What's your primary service area or neighborhood?" },
  ] },
  { title: "Competitive Position", questions: [
    { key: "topCompetitors", label: "Who are your top 1–2 competitors, and what do they do better or worse than you?" },
    { key: "competitiveEdge", label: "What makes a customer choose you over them?" },
  ] },
  { title: "Marketing & Customer Acquisition", questions: [
    { key: "customerAcquisition", label: "How do most new customers currently find you? (walk-in, referral, online, signage)" },
    { key: "currentMarketing", label: "Do you currently do any marketing (social media, flyers, promotions)? What's worked or not?" },
  ] },
  { title: "Staffing & Operations", questions: [
    { key: "staffingLevel", label: "How many employees do you have, and is that enough for current demand?" },
    { key: "staffingChallenges", label: "Is hiring, turnover, or workload capacity a challenge right now?" },
  ] },
  { title: "Business Goals", questions: [
    { key: "topGoal", label: "What's the #1 goal for this business over the next 12 months?" },
    { key: "expansionPlans", label: "Are you considering a new location, product/service line, or major purchase?" },
  ] },
  { title: "Known Challenges & Risks", questions: [
    { key: "dailyChallenge", label: "What's the biggest day-to-day headache in running this business right now?" },
    { key: "financialConcerns", label: "Anything financial or regulatory keeping you up at night? (lease renewal, new law, supplier change)" },
  ] },
];

/** The 6 fields the "Auto-Fill" backend route can compute from real data — kept as a
 * const array (not hardcoded per call site) so the merge-only-blank-fields logic below
 * can't accidentally list a field the route doesn't actually return. */
const AUTO_DRAFT_FIELDS = ["overview", "strengths", "weaknesses", "opportunities", "threats", "taxRecommendations", "growthRecommendations"] as const;

interface SwotFinding {
  findingId: string; category: string; subcategory: string | null; findingText: string; supportingData: string;
  businessImpact: string | null; priority: string; recommendedAction: string | null; responsibleParty: string | null;
  targetDate: string | null; status: string; dataType: string; source: string; autoTriggerKey: string | null;
  editedByStaff: boolean; reviewedBy: string | null; reviewedAt: string | null; dismissedReason: string | null;
  createdBy: string | null; createdAt: string; resolvedBy: string | null; resolvedAt: string | null; updatedAt: string;
}

const FINDING_CATEGORIES = ["Strength", "Weakness", "Opportunity", "Threat", "Recommendation"] as const;
const FINDING_SUBCATEGORIES = ["Tax", "Staffing", "Marketing", "Growth", "CostReduction", "RevenueGrowth", "CashFlow", "Compliance"] as const;
const FINDING_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
const FINDING_DATA_TYPES = ["Fact", "Estimate", "Assumption", "Recommendation"] as const;

const EMPTY_NEW_FINDING = {
  category: "Weakness" as string, subcategory: "" as string, findingText: "", supportingData: "",
  businessImpact: "", priority: "Medium" as string, recommendedAction: "", responsibleParty: "", targetDate: "", dataType: "Assumption" as string,
};

function priorityPillClass(p: string): string {
  return p === "Urgent" ? "status-red" : p === "High" ? "status-amber" : p === "Medium" ? "status-blue" : "status-gray";
}
function statusPillClass(s: string): string {
  return s === "Open" ? "status-amber" : s === "In Progress" ? "status-blue" : s === "Resolved" ? "status-green" : "status-gray";
}

/**
 * Structured findings — one row per discrete finding, each carrying the 8
 * elements a real advisory item needs (finding, supporting data, impact,
 * priority, recommended action, owner, due date, status). Sits above the
 * free-text narrative fields below (v3_client_swot) — that's still the
 * "executive summary" prose staff write; this is the trackable action list.
 * "Generate Findings Now" runs the same deterministic rule engine behind
 * "Auto-Fill from Business Data" but produces individually-actionable rows
 * instead of one merged paragraph, and only ever adds a NEW row for a
 * condition that doesn't already have an open one — it can never duplicate
 * or silently overwrite something staff already edited.
 */
function FindingsPanel({ clientId }: { clientId: string }) {
  const toast = useToast();
  const notify = useNotify();
  const confirm = useConfirm();
  const [findings, setFindings] = useState<SwotFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<SwotFinding>>({});
  const [adding, setAdding] = useState(false);
  const [newFinding, setNewFinding] = useState(EMPTY_NEW_FINDING);
  const [savingNew, setSavingNew] = useState(false);

  function load() {
    setError(null);
    api.get<{ findings: SwotFinding[] }>(`/clients/${clientId}/swot-findings`)
      .then((res) => setFindings(res.findings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load findings."));
  }
  useEffect(load, [clientId]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const res = await api.post<{ created: number; evaluated: number }>(`/clients/${clientId}/swot-findings/generate`, {});
      toast(res.created > 0 ? `${res.created} new finding${res.created === 1 ? "" : "s"} added — review below.` : "No new findings right now — everything data-backed is already tracked or unchanged.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not generate findings.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleResolve(findingId: string) {
    setBusyId(findingId);
    try {
      await api.post(`/clients/${clientId}/swot-findings/${findingId}/resolve`, {});
      toast("Finding resolved.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not resolve this finding.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(findingId: string) {
    const ok = await confirm({ message: "Dismiss this finding? It will move to the closed list.", confirmLabel: "Dismiss" });
    if (!ok) return;
    setBusyId(findingId);
    try {
      await api.post(`/clients/${clientId}/swot-findings/${findingId}/dismiss`, {});
      toast("Finding dismissed.");
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not dismiss this finding.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleQuickUpdate(findingId: string, patch: Partial<SwotFinding>) {
    setBusyId(findingId);
    try {
      await api.patch(`/clients/${clientId}/swot-findings/${findingId}`, patch);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not update this finding.");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(f: SwotFinding) {
    setEditingId(f.findingId);
    setEditForm({ findingText: f.findingText, supportingData: f.supportingData, businessImpact: f.businessImpact || "", recommendedAction: f.recommendedAction || "" });
  }

  async function saveEdit(findingId: string) {
    setBusyId(findingId);
    try {
      await api.patch(`/clients/${clientId}/swot-findings/${findingId}`, editForm);
      toast("Finding updated.");
      setEditingId(null);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this finding.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleAddFinding() {
    if (!newFinding.findingText.trim()) return;
    setSavingNew(true);
    try {
      await api.post(`/clients/${clientId}/swot-findings`, {
        ...newFinding,
        subcategory: newFinding.category === "Recommendation" ? (newFinding.subcategory || null) : null,
        targetDate: newFinding.targetDate || null,
      });
      toast("Finding added.");
      setNewFinding(EMPTY_NEW_FINDING);
      setAdding(false);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not add this finding.");
    } finally {
      setSavingNew(false);
    }
  }

  if (error) return <ErrorBanner error={error} onRetry={load} />;

  const visible = (findings || []).filter((f) => showClosed || (f.status !== "Resolved" && f.status !== "Dismissed"));

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 15, margin: 0 }}>Structured Findings &amp; Action Items</h2>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>Each row traces to real data — finding, impact, priority, owner, due date, and status, all trackable.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show resolved/dismissed
          </label>
          <button type="button" className="btn btn-sm" onClick={() => setAdding((v) => !v)}>{adding ? "Cancel" : "+ Add Finding"}</button>
          <button type="button" className="btn btn-sm" onClick={handleGenerate} disabled={generating} title="Runs the same deterministic engine as Auto-Fill, but produces trackable rows instead of one paragraph — never duplicates an already-open finding.">{generating ? "Analyzing…" : "Generate Findings Now"}</button>
        </div>
      </div>

      {adding && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Category</label>
              <select value={newFinding.category} onChange={(e) => setNewFinding((f) => ({ ...f, category: e.target.value }))}>
                {FINDING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {newFinding.category === "Recommendation" && (
              <div className="field" style={{ margin: 0 }}>
                <label>Subcategory</label>
                <select value={newFinding.subcategory} onChange={(e) => setNewFinding((f) => ({ ...f, subcategory: e.target.value }))}>
                  <option value="">—</option>
                  {FINDING_SUBCATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
            <div className="field" style={{ margin: 0 }}>
              <label>Priority</label>
              <select value={newFinding.priority} onChange={(e) => setNewFinding((f) => ({ ...f, priority: e.target.value }))}>
                {FINDING_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Data Type</label>
              <select value={newFinding.dataType} onChange={(e) => setNewFinding((f) => ({ ...f, dataType: e.target.value }))}>
                {FINDING_DATA_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Finding</label>
            <textarea rows={2} value={newFinding.findingText} onChange={(e) => setNewFinding((f) => ({ ...f, findingText: e.target.value }))} placeholder="What did you observe?" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Supporting Data</label>
            <textarea rows={2} value={newFinding.supportingData} onChange={(e) => setNewFinding((f) => ({ ...f, supportingData: e.target.value }))} placeholder="The real number or fact behind this finding." />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Business Impact</label>
              <input value={newFinding.businessImpact} onChange={(e) => setNewFinding((f) => ({ ...f, businessImpact: e.target.value }))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Recommended Action</label>
              <input value={newFinding.recommendedAction} onChange={(e) => setNewFinding((f) => ({ ...f, recommendedAction: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Responsible Party</label>
              <input value={newFinding.responsibleParty} onChange={(e) => setNewFinding((f) => ({ ...f, responsibleParty: e.target.value }))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Target Date</label>
              <input type="date" value={newFinding.targetDate} onChange={(e) => setNewFinding((f) => ({ ...f, targetDate: e.target.value }))} />
            </div>
          </div>
          <div>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleAddFinding} disabled={savingNew || !newFinding.findingText.trim()}>{savingNew ? "Saving…" : "Add Finding"}</button>
          </div>
        </div>
      )}

      {!findings ? (
        <div className="spinner-wrap">Loading…</div>
      ) : visible.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>No {showClosed ? "" : "open "}findings yet. Click "Generate Findings Now" to draft from real business data, or add one manually.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Category</th><th>Finding</th><th>Priority</th><th>Owner</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visible.map((f) => (
                <Fragment key={f.findingId}>
                  <tr>
                    <td>
                      {f.category}{f.subcategory ? ` · ${f.subcategory}` : ""}
                      {f.source === "Auto" && <span className="badge" style={{ marginLeft: 6, fontSize: 9 }}>Auto</span>}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <div>{f.findingText}</div>
                      {f.recommendedAction && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Recommended: {f.recommendedAction}</div>}
                    </td>
                    <td>
                      <select className={`inline-select ${priorityPillClass(f.priority)}`} value={f.priority} disabled={busyId === f.findingId} onChange={(e) => handleQuickUpdate(f.findingId, { priority: e.target.value })}>
                        {FINDING_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        key={f.responsibleParty || ""} style={{ fontSize: 12.5, width: 110 }} defaultValue={f.responsibleParty || ""} placeholder="Unassigned"
                        onBlur={(e) => { if (e.target.value !== (f.responsibleParty || "")) handleQuickUpdate(f.findingId, { responsibleParty: e.target.value }); }}
                      />
                    </td>
                    <td>
                      <input
                        type="date" key={f.targetDate || ""} style={{ fontSize: 12.5, width: 130 }} defaultValue={f.targetDate || ""}
                        onBlur={(e) => { if (e.target.value !== (f.targetDate || "")) handleQuickUpdate(f.findingId, { targetDate: (e.target.value || null) as any }); }}
                      />
                    </td>
                    <td><span className={`status-pill ${statusPillClass(f.status)}`}>{f.status}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {f.status !== "Resolved" && f.status !== "Dismissed" && (
                          <>
                            <button type="button" className="btn btn-sm" onClick={() => startEdit(f)}>Edit</button>
                            <button type="button" className="btn btn-sm" onClick={() => handleResolve(f.findingId)} disabled={busyId === f.findingId}>Resolve</button>
                            <button type="button" className="btn btn-sm" onClick={() => handleDismiss(f.findingId)} disabled={busyId === f.findingId}>Dismiss</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editingId === f.findingId && (
                    <tr key={`${f.findingId}-edit`}>
                      <td colSpan={7}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, background: "var(--paper-alt, #f8f9fb)", borderRadius: 6 }}>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Finding</label>
                            <textarea rows={2} value={editForm.findingText || ""} onChange={(e) => setEditForm((v) => ({ ...v, findingText: e.target.value }))} />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Supporting Data</label>
                            <textarea rows={2} value={editForm.supportingData || ""} onChange={(e) => setEditForm((v) => ({ ...v, supportingData: e.target.value }))} />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Business Impact</label>
                            <input value={editForm.businessImpact || ""} onChange={(e) => setEditForm((v) => ({ ...v, businessImpact: e.target.value }))} />
                          </div>
                          <div className="field" style={{ margin: 0 }}>
                            <label>Recommended Action</label>
                            <input value={editForm.recommendedAction || ""} onChange={(e) => setEditForm((v) => ({ ...v, recommendedAction: e.target.value }))} />
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => saveEdit(f.findingId)} disabled={busyId === f.findingId}>Save</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <FindingsPanel clientId={clientId} />
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
          <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
            Context nothing in this system can compute — ask the client these directly, they inform the Marketing/Staffing/Growth recommendations below.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {INTAKE_CATEGORIES.map((cat) => (
              <div key={cat.title}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>{cat.title}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {cat.questions.map((q) => field(q.key, q.label, 2))}
                </div>
              </div>
            ))}
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
    </div>
  );
}
