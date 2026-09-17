import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";

const TOKEN_KEY = "altax_kiosk_device_token";
const ROSTER_POLL_MS = 20000;
const CONFIRM_DISPLAY_MS = 3500;

interface RosterEntry { userId: string; name: string; hasPin: boolean; clockedIn: boolean }
interface RosterResponse { kioskLabel: string; staff: RosterEntry[] }
interface PunchResponse { ok: boolean; action: "clock-in" | "clock-out"; name: string; hoursThisPunch?: number; at: string }

function useClock(): string {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/**
 * Real owner question, 2026-09-17: "Add to Home Screen"/"Install app" reads
 * whatever's in <head> at the moment it's tapped — this app is one shared
 * index.html for every route, so without this, the kiosk would get the same
 * icon as the full admin app (confusing on a shared device) and would still
 * open inside the browser's normal chrome (address bar visible) instead of a
 * clean, full-screen "dedicated terminal" feel.
 *
 * Covers BOTH platforms, since the device could be either (direct owner
 * note): the apple-mobile-web-app-* meta tags + apple-touch-icon link drive
 * iOS Safari's behavior; Android/Chrome instead reads whichever manifest the
 * <link rel="manifest"> tag points at. Critically, the app's main manifest
 * has start_url:"/dashboard" — installing from here with THAT manifest still
 * attached would create a home-screen icon that opens the main admin app,
 * not the kiosk. Swapping the manifest link to a separate kiosk-manifest.
 * webmanifest (start_url:"/kiosk", its own icons) fixes that. Every swap
 * restores the ORIGINAL value on unmount (not just removes it), so the
 * tags VitePWA already injects for the main app are untouched everywhere else.
 */
function useKioskHomeScreenTags() {
  useEffect(() => {
    const prevTitle = document.title;
    const created: HTMLElement[] = [];
    const restoreAttrs: { el: Element; attr: string; prev: string | null }[] = [];

    function setAttr(el: Element, attr: string, value: string) {
      restoreAttrs.push({ el, attr, prev: el.getAttribute(attr) });
      el.setAttribute(attr, value);
    }
    function upsertMeta(name: string, content: string) {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); created.push(el); return; }
      setAttr(el, "content", content);
    }

    document.title = "Time Clock";
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-title", "Time Clock");
    upsertMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    upsertMeta("mobile-web-app-capable", "yes");
    upsertMeta("theme-color", "#0b6b6b");

    const iconLink = document.querySelector('link[rel="apple-touch-icon"]');
    if (iconLink) setAttr(iconLink, "href", "/icons/kiosk-apple-touch-icon.png");

    // VitePWA injects this as <link rel="manifest">; swapping its href is
    // what makes Android's "Install app" pick up the kiosk-specific manifest.
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) setAttr(manifestLink, "href", "/kiosk-manifest.webmanifest");

    return () => {
      document.title = prevTitle;
      restoreAttrs.reverse().forEach(({ el, attr, prev }) => { if (prev === null) el.removeAttribute(attr); else el.setAttribute(attr, prev); });
      created.forEach((el) => el.remove());
    };
  }, []);
}

/**
 * Time Clock Kiosk — direct owner request 2026-09-17. Meant to live open,
 * full-screen, on a shared tablet/computer at the office. Deliberately has
 * no normal login: the DEVICE authenticates with its own long token (saved
 * once to this browser's localStorage via the /kiosk/:token setup link an
 * admin opens here), and each person identifies themselves with a short PIN
 * — never their real password — so a compromised or observed kiosk never
 * exposes real account access. The roster is a live query against every
 * active Admin/Staff account, so a person hired next month just shows up
 * here with no separate kiosk setup step.
 */
export function KioskPage() {
  const { token: tokenFromUrl } = useParams();
  const navigate = useNavigate();
  const clock = useClock();
  useKioskHomeScreenTags();

  const [deviceToken, setDeviceToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<PunchResponse | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  // One-time setup: /kiosk/:token saves the device token to this browser and
  // redirects to the clean /kiosk URL, so the secret doesn't linger visibly
  // in the address bar/history after the tablet is set up.
  useEffect(() => {
    if (tokenFromUrl) {
      localStorage.setItem(TOKEN_KEY, tokenFromUrl);
      setDeviceToken(tokenFromUrl);
      navigate("/kiosk", { replace: true });
    }
  }, [tokenFromUrl, navigate]);

  const loadRoster = useCallback(() => {
    if (!deviceToken) return;
    api.get<RosterResponse>(`/public/kiosk/roster?token=${encodeURIComponent(deviceToken)}`)
      .then((res) => { setRoster(res); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not reach the kiosk service."));
  }, [deviceToken]);

  useEffect(() => {
    loadRoster();
    const id = setInterval(loadRoster, ROSTER_POLL_MS);
    return () => clearInterval(id);
  }, [loadRoster]);

  function pressDigit(d: string) {
    if (pin.length >= 6) return;
    setPinError(null);
    setPin((p) => p + d);
  }
  function backspace() {
    setPinError(null);
    setPin((p) => p.slice(0, -1));
  }

  async function submitPin() {
    if (!selected || !deviceToken || pin.length < 4) return;
    setBusy(true);
    setPinError(null);
    try {
      const res = await api.post<PunchResponse>("/public/kiosk/punch", { token: deviceToken, userId: selected.userId, pin });
      setConfirm(res);
      setSelected(null);
      setPin("");
      loadRoster();
      setTimeout(() => setConfirm(null), CONFIRM_DISPLAY_MS);
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const sortedStaff = useMemo(() => (roster?.staff || []).slice().sort((a, b) => a.name.localeCompare(b.name)), [roster]);

  if (!deviceToken) {
    return (
      <KioskShell clock={clock}>
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>This kiosk isn't set up yet</h1>
          <p style={{ opacity: 0.75, fontSize: 16 }}>
            Ask an admin to open Firm → Time Clock Kiosk, create a device, and open the setup link on this screen.
          </p>
        </div>
      </KioskShell>
    );
  }

  if (confirm) {
    return (
      <KioskShell clock={clock}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>{confirm.action === "clock-in" ? "✅" : "👋"}</div>
          <h1 style={{ fontSize: 34, marginBottom: 8 }}>
            {confirm.action === "clock-in" ? `Clocked in, ${confirm.name}!` : `Clocked out, ${confirm.name}!`}
          </h1>
          <p style={{ fontSize: 18, opacity: 0.8 }}>
            {new Date(confirm.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
            {confirm.action === "clock-out" && confirm.hoursThisPunch !== undefined ? ` — ${confirm.hoursThisPunch} hours this shift` : ""}
          </p>
        </div>
      </KioskShell>
    );
  }

  if (selected) {
    return (
      <KioskShell clock={clock}>
        <div style={{ textAlign: "center", width: 320 }}>
          <h1 style={{ fontSize: 26, marginBottom: 4 }}>{selected.name}</h1>
          <p style={{ opacity: 0.7, marginBottom: 20 }}>{selected.clockedIn ? "Enter your PIN to clock out" : "Enter your PIN to clock in"}</p>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginBottom: 20 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                width: 18, height: 18, borderRadius: "50%",
                background: i < pin.length ? "#0b6b6b" : "transparent",
                border: "2px solid #0b6b6b",
              }} />
            ))}
          </div>
          {pinError && <p style={{ color: "#b3441f", marginBottom: 12, fontWeight: 600 }}>{pinError}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <KeypadButton key={d} label={d} onClick={() => pressDigit(d)} disabled={busy} />
            ))}
            <KeypadButton label="Clear" onClick={() => { setPin(""); setPinError(null); }} disabled={busy} small />
            <KeypadButton label="0" onClick={() => pressDigit("0")} disabled={busy} />
            <KeypadButton label="⌫" onClick={backspace} disabled={busy} small />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
            <button
              onClick={() => { setSelected(null); setPin(""); setPinError(null); }}
              style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "1px solid #ccc", background: "#fff", fontSize: 16, cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={submitPin}
              disabled={pin.length < 4 || busy}
              style={{ flex: 2, padding: "14px 0", borderRadius: 10, border: "none", background: pin.length < 4 || busy ? "#9cc4c1" : "#0b6b6b", color: "#fff", fontSize: 16, fontWeight: 700, cursor: pin.length < 4 || busy ? "default" : "pointer" }}
            >
              {busy ? "Checking…" : selected.clockedIn ? "Clock Out" : "Clock In"}
            </button>
          </div>
        </div>
      </KioskShell>
    );
  }

  return (
    <KioskShell clock={clock} label={roster?.kioskLabel}>
      {error && <p style={{ color: "#b3441f", marginBottom: 16 }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 16, width: "min(760px, 92vw)" }}>
        {sortedStaff.map((s) => (
          <button
            key={s.userId}
            onClick={() => { if (s.hasPin) { setSelected(s); setPin(""); setPinError(null); } }}
            disabled={!s.hasPin}
            style={{
              padding: "22px 10px", borderRadius: 14, border: s.clockedIn ? "2px solid #0b6b6b" : "1px solid #d8dee8",
              background: s.clockedIn ? "#eaf3f2" : "#fff", cursor: s.hasPin ? "pointer" : "default", opacity: s.hasPin ? 1 : 0.45,
              display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            }}
          >
            <div style={{ width: 48, height: 48, borderRadius: "50%", background: s.clockedIn ? "#0b6b6b" : "#e5e7eb", color: s.clockedIn ? "#fff" : "#667085", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700 }}>
              {s.name.slice(0, 1).toUpperCase()}
            </div>
            <span style={{ fontSize: 15, fontWeight: 600, textAlign: "center" }}>{s.name}</span>
            {s.clockedIn && <span style={{ fontSize: 11, color: "#0b6b6b", fontWeight: 700 }}>CLOCKED IN</span>}
            {!s.hasPin && <span style={{ fontSize: 11, color: "#a3291c" }}>No PIN set</span>}
          </button>
        ))}
      </div>
    </KioskShell>
  );
}

function KeypadButton({ label, onClick, disabled, small }: { label: string; onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: small ? "14px 0" : "18px 0", borderRadius: 10, border: "1px solid #d8dee8", background: "#fff",
        fontSize: small ? 15 : 22, fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function KioskShell({ children, clock, label }: { children: React.ReactNode; clock: string; label?: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#f7f7f4", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system, sans-serif", padding: 20 }}>
      <div style={{ position: "absolute", top: 24, left: 0, right: 0, display: "flex", justifyContent: "space-between", padding: "0 32px", color: "#667085" }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>AL TAX SERVICE {label ? `· ${label}` : ""}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 14 }}>{clock}</span>
      </div>
      {children}
    </div>
  );
}
