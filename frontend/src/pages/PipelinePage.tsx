import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download, Plus, ArrowRight, PartyPopper, Undo2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { money, stageForEstimate, type Estimate, type StageLabel } from "../api/estimates";
import { useStickyState } from "../utils/listState";
import { exportCsv } from "../components/FilterBar";
import { FIRM_SERVICES } from "../utils/clientOptions";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

/**
 * Pipeline — the same Estimates data as the Estimates list, viewed as a sales
 * funnel instead of a table. New/Contacted/Proposal Sent are plain status
 * writes; Won/Lost reuse the same approve/decline fields the Estimate detail
 * page already stamps, so a card moved here and an estimate approved there
 * are the exact same action.
 *
 * Redesigned 2026-08-14 (owner feedback: "should be 1-2-3 steps to become a
 * client") — moving a card to Won already auto-approves the estimate
 * server-side (see /:estimateId/stage), so the only step that used to be
 * missing from this board was Convert to Client itself, previously reachable
 * only from the separate Estimate detail page. It now lives directly on the
 * Won card. Cards also show a single "move forward" action instead of every
 * other stage at once, so the board reads as a straight line: New → Contacted
 * → Proposal Sent → Won → Client.
 */
const STAGE_ORDER: StageLabel[] = ["New", "Contacted", "Proposal Sent", "Won"];
const COLUMNS: { stage: StageLabel; label: string; step: number }[] = [
  { stage: "New", label: "New", step: 1 },
  { stage: "Contacted", label: "Contacted", step: 2 },
  { stage: "Proposal Sent", label: "Proposal Sent", step: 3 },
];

const PERIODS = ["This Month", "This Quarter", "All Time"] as const;
type Period = (typeof PERIODS)[number];

function withinPeriod(dateStr: string | null, period: Period): boolean {
  if (period === "All Time") return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  if (period === "This Month") {
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  const q = (m: number) => Math.floor(m / 3);
  return d.getFullYear() === now.getFullYear() && q(d.getMonth()) === q(now.getMonth());
}

export function PipelinePage() {
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useStickyState<Period>("pipeline.period", "This Quarter");
  const [search, setSearch] = useState("");
  const [showNewProspect, setShowNewProspect] = useState(false);

  function load(): Promise<void> {
    return api.get<{ estimates: Estimate[] }>("/estimates")
      .then((res) => setEstimates(res.estimates))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the pipeline."));
  }
  useEffect(() => { load(); }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  function handleExportCsv() {
    exportCsv(
      "pipeline.csv",
      [
        { key: "business_name", label: "Client" }, { key: "status", label: "Status" },
        { key: "estimate_date", label: "Date" }, { key: "total", label: "Total" },
      ],
      (estimates || []).map((e) => ({ business_name: e.business_name, status: e.status, estimate_date: e.estimate_date, total: e.totals?.total ?? "" }))
    );
  }

  const byStage = useMemo(() => {
    const grouped: Record<StageLabel, Estimate[]> = { New: [], Contacted: [], "Proposal Sent": [], Won: [], Lost: [] };
    const q = search.trim().toLowerCase();
    for (const e of estimates || []) {
      if (q && ![e.business_name, e.estimate_number, e.entity_type, e.business_type, e.jurisdiction, e.totals?.total].some((v) => String(v ?? "").toLowerCase().includes(q))) continue;
      const stage = stageForEstimate(e.status);
      if (stage) grouped[stage].push(e);
    }
    return grouped;
  }, [estimates, search]);

  const conversionStats = useMemo(() => {
    const won = (estimates || []).filter((e) => e.status === "Approved" && withinPeriod(e.estimate_date, period));
    const lost = (estimates || []).filter((e) => e.status === "Declined" && withinPeriod(e.estimate_date, period));
    const total = won.length + lost.length;
    const rate = total > 0 ? (won.length / total) * 100 : null;
    return { won: won.length, lost: lost.length, rate };
  }, [estimates, period]);

  async function moveTo(estimateId: string, stage: StageLabel) {
    setMoving(estimateId);
    try {
      await api.post(`/estimates/${estimateId}/stage`, { stage });
      setEstimates((prev) =>
        (prev || []).map((e) => (e.estimate_id === estimateId ? { ...e, status: STAGE_TO_STATUS_LOCAL[stage] } : e))
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not move this card.");
    } finally {
      setMoving(null);
    }
  }

  async function handleConvert(estimateId: string) {
    const ok = await confirmDialog({ title: "Convert to Client", message: "This creates the client record, an invoice for the quoted work, and a task for each filing sold. Continue?" });
    if (!ok) return;
    setMoving(estimateId);
    try {
      const res = await api.post<{ clientId: string }>(`/estimates/${estimateId}/convert`, {});
      navigate(`/clients/${res.clientId}`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not convert this estimate.");
    } finally {
      setMoving(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;
  if (!estimates) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            The same estimates as Estimates, viewed as a sales funnel. Move a card with its stage buttons.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="ghost-button" disabled={refreshing} onClick={handleRefresh}><RefreshCw size={13} strokeWidth={2} aria-hidden="true" className={refreshing ? "icon-spin" : undefined} />{refreshing ? "Refreshing…" : "Refresh"}</button>
          <button type="button" className="ghost-button" onClick={handleExportCsv}><Download size={13} strokeWidth={2} aria-hidden="true" />Export CSV</button>
          <button className="btn" onClick={() => navigate("/estimates")}>View as List</button>
          <button type="button" className="btn btn-primary" onClick={() => setShowNewProspect(true)}><Plus size={13} strokeWidth={2} aria-hidden="true" />New Prospect</button>
        </div>
      </div>

      {showNewProspect && (
        <NewProspectModal
          onClose={() => setShowNewProspect(false)}
          onCreated={(estimateId) => { setShowNewProspect(false); load(); navigate(`/estimates/${estimateId}`); }}
        />
      )}

      <div className="metric-grid metric-grid-3" style={{ marginBottom: 16 }}>
        <div className="metric">
          <div className="metric-label">Conversion Rate</div>
          <div className="metric-value">{conversionStats.rate === null ? "—" : `${conversionStats.rate.toFixed(0)}%`}</div>
          <div className="metric-sub">
            {conversionStats.won} won / {conversionStats.lost} lost
          </div>
        </div>
        <div className="metric" style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 6 }}>
          <div className="metric-label">Period</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {PERIODS.map((p) => (
              <button key={p} className={`btn btn-sm ${period === p ? "btn-primary" : ""}`} onClick={() => setPeriod(p)}>
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">Open Pipeline Value</div>
          <div className="metric-value">
            {money([...byStage.New, ...byStage.Contacted, ...byStage["Proposal Sent"]].reduce((s, e) => s + (e.totals?.total || 0), 0))}
          </div>
          <div className="metric-sub">{byStage.New.length + byStage.Contacted.length + byStage["Proposal Sent"].length} open estimates</div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <input placeholder="Search pipeline — client, description, amount…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 280 }} />
      </div>

      <PipelineSteps />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
        {COLUMNS.map((col) => (
          <PipelineColumn
            key={col.stage}
            title={col.label}
            step={col.step}
            stage={col.stage}
            cards={byStage[col.stage]}
            moving={moving}
            onMove={moveTo}
            onOpen={(id) => navigate(`/estimates/${id}`)}
          />
        ))}
        <WonColumn cards={byStage.Won} moving={moving} onConvert={handleConvert} onMoveBack={(id) => moveTo(id, "Proposal Sent")} onOpen={(id) => navigate(`/estimates/${id}`)} />
      </div>

      {byStage.Lost.length > 0 && (
        <div className="card" style={{ marginTop: 12, padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
            <span>Lost</span>
            <span className="muted">{byStage.Lost.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {byStage.Lost.map((e) => (
              <div key={e.estimate_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 8px", borderRadius: 6, background: "var(--surface-2, #f8fafc)" }}>
                <button type="button" className="link-button" style={{ padding: 0, fontSize: 13 }} onClick={() => navigate(`/estimates/${e.estimate_id}`)}>{e.business_name}</button>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="muted" style={{ fontSize: 12 }}>{money(e.totals?.total)}</span>
                  <button type="button" className="btn btn-sm" disabled={moving === e.estimate_id} onClick={() => moveTo(e.estimate_id, "New")} title="Reopen this prospect">
                    <Undo2 size={12} strokeWidth={2} aria-hidden="true" /> Reopen
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The owner asked for the pipeline to spell out "1-2-3 step to be client" — this is that, rendered once at the top of the board rather than repeated on every card. */
function PipelineSteps() {
  const steps: { n: number; label: string; desc: string }[] = [
    { n: 1, label: "Add Prospect", desc: "Name + contact info" },
    { n: 2, label: "Work the Deal", desc: "Contacted → Proposal Sent" },
    { n: 3, label: "Mark Won", desc: "They said yes" },
    { n: 4, label: "Convert to Client", desc: "One click — client, invoice & tasks" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 14, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2, #f8fafc)" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, borderRadius: "50%", background: s.n === 4 ? "var(--teal)" : "var(--line)", color: s.n === 4 ? "#fff" : "var(--ink)", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{s.n}</span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.2 }}>{s.label}</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.2 }}>{s.desc}</div>
            </div>
          </div>
          {i < steps.length - 1 && <ArrowRight size={14} strokeWidth={2} aria-hidden="true" className="muted" style={{ margin: "0 4px" }} />}
        </div>
      ))}
    </div>
  );
}

const STAGE_TO_STATUS_LOCAL: Record<StageLabel, string> = {
  New: "Draft",
  Contacted: "Contacted",
  "Proposal Sent": "Sent",
  Won: "Approved",
  Lost: "Declined",
};

function PipelineColumn({
  title, step, stage, cards, moving, onMove, onOpen,
}: {
  title: string; step: number; stage: StageLabel; cards: Estimate[]; moving: string | null;
  onMove: (id: string, stage: StageLabel) => void; onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
        <span>{step}. {title}</span>
        <span className="muted">{cards.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 560, overflowY: "auto" }}>
        {cards.map((e) => (
          <PipelineCard key={e.estimate_id} est={e} stage={stage} moving={moving} onMove={onMove} onOpen={() => onOpen(e.estimate_id)} />
        ))}
        {!cards.length && <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>Nothing here.</div>}
      </div>
    </div>
  );
}

/** One primary "move forward" action per card instead of every other stage at once — the board is a line (New → Contacted → Proposal Sent → Won), not a grid of equally-valid moves. */
function PipelineCard({
  est, stage, moving, onMove, onOpen,
}: {
  est: Estimate; stage: StageLabel; moving: string | null;
  onMove: (id: string, stage: StageLabel) => void; onOpen: () => void;
}) {
  const stageIndex = STAGE_ORDER.indexOf(stage);
  const next = stageIndex >= 0 && stageIndex < STAGE_ORDER.length - 1 ? STAGE_ORDER[stageIndex + 1] : null;
  const busy = moving === est.estimate_id;
  return (
    <div className="card" style={{ padding: 10, background: "var(--surface-2, #f8fafc)" }}>
      <div style={{ cursor: "pointer" }} tabIndex={0} role="button" onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{est.business_name}</div>
        <div className="muted" style={{ fontSize: 11 }}>{est.estimate_number}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{money(est.totals?.total)}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 8 }}>
        {next && (
          <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onMove(est.estimate_id, next)} title={`Move to ${next}`}>
            {next === "Won" ? <><PartyPopper size={12} strokeWidth={2} aria-hidden="true" /> Mark Won</> : <>{next} <ArrowRight size={12} strokeWidth={2} aria-hidden="true" /></>}
          </button>
        )}
        <button type="button" className="link-button" style={{ padding: 0, fontSize: 11.5 }} disabled={busy} onClick={() => onMove(est.estimate_id, "Lost")}>
          Mark Lost
        </button>
      </div>
    </div>
  );
}

/** The board's real endpoint: a Won card is one click from a client. Kept as its own column (not folded into the same Won/Lost list Lost sits in) since Convert deserves the same visual weight as the other 3 steps, not to be buried below a stage-move button list. */
function WonColumn({
  cards, moving, onConvert, onMoveBack, onOpen,
}: {
  cards: Estimate[]; moving: string | null;
  onConvert: (id: string) => void; onMoveBack: (id: string) => void; onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 12, borderColor: "var(--teal)" }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
        <span>4. Won — Ready to Convert</span>
        <span className="muted">{cards.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 560, overflowY: "auto" }}>
        {cards.map((e) => {
          const busy = moving === e.estimate_id;
          return (
            <div className="card" key={e.estimate_id} style={{ padding: 10, background: "var(--surface-2, #f8fafc)" }}>
              <div style={{ cursor: "pointer" }} tabIndex={0} role="button" onClick={() => onOpen(e.estimate_id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onOpen(e.estimate_id); } }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{e.business_name}</div>
                <div className="muted" style={{ fontSize: 11 }}>{e.estimate_number}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{money(e.totals?.total)}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginTop: 8 }}>
                <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => onConvert(e.estimate_id)}>
                  {busy ? "Converting…" : "Convert to Client →"}
                </button>
                <button type="button" className="link-button" style={{ padding: 0, fontSize: 11.5 }} disabled={busy} onClick={() => onMoveBack(e.estimate_id)} title="Move back to Proposal Sent">
                  <Undo2 size={11} strokeWidth={2} aria-hidden="true" /> Undo
                </button>
              </div>
            </div>
          );
        })}
        {!cards.length && <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>Nothing won yet.</div>}
      </div>
    </div>
  );
}

/**
 * The Pipeline page's own entry point for adding a prospect — previously the
 * only way in was a separate "New Estimate" action on the Estimates list,
 * with no visible link between it and Pipeline (hard audit follow-up,
 * 2026-08-13). Deliberately lightweight: just the fields a first contact
 * actually has (name/contact info) plus what they might be interested in —
 * entity type/business type/full fee-catalog quoting stays on the Estimate
 * detail page for when there's enough to actually price it out.
 */
function NewProspectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (estimateId: string) => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const [businessName, setBusinessName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceInterest, setServiceInterest] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleService(key: string) {
    setServiceInterest((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) { setError("Business name is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ estimateId: string }>("/estimates", {
        businessName: businessName.trim(), contactName: contactName.trim() || undefined,
        email: email.trim() || undefined, phone: phone.trim() || undefined,
        serviceInterest: serviceInterest.map((key) => FIRM_SERVICES.find((s) => s.key === key)?.label || key),
      });
      onCreated(res.estimateId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create this prospect.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="new-prospect-title" style={{ maxWidth: 480, width: "94vw" }} onClick={(e) => e.stopPropagation()}>
        <h3 id="new-prospect-title" style={{ marginTop: 0 }}>New Prospect</h3>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
          Not a client yet — this just adds a card to the pipeline. Full quoting/entity details can be filled in later on the estimate itself.
        </p>
        <form onSubmit={handleSubmit}>
          {error && <ErrorBanner error={error} style={{ marginBottom: 12 }} />}
          <div className="field"><label htmlFor="np-business">Business / Prospect Name *</label><input id="np-business" required value={businessName} onChange={(e) => setBusinessName(e.target.value)} autoFocus /></div>
          <div className="form-grid">
            <div className="field"><label htmlFor="np-contact">Contact Name</label><input id="np-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} /></div>
            <div className="field"><label htmlFor="np-email">Email</label><input id="np-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="np-phone">Phone</label><input id="np-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div className="field">
            <label>What are they interested in?</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
              {FIRM_SERVICES.filter((s) => !s.legacy).map((s) => (
                <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" checked={serviceInterest.includes(s.key)} onChange={() => toggleService(s.key)} />
                  {s.label}
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Creating…" : "Create Prospect"}</button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
