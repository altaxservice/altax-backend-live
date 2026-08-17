import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { useToast } from "../components/Toast";
import { AddressFields } from "../components/AddressFields";
import { formatPhoneInput } from "../utils/formatPhone";
import { ErrorBanner } from "../components/ErrorBanner";
import { FileDropInput } from "../components/FileDropInput";

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
  updatedBy: string | null;
  updatedAt: string | null;
}

// SVG dropped (SEC-004, hard audit 2026-08-13) — see the matching backend
// note in firmSettings.routes.ts for why.
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg"];
const MAX_LOGO_BYTES = 1_500_000;
const ALLOWED_QR_TYPES = ["image/png", "image/jpeg"];
const MAX_QR_BYTES = 1_500_000;

export function FirmSettingsPage() {
  const toast = useToast();
  const [profile, setProfile] = useState<FirmProfile | null>(null);
  const [form, setForm] = useState({ firmName: "", street: "", city: "", state: "", zipCode: "", phone: "", email: "" });
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
        setForm({ firmName: res.firmName, street: res.street, city: res.city, state: res.state, zipCode: res.zipCode, phone: formatPhoneInput(res.phone), email: res.email });
        setLogoPreview(res.logoDataUrl);
        setPendingLogoDataUrl(undefined);
        setZelleQrPreview(res.zelleQrDataUrl);
        setPendingZelleQrDataUrl(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load firm settings."));
  }
  useEffect(load, []);

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

  return (
    <div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        This is the firm's identity — it shows up on every invoice, statement, and report PDF, on the reminder emails
        sent to clients and staff, and in the app itself (sidebar, login screen).
      </p>

      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 520 }}>
        {error && <ErrorBanner error={error} />}

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
              <FileDropInput file={null} onChange={handleLogoFile} accept="image/png,image/jpeg" hint="PNG or JPEG" />
              {logoPreview && <button type="button" className="btn btn-sm" onClick={handleRemoveLogo} style={{ alignSelf: "flex-start" }}>Remove Logo</button>}
            </div>
          </div>
        </div>

        <div className="field">
          <label>Zelle "Scan to Pay" QR Code</label>
          <p className="muted" style={{ fontSize: 11.5, margin: "0 0 6px" }}>
            A screenshot of the QR code your bank's Zelle app generates for receiving payments — printed on every invoice PDF next to Payment Instructions so clients can pay by scanning it.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
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
        </div>

        <div className="field"><label htmlFor="firm-name">Firm Name</label><input id="firm-name" required value={form.firmName} onChange={(e) => setForm((f) => ({ ...f, firmName: e.target.value }))} /></div>

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
          <input id="firm-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formatPhoneInput(e.target.value) }))} />
        </div>
        <div className="field"><label htmlFor="firm-email">Email</label><input id="firm-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Firm Settings"}</button>

        {profile.updatedBy && profile.updatedAt && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            Last updated by {profile.updatedBy} on {new Date(profile.updatedAt).toLocaleString()}
          </div>
        )}
      </form>

      <DashboardAlertSettingsCard />
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
    <div className="card" style={{ maxWidth: 520, marginTop: 16 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Dashboard Alerts</h2>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 12px" }}>
        When on, a client whose cash goes low, receivable goes seriously overdue, filing deadline closes in, payroll
        stops running, or books go stale gets an automatic email (and text, if a phone is on file) to their assigned
        staff member — checked nightly.
      </p>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span>Automatic alerts are {settings.autoAlertsEnabled ? "on" : "off"}</span>
        <button type="button" className="btn btn-sm" onClick={handleToggle} disabled={toggling}>
          {toggling ? "Saving…" : settings.autoAlertsEnabled ? "Turn off" : "Turn on"}
        </button>
      </div>
      <form onSubmit={handleSaveThresholds} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving} style={{ alignSelf: "flex-start" }}>{saving ? "Saving…" : "Save Thresholds"}</button>
      </form>
      {settings.updatedBy && settings.updatedAt && (
        <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Last updated by {settings.updatedBy} on {new Date(settings.updatedAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}
