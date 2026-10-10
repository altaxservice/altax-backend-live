import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, Layers, type LucideIcon } from "lucide-react";

/**
 * Splits a long flat list into collapsible groups with filter chips and per-group counts — the same look as the
 * Message Templates page. The caller supplies how to group and how to draw one group's rows (usually the page's
 * existing table), so nothing about the rows themselves changes.
 */
export function GroupedSections<T>({ items, groupOf, order = [], icons = {}, badgeOf, render, emptyText = "Nothing matches." }: {
  items: T[];
  groupOf: (item: T) => string;
  /** Preferred order of group names; anything not listed follows alphabetically. */
  order?: string[];
  icons?: Record<string, LucideIcon>;
  /** Optional small amber badge per group, e.g. "2 inactive". Return null for none. */
  badgeOf?: (items: T[], group: string) => ReactNode;
  render: (items: T[], group: string) => ReactNode;
  emptyText?: string;
}) {
  const [active, setActive] = useState("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const by = new Map<string, T[]>();
    for (const it of items) { const g = groupOf(it) || "Other"; if (!by.has(g)) by.set(g, []); by.get(g)!.push(it); }
    const rank = (g: string) => { const i = order.indexOf(g); return i === -1 ? 999 : i; };
    return Array.from(by, ([group, list]) => ({ group, list })).sort((a, b) => rank(a.group) - rank(b.group) || a.group.localeCompare(b.group));
  }, [items, groupOf, order]);
  const shown = active === "all" || !groups.some((g) => g.group === active) ? groups : groups.filter((g) => g.group === active);
  const toggle = (g: string) => setCollapsed((prev) => { const n = new Set(prev); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  return (
    <div style={{ padding: "12px 16px 16px" }}>
      <div className="tpl-chips" role="tablist" aria-label="Filter by group">
        <button type="button" className={`tpl-chip${active === "all" ? " on" : ""}`} onClick={() => setActive("all")}>All <span>{items.length}</span></button>
        {groups.map((g) => (
          <button type="button" key={g.group} className={`tpl-chip${active === g.group ? " on" : ""}`} onClick={() => setActive(g.group)}>{g.group} <span>{g.list.length}</span></button>
        ))}
        {groups.length > 1 && (
          <button type="button" className="link-button" style={{ marginLeft: "auto", fontSize: 12.5 }} onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((g) => g.group)))}>{collapsed.size ? "Expand all" : "Collapse all"}</button>
        )}
      </div>
      {shown.length === 0 && <p className="muted" style={{ textAlign: "center", padding: 24 }}>{emptyText}</p>}
      {shown.map((g) => {
        const Icon = icons[g.group] || Layers;
        const open = !collapsed.has(g.group);
        const badge = badgeOf ? badgeOf(g.list, g.group) : null;
        return (
          <section className="tpl-group" key={g.group}>
            <button type="button" className="tpl-group-head" aria-expanded={open} onClick={() => toggle(g.group)}>
              <span className="tpl-group-icon"><Icon size={17} aria-hidden="true" /></span>
              <span className="tpl-group-title">{g.group}</span>
              <span className="tpl-count">{g.list.length}</span>
              {badge}
              <ChevronDown size={16} aria-hidden="true" className="tpl-chev" />
            </button>
            {open && <div style={{ borderTop: "1px solid var(--line)" }}>{render(g.list, g.group)}</div>}
          </section>
        );
      })}
    </div>
  );
}
