import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { useConfirm, usePrompt, useNotify } from "../components/ConfirmProvider";
import { ErrorBanner } from "../components/ErrorBanner";

interface KioskDevice { device_id: string; label: string; active: boolean; created_at: string; created_by: string | null; last_used_at: string | null }
interface StaffRow { user_id: string; name: string; email: string; role: string }
interface OpenPunch { punch_id: string; user_id: string; name: string; clock_in_at: string; device_label: string | null }

/**
 * Admin console for the Time Clock Kiosk — create/revoke the physical
 * device(s), set each person's PIN, and fix a punch someone forgot to close.
 * The kiosk itself (KioskPage.tsx) is the public, unauthenticated screen a
 * shared tablet actually runs; everything here is the admin-only control
 * plane behind it.
 */
export function KioskSettingsPage() {
  const toast = useToast();
  const notify = useNotify();
  const confirmDialog = useConfirm();
  const promptFor = usePrompt();

  const [devices, setDevices] = useState<KioskDevice[] | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [openPunches, setOpenPunches] = useState<OpenPunch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDeviceToken, setNewDeviceToken] = useState<{ deviceId: string; label: string; token: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<{ devices: KioskDevice[] }>("/kiosk/devices").then((r) => setDevices(r.devices)).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load kiosk devices."));
    api.get<{ users: StaffRow[] }>("/users").then((r) => setStaff(r.users.filter((u) => ["admin", "staff"].includes(u.role.toLowerCase())))).catch(() => {});
    api.get<{ punches: OpenPunch[] }>("/kiosk/open-punches").then((r) => setOpenPunches(r.punches)).catch(() => {});
  }
  useEffect(load, []);

  async function handleCreateDevice() {
    const label = await promptFor({ title: "New kiosk device", message: "A short name for this device (e.g. \"Front Desk Tablet\").", placeholder: "Office Kiosk" });
    if (label === null) return;
    setBusy("create");
    try {
      const res = await api.post<{ deviceId: string; deviceToken: string; label: string }>("/kiosk/devices", { label });
      setNewDeviceToken({ deviceId: res.deviceId, label: res.label, token: res.deviceToken });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not create this device.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevoke(d: KioskDevice) {
    const ok = await confirmDialog({ title: "Revoke this kiosk", message: `"${d.label}" will stop working immediately. Anyone using it will need a new setup link.`, danger: true, confirmLabel: "Revoke" });
    if (!ok) return;
    try {
      await api.post(`/kiosk/devices/${d.device_id}/revoke`, {});
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not revoke this device.");
    }
  }

  async function handleResetToken(d: KioskDevice) {
    setBusy(d.device_id);
    try {
      const res = await api.post<{ deviceId: string; deviceToken: string; label: string }>(`/kiosk/devices/${d.device_id}/reset-token`, {});
      setNewDeviceToken({ deviceId: res.deviceId, label: res.label, token: res.deviceToken });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not reset this device's token.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSetPin(u: StaffRow) {
    const pin = await promptFor({ title: `Set PIN — ${u.name}`, message: "4 to 6 digits, used only at the kiosk (never their real password).", placeholder: "1234" });
    if (pin === null) return;
    if (!/^\d{4,6}$/.test(pin)) { await notify("PIN must be 4 to 6 digits."); return; }
    try {
      await api.post(`/kiosk/users/${u.user_id}/pin`, { pin });
      toast(`PIN set for ${u.name}.`);
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not set this PIN.");
    }
  }

  async function handleForceClockOut(p: OpenPunch) {
    const ok = await confirmDialog({ title: "Force clock-out", message: `Close ${p.name}'s open punch right now? Their hours will be recorded up to this moment.`, confirmLabel: "Clock Out Now" });
    if (!ok) return;
    try {
      await api.post(`/kiosk/punches/${p.punch_id}/close`, { clockOutAt: new Date().toISOString() });
      toast(`${p.name} clocked out.`);
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not close this punch.");
    }
  }

  const kioskUrl = newDeviceToken ? `${window.location.origin}/kiosk/${newDeviceToken.token}` : "";

  return (
    <div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        A shared tablet or computer where any Admin/Staff member (including anyone hired later — the list below is always live)
        clocks in and out with a short PIN. Time is recorded automatically into Time Tracking, the same place Staff Capacity reads from.
      </p>
      {error && <ErrorBanner error={error} />}

      {newDeviceToken && (
        <div className="card" style={{ maxWidth: 560, marginBottom: 16, border: "1.5px solid var(--teal, #0b6b6b)" }}>
          <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Setup link for "{newDeviceToken.label}"</h2>
          <p className="muted" style={{ fontSize: 12.5, margin: "0 0 10px" }}>
            Open this link once on the physical tablet/computer — it saves the device's access and switches to the clean kiosk screen.
            This link won't be shown again; use "Reset Token" below if you lose it.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input readOnly value={kioskUrl} style={{ flex: 1, fontSize: 12.5 }} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(kioskUrl); toast("Link copied."); }}>Copy</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
            On the iPad: open this link in Safari, tap the Share icon, then <strong>"Add to Home Screen."</strong> That gives it its own
            clock icon and opens full-screen with no Safari address bar — just a bookmark won't do either of those.
          </p>
          <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setNewDeviceToken(null)}>Done</button>
        </div>
      )}

      <div className="card" style={{ maxWidth: 640, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Kiosk Devices</h2>
          <button type="button" className="btn btn-sm btn-primary" onClick={handleCreateDevice} disabled={busy === "create"}>
            {busy === "create" ? "Creating…" : "+ New Device"}
          </button>
        </div>
        {!devices ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div> : devices.length === 0 ? (
          <div className="muted" style={{ fontSize: 13 }}>No kiosk devices yet.</div>
        ) : (
          devices.map((d) => (
            <div key={d.device_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{d.label} {!d.active && <span className="status-pill status-gray" style={{ fontSize: 10, marginLeft: 6 }}>Revoked</span>}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  Last used: {d.last_used_at ? new Date(d.last_used_at).toLocaleString() : "Never"}
                </div>
              </div>
              {d.active && <button type="button" className="ghost-button btn-sm" onClick={() => handleResetToken(d)} disabled={busy === d.device_id}>Reset Token</button>}
              {d.active && <button type="button" className="ghost-button btn-sm" onClick={() => handleRevoke(d)}>Revoke</button>}
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ maxWidth: 640, marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Staff PINs</h2>
        {!staff ? <div className="muted" style={{ fontSize: 13 }}>Loading…</div> : (
          staff.map((u) => (
            <div key={u.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1, fontSize: 13.5 }}>{u.name} <span className="muted">({u.role})</span></div>
              <button type="button" className="ghost-button btn-sm" onClick={() => handleSetPin(u)}>Set / Reset PIN</button>
            </div>
          ))
        )}
      </div>

      {openPunches && openPunches.length > 0 && (
        <div className="card" style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Currently Clocked In</h2>
          <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>If someone forgot to clock out, close it here so their hours are correct.</p>
          {openPunches.map((p) => (
            <div key={p.punch_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ flex: 1, fontSize: 13.5 }}>
                {p.name} <span className="muted">since {new Date(p.clock_in_at).toLocaleString()}{p.device_label ? ` · ${p.device_label}` : ""}</span>
              </div>
              <button type="button" className="ghost-button btn-sm" onClick={() => handleForceClockOut(p)}>Force Clock Out</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
