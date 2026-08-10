import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calculator } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, ApiError } from "../api/client";
import { useLanguage } from "../context/LanguageContext";
import { APP_NAME } from "../utils/branding";
import { ErrorBanner } from "./ErrorBanner";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { FloatingCalculator } from "./FloatingCalculator";

const EYEBROW = "OPERATIONS DASHBOARD";

export function Header({ title, onMenuClick, menuOpen }: { title: string; onMenuClick?: () => void; menuOpen?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { lang, setLang, t, dir } = useLanguage();
  const [search, setSearch] = useState("");
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showTotpModal, setShowTotpModal] = useState(false);
  const [showPreparerModal, setShowPreparerModal] = useState(false);
  const isPreparer = user?.role === "admin" || user?.role === "staff";
  const [showMore, setShowMore] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const showLanguageToggle = user?.role === "client" || user?.role === "employee";
  const userMenuRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // The dropdown used to stay open until the Admin chip was clicked again —
  // clicking anywhere else on the page left it hanging over the content.
  useEffect(() => {
    if (!showUserMenu) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!userMenuRef.current?.contains(e.target as Node)) setShowUserMenu(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowUserMenu(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showUserMenu]);

  // Same fix for the mobile ⋮ tray (search) — it stayed stuck open until the
  // ⋮ button itself was tapped again; now tapping anywhere else (or Escape)
  // closes it like any dropdown.
  useEffect(() => {
    if (!showMore) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!moreRef.current?.contains(e.target as Node)) setShowMore(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setShowMore(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showMore]);

  // Navigating away should never leave the menu (or the ⋮ tray) open behind the new page.
  useEffect(() => {
    setShowUserMenu(false);
    setShowMore(false);
  }, [location.pathname]);

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
            aria-expanded={Boolean(menuOpen)}
            aria-controls="primary-sidebar"
            onClick={onMenuClick}
          >☰</button>
          <div>
            {/* Clients/employees get their own portal name here — "OPERATIONS
                DASHBOARD" and the "client workspace" subline are firm-internal
                jargon (and the subline mixed English into the Arabic UI). */}
            <div className="topbar-eyebrow">
              {showLanguageToggle
                ? t(user?.role === "employee" ? "dashboard.employee.eyebrow" : "dashboard.client.eyebrow")
                : EYEBROW}
            </div>
            <h1 className="topbar-title">{title}</h1>
            {!showLanguageToggle && (
              <div className="topbar-subtitle" style={{ textTransform: "capitalize" }}>{user?.role} {t("header.workspace")}</div>
            )}
          </div>
        </div>
        <div className="topbar-actions" style={{ position: "relative" }}>
          {/* Always visible, never inside the ⋮ tray — buried there, clients never
              found it. Shows the language you'd switch TO, so an Arabic speaker
              landing on the English portal immediately sees "عربي" to tap. */}
          {showLanguageToggle && (
            <button
              type="button"
              className="btn lang-switch-btn"
              aria-label={t("header.language")}
              onClick={() => setLang(lang === "en" ? "ar" : "en")}
            >
              {lang === "en" ? "عربي" : "English"}
            </button>
          )}
          {/* display:contents — gives the outside-click effect one node covering the
              ⋮ button plus its tray without changing the flex layout on desktop,
              where the tray renders inline instead of as a dropdown. */}
          <div ref={moreRef} style={{ display: "contents" }}>
            <button type="button" className="topbar-more-btn btn" aria-label={t("header.more")} onClick={() => setShowMore((v) => !v)}>⋮</button>
            <div className={`topbar-collapsible ${showMore ? "open" : ""}`}>
              <form onSubmit={handleSearch} className="topbar-search">
                <div className="topbar-search-label">{t("header.search")}</div>
                <input
                  placeholder={t("header.searchPlaceholder")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </form>
              <button type="button" className="btn" onClick={handleSearch}>{t("header.searchAll")}</button>
            </div>
          </div>
          <button
            type="button"
            className="btn topbar-cmdk-hint"
            title="Quick search everything (⌘K)"
            onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
          >
            <kbd>⌘K</kbd>
          </button>
          {isPreparer && (
            <button
              type="button"
              className="btn"
              aria-label="Calculator"
              aria-pressed={showCalculator}
              title="Calculator — plain arithmetic, not the tax calculators under Calculators"
              onClick={() => setShowCalculator((v) => !v)}
            >
              <Calculator size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <div style={{ position: "relative" }} ref={userMenuRef}>
            <button type="button" className="topbar-user-btn" onClick={() => setShowUserMenu((v) => !v)}>
              <div>
                <div className="topbar-user-name">{user?.name || user?.email}</div>
                <div className="topbar-user-role">{user?.role?.toUpperCase()}</div>
              </div>
              <span className="topbar-user-caret" aria-hidden="true">{showUserMenu ? "▴" : "▾"}</span>
            </button>
            {showUserMenu && (
              <div className="topbar-user-dropdown">
                <button type="button" onClick={() => { setShowUserMenu(false); setShowPasswordModal(true); }}>{t("header.changePassword")}</button>
                <button type="button" onClick={() => { setShowUserMenu(false); setShowTotpModal(true); }}>
                  {user?.totpEnabled ? t("header.2faOn") : t("header.enable2fa")}
                </button>
                {isPreparer && (
                  <button type="button" onClick={() => { setShowUserMenu(false); setShowPreparerModal(true); }}>
                    Preparer Info (PTIN / CAF)
                  </button>
                )}
                <button type="button" className="topbar-user-dropdown-signout" onClick={logout}>{t("header.signOut")}</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {showPasswordModal && <ChangePasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showTotpModal && <TwoFactorModal onClose={() => setShowTotpModal(false)} />}
      {showPreparerModal && <PreparerInfoModal onClose={() => setShowPreparerModal(false)} />}
      {showCalculator && <FloatingCalculator onClose={() => setShowCalculator(false)} />}
    </>
  );
}

/**
 * Self-service PTIN / CAF number — every admin/staff account can fill in
 * their own, same as changing their own password, rather than needing an
 * admin to enter it for them. Form 2848 requires each named representative's
 * PTIN and CAF number; nothing captured this before. An admin can still
 * enter it on someone else's behalf from Users & Access if that person
 * hasn't done it themselves yet.
 */
function PreparerInfoModal({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const [ptin, setPtin] = useState("");
  const [cafNumber, setCafNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<{ ptin: string; cafNumber: string }>("/auth/preparer-info")
      .then((res) => { setPtin(res.ptin); setCafNumber(res.cafNumber); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your preparer info."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/auth/preparer-info", { ptin, cafNumber });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your preparer info.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="preparer-info-title" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="preparer-info-title">Preparer Info</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5, margin: "0 0 12px" }}>
          Used on IRS Form 2848 when you're named as a representative. Only visible to you and admins.
        </p>
        {loading ? (
          <p className="muted" style={{ padding: "8px 0" }}>Loading…</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <ErrorBanner error={error} />}
            {saved && <p style={{ color: "var(--green)", fontSize: 13, margin: "0 0 10px" }}>Saved.</p>}
            <div className="field">
              <label htmlFor="prep-ptin">PTIN</label>
              <input id="prep-ptin" placeholder="P12345678" value={ptin} onChange={(e) => { setPtin(e.target.value); setSaved(false); }} />
            </div>
            <div className="field">
              <label htmlFor="prep-caf">CAF Number</label>
              <input id="prep-caf" placeholder="Leave blank if you don't have one yet — the IRS assigns one" value={cafNumber} onChange={(e) => { setCafNumber(e.target.value); setSaved(false); }} />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
          </form>
        )}
      </div>
    </div>
  );
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
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
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="change-password-title" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="change-password-title">Change Password</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {done ? (
          <p className="muted" style={{ padding: "8px 0" }}>Password updated.</p>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <ErrorBanner error={error} />}
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
  useEscapeToClose(onClose);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);
  const { user, updateUser } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"enabled" | "disabled" | null>(null);
  const [backupRemaining, setBackupRemaining] = useState<number | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!user?.totpEnabled) return;
    api.get<{ remaining: number }>("/auth/2fa/backup-codes")
      .then((r) => setBackupRemaining(r.remaining))
      .catch(() => setBackupRemaining(null));
  }, [user?.totpEnabled]);

  async function handleRegenerate(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ backupCodes: string[] }>("/auth/2fa/backup-codes/regenerate", { code });
      setNewCodes(res.backupCodes);
      setBackupRemaining(res.backupCodes.length);
      setCode("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate new recovery codes.");
    } finally {
      setSaving(false);
    }
  }

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

  if (done === "enabled") {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tfa-modal-title" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 id="tfa-modal-title">Two-Factor Authentication</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <p className="muted" style={{ padding: "8px 0" }}>Two-factor authentication is now on. You'll be asked for a code from your authenticator app each time you sign in.</p>
        </div>
      </div>
    );
  }

  // 2FA is mandatory on every portal, so there is no "turn it off" path here
  // any more — the backend refuses it outright. A lost phone is handled by a
  // recovery code, or failing that an admin reset on Users & Access.
  if (user?.totpEnabled) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tfa-modal-title" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 id="tfa-modal-title">Two-Factor Authentication</h2>
            <button className="btn btn-sm" onClick={onClose}>Close</button>
          </div>
          <p className="muted" style={{ padding: "8px 0" }}>
            Two-factor authentication is <strong>on</strong> for this account, and is required on every {APP_NAME}
            {" "}portal — it cannot be turned off.
          </p>

          {newCodes ? (
            <>
              <p style={{ fontSize: 13, margin: "4px 0 8px" }}>
                <strong>Your new recovery codes.</strong> The old ones no longer work. This is the only time these
                are shown.
              </p>
              <div className="card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, padding: 12 }}>
                {newCodes.map((c) => <div key={c}>{c}</div>)}
              </div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(newCodes.join("\n"))}>Copy</button>
            </>
          ) : (
            <>
              <p className="muted" style={{ padding: "0 0 4px", fontSize: 12.5 }}>
                Recovery codes let you sign in if you lose your phone — each works once.
                {backupRemaining !== null && <> You have <strong>{backupRemaining}</strong> left.</>}
              </p>
              {backupRemaining !== null && backupRemaining <= 2 && (
                <div className="error-banner" style={{ fontSize: 12 }}>
                  You are nearly out of recovery codes. Generate a new set now.
                </div>
              )}
              <form onSubmit={handleRegenerate} style={{ marginTop: 8 }}>
                {error && <ErrorBanner error={error} />}
                <div className="field">
                  <label htmlFor="tfa-regen-code">Authenticator code (to issue new recovery codes)</label>
                  <input
                    id="tfa-regen-code"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <button type="submit" className="btn btn-sm" disabled={saving || code.length !== 6}>
                  {saving ? "Generating…" : "Generate New Recovery Codes"}
                </button>
              </form>
            </>
          )}

          <p className="muted" style={{ padding: "10px 0 0", fontSize: 11.5 }}>
            Out of codes and without your phone? An admin can reset your 2FA from Users &amp; Access, and you'll set
            up a new authenticator at your next sign-in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={panelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="tfa-modal-title" style={{ maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 id="tfa-modal-title">Two-Factor Authentication</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {error && <ErrorBanner error={error} />}
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
