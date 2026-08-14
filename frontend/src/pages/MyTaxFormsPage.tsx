import { useEffect, useState } from "react";
import { api, ApiError, downloadFile, viewFile, buildFilename } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";
import { useToast } from "../components/Toast";
import { useNotify } from "../components/ConfirmProvider";
import { useLanguage } from "../context/LanguageContext";
import type { GovFormFiling, GovFormsMeta } from "../api/govForms";
import { GOV_FORM_LABELS, GOV_STATUS_COLOR } from "../api/govForms";
import { fmtDateTime } from "../utils/date";

/**
 * Employee/contractor self-service: fill in and electronically sign a W-4 or
 * W-9 that staff sent from their own profile (see EmployeeDetailPage's
 * "Send to employee to sign" action). Only ever shows filings addressed to
 * the logged-in person themselves — enforced server-side by matching
 * req.user.employeeId, this page never takes an employeeId of its own.
 */
export function MyTaxFormsPage() {
  const toast = useToast();
  const notify = useNotify();
  const { t, dir } = useLanguage();
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
      const filename = buildFilename([GOV_FORM_LABELS[f.form_type] || f.form_type], "pdf");
      if (mode === "view") await viewFile(path);
      else await downloadFile(path, filename);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not open this form.");
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorBanner error={error} />;

  return (
    <div dir={dir}>
      <p className="muted" style={{ margin: "0 0 20px" }}>{t("myTaxForms.subtitle")}</p>

      {!filings ? (
        <p className="muted">{t("common.loading")}</p>
      ) : filings.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>{t("myTaxForms.none")}</p></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filings.map((f) => (
            <div key={f.filing_id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <strong>{GOV_FORM_LABELS[f.form_type]}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                    <span style={{ color: GOV_STATUS_COLOR[f.status] || "inherit", fontWeight: 700 }}>{f.status}</span>
                    {f.status === "Draft" && ` — ${t("myTaxForms.needsSignature")}`}
                    {f.signed_at && ` · ${t("myTaxForms.signed")} ${fmtDateTime(f.signed_at)}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {f.status === "Draft" ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId(openId === f.filing_id ? null : f.filing_id)}>
                      {openId === f.filing_id ? t("myTaxForms.close") : t("myTaxForms.fillAndSign")}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handleView(f, "view")}>{t("myTaxForms.view")}</button>
                      <button type="button" className="btn btn-sm" disabled={busy === `pdf-${f.filing_id}`} onClick={() => handleView(f, "download")}>{t("myTaxForms.download")}</button>
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
  const { t } = useLanguage();
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
  if (!meta) return <p className="muted" style={{ marginTop: 12 }}>{t("common.loading")}</p>;

  const idPrefix = `mtf-${filing.filing_id}`;

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
      {saveError && <ErrorBanner error={saveError} />}

      {filing.form_type === "W4" ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-first-name`}>{t("myTaxForms.firstName")}</label><input id={`${idPrefix}-first-name`} value={data.firstName || ""} onChange={(e) => set("firstName", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-last-name`}>{t("myTaxForms.lastName")}</label><input id={`${idPrefix}-last-name`} value={data.lastName || ""} onChange={(e) => set("lastName", e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor={`${idPrefix}-address`}>{t("myTaxForms.address")}</label><input id={`${idPrefix}-address`} value={data.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-city`}>{t("myTaxForms.city")}</label><input id={`${idPrefix}-city`} value={data.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-state`}>{t("myTaxForms.state")}</label><input id={`${idPrefix}-state`} value={data.state || ""} onChange={(e) => set("state", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-zip`}>{t("myTaxForms.zip")}</label><input id={`${idPrefix}-zip`} value={data.zip || ""} onChange={(e) => set("zip", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-ssn`}>{t("myTaxForms.ssn")}</label><input id={`${idPrefix}-ssn`} value={data.ssn || ""} onChange={(e) => set("ssn", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor={`${idPrefix}-filing-status`}>{t("myTaxForms.filingStatus")}</label>
              <select id={`${idPrefix}-filing-status`} value={data.filingStatus || meta.w4FilingStatuses[0]} onChange={(e) => set("filingStatus", e.target.value)}>
                {meta.w4FilingStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
            <input type="checkbox" checked={!!data.multipleJobsCheckbox} onChange={(e) => set("multipleJobsCheckbox", e.target.checked)} />
            {t("myTaxForms.multipleJobsCheckbox")}
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-step3a`}>{t("myTaxForms.step3a")}</label><input id={`${idPrefix}-step3a`} type="number" step="0.01" value={data.qualifyingChildrenAmount || ""} onChange={(e) => set("qualifyingChildrenAmount", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-step3b`}>{t("myTaxForms.step3b")}</label><input id={`${idPrefix}-step3b`} type="number" step="0.01" value={data.otherDependentsAmount || ""} onChange={(e) => set("otherDependentsAmount", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-step4a`}>{t("myTaxForms.step4a")}</label><input id={`${idPrefix}-step4a`} type="number" step="0.01" value={data.otherIncome || ""} onChange={(e) => set("otherIncome", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-step4b`}>{t("myTaxForms.step4b")}</label><input id={`${idPrefix}-step4b`} type="number" step="0.01" value={data.deductions || ""} onChange={(e) => set("deductions", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-step4c`}>{t("myTaxForms.step4c")}</label><input id={`${idPrefix}-step4c`} type="number" step="0.01" value={data.extraWithholding || ""} onChange={(e) => set("extraWithholding", e.target.value)} /></div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-name`}>{t("myTaxForms.name")}</label><input id={`${idPrefix}-name`} value={data.name || ""} onChange={(e) => set("name", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-business-name`}>{t("myTaxForms.businessNameOptional")}</label><input id={`${idPrefix}-business-name`} value={data.businessName || ""} onChange={(e) => set("businessName", e.target.value)} /></div>
          </div>
          <div className="field">
            <label htmlFor={`${idPrefix}-tax-classification`}>{t("myTaxForms.federalTaxClassification")}</label>
            <select id={`${idPrefix}-tax-classification`} value={data.taxClassification || meta.w9TaxClassifications[0]} onChange={(e) => set("taxClassification", e.target.value)}>
              {meta.w9TaxClassifications.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          {data.taxClassification === "LLC" && (
            <div className="field" style={{ maxWidth: 200 }}><label htmlFor={`${idPrefix}-llc-code`}>{t("myTaxForms.llcTaxClassificationCode")}</label><input id={`${idPrefix}-llc-code`} maxLength={1} value={data.llcTaxClassificationCode || ""} onChange={(e) => set("llcTaxClassificationCode", e.target.value.toUpperCase())} /></div>
          )}
          {data.taxClassification === "Other" && (
            <div className="field"><label htmlFor={`${idPrefix}-other-classification`}>{t("myTaxForms.describe")}</label><input id={`${idPrefix}-other-classification`} value={data.otherClassificationText || ""} onChange={(e) => set("otherClassificationText", e.target.value)} /></div>
          )}
          <div className="field"><label htmlFor={`${idPrefix}-w9-address`}>{t("myTaxForms.address")}</label><input id={`${idPrefix}-w9-address`} value={data.address || ""} onChange={(e) => set("address", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-w9-city`}>{t("myTaxForms.city")}</label><input id={`${idPrefix}-w9-city`} value={data.city || ""} onChange={(e) => set("city", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-w9-state`}>{t("myTaxForms.state")}</label><input id={`${idPrefix}-w9-state`} value={data.state || ""} onChange={(e) => set("state", e.target.value)} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-w9-zip`}>{t("myTaxForms.zip")}</label><input id={`${idPrefix}-w9-zip`} value={data.zip || ""} onChange={(e) => set("zip", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-w9-ssn`}>{t("myTaxForms.ssnOptional")}</label><input id={`${idPrefix}-w9-ssn`} value={data.ssn || ""} onChange={(e) => set("ssn", e.target.value)} placeholder="XXX-XX-XXXX" /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor={`${idPrefix}-w9-ein`}>{t("myTaxForms.einOptional")}</label><input id={`${idPrefix}-w9-ein`} value={data.ein || ""} onChange={(e) => set("ein", e.target.value)} placeholder="XX-XXXXXXX" /></div>
          </div>
        </>
      )}

      <div style={{ marginTop: 16, padding: 12, background: "var(--surface)", borderRadius: 8 }}>
        <p style={{ fontSize: 12.5, margin: "0 0 10px" }}>
          {t("myTaxForms.signatureLegal")}
        </p>
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor={`${idPrefix}-signer-name`}>{t("myTaxForms.signLabel")}</label>
          <input id={`${idPrefix}-signer-name`} value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 13, margin: "8px 0" }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} />
          {t("myTaxForms.confirmCheckbox")}
        </label>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={handleSubmit}>
          {saving ? t("myTaxForms.submitting") : t("myTaxForms.signAndSubmit")}
        </button>
      </div>
    </div>
  );
}
