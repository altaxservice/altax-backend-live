export interface ActionMenuOption {
  value: string;
  label: string;
}

/** Mirrors legacy's actionMenu(): a plain <select> with "Actions" as the placeholder, one option per action. */
export function ActionMenu({ options, onSelect, disabled }: { options: ActionMenuOption[]; onSelect: (value: string) => void; disabled?: boolean }) {
  return (
    <select
      className="inline-select action-menu"
      value=""
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const value = e.target.value;
        e.target.value = "";
        if (value) onSelect(value);
      }}
    >
      <option value="">Actions</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
