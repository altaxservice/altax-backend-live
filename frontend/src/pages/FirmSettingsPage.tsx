import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { useToast } from "../components/Toast";
import { AddressFields } from "../components/AddressFields";
import { formatPhoneInput } from "../utils/formatPhone";
import { ErrorBanner } from "../components/ErrorBanner";
import { FileDropInput } from "../components/FileDropInput";

const TERMS_OPTIONS = ["", "Due on receipt", "Net 15", "Net 30", "Net 60"];

interface FirmProfile {
  firmName: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  zelleQrDataUrl: string | null;
  zellePhone: string;
  ein: string;
  efin: string;
  website: string;
  defaultPaymentTerms: string;
  defaultPaymentInstructions: string;
  invoiceFooter: string;
  emailFromName: string;
  emailReplyTo: string;
  emailSignature: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface FirmSettingsForm {
  firmName: string; street: string; city: string; state: string; zipCode: string; phone: string; email: string;
  ein: string; efin: string; website: string;
  defaultPaymentTerms: string; defaultPaymentInstructions: string; invoiceFooter: string;
  emailFromName: string; emailReplyTo: string; emailSignature: string; zellePhone: string;
}

const EMPTY_FORM: FirmSettingsForm = {
  firmName: "", street: "", city: "", state: "", zipCode: "", phone: "", email: "",
  ein: "", efin: "", website: "",
  defaultPaymentTerms: "", defaultPaymentInstructions: "", invoiceFooter: "",
  emailFromName: "", emailReplyTo: "", emailSignature: "", zellePhone: "",
};

// SVG dropped (SEC-004, hard audit 2026-08-13) — see the matching backend
// note in firmSettings.routes.ts for why.
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_BYTES = 1_500_000;
const ALLOWED_QR_TYPES = ["image/png", "image/jpeg"];
const MAX_QR_BYTES = 1_500_000;

export function FirmSettingsPage() {
  const toast = useToast();
  const [profile, setProfile] = useState<FirmProfile | null>(null);
  const [form, setForm] = useState<FirmSettingsForm>(EMPTY_FORM);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState<string | null | undefined>(undefined);
  const [zelleQrPreview, setZelleQrPreview] = useState<string | null>(null);
  const [pendingZelleQrDataUrl, setPendingZelleQrDataUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<FirmProfile>("/firm-settings")
      .then((res) => {
        setProfile(res);
        setForm({
          firmName: res.firmName, street: res.street, city: res.city, state: res.state, zipCode: res.zipCode,
          phone: formatPhoneInput(res.phone), email: res.email,
          ein: res.ein, efin: res.efin, website: res.website,
          defaultPaymentTerms: res.defaultPaymentTerms, defaultPaymentInstructions: res.defaultPaymentInstructions,
          invoiceFooter: res.invoiceFooter,
          emailFromName: res.emailFromName, emailReplyTo: res.emailReplyTo, emailSignature: res.emailSignature,
          zellePhone: res.zellePhone || "",
        });
        setLogoPreview(res.logoDataUrl);
        setPendingLogoDataUrl(undefined);
        setZelleQrPreview(res.zelleQrDataUrl);
        setPendingZelleQrDataUrl(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load firm settings."));
  }
  useEffect(load, []);

  function set<K extends keyof FirmSettingsForm>(key: K, value: FirmSettingsForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleLogoFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setError("Logo must be a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Logo image is too large — please use a file under 1.5MB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setLogoPreview(dataUrl);
      setPendingLogoDataUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveLogo() {
    setLogoPreview(null);
    setPendingLogoDataUrl(null);
  }

  function handleZelleQrFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED_QR_TYPES.includes(file.type)) {
      setError("Zelle QR code must be a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_QR_BYTES) {
      setError("Zelle QR image is too large — please use a file under 1.5MB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setZelleQrPreview(dataUrl);
      setPendingZelleQrDataUrl(dataUrl);
    };
    reader.readAsDataURL(file);
  }

  function handleRemoveZelleQr() {
    setZelleQrPreview(null);
    setPendingZelleQrDataUrl(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (pendingLogoDataUrl !== undefined) payload.logoDataUrl = pendingLogoDataUrl;
      if (pendingZelleQrDataUrl !== undefined) payload.zelleQrDataUrl = pendingZelleQrDataUrl;
      const res = await api.patch<FirmProfile>("/firm-settings", payload);
      setProfile(res);
      setLogoPreview(res.logoDataUrl);
      setPendingLogoDataUrl(undefined);
      setZelleQrPreview(res.zelleQrDataUrl);
      setPendingZelleQrDataUrl(undefined);
      toast("Firm settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save firm settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return error ? <ErrorBanner error={error} /> : <div className="spinner-wrap">Loading…</div>;

  const addressLine = [form.street, [form.city, form.state, form.zipCode].filter(Boolean).join(", ")].filter(Boolean).join(", ");

  return (
    <div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 760 }}>
        This is the firm's identity — it shows up on every invoice, statement, and report PDF, on the reminder emails
        sent to clients and staff, and in the app itself (sidebar, login screen). Changes here take effect everywhere
        immediately, so double-check before saving.
      </p>

      <form onSubmit={handleSubmit}>
        {error && <ErrorBanner error={error} />}

        <div className="firm-settings-grid">
          <div className="firm-settings-col">
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>Identity</h2>
              <div className="field">
                <label>Logo</label>
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 8, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fafafa" }}>
                    {logoPreview ? (
                      <img src={logoPreview.startsWith("data:") ? logoPreview : resolveFileUrl(logoPreview)} alt="Firm logo" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>No logo</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <FileDropInput file={null} onChange={handleLogoFile} accept="image/png,image/jpeg" hint="Square PNG or JPEG, 512px+ works best" />
                    {logoPreview && <button type="button" className="btn btn-sm" onClick={handleRemoveLogo} style={{ alignSelf: "flex-start" }}>Remove Logo</button>}
                  </div>
                </div>
              </div>

              <div className="field"><label htmlFor="firm-name">Firm Name</label><input id="firm-name" required value={form.firmName} onChange={(e) => set("firmName", e.target.value)} /></div>

              <AddressFields
                idPrefix="firm"
                value={{ street: form.street, city: form.city, state: form.state, zip: form.zipCode }}
                onChange={(patch) => setForm((f) => ({
                  ...f,
                  street: patch.street ?? f.street,
                  city: patch.city ?? f.city,
                  state: patch.state ?? f.state,
                  zipCode: patch.zip ?? f.zipCode,
                }))}
              />

              <div className="field">
                <label htmlFor="firm-phone">Phone</label>
                <input id="firm-phone" value={form.phone} onChange={(e) => set("phone", formatPhoneInput(e.target.value))} />
              </div>
              <div className="field"><label htmlFor="firm-email">Email</label><input id="firm-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
              <div className="field"><label htmlFor="firm-website">Website</label><input id="firm-website" placeholder="https://www.example.com" value={form.website} onChange={(e) => set("website", e.target.value)} /></div>
            </div>

            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Firm Credentials</h2>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
                Prints on engagement letters and prefills IRS Form 2848/8821 and MD Form 548 generation. Each
                preparer's own PTIN/CAF number is set on their own user profile, not here.
              </p>
              <div className="field"><label htmlFor="firm-ein">Firm EIN</label><input id="firm-ein" placeholder="XX-XXXXXXX" value={form.ein} onChange={(e) => set("ein", e.target.value)} /></div>
              <div className="field"><label htmlFor="firm-efin">Firm EFIN</label><input id="firm-efin" placeholder="6-digit e-file ID" value={form.efin} onChange={(e) => set("efin", e.target.value)} /></div>
            </div>

            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Billing Defaults</h2>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
                Pre-fills a new invoice's Terms and Payment Instructions so staff don't retype them every time —
                still fully editable on each invoice.
              </p>
              <div className="field">
                <label htmlFor="firm-default-terms">Default Payment Terms</label>
                <select id="firm-default-terms" value={form.defaultPaymentTerms} onChange={(e) => set("defaultPaymentTerms", e.target.value)}>
                  {TERMS_OPTIONS.map((t) => <option key={t || "none"} value={t}>{t || "No default (Due on receipt)"}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="firm-default-instructions">Default Payment Instructions</label>
                <textarea id="firm-default-instructions" rows={3} placeholder="e.g. Checks payable to AL Tax Service, or pay by Zelle using the QR code below." value={form.defaultPaymentInstructions} onChange={(e) => set("defaultPaymentInstructions", e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="firm-invoice-footer">Invoice Footer</label>
                <input id="firm-invoice-footer" placeholder="Thank you for your business." value={form.invoiceFooter} onChange={(e) => set("invoiceFooter", e.target.value)} />
              </div>
            </div>

            <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save Firm Settings"}</button>
            {profile.updatedBy && profile.updatedAt && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Last updated by {profile.updatedBy} on {new Date(profile.updatedAt).toLocaleString()}
              </div>
            )}
          </div>

          <div className="firm-settings-col">
            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Letterhead Preview</h2>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>What clients see at the top of every invoice, statement, and report PDF.</p>
              <div className="firm-letterhead-preview">
                <div className="firm-letterhead-preview-header">
                  {logoPreview && <img src={logoPreview.startsWith("data:") ? logoPreview : resolveFileUrl(logoPreview)} alt="" style={{ height: 32, maxWidth: 64, objectFit: "contain" }} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{form.firmName || "Firm Name"}</div>
                    <div style={{ fontSize: 11, color: "#9fb4bf" }}>{addressLine || "Address"}</div>
                  </div>
                </div>
                <div className="firm-letterhead-preview-body">
                  {[form.phone && `Phone: ${formatPhoneInput(form.phone)}`, form.email && `Email: ${form.email}`, form.website].filter(Boolean).join("  ·  ") || "Phone · Email · Website"}
                </div>
              </div>
            </div>

            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Zelle Payments</h2>
              <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
                <label htmlFor="firm-zelle-phone">Zelle phone number</label>
                <input id="firm-zelle-phone" value={form.zellePhone} onChange={(e) => set("zellePhone", formatPhoneInput(e.target.value))} placeholder="(443) 825-8804" inputMode="tel" />
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  Printed on every invoice — the PDF, the online invoice page and the invoice email — as “Zelle by phone number: {form.zellePhone || "(###) ###-####"}”. Leave blank to hide it.
                </div>
              </div>
              <h3 style={{ fontSize: 13.5, margin: "0 0 4px" }}>“Scan to Pay” QR Code</h3>
              <p className="muted" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
                A screenshot of the QR code your bank's Zelle app generates for receiving payments — printed on every
                invoice PDF next to Payment Instructions so clients can pay by scanning it. Test-scan it yourself
                before saving; a blurry screenshot may not scan once printed.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                <div style={{ width: 72, height: 72, borderRadius: 8, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fafafa" }}>
                  {zelleQrPreview ? (
                    <img src={zelleQrPreview.startsWith("data:") ? zelleQrPreview : resolveFileUrl(zelleQrPreview)} alt="Zelle QR code" style={{ maxWidth: "100%", maxHeight: "100%" }} />
                  ) : (
                    <span className="muted" style={{ fontSize: 11 }}>None on file</span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                  <FileDropInput file={null} onChange={handleZelleQrFile} accept="image/png,image/jpeg" hint="PNG or JPEG" />
                  {zelleQrPreview && <button type="button" className="btn btn-sm" onClick={handleRemoveZelleQr} style={{ alignSelf: "flex-start" }}>Remove QR Code</button>}
                </div>
              </div>
              {zelleQrPreview && (
                <div className="firm-qr-preview-mock">
                  <img src={zelleQrPreview.startsWith("data:") ? zelleQrPreview : resolveFileUrl(zelleQrPreview)} alt="" style={{ width: 48, height: 48, objectFit: "contain" }} />
                  <div style={{ fontSize: 11.5, color: "#555" }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Payment Instructions</div>
                    <div>{form.defaultPaymentInstructions || "Scan to pay by Zelle."}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="card">
              <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Communication Defaults</h2>
              <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
                Applied to every outgoing email (reminders, invoices, notices). Replies always route to your reply-to
                address (or the firm email above if left blank) so "reply to this email" is actually true.
              </p>
              <div className="field"><label htmlFor="firm-from-name">Sender Display Name</label><input id="firm-from-name" placeholder={form.firmName || "AL Tax Service"} value={form.emailFromName} onChange={(e) => set("emailFromName", e.target.value)} /></div>
              <div className="field"><label htmlFor="firm-reply-to">Reply-To Email</label><input id="firm-reply-to" type="email" placeholder={form.email || "firm email"} value={form.emailReplyTo} onChange={(e) => set("emailReplyTo", e.target.value)} /></div>
              <div className="field">
                <label htmlFor="firm-signature">Email Signature</label>
                <textarea id="firm-signature" rows={3} placeholder={"Warm regards,\nThe " + (form.firmName || "AL Tax Service") + " Team"} value={form.emailSignature} onChange={(e) => set("emailSignature", e.target.value)} />
              </div>
            </div>

            <DashboardAlertSettingsCard />
            <FirmSettingsHistoryCard />
          </div>
        </div>
      </form>
    </div>
  );
}

interface DashboardAlertSettings {
  autoAlertsEnabled: boolean; cashThreshold: number; overdueDaysThreshold: number; filingDeadlineDaysThreshold: number;
  payrollCadenceGraceDays: number; bookkeepingStalenessDaysThreshold: number;
  updatedBy: string | null; updatedAt: string | null;
}

/**
 * Firm-wide on/off switch + thresholds for the At a Glance dashboard's
 * automated email/SMS alerts (a client's cash going negative, a
 * receivable going seriously overdue, a filing deadline closing in) —
 * see runDashboardAlertPush, src/modules/clients/dashboardAlerts.ts.
 */
function DashboardAlertSettingsCard() {
  const toast = useToast();
  const [settings, setSettings] = useState<DashboardAlertSettings | null>(null);
  const [form, setForm] = useState({ cashThreshold: "0", overdueDaysThreshold: "90", filingDeadlineDaysThreshold: "7", payrollCadenceGraceDays: "10", bookkeepingStalenessDaysThreshold: "75" });
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);

  function load() {
    api.get<DashboardAlertSettings>("/reports/dashboard-alert-settings")
      .then((res) => {
        setSettings(res);
        setForm({
          cashThreshold: String(res.cashThreshold), overdueDaysThreshold: String(res.overdueDaysThreshold), filingDeadlineDaysThreshold: String(res.filingDeadlineDaysThreshold),
          payrollCadenceGraceDays: String(res.payrollCadenceGraceDays), bookkeepingStalenessDaysThreshold: String(res.bookkeepingStalenessDaysThreshold),
        });
      })
      .catch(() => {});
  }
  useEffect(load, []);

  async function handleToggle() {
    if (!settings || toggling) return;
    setToggling(true);
    try {
      const res = await api.patch<DashboardAlertSettings>("/reports/dashboard-alert-settings", { autoAlertsEnabled: !settings.autoAlertsEnabled });
      setSettings(res);
      toast(res.autoAlertsEnabled ? "Dashboard alerts turned on." : "Dashboard alerts turned off.");
    } catch {
      toast("Could not update dashboard alert settings.");
    } finally {
      setToggling(false);
    }
  }

  async function handleSaveThresholds(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    setSaving(true);
    try {
      const res = await api.patch<DashboardAlertSettings>("/reports/dashboard-alert-settings", {
        cashThreshold: Number(form.cashThreshold) || 0,
        overdueDaysThreshold: Number(form.overdueDaysThreshold) || 90,
        filingDeadlineDaysThreshold: Number(form.filingDeadlineDaysThreshold) || 7,
        payrollCadenceGraceDays: Number(form.payrollCadenceGraceDays) || 10,
        bookkeepingStalenessDaysThreshold: Number(form.bookkeepingStalenessDaysThreshold) || 75,
      });
      setSettings(res);
      toast("Alert thresholds saved.");
    } catch {
      toast("Could not save alert thresholds.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Dashboard Alerts</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        When on, a client whose cash goes low (below the threshold — $0 means only once it goes negative), receivable
        goes seriously overdue, filing deadline closes in, payroll stops running, or books go stale gets an automatic
        email (and text, if a phone is on file) to their assigned staff member — checked nightly.
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span>Automatic alerts are {settings.autoAlertsEnabled ? "on" : "off"}</span>
        <button type="button" className="btn btn-sm" onClick={handleToggle} disabled={toggling}>
          {toggling ? "Saving…" : settings.autoAlertsEnabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      {/* This card's fields live inside the page's outer <form> (its Save
          Thresholds button is a plain type="button", not type="submit", to
          avoid nesting a second <form> — invalid HTML and unpredictable
          submit behavior). Without this guard, pressing Enter in one of
          these inputs would bubble up and trigger the OUTER form's "Save
          Firm Settings" instead of this card's own "Save Thresholds". */}
      <div
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
        onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
      >
        <div className="field">
          <label htmlFor="cash-threshold">Cash balance threshold ($)</label>
          <input id="cash-threshold" type="number" step="0.01" value={form.cashThreshold} onChange={(e) => setForm((f) => ({ ...f, cashThreshold: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="overdue-threshold">Overdue invoice alert threshold (days)</label>
          <input id="overdue-threshold" type="number" min={1} value={form.overdueDaysThreshold} onChange={(e) => setForm((f) => ({ ...f, overdueDaysThreshold: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="filing-threshold">Filing deadline alert threshold (days out)</label>
          <input id="filing-threshold" type="number" min={1} value={form.filingDeadlineDaysThreshold} onChange={(e) => setForm((f) => ({ ...f, filingDeadlineDaysThreshold: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="payroll-cadence-grace">Payroll cadence grace period (days)</label>
          <input id="payroll-cadence-grace" type="number" min={0} value={form.payrollCadenceGraceDays} onChange={(e) => setForm((f) => ({ ...f, payrollCadenceGraceDays: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="bookkeeping-staleness">Bookkeeping staleness threshold (days)</label>
          <input id="bookkeeping-staleness" type="number" min={1} value={form.bookkeepingStalenessDaysThreshold} onChange={(e) => setForm((f) => ({ ...f, bookkeepingStalenessDaysThreshold: e.target.value }))} />
        </div>
        <button type="button" className="btn btn-sm btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }} onClick={handleSaveThresholds}>{saving ? "Saving…" : "Save Thresholds"}</button>
      </div>
      {settings.updatedBy && settings.updatedAt && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Last updated by {settings.updatedBy} on {new Date(settings.updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

interface FirmSettingsHistoryEntry { loggedAt: string; userEmail: string; note: string | null }

/** Surfaces the audit log's existing UPDATE_FIRM_SETTINGS rows — no new logging, just a read-only view of who changed the firm's settings and when. */
function FirmSettingsHistoryCard() {
  const [entries, setEntries] = useState<FirmSettingsHistoryEntry[] | null>(null);

  useEffect(() => {
    api.get<FirmSettingsHistoryEntry[]>("/firm-settings/history").then(setEntries).catch(() => setEntries([]));
  }, []);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="card">
      <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Change History</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
        {entries.map((e, i) => (
          <div key={i} style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10, borderBottom: i < entries.length - 1 ? "1px solid var(--line)" : "none", paddingBottom: 6 }}>
            <span>{e.userEmail}</span>
            <span className="muted">{new Date(e.loggedAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
