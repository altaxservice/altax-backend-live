import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Download, FilePlus2, FileText, Printer, Search } from "lucide-react";
import { api, ApiError, downloadFile, downloadFilePost, printFile, printFilePost, viewFile, viewFilePost } from "../api/client";
import type { Client } from "../api/types";
import { ContractBodyText } from "../components/ContractBodyText";
import { DocSigningPanel } from "../components/DocSigningPanel";
import { printText } from "../utils/printDocument";
import { DateInput } from "../components/DateInput";
import { useToast } from "../components/Toast";

interface Option { value: string; label: string }
interface Question {
  id: string; label: string; type: "text" | "textarea" | "date" | "money" | "number" | "select" | "yesno" | "list";
  required?: boolean; help?: string; placeholder?: string; options?: Option[]; showIf?: { id: string; equals?: string | boolean; notEmpty?: boolean };
  fields?: Question[]; addLabel?: string; minItems?: number;
}
interface Step { title: string; description?: string; questions: Question[] }
interface TemplateSummary { key: string; title: string; titleAr?: string | null; category: string; description: string; reviewNote: string | null; steps: number; hasArabic?: boolean }
type Lang = "en" | "ar" | "both";
interface TemplateFull extends TemplateSummary { stepList: Step[] }
interface ExistingTool { title: string; description: string; path: string; hint: string }
interface HistoryDoc { docId: string; templateKey: string; title: string; contractId: string | null; status: string | null; createdBy: string; createdAt: string; clientId: string; clientName: string | null }
type Answers = Record<string, any>;

function condMet(c: Question["showIf"], a: Answers): boolean {
  if (!c) return true;
  const v = a[c.id];
  if (c.equals !== undefined) return typeof c.equals === "boolean" ? Boolean(v) === c.equals : String(v ?? "") === String(c.equals);
  return Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== "";
}

/** One input for one question; list questions repeat their fields per row. */
function Field({ q, value, onChange, answers }: { q: Question; value: any; onChange: (v: any) => void; answers: Answers }) {
  if (!condMet(q.showIf, answers)) return null;
  const id = `db-${q.id}`;
  const label = <label htmlFor={id}>{q.label}{q.required && <span style={{ color: "var(--red)" }}> *</span>}</label>;
  const help = q.help ? <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{q.help}</div> : null;
  switch (q.type) {
    case "textarea": return <div className="field">{label}<textarea id={id} rows={4} value={value ?? ""} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} />{help}</div>;
    case "date": return <div className="field">{label}<DateInput id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />{help}</div>;
    case "money": return <div className="field">{label}<input id={id} type="number" min="0" step="0.01" inputMode="decimal" value={value ?? ""} placeholder="0.00" onChange={(e) => onChange(e.target.value)} />{help}</div>;
    case "number": return <div className="field">{label}<input id={id} type="number" step="any" inputMode="decimal" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />{help}</div>;
    case "select": return <div className="field">{label}<select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>{!q.required && <option value="">—</option>}{(q.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{help}</div>;
    case "yesno": return <label className="field" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /><span>{q.label}</span>{help}</label>;
    case "list": {
      const rows: Answers[] = Array.isArray(value) ? value : [];
      const setRow = (i: number, patch: Answers) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
      return (
        <div className="field">
          <label>{q.label}{q.required && <span style={{ color: "var(--red)" }}> *</span>}</label>
          {help}
          <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
            {rows.map((row, i) => (
              <div key={i} className="card" style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><b style={{ fontSize: 12.5 }}>#{i + 1}</b><button type="button" className="btn btn-sm" onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remove</button></div>
                {(q.fields || []).map((f) => <Field key={f.id} q={{ ...f, id: `${q.id}-${i}-${f.id}` }} value={row[f.id]} answers={row} onChange={(v) => setRow(i, { [f.id]: v })} />)}
              </div>
            ))}
            <button type="button" className="btn btn-sm" style={{ justifySelf: "start" }} onClick={() => onChange([...rows, {}])}>+ {q.addLabel || "Add"}</button>
          </div>
        </div>
      );
    }
    default: return <div className="field">{label}<input id={id} type="text" value={value ?? ""} placeholder={q.placeholder} onChange={(e) => onChange(e.target.value)} />{help}</div>;
  }
}

function Library({ onPick }: { onPick: (key: string) => void }) {
  const [data, setData] = useState<{ templates: TemplateSummary[]; categories: string[]; existingTools: ExistingTool[] } | null>(null);
  const [recent, setRecent] = useState<HistoryDoc[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [signing, setSigning] = useState<string | null>(null);
  const loadRecent = () => api.get<{ docs: HistoryDoc[] }>("/doc-builder/history").then((r) => setRecent(r.docs.slice(0, 8))).catch(() => {});
  useEffect(() => {
    api.get<NonNullable<typeof data>>("/doc-builder/templates").then(setData).catch(() => setData({ templates: [], categories: [], existingTools: [] }));
    loadRecent();
  }, []);
  if (!data) return <div className="spinner-wrap">Loading the library…</div>;
  const needle = q.trim().toLowerCase();
  const shown = data.templates.filter((t) => (!cat || t.category === cat) && (!needle || `${t.title} ${t.description}`.toLowerCase().includes(needle)));
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="command-panel">
        <div className="command-panel-header"><div><h2 className="command-panel-title">Create a document</h2><div className="command-panel-note">Pick a document, answer a few questions, and it is written for you — then save it to the client, send it to sign, or print it.</div></div></div>
        <div style={{ padding: "12px 16px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
          <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
            <Search size={14} aria-hidden="true" style={{ position: "absolute", left: 10, top: 11, opacity: 0.5 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" style={{ paddingLeft: 30, width: "100%" }} aria-label="Search documents" />
          </div>
          <button type="button" className={`tpl-chip${cat === "" ? " on" : ""}`} onClick={() => setCat("")}>All</button>
          {data.categories.map((c) => <button key={c} type="button" className={`tpl-chip${cat === c ? " on" : ""}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div style={{ padding: 16, display: "grid", gap: 20 }}>
          {data.categories.filter((c) => shown.some((t) => t.category === c)).map((c) => (
            <section key={c}>
              <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>{c}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
                {shown.filter((t) => t.category === c).map((t) => (
                  <button key={t.key} type="button" className="card" onClick={() => onPick(t.key)} style={{ textAlign: "left", padding: "12px 14px", cursor: "pointer", font: "inherit", color: "inherit", display: "grid", gap: 6 }}>
                    <span style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 800 }}><FileText size={16} aria-hidden="true" />{t.title}</span>
                    <span className="muted" style={{ fontSize: 12.5 }}>{t.description}</span>
                    <span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>{t.steps + 1} steps{t.hasArabic ? " · English / العربية" : ""} · Start →</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {shown.length === 0 && <p className="muted" style={{ margin: 0 }}>No document matches that search.</p>}
        </div>
      </div>

      {signing && <DocSigningPanel docId={signing} onChanged={loadRecent} onClose={() => setSigning(null)} />}
      {recent.length > 0 && (
        <div className="command-panel">
          <div className="command-panel-header"><h2 className="command-panel-title">Recently built</h2></div>
          <div className="table-scroll"><table>
            <thead><tr><th scope="col">Document</th><th scope="col">Client</th><th scope="col">Status</th><th scope="col">Built</th><th scope="col"></th></tr></thead>
            <tbody>{recent.map((d) => (
              <tr key={d.docId}>
                <td>{d.title}</td><td>{d.clientName || d.clientId || <span className="muted">Outside parties</span>}</td><td>{d.status || "—"}</td>
                <td className="muted">{new Date(d.createdAt).toLocaleDateString()} · {d.createdBy}</td>
                <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn btn-sm" onClick={() => { setSigning(d.docId); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Signatures</button> <button type="button" className="btn btn-sm" onClick={() => onPick(`${d.templateKey}?from=${d.docId}`)}>Use again</button> {d.clientId && <Link className="btn btn-sm" to={`/clients/${d.clientId}?tab=Contracts`}>Open</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      <div className="command-panel">
        <div className="command-panel-header"><div><h2 className="command-panel-title">Already in the app</h2><div className="command-panel-note">Documents the app already creates — each one lives where it's used.</div></div></div>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {data.existingTools.map((t) => (
            <Link key={t.title} to={t.path} className="card" style={{ padding: "12px 14px", textDecoration: "none", color: "inherit", display: "grid", gap: 4 }}>
              <b>{t.title}</b><span className="muted" style={{ fontSize: 12.5 }}>{t.description}</span><span style={{ fontSize: 12, color: "var(--teal)", fontWeight: 700 }}>{t.hint} →</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

function Wizard({ templateKey, fromDocId, onExit }: { templateKey: string; fromDocId: string | null; onExit: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [tpl, setTpl] = useState<TemplateFull | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [answers, setAnswers] = useState<Answers>({});
  const [step, setStep] = useState(0);
  const [preview, setPreview] = useState<{ body: string; missing: string[] }>({ body: "", missing: [] });
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [done, setDone] = useState<{ contractId: string; docId: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadedFor = useRef("");

  useEffect(() => {
    api.get<{ template: TemplateFull }>(`/doc-builder/templates/${templateKey}`).then((r) => setTpl(r.template)).catch(() => setErr("Could not load this document."));
    api.get<{ clients: Client[] }>("/clients").then((r) => setClients(r.clients)).catch(() => {});
  }, [templateKey]);

  // Starting answers: from a past document when "Use again", otherwise defaults plus whatever the chosen client's record fills in.
  useEffect(() => {
    if (!tpl) return;
    const k = `${tpl.key}|${clientId}|${fromDocId || ""}`;
    if (loadedFor.current === k) return;
    const prevClient = loadedFor.current.split("|")[1];
    loadedFor.current = k;
    (async () => {
      try {
        if (fromDocId && !prevClient && prevClient !== "") {
          const d = await api.get<{ answers: Answers; clientId: string }>(`/doc-builder/docs/${fromDocId}`);
          const { _lang, ...rest } = d.answers as Answers; if (_lang === "ar" || _lang === "both") setLang(_lang);
          setAnswers(rest); setClientId(d.clientId); loadedFor.current = `${tpl.key}|${d.clientId}|${fromDocId}`;
          return;
        }
        const r = await api.get<{ answers: Answers }>(`/doc-builder/templates/${tpl.key}/start?clientId=${encodeURIComponent(clientId)}`);
        // Keep what's already typed; only fill what's still empty so switching client never wipes the work.
        setAnswers((cur) => { const out = { ...r.answers }; for (const [key, v] of Object.entries(cur)) if (v !== "" && v !== undefined && !(Array.isArray(v) && v.length === 0)) out[key] = v; return clientId ? { ...out, ...pickPrefilled(tpl, r.answers) } : out; });
      } catch { /* the form still works without prefill */ }
    })();
  }, [tpl, clientId, fromDocId]);

  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!tpl) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.post<{ body: string; missing: string[] }>("/doc-builder/preview", { templateKey: tpl.key, answers, lang }).then(setPreview).catch(() => {});
    }, 350);
    return () => window.clearTimeout(timer.current);
  }, [tpl, answers, lang]);

  const steps = useMemo(() => (tpl ? [{ title: "Client", questions: [] as Question[] }, ...tpl.stepList, { title: "Review", questions: [] as Question[] }] : []), [tpl]);
  const last = steps.length - 1;
  const set = (id: string, v: any) => setAnswers((a) => ({ ...a, [id]: v }));
  const body = { templateKey, clientId, answers, lang };

  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ contractId: string; docId: string }>("/doc-builder/create", body);
      setDone({ contractId: r.contractId, docId: r.docId, body: preview.body }); toast("Document saved to the client's file.");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save the document."); } finally { setBusy(false); }
  }
  const draftPdf = (print: boolean) => (print ? printFilePost : viewFilePost)("/doc-builder/pdf", body).catch((e) => toast(e instanceof ApiError ? e.message : "Could not open the PDF."));

  if (!tpl) return <div className="spinner-wrap">{err || "Loading…"}</div>;

  if (done) {
    return (
      <div className="command-panel" style={{ maxWidth: 900 }}>
        <div className="command-panel-header"><h2 className="command-panel-title" style={{ display: "flex", gap: 8, alignItems: "center" }}><Check size={18} aria-hidden="true" /> Document ready</h2></div>
        <div style={{ padding: 16, display: "grid", gap: 12 }}>
          <p style={{ margin: 0 }}><b>{tpl.title}</b> was saved {clientId ? `to ${clients.find((c) => c.client_id === clientId)?.client_name || "the client"}'s file as a draft` : "as a draft with no client"}. You can find it again under E-Sign.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {clientId && <button type="button" className="btn" onClick={() => navigate(`/clients/${clientId}?tab=Contracts`)}>Open in the client's file</button>}
            {lang === "en" ? (
              <>
                <button type="button" className="btn" onClick={() => viewFile(`/contracts/${done.contractId}/pdf`)}>View PDF</button>
                <button type="button" className="btn" onClick={() => printFile(`/contracts/${done.contractId}/pdf`)}><Printer size={14} aria-hidden="true" /> Print</button>
                <button type="button" className="btn" onClick={() => downloadFile(`/contracts/${done.contractId}/pdf`, `${tpl.title}.pdf`)}><Download size={14} aria-hidden="true" /> Download PDF</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => printText(tpl.title, done.body)}><Printer size={14} aria-hidden="true" /> View / Print / Save as PDF</button>
            )}
            <button type="button" className="btn" onClick={() => downloadFile(`/contracts/${done.contractId}/docx`, `${tpl.title}.docx`).catch((e) => toast(e instanceof ApiError ? e.message : "Could not download the Word file."))}><Download size={14} aria-hidden="true" /> Download Word</button>
          </div>
          <DocSigningPanel docId={done.docId} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 8, borderTop: "1px solid var(--line)" }}>
            <button type="button" className="btn btn-sm" onClick={() => { setDone(null); setStep(0); }}>Make a change and create another copy</button>
            <button type="button" className="btn btn-sm" onClick={onExit}>Back to the library</button>
          </div>
        </div>
      </div>
    );
  }

  const q = steps[step];
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={onExit}><ArrowLeft size={14} aria-hidden="true" /> Library</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>{tpl.title}</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>{tpl.category}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {steps.map((s, i) => <button key={s.title + i} type="button" className={`tpl-chip${i === step ? " on" : ""}`} onClick={() => setStep(i)}>{i + 1}. {s.title}</button>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 14, alignItems: "start" }} className="db-split">
        <div className="command-panel">
          <div className="command-panel-header"><div><h3 className="command-panel-title">{q.title}</h3>{"description" in q && (q as Step).description && <div className="command-panel-note">{(q as Step).description}</div>}</div></div>
          <div style={{ padding: 16 }}>
            {step === 0 && (
              <div className="field">
                <label htmlFor="db-client">Which client is this for? <span className="muted">(optional)</span></label>
                <select id="db-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                  <option value="">No client — outside parties</option>
                  {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
                </select>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>The client's name, address and contact details fill in automatically where the document asks for them. You can change anything.</div>
              </div>
            )}
            {step === 0 && tpl.hasArabic && (
              <div className="field">
                <label>Document language</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {([["en", "English"], ["ar", "العربية"], ["both", "English + العربية"]] as [Lang, string][]).map(([v, label]) => (
                    <button key={v} type="button" className={`tpl-chip${lang === v ? " on" : ""}`} onClick={() => setLang(v)}>{label}</button>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>The questions stay in English. "English + العربية" puts the Arabic edition after the English one, in a single document.</div>
              </div>
            )}
            {step > 0 && step < last && q.questions.map((qq) => <Field key={qq.id} q={qq} value={answers[qq.id]} answers={answers} onChange={(v) => set(qq.id, v)} />)}
            {step === last && (
              <div style={{ display: "grid", gap: 10 }}>
                {tpl.reviewNote && <div className="tender-warn">{tpl.reviewNote}</div>}
                {preview.missing.length > 0 ? (
                  <div className="tender-warn"><b>Still to fill in:</b><ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{preview.missing.slice(0, 8).map((m) => <li key={m}>{m}</li>)}</ul></div>
                ) : <p style={{ margin: 0 }}><Check size={14} aria-hidden="true" style={{ verticalAlign: "-2px", color: "var(--green)" }} /> Everything is filled in. Read the document on the right, then create it.</p>}
                {!clientId && <div className="muted" style={{ fontSize: 12.5 }}>No client chosen — this document will be saved without a client (you and admins will find it under E-Sign and Recently built).</div>}
                {err && <div className="tender-warn" style={{ color: "var(--red)" }}>{err}</div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-primary" disabled={busy || preview.missing.length > 0} onClick={create}><FilePlus2 size={14} aria-hidden="true" /> {busy ? "Saving…" : "Create & save to client"}</button>
                  {lang === "en" ? (
                    <>
                      <button type="button" className="btn" onClick={() => draftPdf(false)}>View PDF</button>
                      <button type="button" className="btn" onClick={() => draftPdf(true)}><Printer size={14} aria-hidden="true" /> Print</button>
                      <button type="button" className="btn" onClick={() => downloadFilePost("/doc-builder/pdf", body, `${tpl.title}.pdf`).catch((e) => toast(e instanceof ApiError ? e.message : "Could not download the PDF."))}><Download size={14} aria-hidden="true" /> Download PDF</button>
                    </>
                  ) : <button type="button" className="btn" onClick={() => printText(tpl.title, preview.body)}><Printer size={14} aria-hidden="true" /> View / Print / Save as PDF</button>}
                  <button type="button" className="btn" onClick={() => downloadFilePost("/doc-builder/docx", body, `${tpl.title}.docx`).catch((e) => toast(e instanceof ApiError ? e.message : "Could not download the Word file."))}><Download size={14} aria-hidden="true" /> Download Word</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, gap: 8 }}>
              <button type="button" className="btn" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={14} aria-hidden="true" /> Back</button>
              {step < last && <button type="button" className="btn btn-primary" onClick={() => setStep(step + 1)}>Next <ArrowRight size={14} aria-hidden="true" /></button>}
            </div>
          </div>
        </div>
        <div className="command-panel" style={{ position: "sticky", top: 12 }}>
          <div className="command-panel-header"><h3 className="command-panel-title">Live preview</h3></div>
          <div style={{ padding: 16, font: "13px/1.55 Georgia, 'Times New Roman', 'Geeza Pro', serif", maxHeight: "70vh", overflow: "auto", background: "var(--paper, #fff)", wordBreak: "break-word" }}>
            {preview.body ? <ContractBodyText text={preview.body} /> : <span className="muted">Your document appears here as you answer.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Answers that come straight from the client's record (name, address…), so choosing a client refreshes them even when already filled. */
function pickPrefilled(tpl: TemplateFull, fresh: Answers): Answers {
  const out: Answers = {};
  for (const s of tpl.stepList) for (const q of s.questions) if ((q as any).prefill && (q as any).prefill !== "today" && (q as any).prefill !== "firmName" && fresh[q.id]) out[q.id] = fresh[q.id];
  return out;
}

export function DocumentBuilderPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("doc") || "";
  const [key, from] = raw.split("?from=");
  return (
    <div style={{ padding: 20 }}>
      {key
        ? <Wizard key={`${key}-${from || ""}`} templateKey={key} fromDocId={from || null} onExit={() => setParams({})} />
        : <Library onPick={(k) => setParams({ doc: k })} />}
    </div>
  );
}
