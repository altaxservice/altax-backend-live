import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

export interface LabelInfo { label_id: string; name: string; color: string }

/** Simple relative-luminance check so chip text stays readable against any admin-picked color. */
function pickTextColor(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}

/** Colored pill chips for whatever labels are on a record. onRemove, if given, adds an "x" to each chip. */
export function LabelChips({ labels, onRemove }: { labels: LabelInfo[]; onRemove?: (labelId: string) => void }) {
  if (labels.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }} onClick={(e) => e.stopPropagation()}>
      {labels.map((l) => (
        <span
          key={l.label_id}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4, background: l.color, color: pickTextColor(l.color),
            fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999, lineHeight: 1.5,
          }}
        >
          {l.name}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(l.label_id)}
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
      api.get<{ assignments: { entity_id: string; label_id: string; name: string; color: string }[] }>(`/labels/for/${entityType}`),
    ]).then(([labelsRes, assignRes]) => {
      setAllLabels(labelsRes.labels);
      const map: Record<string, LabelInfo[]> = {};
      for (const a of assignRes.assignments) {
        (map[a.entity_id] ||= []).push({ label_id: a.label_id, name: a.name, color: a.color });
      }
      setByEntity(map);
    }).catch(() => {});
  }, [entityType]);

  useEffect(load, [load]);

  const assign = useCallback(async (entityId: string, labelId: string) => {
    await api.post(`/labels/for/${entityType}/${entityId}`, { labelId });
    load();
  }, [entityType, load]);

  const unassign = useCallback(async (entityId: string, labelId: string) => {
    await api.post(`/labels/for/${entityType}/${entityId}/${labelId}/remove`, {});
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
      api.get<{ labels: LabelInfo[] }>(`/labels/for/${entityType}/${entityId}`),
    ]).then(([paletteRes, assignedRes]) => {
      setAllLabels(paletteRes.labels);
      setLabels(assignedRes.labels);
    }).catch(() => {});
  }, [entityType, entityId]);

  useEffect(load, [load]);

  const assign = useCallback(async (labelId: string) => {
    if (!entityId) return;
    await api.post(`/labels/for/${entityType}/${entityId}`, { labelId });
    load();
  }, [entityType, entityId, load]);

  const unassign = useCallback(async (labelId: string) => {
    if (!entityId) return;
    await api.post(`/labels/for/${entityType}/${entityId}/${labelId}/remove`, {});
    load();
  }, [entityType, entityId, load]);

  return { allLabels, labels, assign, unassign };
}
