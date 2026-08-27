import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { ErrorBanner } from "../components/ErrorBanner";

/**
 * Self-hosted, privacy-first website analytics — direct owner request,
 * 2026-08-27, explicitly "the safest way" over Google Analytics or any
 * third-party tracker. Reads from v3_page_views (sql/113), populated by
 * the marketing site's own fire-and-forget beacon
 * (marketing-site/js/main.js's sendPageviewBeacon) — no cookies, no raw
 * IP/user-agent ever stored. "Unique visitors" is a same-day count only
 * (the visitor hash rotates daily on purpose — see sql/113's top comment
 * for why), so don't read it as a returning-visitor metric across days.
 */
interface AnalyticsSummary {
  range: string;
  totalViews: number;
  uniqueVisitors: number;
  topPages: { path: string; views: number; unique_visitors: number }[];
  devices: { device_type: string; views: number }[];
  referrers: { referrer_host: string; views: number }[];
  daily: { day: string; views: number; unique_visitors: number }[];
}

const RANGES: { key: string; label: string }[] = [
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
];

function fmtDay(v: string): string {
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function WebsiteAnalyticsPage() {
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api.get<AnalyticsSummary>(`/analytics/summary?range=${range}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load website analytics."));
  }, [range]);

  if (error) return <ErrorBanner error={error} />;

  const maxDaily = data ? Math.max(1, ...data.daily.map((d) => d.views)) : 1;
  const totalDeviceViews = data ? data.devices.reduce((s, d) => s + d.views, 0) : 0;

  return (
    <div>
      <div className="portal-banner" style={{ marginBottom: 16 }}>
        <div className="topbar-eyebrow">Website Analytics</div>
        <h2>Visitors &amp; Popular Pages</h2>
        <p>
          Self-hosted, no third-party tracker — no cookies, no raw IP address or browser fingerprint ever stored.
          "Unique visitors" is a same-day count only, by design (see the Analytics section of the codebase for why).
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {RANGES.map((r) => (
          <button key={r.key} className={`btn btn-sm ${range === r.key ? "btn-primary" : ""}`} onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
      </div>

      {!data ? (
        <div className="spinner-wrap">Loading…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 }}>
            <div className="card">
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Total Page Views</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{data.totalViews.toLocaleString()}</div>
            </div>
            <div className="card">
              <div className="muted" style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Unique Visitors (same-day)</div>
              <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>{data.uniqueVisitors.toLocaleString()}</div>
            </div>
          </div>

          {data.daily.length > 0 && (
            <div className="command-panel" style={{ marginBottom: 20 }}>
              <div className="command-panel-header"><h2 className="command-panel-title">Daily Views</h2></div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 5 }}>
                {data.daily.map((d) => (
                  <div key={d.day} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                    <span className="muted" style={{ width: 56, flexShrink: 0 }}>{fmtDay(d.day)}</span>
                    <div style={{ flex: 1, background: "var(--surface-alt, rgba(0,0,0,0.04))", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(d.views / maxDaily) * 100}%`, background: "var(--teal, #0b6b6b)", height: 14, borderRadius: 3, minWidth: d.views > 0 ? 3 : 0 }} />
                    </div>
                    <span style={{ width: 34, textAlign: "right", fontWeight: 600 }}>{d.views}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="command-panel" style={{ marginBottom: 20 }}>
            <div className="command-panel-header">
              <div>
                <h2 className="command-panel-title">Most Visited Pages</h2>
                <div className="command-panel-note">Includes every tool/calculator page — this is where "what visitors use most" shows up.</div>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th scope="col">Page</th><th scope="col">Views</th><th scope="col">Unique Visitors</th></tr></thead>
                <tbody>
                  {data.topPages.map((p) => (
                    <tr key={p.path}>
                      <td><code style={{ fontSize: 12.5 }}>{p.path}</code></td>
                      <td>{p.views.toLocaleString()}</td>
                      <td className="muted">{p.unique_visitors.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.topPages.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No page views recorded yet for this range.</p>}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            <div className="command-panel">
              <div className="command-panel-header"><h2 className="command-panel-title">Devices</h2></div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {data.devices.map((d) => (
                  <div key={d.device_type} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ textTransform: "capitalize" }}>{d.device_type}</span>
                    <span className="muted">{d.views.toLocaleString()} ({totalDeviceViews ? Math.round((d.views / totalDeviceViews) * 100) : 0}%)</span>
                  </div>
                ))}
                {data.devices.length === 0 && <p className="muted" style={{ margin: 0 }}>No data yet.</p>}
              </div>
            </div>
            <div className="command-panel">
              <div className="command-panel-header"><h2 className="command-panel-title">Top Referrers</h2></div>
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                {data.referrers.map((r) => (
                  <div key={r.referrer_host} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span>{r.referrer_host}</span>
                    <span className="muted">{r.views.toLocaleString()}</span>
                  </div>
                ))}
                {data.referrers.length === 0 && <p className="muted" style={{ margin: 0 }}>No data yet.</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
