import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { US_STATES } from "../utils/clientOptions";

/**
 * Firm Portal Credentials — the firm's own agency logins (EFTPS, MD Tax Connect,
 * SSA BSO, ...). Admin-only, encrypted server-side; the password is never sent
 * to the browser until an admin explicitly clicks Reveal, and every reveal is
 * written to the same access log the client Secure Vault uses.
 */

interface FirmPortal {
  portal_id: string;
  portal_name: string;
  category: string | null;
  jurisdiction: string | null;
  agency_name: string | null;
  portal_url: string | null;
  username: string | null;
  has_notes: boolean;
  status: string;
  updated_at: string | null;
  updated_by: string | null;
}

interface Revealed {
  portalId: string;
  username: string;
  password: string;
  notes: string;
}

const CATEGORIES = ["Federal Tax", "State Tax", "Payroll", "Licensing & Permits", "Banking", "Software", "Other"];

const EMPTY_FORM = {
  portalId: "",
  portalName: "",
  category: "Federal Tax",
  jurisdiction: "",
  agencyName: "",
  portalUrl: "",
  username: "",
  password: "",
  notes: "",
  status: "Active",
};

export function FirmPortalsPage() {
  const toast = useToast();
  const [portals, setPortals] = useState<FirmPortal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);

  function load() {
    api.get<{ portals: FirmPortal[] }>("/firm-portals")
      .then((res) => { setPortals(res.portals); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load firm portal credentials."));
  }
  useEffect(load, []);

  const filtered = useMemo(() => {
    if (!portals) return [];
    const q = search.trim().toLowerCase();
    if (!q) return portals;
    return portals.filter((p) =>
      [p.portal_name, p.category, p.jurisdiction, p.agency_name, p.username, p.portal_url]
        .some((v) => String(v || "").toLowerCase().includes(q)));
  }, [portals, search]);

  function startAdd() {
    setForm({ ...EMPTY_FORM });
    setSaveError(null);
    setShowForm(true);
  }

  function startEdit(p: FirmPortal) {
    setForm({
      portalId: p.portal_id,
      portalName: p.portal_name,
      category: p.category || "Other",
      jurisdiction: p.jurisdiction || "",
      agencyName: p.agency_name || "",
      portalUrl: p.portal_url || "",
      username: p.username || "",
      password: "",
      notes: "",
      status: p.status || "Active",
    });
    setSaveError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      // notes is only sent when the admin typed something, so editing a portal's
      // URL doesn't wipe notes they can't see in this form.
      const payload: Record<string, unknown> = { ...form };
      if (!form.notes) delete payload.notes;
      await api.post("/firm-portals", payload);
      toast(form.portalId ? "Portal credential updated." : "Portal credential saved.");
      setShowForm(false);
      setRevealed(null);
      load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save this portal credential.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReveal(p: FirmPortal) {
    if (revealed?.portalId === p.portal_id) { setRevealed(null); return; }
    try {
      const res = await api.get<Revealed & { portalName: string }>(`/firm-portals/${p.portal_id}/reveal`);
      setRevealed({ portalId: p.portal_id, username: res.username, password: res.password, notes: res.notes });
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not reveal this credential.");
    }
  }

  async function handleDelete(p: FirmPortal) {
    if (!confirm(`Delete the saved credential for "${p.portal_name}"? The password cannot be recovered.`)) return;
    try {
      await api.post(`/firm-portals/${p.portal_id}/delete`, {});
      toast("Portal credential deleted.");
      setRevealed(null);
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Could not delete this credential.");
    }
  }

  async function copy(value: string, what: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast(`${what} copied to clipboard.`);
    } catch {
      alert("Could not copy — your browser blocked clipboard access.");
    }
  }

  if (error) return <div className="error-banner">{error}</div>;
  if (!portals) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        The firm's own agency logins — EFTPS, MD Tax Connect, state unemployment portals, and anything else the office
        signs into. Passwords are encrypted on the server and only decrypted when you click <strong>Reveal</strong>;
        every reveal is written to the vault access log. Admin only.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input
          placeholder="Search portals…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <div className="muted" style={{ fontSize: 12 }}>{filtered.length} of {portals.length}</div>
        <div style={{ marginLeft: "auto" }}>
          <button type="button" className="btn btn-primary" onClick={startAdd}>Add Portal</button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 620, marginBottom: 18 }}>
          <h3 style={{ marginTop: 0 }}>{form.portalId ? "Edit Portal" : "Add Portal"}</h3>
          {saveError && <div className="error-banner">{saveError}</div>}

          <div className="field">
            <label>Portal Name *</label>
            <input required value={form.portalName} placeholder="EFTPS" onChange={(e) => setForm((f) => ({ ...f, portalName: e.target.value }))} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Category</label>
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="field">
              <label>State / Jurisdiction</label>
              <select value={form.jurisdiction} onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}>
                <option value="">— None / Federal —</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Agency Name</label>
            <input value={form.agencyName} placeholder="IRS / Comptroller of Maryland" onChange={(e) => setForm((f) => ({ ...f, agencyName: e.target.value }))} />
          </div>

          <div className="field">
            <label>Portal URL</label>
            <input value={form.portalUrl} placeholder="https://www.eftps.gov" onChange={(e) => setForm((f) => ({ ...f, portalUrl: e.target.value }))} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>User ID</label>
              <input value={form.username} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
            </div>
            <div className="field">
              <label>Password{form.portalId ? " (leave blank to keep)" : ""}</label>
              <input type="password" value={form.password} autoComplete="new-password" onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
          </div>

          <div className="field">
            <label>Notes (PIN, security answers, renewal date…)</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            {form.portalId && <div className="muted" style={{ fontSize: 11 }}>Leave blank to keep existing notes.</div>}
          </div>

          <div className="field">
            <label>Status</label>
            <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Portal"}</button>
            <button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="muted" style={{ padding: 20, textAlign: "center" }}>
          {portals.length === 0 ? "No portal credentials saved yet." : "No portals match that search."}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Portal</th>
                <th>Category</th>
                <th>Jurisdiction</th>
                <th>User ID</th>
                <th>Password</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const open = revealed?.portalId === p.portal_id;
                return (
                  <tr key={p.portal_id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.portal_name}</div>
                      {p.portal_url && (
                        <a href={p.portal_url} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>{p.portal_url}</a>
                      )}
                      {p.agency_name && <div className="muted" style={{ fontSize: 11 }}>{p.agency_name}</div>}
                    </td>
                    <td>{p.category || "—"}</td>
                    <td>{p.jurisdiction || "Federal"}</td>
                    <td>
                      {p.username ? (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <code style={{ fontSize: 12 }}>{p.username}</code>
                          <button type="button" className="btn btn-sm" onClick={() => copy(p.username!, "User ID")}>Copy</button>
                        </span>
                      ) : "—"}
                    </td>
                    <td>
                      {open ? (
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                          <code style={{ fontSize: 12 }}>{revealed!.password || "(none saved)"}</code>
                          {revealed!.password && (
                            <button type="button" className="btn btn-sm" onClick={() => copy(revealed!.password, "Password")}>Copy</button>
                          )}
                        </span>
                      ) : (
                        <span className="muted">••••••••</span>
                      )}
                      {open && revealed!.notes && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 4, whiteSpace: "pre-wrap" }}>{revealed!.notes}</div>
                      )}
                    </td>
                    <td>{p.status}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button type="button" className="btn btn-sm" onClick={() => handleReveal(p)}>{open ? "Hide" : "Reveal"}</button>{" "}
                      <button type="button" className="btn btn-sm" onClick={() => startEdit(p)}>Edit</button>{" "}
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => handleDelete(p)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
