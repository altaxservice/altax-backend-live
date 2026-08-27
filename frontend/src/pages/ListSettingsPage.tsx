import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useToast } from "../components/Toast";
import { ErrorBanner } from "../components/ErrorBanner";
import { useConfirm, useNotify } from "../components/ConfirmProvider";

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
  /** Only meaningful for category "taskStatuses" — null = General (applies to every task type), otherwise scoped to exactly one Task Type value. Added 2026-08-27. */
  taskType: string | null;
}

interface DropdownCategory {
  category: string;
  label: string;
  customized: boolean;
  options: DropdownOption[];
}

/** General first (applies to every task type), then one group per Task Type present among the given options, alphabetically. */
function groupTaskStatuses(options: DropdownOption[]): [string, DropdownOption[]][] {
  const general = options.filter((o) => !o.taskType);
  const byType = new Map<string, DropdownOption[]>();
  for (const o of options) {
    if (!o.taskType) continue;
    if (!byType.has(o.taskType)) byType.set(o.taskType, []);
    byType.get(o.taskType)!.push(o);
  }
  const groups: [string, DropdownOption[]][] = [["General (All Task Types)", general]];
  for (const type of Array.from(byType.keys()).sort()) groups.push([type, byType.get(type)!]);
  return groups;
}

/** The Rename/Hide/Delete row table — extracted so it can render once per Task Type group (taskStatuses) or once flat (every other category), same markup either way. Up/down reordering is scoped to whatever `options` it's given, so within a group the arrows only move an item relative to its own group. */
function OptionTable({ cat, options, busy, editing, setEditing, onMove, onRename, onToggle, onDelete, startRename }: {
  cat: DropdownCategory;
  options: DropdownOption[];
  busy: boolean;
  editing: { optionId: string; value: string } | null;
  setEditing: (v: { optionId: string; value: string } | null) => void;
  onMove: (cat: DropdownCategory, opt: DropdownOption, direction: "up" | "down") => void;
  onRename: (cat: DropdownCategory, opt: DropdownOption) => void;
  onToggle: (cat: DropdownCategory, opt: DropdownOption) => void;
  onDelete: (cat: DropdownCategory, opt: DropdownOption) => void;
  startRename: (cat: DropdownCategory, opt: DropdownOption) => void;
}) {
  if (!options.length) return <p className="muted" style={{ fontSize: 13, padding: "4px 0" }}>No statuses in this group yet.</p>;
  return (
    <div className="table-scroll">
      <table>
        <tbody>
          {options.map((opt, i) => (
            <tr key={opt.optionId || opt.value} style={{ opacity: opt.active ? 1 : 0.45 }}>
              <td style={{ width: "100%" }}>
                {editing && opt.optionId === editing.optionId ? (
                  <input
                    autoFocus
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") onRename(cat, opt); if (e.key === "Escape") setEditing(null); }}
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
                <button type="button" className="btn btn-sm" disabled={busy || i === 0} onClick={() => onMove(cat, opt, "up")}>↑</button>{" "}
                <button type="button" className="btn btn-sm" disabled={busy || i === options.length - 1} onClick={() => onMove(cat, opt, "down")}>↓</button>{" "}
                {editing && opt.optionId === editing.optionId ? (
                  <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => onRename(cat, opt)}>Save</button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={busy} onClick={() => startRename(cat, opt)}>Rename</button>
                )}{" "}
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => onToggle(cat, opt)}>
                  {opt.active ? "Hide" : "Show"}
                </button>{" "}
                <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => onDelete(cat, opt)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ListSettingsPage() {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const notify = useNotify();
  const [categories, setCategories] = useState<DropdownCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newValue, setNewValue] = useState("");
  // Which Task Type a new Task Status applies to — "" means General (every
  // task type). Only rendered/used for the taskStatuses category.
  const [newTaskType, setNewTaskType] = useState("");
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
      await notify(err instanceof ApiError ? err.message : "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(category: DropdownCategory) {
    const value = newValue.trim();
    if (!value) return;
    await withReload(async () => {
      const taskType = category.category === "taskStatuses" ? (newTaskType || undefined) : undefined;
      await api.post(`/system/dropdowns/${category.category}`, { value, taskType });
      toast(taskType ? `Added "${value}" (${taskType}).` : `Added "${value}".`);
      setNewValue("");
      setNewTaskType("");
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

  // Rename needs a real row id — materialize defaults first if needed.
  async function startRename(category: DropdownCategory, opt: DropdownOption) {
    const id = opt.optionId || await optionIdFor(category, opt).catch(() => null);
    if (id) setEditing({ optionId: id, value: opt.value });
    if (!opt.optionId) load();
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

  if (error) return <ErrorBanner error={error} onRetry={load} />;
  if (!categories) return <div className="spinner-wrap">Loading…</div>;

  const taskTypeValues = categories.find((c) => c.category === "taskTypes")?.options.filter((o) => o.active).map((o) => o.value) || [];

  const q = search.trim().toLowerCase();
  const visibleCategories = categories
    .map((cat) => {
      if (!q) return cat;
      const labelMatch = cat.label.toLowerCase().includes(q);
      return { ...cat, options: labelMatch ? cat.options : cat.options.filter((o) => o.value.toLowerCase().includes(q)) };
    })
    .filter((cat) => !q || cat.label.toLowerCase().includes(q) || cat.options.length > 0);

  return (
    <div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 720 }}>
        Every dropdown list the app's forms use, editable in one place. Changes apply to new entries only —
        existing tasks, invoices and documents keep the text they were saved with. Hide an option to retire it
        without deleting it; drag order with the arrows.
      </p>

      <div style={{ marginBottom: 16 }}>
        <input placeholder="Search list values…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--paper)", color: "var(--ink)", width: 220 }} />
      </div>

      {q && visibleCategories.length === 0 && <p className="muted" style={{ padding: 16, textAlign: "center" }}>No list values match.</p>}

      {visibleCategories.map((cat) => {
        const isOpen = q ? true : open === cat.category;
        const activeCount = cat.options.filter((o) => o.active).length;
        return (
          <div key={cat.category} className="command-panel" style={{ marginBottom: 10 }}>
            <div
              className="command-panel-header"
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => { setOpen(isOpen ? null : cat.category); setNewValue(""); setEditing(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(isOpen ? null : cat.category); setNewValue(""); setEditing(null);
                }
              }}
            >
              <div>
                <h2 className="command-panel-title" style={{ fontSize: 15 }}>{cat.label}</h2>
                <div className="command-panel-note">
                  {activeCount} option{activeCount === 1 ? "" : "s"}
                  {cat.options.length !== activeCount ? ` (+${cat.options.length - activeCount} hidden)` : ""}
                  {cat.customized ? "" : " · factory defaults"}
                </div>
              </div>
              <span className="muted" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
            </div>

            {isOpen && (
              <div style={{ padding: "4px 16px 14px" }}>
                {cat.category === "taskStatuses" ? (
                  // Grouped by Task Type — General first (applies to every task,
                  // matches the un-grouped behavior every other list still has),
                  // then one mini-table per Task Type that has at least one
                  // status scoped to it. Direct owner request, 2026-08-27.
                  groupTaskStatuses(cat.options).map(([groupLabel, groupOptions]) => (
                    <div key={groupLabel} style={{ marginBottom: 14 }}>
                      <div className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", margin: "10px 0 4px" }}>
                        {groupLabel}
                      </div>
                      <OptionTable
                        cat={cat} options={groupOptions} busy={busy} editing={editing} setEditing={setEditing}
                        onMove={handleMove} onRename={handleRename} onToggle={handleToggle} onDelete={handleDelete} startRename={startRename}
                      />
                    </div>
                  ))
                ) : (
                  <OptionTable
                    cat={cat} options={cat.options} busy={busy} editing={editing} setEditing={setEditing}
                    onMove={handleMove} onRename={handleRename} onToggle={handleToggle} onDelete={handleDelete} startRename={startRename}
                  />
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <input
                    placeholder={`Add to ${cat.label}…`}
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(cat); }}
                    style={{ maxWidth: 340 }}
                  />
                  {cat.category === "taskStatuses" && (
                    <select
                      value={newTaskType}
                      onChange={(e) => setNewTaskType(e.target.value)}
                      style={{ maxWidth: 220 }}
                      aria-label="Which task type this status applies to"
                    >
                      <option value="">General (All Task Types)</option>
                      {taskTypeValues.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
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
