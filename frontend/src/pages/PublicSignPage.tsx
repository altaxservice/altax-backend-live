import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { ContractBodyText } from "../components/ContractBodyText";
import { ErrorBanner } from "../components/ErrorBanner";
import { PublicPageShell } from "../components/PublicPageShell";

interface Other { role: string; name: string; status: string; signedAt: string | null; isYou: boolean }
interface Data {
  file?: { name: string; pages: number } | null;
  doc: { title: string; body: string; effectiveDate: string | null; clientName: string; status: string; firmName: string; completed: boolean };
  signer: { name: string; role: string; status: string; signedAt: string | null; signedName: string | null };
  others: Other[];
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/** A small drawing pad: finger or mouse, exported as a PNG. Optional — typing the name is enough to sign. */
function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current!; const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!; ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  function down(e: React.PointerEvent) { drawing.current = true; ref.current!.setPointerCapture(e.pointerId); const { x, y } = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.beginPath(); ctx.moveTo(x, y); }
  function move(e: React.PointerEvent) { if (!drawing.current) return; const { x, y } = pos(e); const ctx = ref.current!.getContext("2d")!; ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; }
  function up() { if (!drawing.current) return; drawing.current = false; if (dirty.current) onChange(ref.current!.toDataURL("image/png")); }
  function clear() { const c = ref.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); dirty.current = false; onChange(null); }
  return (
    <div>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        style={{ width: "100%", height: 130, border: "1px dashed var(--line, #bbb)", borderRadius: 8, background: "#fff", touchAction: "none", cursor: "crosshair" }} aria-label="Draw your signature here" />
      <button type="button" className="btn btn-sm" style={{ marginTop: 6 }} onClick={clear}>Clear drawing</button>
    </div>
  );
}

/**
 * The page a signer opens from their private link — no login. They read the whole document, see who else has signed, then sign
 * by typing their name (and optionally drawing it) after agreeing to sign electronically. Works on a phone.
 */
export function PublicSignPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Two separate confirmations: consent to use electronic records and signatures (Maryland UETA, Commercial Law 21-104(b)(3), wants this separately
  // consented to, not buried in the agreement), and the signer's own "I read it and agree to sign". The server still receives one "agreed" flag.
  const [consentE, setConsentE] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [declined, setDeclined] = useState(false);

  const load = () => { if (token) api.get<Data>(`/public/signatures/${token}`).then((d) => { setData(d); setName((n) => n || d.signer.signedName || ""); }).catch((e) => setError(e instanceof ApiError ? e.message : "This link could not be opened.")); };
  useEffect(load, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sign() {
    setBusy(true); setSignError(null);
    try { await api.post(`/public/signatures/${token}/sign`, { signerName: name, agreed: consentE && agreed, signatureImage: image || undefined }); load(); }
    catch (e) { setSignError(e instanceof ApiError ? e.message : "Could not record your signature."); } finally { setBusy(false); }
  }
  async function decline() {
    setBusy(true);
    try { await api.post(`/public/signatures/${token}/decline`, { reason }); setDeclined(true); load(); }
    catch (e) { setSignError(e instanceof ApiError ? e.message : "Could not record your answer."); } finally { setBusy(false); }
  }

  if (error) return <PublicPageShell><ErrorBanner error={error} /></PublicPageShell>;
  if (!data) return <PublicPageShell><div className="spinner-wrap">Loading…</div></PublicPageShell>;
  const { doc, signer, others } = data;
  const signed = signer.status === "Signed", closed = signer.status === "Declined" || declined;
  const pdfHref = resolveFileUrl(`/public/signatures/${token}/pdf`);

  return (
    <PublicPageShell>
      <div style={{ maxWidth: 820, margin: "0 auto", display: "grid", gap: 16, padding: "0 4px" }}>
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>{doc.firmName}{doc.clientName ? ` · for ${doc.clientName}` : ""}</div>
          <h1 style={{ margin: "4px 0 0", fontSize: 22 }}>{doc.title}</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Hello {signer.name} — you are signing as <b>{signer.role}</b>. If you are not {signer.name}, or you were not expecting this, please do not sign — contact the person who sent it.</p>
          <p className="muted" dir="rtl" lang="ar" style={{ margin: "4px 0 0", textAlign: "right" }}>مرحباً <bdi>{signer.name}</bdi> — أنتم توقّعون بصفة <bdi>{signer.role}</bdi>. وإذا لم تكونوا <bdi>{signer.name}</bdi>، أو لم تكونوا تتوقعون هذا المستند، فيرجى عدم التوقيع والتواصل مع من أرسله لكم.</p>
        </div>

        {doc.completed && <div className="tender-warn" style={{ background: "var(--green-soft, #e8f6ee)" }}>✓ Everyone has signed this document. You can view, print or save the signed copy below.</div>}

        <div className="command-panel"><div className="command-panel-header"><h2 className="command-panel-title">Read the document before you sign</h2></div>
          {data.file ? (
            <div style={{ padding: 12, display: "grid", gap: 8 }}>
              <iframe title={data.file.name} src={resolveFileUrl(`/public/signatures/${token}/file`)} style={{ width: "100%", height: "70vh", border: "1px solid var(--line, #ddd)", borderRadius: 6, background: "#fff" }} />
              <a href={resolveFileUrl(`/public/signatures/${token}/file`)} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>Open the document in its own tab ({data.file.name}, {data.file.pages} page{data.file.pages === 1 ? "" : "s"}) — easier to read on a phone</a>
            </div>
          ) : (
            <div style={{ padding: 16, maxHeight: "60vh", overflow: "auto", font: "14px/1.6 Georgia, 'Times New Roman', 'Geeza Pro', serif", background: "var(--paper, #fff)" }}><ContractBodyText text={doc.body} /></div>
          )}
        </div>

        <div className="command-panel"><div className="command-panel-header"><h2 className="command-panel-title">Who has signed</h2></div>
          <div style={{ padding: 12, display: "grid", gap: 6 }}>
            {others.map((o, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
                <span><b>{o.role}</b> — {o.name}{o.isYou ? " (you)" : ""}</span>
                <span style={{ color: o.status === "Signed" ? "var(--green, #1a7f4b)" : o.status === "Declined" ? "var(--red, #b3261e)" : "var(--muted, #666)" }}>{o.status === "Signed" ? `✓ Signed ${fmt(o.signedAt)}` : o.status === "Declined" ? "Declined" : "Waiting"}</span>
              </div>
            ))}
          </div>
        </div>

        {!signed && !closed && !doc.completed && (
          <div className="command-panel"><div className="command-panel-header"><h2 className="command-panel-title">Sign</h2></div>
            <div style={{ padding: 16, display: "grid", gap: 14 }}>
              <div className="field"><label htmlFor="sg-name">Type your full legal name<span style={{ color: "var(--red)" }}> *</span></label><input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
              <div className="field"><label>Draw your signature <span className="muted">(optional)</span></label><SignaturePad onChange={setImage} /></div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5 }}>
                <input type="checkbox" checked={consentE} onChange={(e) => setConsentE(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ display: "block" }}><b>Electronic signing.</b> I agree to use electronic records and signatures for this document. This is my choice: I can ask the sender for a paper copy to sign by hand instead, and I can stop before signing by closing this page or choosing "I don't want to sign". Signing electronically has the same effect as signing on paper. To view and keep the document I need a phone or computer with an internet browser and a program that opens PDF files.</span>
                  <span dir="rtl" lang="ar" style={{ display: "block", marginTop: 6, textAlign: "right" }}><b>التوقيع الإلكتروني.</b> أوافق على استخدام السجلات والتوقيعات الإلكترونية لهذا المستند. وهذا خيار لي: يمكنني أن أطلب من المرسل نسخة ورقية لأوقّعها بخط اليد بدلاً من ذلك، ويمكنني التوقف قبل التوقيع بإغلاق هذه الصفحة أو باختيار «لا أريد التوقيع». التوقيع الإلكتروني له الأثر نفسه كالتوقيع على الورق. ولعرض المستند وحفظه أحتاج إلى هاتف أو حاسوب مزوّد بمتصفح إنترنت وبرنامج يفتح ملفات PDF.</span>
                </span>
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13.5 }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 3 }} />
                <span>
                  <span style={{ display: "block" }}><b>My signature.</b> I am {signer.name} (or I am authorized to sign for them as {signer.role}). I have read this whole document and I agree to sign it. My typed name{image ? " and drawn signature" : ""} will be my legal signature. The time, my device's network address (IP address) and my browser or device type are recorded with my signature.</span>
                  <span dir="rtl" lang="ar" style={{ display: "block", marginTop: 6, textAlign: "right" }}><b>توقيعي.</b> أنا <bdi>{signer.name}</bdi> (أو أنا مفوَّض بالتوقيع عنه بصفتي <bdi>{signer.role}</bdi>). قرأت هذا المستند كاملاً وأوافق على توقيعه. سيكون اسمي المكتوب{image ? " وتوقيعي المرسوم" : ""} توقيعي القانوني. ويُسجَّل مع توقيعي الوقت وعنوان الشبكة (IP) لجهازي ونوع المتصفح أو الجهاز.</span>
                </span>
              </label>
              <div className="muted" style={{ fontSize: 12.5 }}>
                After you sign, you can open, print or save the signed document from this page at any time{doc.firmName ? ` — ${doc.firmName} keeps a copy too` : ""}.
                <span dir="rtl" lang="ar" style={{ display: "block", textAlign: "right", marginTop: 2 }}>بعد التوقيع يمكنكم فتح المستند الموقّع أو طباعته أو حفظه من هذه الصفحة في أي وقت.</span>
              </div>
              {signError && <div className="tender-warn" style={{ color: "var(--red)" }}>{signError}</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !agreed || !consentE} onClick={sign}>{busy ? "Signing…" : "Sign document"}</button>
                <button type="button" className="btn" onClick={() => setDeclining((v) => !v)}>I don't want to sign</button>
              </div>
              {declining && (
                <div className="field"><label htmlFor="sg-reason">Tell us why (optional)</label><textarea id="sg-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-danger" style={{ marginTop: 6 }} disabled={busy} onClick={decline}>Decline to sign</button></div>
              )}
            </div>
          </div>
        )}

        {signed && <div className="tender-warn" style={{ background: "var(--green-soft, #e8f6ee)" }}>✓ You signed this document on {fmt(signer.signedAt)}{!doc.completed ? ". We'll email you the signed copy once everyone has signed." : "."}</div>}
        {closed && <div className="tender-warn">You chose not to sign this document. The person who sent it has been told.</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a className="btn" href={pdfHref} target="_blank" rel="noreferrer">View / download PDF</a>
        </div>
      </div>
    </PublicPageShell>
  );
}
