import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Drop-in replacement for <input type="date">: a typed mm/dd/yyyy field plus a calendar popup (month and year pickers,
 * arrows, today highlighted, selected day in blue, Today / Clear). The value is always an ISO yyyy-mm-dd string and
 * onChange receives an event-shaped object, so existing handlers that read e.target.value keep working unchanged.
 * Touch devices keep the phone's own native date picker, which is better there.
 */
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "min" | "max"> & {
  value?: string | null;
  min?: string;
  max?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
function parseIso(v: string | null | undefined): { y: number; m: number; d: number } | null {
  const mt = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!mt) return null;
  const y = +mt[1], m = +mt[2] - 1, d = +mt[3];
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d ? { y, m, d } : null;
}
const display = (v: string | null | undefined) => { const p = parseIso(v); return p ? `${pad(p.m + 1)}/${pad(p.d)}/${p.y}` : ""; };
/** "10/9/2026", "10-09-26" and "20261009" all become 2026-10-09; anything else is null. */
function parseTyped(text: string): string | null {
  const t = text.trim();
  let m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const iso = toIso(y, +m[1] - 1, +m[2]);
    return parseIso(iso) ? iso : null;
  }
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) { const iso = `${m[1]}-${m[2]}-${m[3]}`; return parseIso(iso) ? iso : null; }
  return null;
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return coarse;
}

export function DateInput({ value, min, max, onChange, onBlur, className, style, disabled, name, id, ...rest }: Props) {
  const coarse = useCoarsePointer();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const selected = parseIso(value);
  const today = new Date();
  const [view, setView] = useState(() => ({ y: selected?.y ?? today.getFullYear(), m: selected?.m ?? today.getMonth() }));
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const emit = (iso: string) => {
    const target = { value: iso, name: name || "", id: id || "" };
    onChange?.({ target, currentTarget: target } as unknown as ChangeEvent<HTMLInputElement>);
  };

  // Keep the visible month in step with the value when it is changed from outside.
  useEffect(() => { if (selected) setView({ y: selected.y, m: selected.m }); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const place = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      const popH = popRef.current?.offsetHeight || 330;
      const below = window.innerHeight - r.bottom;
      const top = below < popH + 8 && r.top > popH + 8 ? r.top - popH - 4 : r.bottom + 4;
      setPos({ top, left: Math.max(8, Math.min(r.left, window.innerWidth - 292)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const start = first.getDay();
    const dim = new Date(view.y, view.m + 1, 0).getDate();
    const prevDim = new Date(view.y, view.m, 0).getDate();
    const out: { y: number; m: number; d: number; other: boolean }[] = [];
    for (let i = start - 1; i >= 0; i--) out.push({ y: view.m === 0 ? view.y - 1 : view.y, m: (view.m + 11) % 12, d: prevDim - i, other: true });
    for (let d = 1; d <= dim; d++) out.push({ y: view.y, m: view.m, d, other: false });
    while (out.length % 7 !== 0 || out.length < 42) {
      const n = out.length - (start + dim) + 1;
      out.push({ y: view.m === 11 ? view.y + 1 : view.y, m: (view.m + 1) % 12, d: n, other: true });
    }
    return out;
  }, [view]);

  if (coarse) {
    return <input {...rest} id={id} name={name} type="date" className={className} style={style} disabled={disabled} min={min} max={max} value={value ? String(value).slice(0, 10) : ""} onBlur={onBlur}
      onChange={(e) => onChange?.(e)} />;
  }

  const outOfRange = (iso: string) => (min && iso < min) || (max && iso > max);
  const years: number[] = [];
  for (let y = Math.min(view.y, (selected?.y ?? view.y), today.getFullYear()) - 12; y <= Math.max(view.y, today.getFullYear()) + 12; y++) years.push(y);
  const shift = (delta: number) => setView((v) => { const d = new Date(v.y, v.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const todayIso = toIso(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <span ref={wrapRef} className="dp-wrap" style={style}>
      <input
        {...rest} id={id} name={name} type="text" inputMode="numeric" autoComplete="off" placeholder="mm/dd/yyyy" disabled={disabled}
        className={className} value={draft ?? display(value)}
        onFocus={() => setDraft(display(value))}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (text.trim() === "") { emit(""); return; }
          const iso = parseTyped(text);
          if (iso) emit(iso);
        }}
        onBlur={(e) => { const iso = parseTyped(draft ?? ""); if (iso) emit(iso); else if ((draft ?? "").trim() !== "" ) emit(String(value || "").slice(0, 10)); setDraft(null); onBlur?.(e); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } rest.onKeyDown?.(e); }}
      />
      <button type="button" className="dp-btn" aria-label="Open calendar" disabled={disabled} tabIndex={-1} onClick={() => setOpen((o) => !o)}><CalendarDays size={16} aria-hidden="true" /></button>
      {open && createPortal(
        <div ref={popRef} className="dp-pop" role="dialog" aria-label="Choose a date" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft size={15} aria-hidden="true" /></button>
            <select aria-label="Month" value={view.m} onChange={(e) => setView((v) => ({ ...v, m: +e.target.value }))}>{MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}</select>
            <select aria-label="Year" value={view.y} onChange={(e) => setView((v) => ({ ...v, y: +e.target.value }))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
            <button type="button" className="dp-nav" aria-label="Next month" onClick={() => shift(1)}><ChevronRight size={15} aria-hidden="true" /></button>
          </div>
          <div className="dp-grid" role="grid">
            {WEEKDAYS.map((w) => <div key={w} className="dp-dow" role="columnheader">{w}</div>)}
            {cells.map((c, i) => {
              const iso = toIso(c.y, c.m, c.d);
              const isSel = selected && toIso(selected.y, selected.m, selected.d) === iso;
              const bad = outOfRange(iso);
              return (
                <button
                  type="button" key={i} role="gridcell" disabled={!!bad} aria-selected={!!isSel}
                  className={`dp-day${c.other ? " other" : ""}${iso === todayIso ? " today" : ""}${isSel ? " sel" : ""}`}
                  onClick={() => { emit(iso); setDraft(null); setOpen(false); }}
                >{c.d}</button>
              );
            })}
          </div>
          <div className="dp-foot">
            <button type="button" className="dp-link" onClick={() => { if (!outOfRange(todayIso)) { emit(todayIso); setDraft(null); setOpen(false); } }}>Today</button>
            <button type="button" className="dp-clear" onClick={() => { emit(""); setDraft(null); setOpen(false); }}>Clear</button>
          </div>
        </div>,
        document.body
      )}
    </span>
  );
}
