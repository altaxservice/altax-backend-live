import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Download } from "lucide-react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { money, STAGE_LABELS, stageForEstimate, type Estimate, type StageLabel } from "../api/estimates";
import { useStickyState } from "../utils/listState";
import { exportCsv } from "../components/FilterBar";

/**
 * Pipeline — the same Estimates data as the Estimates list, viewed as a sales
 * funnel instead of a table. New/Contacted/Proposal Sent are plain status
 * writes; Won/Lost reuse the same approve/decline fields the Estimate detail
 * page already stamps, so a card moved here and an estimate approved there
 * are the exact same action.
 */
const COLUMNS: { stage: StageLabel; label: string }[] = [
  { stage: "New", label: "New" },
  { stage: "Contacted", label: "Contacted" },
  { stage: "Proposal Sent", label: "Proposal Sent" },
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
  const [estimates, setEstimates] = useState<Estimate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useStickyState<Period>("pipeline.period", "This Quarter");

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
    for (const e of estimates || []) {
      const stage = stageForEstimate(e.status);
      if (stage) grouped[stage].push(e);
    }
    return grouped;
  }, [estimates]);

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
        </div>
      </div>

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {COLUMNS.map((col) => (
          <PipelineColumn key={col.stage} title={col.label} stage={col.stage} cards={byStage[col.stage]} moving={moving} onMove={moveTo} onOpen={(id) => navigate(`/estimates/${id}`)} />
        ))}
        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
            <span>Won / Lost</span>
            <span className="muted">{byStage.Won.length + byStage.Lost.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 560, overflowY: "auto" }}>
            {byStage.Won.map((e) => (
              <PipelineCard key={e.estimate_id} est={e} stage="Won" moving={moving} onMove={moveTo} onOpen={() => navigate(`/estimates/${e.estimate_id}`)} />
            ))}
            {byStage.Lost.map((e) => (
              <PipelineCard key={e.estimate_id} est={e} stage="Lost" moving={moving} onMove={moveTo} onOpen={() => navigate(`/estimates/${e.estimate_id}`)} />
            ))}
            {!byStage.Won.length && !byStage.Lost.length && <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>Nothing closed yet.</div>}
          </div>
        </div>
      </div>
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
  title, stage, cards, moving, onMove, onOpen,
}: {
  title: string; stage: StageLabel; cards: Estimate[]; moving: string | null;
  onMove: (id: string, stage: StageLabel) => void; onOpen: (id: string) => void;
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
        <span>{title}</span>
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

function PipelineCard({
  est, stage, moving, onMove, onOpen,
}: {
  est: Estimate; stage: StageLabel; moving: string | null;
  onMove: (id: string, stage: StageLabel) => void; onOpen: () => void;
}) {
  const next = STAGE_LABELS.filter((s) => s !== stage);
  return (
    <div className="card" style={{ padding: 10, background: "var(--surface-2, #f8fafc)" }}>
      <div style={{ cursor: "pointer" }} onClick={onOpen}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{est.business_name}</div>
        <div className="muted" style={{ fontSize: 11 }}>{est.estimate_number}</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{money(est.totals?.total)}</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {next.map((s) => (
          <button
            key={s}
            className="btn btn-sm"
            disabled={moving === est.estimate_id}
            onClick={() => onMove(est.estimate_id, s)}
            title={`Move to ${s}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
