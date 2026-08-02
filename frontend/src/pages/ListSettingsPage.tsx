import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm } from "../components/ConfirmProvider";

/**
 * List Settings — every dropdown list in the app, editable in one place.
 *
 * Before this, adding a task type or a payment method meant a code change.
 * Each list ships with its factory defaults; the first edit copies them into
 * the database and from then on the list is fully the firm's own. Options are
 * copied into records as plain text when a record is saved, so renaming or
 * removing an option here never rewrites existing tasks/invoices — it only
 * changes what future forms offer.
 */

interface DropdownOption {
  optionId: string | null; // null = factory default not yet copied to the DB
  value: string;
  active: boolean;
  sortOrder: number;
}

interface DropdownCategory {
  category: string;
  label: string;
  customized: boolean;
  options: DropdownOption[];
}

export function ListSettingsPage() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [categories, setCategories] = useState<DropdownCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ optionId: string; value: string } | null>(null);

  function load() {
    api.get<{ categories: DropdownCategory[] }>("/system/dropdowns")
      .then((res) => { setCategories(res.categories); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the lists."));
  }
  useEffect(load, []);

  /**
   * Factory-default rows have no optionId to PATCH. Any edit on such a list
   * first materializes it (add a throwaway? No — the add endpoint seeds it),
   * so edits on defaults route through a seed-then-retry: adding the SAME
   * value is rejected as duplicate AFTER seeding, which is all we need.
   */
  async function ensureSeeded(category: DropdownCategory): Promise<void> {
    if (category.customized) return;
    // Adding a marker value seeds the list, then we remove the marker.
    const marker = `__seed_${Date.now()}`;
    const res = await api.post<{ optionId: string }>(`/system/dropdowns/${category.category}`, { value: marker });
    await api.post(`/system/dropdowns/option/${res.optionId}/delete`, {});
  }

  async function withReload(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(category: DropdownCategory) {
    const value = newValue.trim();
    if (!value) return;
    await withReload(async () => {
      await api.post(`/system/dropdowns/${category.category}`, { value });
      toast(`Added "${value}".`);
      setNewValue("");
    });
  }

  async function optionIdFor(category: DropdownCategory, opt: DropdownOption): Promise<string> {
    if (opt.optionId) return opt.optionId;
    await ensureSeeded(category);
    const fresh = await api.get<{ categories: DropdownCategory[] }>("/system/dropdowns");
    const cat = fresh.categories.find((c) => c.category === category.category);
    const found = cat?.options.find((o) => o.value === opt.value);
    if (!found?.optionId) throw new ApiError("Could not prepare this list for editing — reload and try again.", 500);
    return found.optionId;
  }

  async function handleToggle(category: DropdownCategory, opt: DropdownOption) {
    await withReload(async () => {
      const id = await optionIdFor(category, opt);
      await api.patch(`/system/dropdowns/option/${id}`, { active: !opt.active });
    });
  }

  async function handleMove(category: DropdownCategory, opt: DropdownOption, direction: "up" | "down") {
    await withReload(async () => {
      const id = await optionIdFor(category, opt);
      await api.patch(`/system/dropdowns/option/${id}`, { direction });
    });
  }

  async function handleRename(category: DropdownCategory, opt: DropdownOption) {
    if (!editing) return;
    const value = editing.value.trim();
    if (!value || value === opt.value) { setEditing(null); return; }
    await withReload(async () => {
      const id = await optionIdFor(category, opt);
      await api.patch(`/system/dropdowns/option/${id}`, { value });
      toast(`Renamed to "${value}". Existing records keep the old text.`);
      setEditing(null);
    });
  }

  async function handleDelete(category: DropdownCategory, opt: DropdownOption) {
    const ok = await confirmDialog({
      title: "Remove option",
      message: `Remove "${opt.value}" from ${category.label}? Existing records that already use it are not changed — it just stops being offered on forms.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    await withReload(async () => {
      const id = await optionIdFor(category, opt);
      await api.post(`/system/dropdowns/option/${id}/delete`, {});
      toast(`Removed "${opt.value}".`);
    });
  }

  if (error) return <ErrorBanner error={error} />;
  if (!categories) return <div className="spinner-wrap">Loading…</div>;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        Every dropdown list the app's forms use, editable in one place. Changes apply to new entries only —
        existing tasks, invoices and documents keep the text they were saved with. Hide an option to retire it
        without deleting it; drag order with the arrows.
      </p>

      {categories.map((cat) => {
        const isOpen = open === cat.category;
        const activeCount = cat.options.filter((o) => o.active).length;
        return (
          <div key={cat.category} className="command-panel" style={{ marginBottom: 10 }}>
            <div
              className="command-panel-header"
              style={{ cursor: "pointer" }}
              onClick={() => { setOpen(isOpen ? null : cat.category); setNewValue(""); setEditing(null); }}
            >
              <div>
                <h2 className="command-panel-title" style={{ fontSize: 15 }}>{cat.label}</h2>
                <div className="command-panel-note">
                  {activeCount} option{activeCount === 1 ? "" : "s"}
                  {cat.options.length !== activeCount ? ` (+${cat.options.length - activeCount} hidden)` : ""}
                  {cat.customized ? "" : " · factory defaults"}
                </div>
              </div>
              <span className="muted">{isOpen ? "▾" : "▸"}</span>
            </div>

            {isOpen && (
              <div style={{ padding: "4px 16px 14px" }}>
                <div className="table-scroll">
                  <table>
                    <tbody>
                      {cat.options.map((opt, i) => (
                        <tr key={opt.optionId || opt.value} style={{ opacity: opt.active ? 1 : 0.45 }}>
                          <td style={{ width: "100%" }}>
                            {editing && opt.optionId === editing.optionId ? (
                              <input
                                autoFocus
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onKeyDown={(e) => { if (e.key === "Enter") handleRename(cat, opt); if (e.key === "Escape") setEditing(null); }}
                                style={{ maxWidth: 340 }}
                              />
                            ) : (
                              <>
                                {opt.value}
                                {!opt.active && <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>(hidden)</span>}
                              </>
                            )}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <button type="button" className="btn btn-sm" disabled={busy || i === 0} onClick={() => handleMove(cat, opt, "up")}>↑</button>{" "}
                            <button type="button" className="btn btn-sm" disabled={busy || i === cat.options.length - 1} onClick={() => handleMove(cat, opt, "down")}>↓</button>{" "}
                            {editing && opt.optionId === editing.optionId ? (
                              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => handleRename(cat, opt)}>Save</button>
                            ) : (
                              <button
                                type="button" className="btn btn-sm" disabled={busy}
                                onClick={async () => {
                                  // Rename needs a real row id — materialize defaults first if needed.
                                  const id = opt.optionId || await optionIdFor(cat, opt).catch(() => null);
                                  if (id) setEditing({ optionId: id, value: opt.value });
                                  if (!opt.optionId) load();
                                }}
                              >Rename</button>
                            )}{" "}
                            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => handleToggle(cat, opt)}>
                              {opt.active ? "Hide" : "Show"}
                            </button>{" "}
                            <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => handleDelete(cat, opt)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <input
                    placeholder={`Add to ${cat.label}…`}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(cat); }}
                    style={{ maxWidth: 340 }}
                  />
                  <button type="button" className="btn btn-primary" disabled={busy || !newValue.trim()} onClick={() => handleAdd(cat)}>Add</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
