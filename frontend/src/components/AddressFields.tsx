import { US_STATES } from "../utils/clientOptions";

export interface AddressValue {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Street/City/(State)/ZIP inputs. Set showStateField={false} when the parent form
 * already has its own State select elsewhere (Clients/Employees both do, since state
 * also drives tax lookups) to avoid a duplicate field.
 */
export function AddressFields({
  value, onChange, showStateField = true, idPrefix = "addr",
}: {
  value: AddressValue;
  onChange: (patch: Partial<AddressValue>) => void;
  showStateField?: boolean;
  idPrefix?: string;
}) {
  return (
    <div>
      <div className="field">
        <label htmlFor={`${idPrefix}-street`}>Street Address</label>
        <input id={`${idPrefix}-street`} value={value.street} onChange={(e) => onChange({ street: e.target.value })} placeholder="123 Main St, Suite 2" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: showStateField ? "1.5fr 1fr 1fr" : "1.5fr 1fr", gap: 12, marginBottom: 10 }}>
        <div className="field">
          <label htmlFor={`${idPrefix}-city`}>City</label>
          <input id={`${idPrefix}-city`} value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
        </div>
        {showStateField && (
          <div className="field">
            <label htmlFor={`${idPrefix}-state`}>State</label>
            <select id={`${idPrefix}-state`} value={value.state} onChange={(e) => onChange({ state: e.target.value })}>
              <option value="">Select state…</option>
              {US_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${idPrefix}-zip`}>ZIP</label>
          <input id={`${idPrefix}-zip`} value={value.zip} onChange={(e) => onChange({ zip: e.target.value })} />
        </div>
      </div>
    </div>
  );
}
