import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, resolveFileUrl } from "../api/client";
import { useToast } from "../components/Toast";
import { AddressFields } from "../components/AddressFields";
import { formatPhoneInput } from "../utils/formatPhone";

interface FirmProfile {
  firmName: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml"];
const MAX_LOGO_BYTES = 1_500_000;

export function FirmSettingsPage() {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<FirmProfile | null>(null);
  const [form, setForm] = useState({ firmName: "", street: "", city: "", state: "", zipCode: "", phone: "", email: "" });
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [pendingLogoDataUrl, setPendingLogoDataUrl] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    api.get<FirmProfile>("/firm-settings")
      .then((res) => {
        setProfile(res);
        setForm({ firmName: res.firmName, street: res.street, city: res.city, state: res.state, zipCode: res.zipCode, phone: formatPhoneInput(res.phone), email: res.email });
        setLogoPreview(res.logoDataUrl);
        setPendingLogoDataUrl(undefined);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load firm settings."));
  }
  useEffect(load, []);

  function handleLogoFile(file: File | null) {
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      setError("Logo must be a PNG, JPEG, or SVG image.");
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { ...form };
      if (pendingLogoDataUrl !== undefined) payload.logoDataUrl = pendingLogoDataUrl;
      const res = await api.patch<FirmProfile>("/firm-settings", payload);
      setProfile(res);
      setLogoPreview(res.logoDataUrl);
      setPendingLogoDataUrl(undefined);
      toast("Firm settings saved.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save firm settings.");
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return error ? <div className="error-banner">{error}</div> : <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        This is the firm's identity — it shows up on every invoice, statement, and report PDF, on the reminder emails
        sent to clients and staff, and in the app itself (sidebar, login screen).
      </p>

      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 520 }}>
        {error && <div className="error-banner">{error}</div>}

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
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => handleLogoFile(e.target.files?.[0] || null)} />
              {logoPreview && <button type="button" className="btn btn-sm" onClick={handleRemoveLogo} style={{ alignSelf: "flex-start" }}>Remove Logo</button>}
            </div>
          </div>
        </div>

        <div className="field"><label>Firm Name</label><input required value={form.firmName} onChange={(e) => setForm((f) => ({ ...f, firmName: e.target.value }))} /></div>

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
          <label>Phone</label>
          <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: formatPhoneInput(e.target.value) }))} />
        </div>
        <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>

        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Firm Settings"}</button>

        {profile.updatedBy && profile.updatedAt && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            Last updated by {profile.updatedBy} on {new Date(profile.updatedAt).toLocaleString()}
          </div>
        )}
      </form>
    </div>
  );
}
