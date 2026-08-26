import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "./ErrorBanner";
import { useNotify } from "./ConfirmProvider";

/**
 * Admin-editable lead-day schedule for the automatic client compliance
 * reminder sweep (complianceReminders.ts) — direct owner request,
 * 2026-08-26. Same "days before due date to remind" idea as the
 * appointment reminder lead-time settings, just per obligation type
 * instead of one shared value, since Annual Report and a quick filing
 * warrant different lead times.
 */
interface ReminderSetting { source: string; leadDays: number[]; enabled: boolean }

export function ComplianceReminderSettingsPanel() {
  const notify = useNotify();
  const [settings, setSettings] = useState<ReminderSetting[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { leadDaysText: string; enabled: boolean }>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  function load() {
    api.get<{ settings: ReminderSetting[] }>("/clients/compliance-reminder-settings")
      .then((res) => {
        setSettings(res.settings);
        setDrafts(Object.fromEntries(res.settings.map((s) => [s.source, { leadDaysText: s.leadDays.join(", "), enabled: s.enabled }])));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load reminder settings."));
  }
  useEffect(load, []);

  async function saveRow(source: string) {
    const d = drafts[source];
    if (!d) return;
    const leadDays = d.leadDaysText.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0);
    if (leadDays.length === 0) { await notify("Enter at least one lead day (e.g. 7, or 14, 3)."); return; }
    setSavingKey(source);
    try {
      await api.patch(`/clients/compliance-reminder-settings/${encodeURIComponent(source)}`, { leadDays, enabled: d.enabled });
      load();
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save this setting.");
    } finally {
      setSavingKey(null);
    }
  }

  if (error) return <ErrorBanner error={error} style={{ marginBottom: 16 }} />;
  if (!settings) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div className="command-panel" style={{ marginBottom: 16 }}>
      <div className="command-panel-header">
        <h2 className="command-panel-title">Compliance Reminder Settings</h2>
        <div className="command-panel-note">
          How many days before each deadline type to automatically email/text the client — runs daily at 6:29AM. Comma-separate multiple lead days (e.g. "14, 3" reminds twice). MD Sales Tax has its own separate reminder, not shown here.
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead><tr><th scope="col">Obligation</th><th scope="col">Remind (days before)</th><th scope="col">Active</th><th scope="col"></th></tr></thead>
          <tbody>
            {settings.map((s) => {
              const d = drafts[s.source];
              if (!d) return null;
              return (
                <tr key={s.source}>
                  <td>{s.source}</td>
                  <td style={{ width: 160 }}>
                    <input style={{ width: "100%" }} value={d.leadDaysText} onChange={(e) => setDrafts((prev) => ({ ...prev, [s.source]: { ...prev[s.source], leadDaysText: e.target.value } }))} />
                  </td>
                  <td><input type="checkbox" checked={d.enabled} onChange={(e) => setDrafts((prev) => ({ ...prev, [s.source]: { ...prev[s.source], enabled: e.target.checked } }))} /></td>
                  <td><button className="btn btn-sm" disabled={savingKey === s.source} onClick={() => saveRow(s.source)}>{savingKey === s.source ? "Saving…" : "Save"}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
