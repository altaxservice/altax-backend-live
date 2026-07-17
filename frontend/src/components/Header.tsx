import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../api/client";
import { useLanguage } from "../context/LanguageContext";

const EYEBROW = "OPERATIONS DASHBOARD";

export function Header({ title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { lang, setLang, t, dir } = useLanguage();
  const [search, setSearch] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showTotpModal, setShowTotpModal] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const showLanguageToggle = user?.role === "client" || user?.role === "employee";

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    setShowMore(false);
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <>
      <header className="topbar" dir={showLanguageToggle ? dir : "ltr"}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <button
            type="button"
            className={`hamburger-btn ${showLanguageToggle ? "hidden-for-tabbar" : ""}`}
            aria-label={t("header.menu")}
            onClick={onMenuClick}
          >☰</button>
          <div>
            <div className="topbar-eyebrow">{EYEBROW}</div>
            <h1 className="topbar-title">{title}</h1>
            <div className="topbar-subtitle" style={{ textTransform: "capitalize" }}>{user?.role} {t("header.workspace")}</div>
          </div>
        </div>
        <div className="topbar-actions" style={{ position: "relative" }}>
          <button type="button" className="topbar-more-btn btn" aria-label={t("header.more")} onClick={() => setShowMore((v) => !v)}>⋮</button>
          <div className={`topbar-collapsible ${showMore ? "open" : ""}`}>
            {showLanguageToggle && (
              <div className="topbar-lang-toggle" role="group" aria-label={t("header.language")} style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
                <button type="button" className="btn btn-sm" style={{ borderRadius: 0, border: "none", fontWeight: lang === "en" ? 800 : 500, background: lang === "en" ? "var(--surface-2, #eee)" : "transparent" }} onClick={() => setLang("en")}>EN</button>
                <button type="button" className="btn btn-sm" style={{ borderRadius: 0, border: "none", fontWeight: lang === "ar" ? 800 : 500, background: lang === "ar" ? "var(--surface-2, #eee)" : "transparent" }} onClick={() => setLang("ar")}>عربي</button>
              </div>
            )}
            <form onSubmit={handleSearch} className="topbar-search">
              <div className="topbar-search-label">{t("header.search")}</div>
              <input
                placeholder={t("header.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </form>
            <button type="button" className="btn" onClick={handleSearch}>{t("header.searchAll")}</button>
            <div className="topbar-user">
              <div className="topbar-user-name">{user?.name || user?.email}</div>
              <div className="topbar-user-role">{user?.role?.toUpperCase()}</div>
            </div>
            <button type="button" className="btn" onClick={() => { setShowMore(false); setShowPasswordModal(true); }}>{t("header.changePassword")}</button>
            <button type="button" className="btn" onClick={() => { setShowMore(false); setShowTotpModal(true); }}>
              {user?.totpEnabled ? t("header.2faOn") : t("header.enable2fa")}
            </button>
          </div>
          <button type="button" className="btn" onClick={logout}>{t("header.signOut")}</button>
        </div>
      </header>
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showTotpModal && <TwoFactorModal onClose={() => setShowTotpModal(false)} />}
    </>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change password.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Change Password</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {done ? (
          <p className="muted" style={{ padding: "8px 0" }}>Password updated.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="error-banner">{error}</div>}
            <div className="field">
              <label htmlFor="cp-current">Current Password</label>
              <input id="cp-current" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cp-new">New Password</label>
              <input id="cp-new" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="cp-confirm">Confirm New Password</label>
              <input id="cp-confirm" type="password" required minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Update Password"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function TwoFactorModal({ onClose }: { onClose: () => void }) {
  const { user, updateUser } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"enabled" | "disabled" | null>(null);

  async function handleStartSetup() {
    setSaving(true);
    setError(null);
    try {
      const result = await api.post<{ secret: string; qrCodeDataUrl: string }>("/auth/2fa/setup", {});
      setSetup(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start 2FA setup.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/2fa/confirm", { code });
      updateUser({ totpEnabled: true });
      setDone("enabled");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not confirm code.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/2fa/disable", { code });
      updateUser({ totpEnabled: false });
      setDone("disabled");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not disable 2FA.");
    } finally {
      setSaving(false);
    }
  }

  if (done === "enabled") {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Two-Factor Authentication</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <p className="muted" style={{ padding: "8px 0" }}>Two-factor authentication is now on. You'll be asked for a code from your authenticator app each time you sign in.</p>
        </div>
      </div>
    );
  }

  if (done === "disabled") {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Two-Factor Authentication</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <p className="muted" style={{ padding: "8px 0" }}>Two-factor authentication has been turned off for this account.</p>
        </div>
      </div>
    );
  }

  if (user?.totpEnabled) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2>Two-Factor Authentication</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <p className="muted" style={{ padding: "8px 0" }}>Two-factor authentication is currently <strong>on</strong> for this account. Enter a current code from your authenticator app to turn it off.</p>
          <form onSubmit={handleDisable}>
            {error && <div className="error-banner">{error}</div>}
            <div className="field">
              <label htmlFor="tfa-disable-code">Authenticator Code</label>
              <input
                id="tfa-disable-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <button type="submit" className="btn btn-danger" disabled={saving || code.length !== 6}>{saving ? "Disabling…" : "Disable 2FA"}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Two-Factor Authentication</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!setup ? (
          <>
            <p className="muted" style={{ padding: "8px 0" }}>
              Add an extra layer of security to your account using an authenticator app
              (Google Authenticator, Microsoft Authenticator, 1Password, etc).
            </p>
            <button type="button" className="btn btn-primary" onClick={handleStartSetup} disabled={saving}>
              {saving ? "Starting…" : "Set Up 2FA"}
            </button>
          </>
        ) : (
          <form onSubmit={handleConfirm}>
            <p className="muted" style={{ padding: "4px 0" }}>Scan this QR code with your authenticator app:</p>
            <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
              <img src={setup.qrCodeDataUrl} alt="2FA QR code" width={180} height={180} />
            </div>
            <p className="muted" style={{ fontSize: 11, wordBreak: "break-all" }}>
              Can't scan? Enter this key manually: <code>{setup.secret}</code>
            </p>
            <div className="field">
              <label htmlFor="tfa-confirm-code">Enter the 6-digit code to confirm</label>
              <input
                id="tfa-confirm-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving || code.length !== 6}>
              {saving ? "Confirming…" : "Confirm & Enable"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
