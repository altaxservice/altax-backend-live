import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { DateInput } from "./DateInput";
import { useToast } from "./Toast";
import { fmtDateOnly as fmtDate } from "../utils/date";

interface Segment { frequency: string; effectiveFrom: string; effectiveTo: string | null }
interface Period { start: string; end: string; frequency: string }
interface Conflict { start: string; end: string; paidDate: string | null }
interface Timeline { segments: Segment[]; frequencies: string[]; timelineStart: string; periods: Period[] }
interface Preview { ok: boolean; errors: string[]; periods: Period[]; conflicts: Conflict[]; segments?: Segment[] }

const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const TONE: Record<string, string> = { Monthly: "blue", Quarterly: "teal", Semiannual: "amber", Annually: "green", "N/A": "grey" };

/**
 * Sales-tax filing frequency as a timeline you can edit any time: every period of "Quarterly until here, Monthly from
 * there…" is a row you can change, add or remove, with a live preview of the filing periods it produces and a warning
 * before anything already marked filed would be reshaped. Replaces the single "frequency + effective date" pair that
 * could not express (or correct) a real history.
 */
export function SalesTaxFrequencyEditor({ clientId, canEdit, onChanged }: { clientId: string; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Timeline | null>(null);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<{ frequency: string; effectiveFrom: string }[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Timeline>(`/clients/${clientId}/sales-tax-frequency`).then(setData).catch(() => setData(null));
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  function startEdit() {
    const base = data?.segments.length ? data.segments.map((s) => ({ frequency: s.frequency, effectiveFrom: s.effectiveFrom })) : [{ frequency: "Monthly", effectiveFrom: data?.timelineStart || "2000-01-01" }];
    setRows(base); setPreview(null); setAck(false); setError(null); setEditing(true);
  }

  // Live preview, debounced.
  useEffect(() => {
    if (!editing) return;
    const t = window.setTimeout(() => {
      api.post<Preview>(`/clients/${clientId}/sales-tax-frequency/preview`, { segments: rows }).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => window.clearTimeout(t);
  }, [rows, editing, clientId]);

  function addChange() {
    const last = rows[rows.length - 1];
    const next = last?.frequency === "Monthly" ? "Quarterly" : "Monthly";
    setRows([...rows, { frequency: next, effectiveFrom: todayIso() }]);
  }
  const setRow = (i: number, patch: Partial<{ frequency: string; effectiveFrom: string }>) => setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.put(`/clients/${clientId}/sales-tax-frequency`, { segments: rows, confirmFiled: ack });
      toast("Filing frequency updated.");
      setEditing(false);
      load();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) { setError("This change would reshape periods already marked filed — review them below and tick the box to continue."); }
      else setError(err instanceof ApiError ? err.message : "Could not save the frequency timeline.");
    } finally { setSaving(false); }
  }

  const frequencies = data?.frequencies || ["Monthly", "Quarterly", "Semiannual", "Annually", "N/A"];
  const conflicts = preview?.conflicts || [];
  const canSave = !saving && preview?.ok && (conflicts.length === 0 || ack);
  const current = data?.segments.length ? data.segments[data.segments.length - 1] : null;
  const shown = (editing ? preview?.periods : data?.periods) || [];
  const byYear = shown.reduce<Record<string, Period[]>>((acc, p) => { (acc[p.start.slice(0, 4)] ||= []).push(p); return acc; }, {});

  return (
    <div className="stf" style={{ gridColumn: "1 / -1" }}>
      <div className="stf-head">
        <div>
          <div className="stf-label">Sales Tax Frequency</div>
          <div className="stf-current">
            {current ? <><b>{current.frequency}</b><span className="muted"> — since {current.effectiveFrom === (data?.timelineStart || "2000-01-01") ? "the beginning" : fmtDate(current.effectiveFrom)}</span></> : <span className="muted">Not set</span>}
          </div>
        </div>
        {canEdit && !editing && <button type="button" className="ghost-button btn-sm" onClick={startEdit}>Edit frequency timeline</button>}
      </div>

      {!editing && data && data.segments.length > 1 && (
        <div className="stf-bar" aria-label="Frequency history">
          {data.segments.map((s, i) => (
            <span key={i} className={`stf-seg ${TONE[s.frequency] || "grey"}`}>
              {s.frequency}<small>{s.effectiveFrom === data.timelineStart || i === 0 ? "from the beginning" : `from ${fmtDate(s.effectiveFrom)}`}{s.effectiveTo ? ` to ${fmtDate(s.effectiveTo)}` : ""}</small>
            </span>
          ))}
        </div>
      )}

      {editing && (
        <div className="stf-edit">
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 12.5 }}>
            Each row is a stretch of time that uses one filing frequency, running until the next row begins. Change a date, switch a frequency, add a change, or remove a row — the preview updates as you go.
          </p>
          {rows.map((r, i) => (
            <div className="stf-row" key={i}>
              <select value={r.frequency} onChange={(e) => setRow(i, { frequency: e.target.value })} aria-label="Frequency">
                {frequencies.map((f) => <option key={f}>{f}</option>)}
              </select>
              <span className="stf-from">from</span>
              {i === 0
                ? <span className="stf-beginning">the beginning</span>
                : <DateInput value={r.effectiveFrom} onChange={(e) => setRow(i, { effectiveFrom: e.target.value })} />}
              {i > 0 && <button type="button" className="icon-button" title="Remove this change" aria-label="Remove this change" onClick={() => setRows(rows.filter((_, idx) => idx !== i))}><Trash2 size={15} /></button>}
            </div>
          ))}
          <button type="button" className="ghost-button btn-sm" style={{ marginTop: 6 }} onClick={addChange}><Plus size={13} aria-hidden="true" /> Add a change</button>

          {preview && !preview.ok && <div className="stf-msg bad">{preview.errors.join(" ")}</div>}
          {conflicts.length > 0 && (
            <div className="stf-msg warn">
              <b>Heads up — this reshapes {conflicts.length} period{conflicts.length === 1 ? "" : "s"} already marked filed:</b>
              <ul>{conflicts.map((c) => <li key={c.start}>{fmtDate(c.start)} – {fmtDate(c.end)}{c.paidDate ? ` (paid ${fmtDate(c.paidDate)})` : ""}</li>)}</ul>
              <label><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand — reshape them anyway</label>
            </div>
          )}
          {error && <div className="stf-msg bad">{error}</div>}
          <div className="stf-actions">
            <button type="button" className="action-button" disabled={!canSave} onClick={save}>{saving ? "Saving…" : "Save timeline"}</button>
            <button type="button" className="ghost-button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}

      {Object.keys(byYear).length > 0 && (
        <div className="stf-periods">
          <div className="stf-label" style={{ marginBottom: 6 }}>{editing ? "Filing periods this will produce" : "Filing periods"}</div>
          {Object.entries(byYear).map(([year, list]) => (
            <div className="stf-year" key={year}>
              <b>{year}</b>
              <div>{list.map((p) => <span key={p.start} className={`stf-chip ${TONE[p.frequency] || "grey"}`} title={`${fmtDate(p.start)} – ${fmtDate(p.end)}`}>{p.frequency === "Monthly" ? new Date(`${p.start}T12:00:00`).toLocaleDateString("en-US", { month: "short" }) : `${new Date(`${p.start}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}–${new Date(`${p.end}T12:00:00`).toLocaleDateString("en-US", { month: "short" })}`}</span>)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
