import { useEffect, useState } from "react";
import { api, viewFile, downloadFile } from "../api/client";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { useConfirm } from "../components/ConfirmProvider";

interface WispRosterRow { userId: string; name: string; email: string; role: string; acknowledged: boolean; acknowledgedAt: string | null }
interface WispMeta {
  coordinatorNames: string; adoptedDate: string; lastReviewedDate: string;
  myAcknowledgment: { acknowledged: boolean; acknowledgedAt: string | null };
  roster?: WispRosterRow[];
}

/**
 * The firm's Written Information Security Plan — required under IRS Pub. 4557
 * and the FTC Safeguards Rule for every paid tax preparer. Open to Admin AND
 * Staff (unlike Firm Settings, which is admin-only) since every staff member
 * needs to read and acknowledge it, not just admins. Generated fresh from the
 * firm's own profile + these settings on every view/download, so it's never
 * stale. An admin can see who still hasn't acknowledged, edit the named
 * coordinators, and mark it reviewed (which bumps the version and requires
 * everyone to re-acknowledge).
 */
export function CompliancePage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const isAdmin = user?.role === "admin";
  const [meta, setMeta] = useState<WispMeta | null>(null);
  const [coordinatorNames, setCoordinatorNames] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    api.get<WispMeta>("/compliance/wisp/meta")
      .then((res) => { setMeta(res); setCoordinatorNames(res.coordinatorNames); })
      .catch(() => {});
  }
  useEffect(load, []);

  async function handleView(mode: "view" | "download") {
    setBusy(mode);
    try {
      if (mode === "view") await viewFile("/compliance/wisp/pdf");
      else await downloadFile("/compliance/wisp/pdf", "WISP.pdf");
    } catch {
      toast("Could not generate the WISP PDF.");
    } finally {
      setBusy(null);
    }
  }

  async function handleAcknowledge() {
    setBusy("ack");
    try {
      await api.post("/compliance/wisp/acknowledge", {});
      toast("Thanks — your acknowledgment has been recorded.");
      load();
    } catch {
      toast("Could not record your acknowledgment.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveCoordinators() {
    setBusy("coordinators");
    try {
      await api.patch("/compliance/wisp/settings", { coordinatorNames });
      toast("Data Security Coordinator(s) updated.");
      load();
    } catch {
      toast("Could not save the coordinator names.");
    } finally {
      setBusy(null);
    }
  }

  async function handleMarkReviewed() {
    const ok = await confirm({
      title: "Mark WISP reviewed today?",
      message: "This sets today as the last-reviewed date and requires every staff member to re-acknowledge the plan, even if nothing else in it changed.",
      confirmLabel: "Mark Reviewed",
    });
    if (!ok) return;
    setBusy("review");
    try {
      await api.patch("/compliance/wisp/settings", { markReviewedToday: true });
      toast("WISP marked reviewed today. Staff will be asked to re-acknowledge.");
      load();
    } catch {
      toast("Could not update the review date.");
    } finally {
      setBusy(null);
    }
  }

  if (!meta) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        The firm's Written Information Security Plan (WISP) — required for every paid tax preparer under IRS
        Publication 4557 and the FTC Safeguards Rule (16 CFR Part 314). Generated from the firm's current profile,
        so it's always up to date.
      </p>

      <div className="card" style={{ maxWidth: 560 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>Written Information Security Plan</h2>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, margin: "8px 0 14px" }}>
          <span className="muted">Adopted: <strong>{meta.adoptedDate}</strong></span>
          <span className="muted">Last reviewed: <strong>{meta.lastReviewedDate}</strong></span>
          <span className="muted">Coordinator(s): <strong>{meta.coordinatorNames}</strong></span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button type="button" className="btn btn-sm" onClick={() => handleView("view")} disabled={busy === "view"}>
            {busy === "view" ? "Opening…" : "View / Print PDF"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => handleView("download")} disabled={busy === "download"}>
            {busy === "download" ? "Downloading…" : "Download PDF"}
          </button>
        </div>

        {meta.myAcknowledgment.acknowledged ? (
          <div style={{ fontSize: 12, color: "var(--success, #1a7f37)", marginBottom: 14 }}>
            ✓ You acknowledged this version on {new Date(meta.myAcknowledgment.acknowledgedAt!).toLocaleString()}.
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontSize: 12, margin: "0 0 6px" }}>
              You have not yet acknowledged the current version of the WISP. Please review it above, then confirm below.
            </p>
            <button type="button" className="btn btn-sm btn-primary" onClick={handleAcknowledge} disabled={busy === "ack"}>
              {busy === "ack" ? "Saving…" : "I have read and understood this WISP"}
            </button>
          </div>
        )}

        {isAdmin && (
          <>
            <div style={{ borderTop: "1px solid var(--line)", margin: "14px 0" }} />
            <div className="field">
              <label htmlFor="wisp-coordinators">Data Security Coordinator(s)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="wisp-coordinators" value={coordinatorNames} onChange={(e) => setCoordinatorNames(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn-sm" onClick={handleSaveCoordinators} disabled={busy === "coordinators"}>
                  {busy === "coordinators" ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <button type="button" className="btn btn-sm" onClick={handleMarkReviewed} disabled={busy === "review"} style={{ marginTop: 6 }}>
              {busy === "review" ? "Saving…" : "Mark Reviewed Today"}
            </button>

            {meta.roster && (
              <div style={{ marginTop: 16 }}>
                <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.3 }}>
                  Staff Acknowledgment — Version {meta.lastReviewedDate}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {meta.roster.map((r) => (
                    <div key={r.userId} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                      <span>{r.name} <span className="muted">({r.role})</span></span>
                      {r.acknowledged ? (
                        <span style={{ color: "var(--success, #1a7f37)" }}>✓ {new Date(r.acknowledgedAt!).toLocaleDateString()}</span>
                      ) : (
                        <span className="muted">Not yet acknowledged</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
