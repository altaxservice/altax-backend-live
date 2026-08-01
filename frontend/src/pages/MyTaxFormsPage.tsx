import { useEffect, useState } from "react";
import { api, ApiError, downloadFile, viewFile } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import type { GovFormFiling, GovFormsMeta } from "../api/govForms";
import { GOV_FORM_LABELS, GOV_STATUS_COLOR } from "../api/govForms";

/**
 * Employee/contractor self-service: fill in and electronically sign a W-4 or
 * W-9 that staff sent from their own profile (see EmployeeDetailPage's
 * "Send to employee to sign" action). Only ever shows filings addressed to
 * the logged-in person themselves — enforced server-side by matching
 * req.user.employeeId, this page never takes an employeeId of its own.
 */
export function MyTaxFormsPage() {
  const toast = useToast();
  const [filings, setFilings] = useState<GovFormFiling[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<{ filings: GovFormFiling[] }>("/gov-forms/my")
      .then((res) => setFilings(res.filings))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your tax forms."));
  }
  useEffect(load, []);

  async function handleView(f: GovFormFiling, mode: "view" | "download") {
    setBusy(`pdf-${f.filing_id}`);
    try {
      const path = f.attached_upload_id ? `/documents/uploads/${f.attached_upload_id}/download` : `/gov-forms/${f.filing_id}/pdf`;
      const filename = `Form_${f.form_type}_${f.filing_id}.pdf`;
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, filename);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not open this form.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>My Tax Forms</h1>
      <p className="muted" style={{ margin: "0 0 20px" }}>Forms AL TAX Service has asked you to fill in and sign. Nothing appears here until they send you one.</p>

      {!filings ? (
        <p className="muted">Loading…</p>
      ) : filings.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>No forms waiting on you right now.</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filings.map((f) => (
            <div key={f.filing_id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>{GOV_FORM_LABELS[f.form_type]}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <span style={{ color: GOV_STATUS_COLOR[f.status] || "inherit", fontWeight: 700 }}>{f.status}</span>
                    {f.status === "Draft" && " — needs your signature"}
                    {f.signed_at && ` · Signed ${new Date(f.signed_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {f.status === "Draft" ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId(openId === f.filing_id ? null : f.filing_id)}>
                      {openId === f.filing_id ? "Close" : "Fill out & Sign"}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handleView(f, "view")}>View</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handleView(f, "download")}>Download</button>
                    </>
                  )}
                </div>
              </div>
              {openId === f.filing_id && (
                <FillAndSignForm
                  filing={f}
                  onDone={() => { setOpenId(null); toast("Signed and submitted."); load(); }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FillAndSignForm({ filing, onDone }: { filing: GovFormFiling; onDone: () => void }) {
  const [meta, setMeta] = useState<GovFormsMeta | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, any>>(filing.form_data || {});
  const [signerName, setSignerName] = useState("");
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    api.get<GovFormsMeta>("/gov-forms/meta").then(setMeta).catch((err) => setLoadError(err instanceof ApiError ? err.message : "Could not load form options."));
  }, []);

  function set(key: string, value: any) {
    setData((d) => ({ ...d, [key]: value }));
  }

  async function handleSubmit() {
    setSaveError(null);
    if (!signerName.trim()) { setSaveError("Type your full legal name to sign."); return; }
    if (!agree) { setSaveError("Check the box confirming this is your electronic signature."); return; }
    setSaving(true);
    try {
      await api.post(`/gov-forms/my/${filing.filing_id}/sign`, { formData: data, signerName: signerName.trim(), agree });
      onDone();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not submit this form.");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <ErrorBanner error={loadError} style={{ marginTop: 12 }} />;
  if (!meta) return <p className="muted" style={{ marginTop: 12 }}>Loading…</p>;

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      {saveError && <ErrorBanner error={saveError} />}

      {filing.form_type === "W4" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>First name</label><input value={data.firstName || ""} onChange={(e) => set("firstName", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>Last name</label><input value={data.lastName || ""} onChange={(e) => set("lastName", e.target.value)} /></div>
          </div>
          <div className="field"><label>Address</label><input value={data.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>City</label><input value={data.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>State</label><input value={data.state || ""} onChange={(e) => set("state", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>ZIP</label><input value={data.zip || ""} onChange={(e) => set("zip", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>SSN</label><input value={data.ssn || ""} onChange={(e) => set("ssn", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}>
              <label>Filing status</label>
              <select value={data.filingStatus || meta.w4FilingStatuses[0]} onChange={(e) => set("filingStatus", e.target.value)}>
                {meta.w4FilingStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
            <input type="checkbox" checked={!!data.multipleJobsCheckbox} onChange={(e) => set("multipleJobsCheckbox", e.target.checked)} />
            Step 2 — There are only two jobs total (check this box)
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>Step 3(a) — Qualifying children amount</label><input type="number" step="0.01" value={data.qualifyingChildrenAmount || ""} onChange={(e) => set("qualifyingChildrenAmount", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>Step 3(b) — Other dependents amount</label><input type="number" step="0.01" value={data.otherDependentsAmount || ""} onChange={(e) => set("otherDependentsAmount", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>4(a) Other income</label><input type="number" step="0.01" value={data.otherIncome || ""} onChange={(e) => set("otherIncome", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>4(b) Deductions</label><input type="number" step="0.01" value={data.deductions || ""} onChange={(e) => set("deductions", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>4(c) Extra withholding</label><input type="number" step="0.01" value={data.extraWithholding || ""} onChange={(e) => set("extraWithholding", e.target.value)} /></div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>Name</label><input value={data.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>Business name <span className="muted">(if different)</span></label><input value={data.businessName || ""} onChange={(e) => set("businessName", e.target.value)} /></div>
          </div>
          <div className="field">
            <label>Federal tax classification</label>
            <select value={data.taxClassification || meta.w9TaxClassifications[0]} onChange={(e) => set("taxClassification", e.target.value)}>
              {meta.w9TaxClassifications.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {data.taxClassification === "LLC" && (
            <div className="field" style={{ maxWidth: 200 }}><label>LLC tax classification (C, S, or P)</label><input maxLength={1} value={data.llcTaxClassificationCode || ""} onChange={(e) => set("llcTaxClassificationCode", e.target.value.toUpperCase())} /></div>
          )}
          {data.taxClassification === "Other" && (
            <div className="field"><label>Describe</label><input value={data.otherClassificationText || ""} onChange={(e) => set("otherClassificationText", e.target.value)} /></div>
          )}
          <div className="field"><label>Address</label><input value={data.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>City</label><input value={data.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>State</label><input value={data.state || ""} onChange={(e) => set("state", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label>ZIP</label><input value={data.zip || ""} onChange={(e) => set("zip", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label>SSN <span className="muted">(if applicable)</span></label><input value={data.ssn || ""} onChange={(e) => set("ssn", e.target.value)} placeholder="XXX-XX-XXXX" /></div>
            <div className="field" style={{ margin: 0 }}><label>EIN <span className="muted">(if applicable)</span></label><input value={data.ein || ""} onChange={(e) => set("ein", e.target.value)} placeholder="XX-XXXXXXX" /></div>
          </div>
        </>
      )}

      <div style={{ marginTop: 16, padding: 12, background: "var(--surface)", borderRadius: 8 }}>
        <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>
          Under penalty of perjury, typing your name below and checking this box is your electronic signature on this form — legally the same as signing it by hand.
        </p>
        <div className="field" style={{ maxWidth: 320 }}>
          <label>Type your full legal name to sign</label>
          <input value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, margin: "8px 0" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
          I confirm this is my electronic signature and the information above is true and correct.
        </label>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>
          {saving ? "Submitting…" : "Sign & Submit"}
        </button>
      </div>
    </div>
  );
}
