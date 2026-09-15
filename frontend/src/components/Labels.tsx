import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

/**
 * assignedBy/assignedAt: who put this label on the record and when — always
 * present from the API now (see labels.routes.ts), surfaced here mainly for
 * admin, who (real owner request, 2026-09-14) can see every staff member's
 * label assignments at once, including more than one person independently
 * tagging the same record with the same label (the underlying primary key
 * now allows that — sql/155). A staff member's own list never has more than
 * one row per label per record, so assignedBy there is just their own name.
 */
export interface LabelInfo { label_id: string; name: string; color: string; assignedBy?: string | null; assignedAt?: string | null; created_by?: string | null }

/** Simple relative-luminance check so chip text stays readable against any admin-picked color. */
function pickTextColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

/**
 * Colored pill chips for whatever labels are on a record. onRemove, if
 * given, adds an "x" to each chip and is called with that chip's own
 * assignedBy — necessary now that the same label can appear more than once
 * (one row per person who assigned it), so removing one chip never deletes
 * someone else's identical-looking tag. Each chip's title shows who added
 * it and when, mainly useful for admin looking at everyone's tags at once.
 */
export function LabelChips({ labels, onRemove }: { labels: LabelInfo[]; onRemove?: (labelId: string, assignedBy?: string | null) => void }) {
  if (labels.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
      {labels.map((l) => (
        <span
          key={`${l.label_id}-${l.assignedBy || ""}`}
          title={l.assignedBy ? `Added by ${l.assignedBy}${l.assignedAt ? ` on ${new Date(l.assignedAt).toLocaleDateString()}` : ""}` : undefined}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, background: l.color, color: pickTextColor(l.color),
            fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, lineHeight: 1.5,
          }}
        >
          {l.name}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(l.label_id, l.assignedBy)}
              aria-label={`Remove ${l.name} label`}
              style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, fontSize: 12, lineHeight: 1 }}
            >
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** A tiny "+ Add label" select — only lists labels not already on the record. */
export function LabelPicker({ allLabels, assignedIds, onAdd }: { allLabels: LabelInfo[]; assignedIds: Set<string>; onAdd: (labelId: string) => void }) {
  const available = allLabels.filter((l) => !assignedIds.has(l.label_id));
  if (available.length === 0) return null;
  return (
    <select
      value=""
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}
      style={{ fontSize: 11, padding: "2px 4px", marginTop: 4 }}
      aria-label="Add a label"
    >
      <option value="">+ Add label…</option>
      {available.map((l) => <option key={l.label_id} value={l.label_id}>{l.name}</option>)}
    </select>
  );
}

/**
 * Bulk hook for list pages — one GET for the firm's whole label palette and one
 * GET for every assignment of this entity type, so a table of N rows costs 2
 * requests total rather than N. assign/unassign optimistically re-fetch the
 * assignment map (small enough per firm that a full re-fetch is simpler and
 * safer than hand-patching local state).
 */
export function useEntityLabels(entityType: string) {
  const [allLabels, setAllLabels] = useState<LabelInfo[]>([]);
  const [byEntity, setByEntity] = useState<Record<string, LabelInfo[]>>({});

  const load = useCallback(() => {
    Promise.all([
      api.get<{ labels: LabelInfo[] }>("/labels"),
      api.get<{ assignments: { entity_id: string; label_id: string; name: string; color: string; assigned_by?: string | null; assigned_at?: string | null }[] }>(`/labels/for/${entityType}`),
    ]).then(([labelsRes, assignRes]) => {
      setAllLabels(labelsRes.labels);
      const map: Record<string, LabelInfo[]> = {};
      for (const a of assignRes.assignments) {
        (map[a.entity_id] ||= []).push({ label_id: a.label_id, name: a.name, color: a.color, assignedBy: a.assigned_by, assignedAt: a.assigned_at });
      }
      setByEntity(map);
    }).catch(() => {});
  }, [entityType]);

  useEffect(load, [load]);

  const assign = useCallback(async (entityId: string, labelId: string) => {
    await api.post(`/labels/for/${entityType}/${entityId}`, { labelId });
    load();
  }, [entityType, load]);

  // assignedBy targets exactly which assignment to remove — necessary since
  // more than one person can now independently tag the same entity with the
  // same label (see LabelChips' doc comment); admin passes the chip's own
  // assignedBy so removing one person's tag never touches another's.
  const unassign = useCallback(async (entityId: string, labelId: string, assignedBy?: string | null) => {
    await api.post(`/labels/for/${entityType}/${entityId}/${labelId}/remove`, assignedBy ? { assignedBy } : {});
    load();
  }, [entityType, load]);

  return { allLabels, byEntity, assign, unassign };
}

/** Single-entity variant for detail pages — same idea, scoped to one record. */
export function useEntityLabel(entityType: string, entityId: string | undefined) {
  const [allLabels, setAllLabels] = useState<LabelInfo[]>([]);
  const [labels, setLabels] = useState<LabelInfo[]>([]);

  const load = useCallback(() => {
    if (!entityId) return;
    Promise.all([
      api.get<{ labels: LabelInfo[] }>("/labels"),
      api.get<{ labels: { label_id: string; name: string; color: string; assigned_by?: string | null; assigned_at?: string | null }[] }>(`/labels/for/${entityType}/${entityId}`),
    ]).then(([paletteRes, assignedRes]) => {
      setAllLabels(paletteRes.labels);
      setLabels(assignedRes.labels.map((l) => ({ label_id: l.label_id, name: l.name, color: l.color, assignedBy: l.assigned_by, assignedAt: l.assigned_at })));
    }).catch(() => {});
  }, [entityType, entityId]);

  useEffect(load, [load]);

  const assign = useCallback(async (labelId: string) => {
    if (!entityId) return;
    await api.post(`/labels/for/${entityType}/${entityId}`, { labelId });
    load();
  }, [entityType, entityId, load]);

  // assignedBy targets exactly which assignment to remove — see the bulk
  // hook's identical comment above.
  const unassign = useCallback(async (labelId: string, assignedBy?: string | null) => {
    if (!entityId) return;
    await api.post(`/labels/for/${entityType}/${entityId}/${labelId}/remove`, assignedBy ? { assignedBy } : {});
    load();
  }, [entityType, entityId, load]);

  return { allLabels, labels, assign, unassign };
}
