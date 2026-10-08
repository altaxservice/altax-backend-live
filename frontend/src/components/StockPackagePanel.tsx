import { useState } from "react";
import { api, ApiError, downloadFile, buildFilename } from "../api/client";
import { useNotify } from "./ConfirmProvider";
import { useToast } from "./Toast";

interface PartyLite { name: string }

export interface StockDetailsValue {
  corpKind: "Stock" | "Close";
  sdatId: string;
  sharesIssued: number;
  parValue: string;
  taxStatus: "" | "C" | "S";
  certificateNumbers: string;
  originalHolder: string;
  originalHolderTransferDate: string;
  paymentTerms: string;
  landlordConsentRequired: "" | "Yes" | "No";
  sellers: { address: string; shares: number }[];
  buyers: { shares: number }[];
  officers: { president: string; vicePresident: string; secretary: string; treasurer: string };
  directors: string[];
  residentAgent: { change: boolean; name: string; address: string };
}

export interface StockTransferLite {
  transfer_id: string;
  seller_name: string;
  buyer_name: string;
  additional_sellers: PartyLite[] | null;
  additional_buyers: PartyLite[] | null;
  include_stock_package?: boolean;
  stock_details?: Partial<StockDetailsValue> | null;
}

const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

function initial(t: StockTransferLite, sdatId: string, entityType: string | null): StockDetailsValue {
  const d = t.stock_details || {};
  const sellerCount = 1 + (t.additional_sellers || []).filter((p) => p.name).length;
  const buyerCount = 1 + (t.additional_buyers || []).filter((p) => p.name).length;
  const fit = <T,>(arr: T[] | undefined, count: number, make: () => T): T[] => Array.from({ length: count }, (_, i) => (arr && arr[i]) || make());
  return {
    corpKind: d.corpKind === "Close" ? "Close" : "Stock",
    sdatId: d.sdatId || sdatId || "",
    sharesIssued: d.sharesIssued || 0,
    parValue: d.parValue || "",
    taxStatus: d.taxStatus || (entityType === "S-Corp" ? "S" : entityType === "C-Corp" ? "C" : ""),
    certificateNumbers: d.certificateNumbers || "",
    originalHolder: d.originalHolder || "",
    originalHolderTransferDate: d.originalHolderTransferDate || "",
    paymentTerms: d.paymentTerms || "",
    landlordConsentRequired: d.landlordConsentRequired || "",
    sellers: fit(d.sellers, sellerCount, () => ({ address: "", shares: 0 })),
    buyers: fit(d.buyers, buyerCount, () => ({ shares: 0 })),
    officers: { president: "", vicePresident: "", secretary: "", treasurer: "", ...(d.officers || {}) },
    directors: d.directors || [],
    residentAgent: { change: false, name: "", address: "", ...(d.residentAgent || {}) },
  };
}

/**
 * Stock Transfer Package for the sale of a Maryland corporation's shares: the corporation facts the documents need
 * (type, SDAT ID, shares, par value, who gets how many shares, officers, resident agent), then a Word download.
 * Sellers, buyers, price and effective date come from the transfer itself.
 */
export function StockPackagePanel({ clientId, clientName, transfer, sdatId, entityType, onSaved }: {
  clientId: string; clientName: string; transfer: StockTransferLite; sdatId: string; entityType: string | null; onSaved: () => void;
}) {
  const notify = useNotify();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<StockDetailsValue>(() => initial(transfer, sdatId, entityType));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const sellerNames = [transfer.seller_name, ...(transfer.additional_sellers || []).map((p) => p.name).filter(Boolean)];
  const buyerNames = [transfer.buyer_name, ...(transfer.additional_buyers || []).map((p) => p.name).filter(Boolean)];
  const set = (patch: Partial<StockDetailsValue>) => setV((x) => ({ ...x, ...patch }));
  const sold = v.sellers.reduce((s, x) => s + x.shares, 0);
  const bought = v.buyers.reduce((s, x) => s + x.shares, 0);
  const url = `/clients/${clientId}/ownership-transfers/${transfer.transfer_id}/stock-package`;

  async function save(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await api.put<{ ok: boolean; ready: boolean; problem: string | null }>(url, { include: true, stockDetails: v });
      setProblem(res.problem);
      onSaved();
      return res.ready;
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not save the stock package details.");
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function saveAndDownload() {
    if (!(await save())) return;
    try {
      await downloadFile(`${url}.docx`, buildFilename([clientName, "Stock Transfer Package"], "docx"));
      toast("Stock Transfer Package downloaded.");
    } catch (err) {
      await notify(err instanceof ApiError ? err.message : "Could not build the package.");
    }
  }

  if (!open) {
    return (
      <button className="btn-secondary" onClick={() => setOpen(true)}>
        {transfer.include_stock_package ? "Stock Transfer Package…" : "Create Stock Transfer Package…"}
      </button>
    );
  }

  return (
    <div style={{ flexBasis: "100%", border: "1px solid var(--line, #d0d7de)", borderRadius: 8, padding: 14, marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontSize: 13.5 }}>Stock Transfer Package — sale of 100% of the shares</strong>
        <button className="btn-secondary" onClick={() => setOpen(false)}>Close</button>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
        Use this when the buyer purchases the corporation's stock (change of stockholders). It replaces the Articles of Amendment: a change of owners is made by transferring shares, and Articles of Amendment are only for changing the charter itself (name, authorized stock, purpose). Price and effective date come from this transfer.
      </p>

      <div className="form-grid-3">
        <div className="field"><label htmlFor={`sp-kind-${transfer.transfer_id}`}>Corporation type</label>
          <select id={`sp-kind-${transfer.transfer_id}`} value={v.corpKind} onChange={(e) => set({ corpKind: e.target.value === "Close" ? "Close" : "Stock" })}>
            <option value="Stock">Stock corporation (has a board of directors)</option>
            <option value="Close">Close corporation (elected no board of directors)</option>
          </select>
        </div>
        <div className="field"><label htmlFor={`sp-sdat-${transfer.transfer_id}`}>SDAT ID</label><input id={`sp-sdat-${transfer.transfer_id}`} value={v.sdatId} onChange={(e) => set({ sdatId: e.target.value })} placeholder="e.g. D21958772" /></div>
        <div className="field"><label htmlFor={`sp-tax-${transfer.transfer_id}`}>Tax status</label>
          <select id={`sp-tax-${transfer.transfer_id}`} value={v.taxStatus} onChange={(e) => set({ taxStatus: e.target.value as StockDetailsValue["taxStatus"] })}>
            <option value="">Not sure</option><option value="C">C corporation</option><option value="S">S corporation</option>
          </select>
        </div>
        <div className="field"><label htmlFor={`sp-issued-${transfer.transfer_id}`}>Total shares issued</label><input id={`sp-issued-${transfer.transfer_id}`} inputMode="numeric" value={v.sharesIssued ? String(v.sharesIssued) : ""} onChange={(e) => set({ sharesIssued: num(e.target.value) })} placeholder="e.g. 1000" /></div>
        <div className="field"><label htmlFor={`sp-par-${transfer.transfer_id}`}>Par value per share ($)</label><input id={`sp-par-${transfer.transfer_id}`} value={v.parValue} onChange={(e) => set({ parValue: e.target.value })} placeholder="e.g. 1 or 10" /></div>
        <div className="field"><label htmlFor={`sp-cert-${transfer.transfer_id}`}>Certificate no(s). being cancelled</label><input id={`sp-cert-${transfer.transfer_id}`} value={v.certificateNumbers} onChange={(e) => set({ certificateNumbers: e.target.value })} placeholder="Leave blank to fill in by hand" /></div>
      </div>

      <h4 style={{ fontSize: 12.5, margin: "10px 0 4px" }}>Sellers — shares sold</h4>
      {sellerNames.map((name, i) => (
        <div key={i} className="form-grid-3" style={{ marginBottom: 4 }}>
          <div className="field" style={{ margin: 0 }}><label>Seller {sellerNames.length > 1 ? i + 1 : ""}</label><input value={name} readOnly /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`sp-sa-${transfer.transfer_id}-${i}`}>Address</label><input id={`sp-sa-${transfer.transfer_id}-${i}`} value={v.sellers[i]?.address || ""} onChange={(e) => set({ sellers: v.sellers.map((s, j) => (j === i ? { ...s, address: e.target.value } : s)) })} placeholder="Street, city, state ZIP" /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`sp-ss-${transfer.transfer_id}-${i}`}>Shares sold</label><input id={`sp-ss-${transfer.transfer_id}-${i}`} inputMode="numeric" value={v.sellers[i]?.shares ? String(v.sellers[i].shares) : ""} onChange={(e) => set({ sellers: v.sellers.map((s, j) => (j === i ? { ...s, shares: num(e.target.value) } : s)) })} /></div>
        </div>
      ))}
      <h4 style={{ fontSize: 12.5, margin: "10px 0 4px" }}>Buyers — shares received</h4>
      {buyerNames.map((name, i) => (
        <div key={i} className="form-grid-3" style={{ marginBottom: 4 }}>
          <div className="field" style={{ margin: 0 }}><label>Buyer {buyerNames.length > 1 ? i + 1 : ""}</label><input value={name} readOnly /></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor={`sp-bs-${transfer.transfer_id}-${i}`}>Shares received</label><input id={`sp-bs-${transfer.transfer_id}-${i}`} inputMode="numeric" value={v.buyers[i]?.shares ? String(v.buyers[i].shares) : ""} onChange={(e) => set({ buyers: v.buyers.map((b, j) => (j === i ? { ...b, shares: num(e.target.value) } : b)) })} /></div>
        </div>
      ))}
      <p style={{ fontSize: 12, margin: "6px 0", color: v.sharesIssued && sold === v.sharesIssued && bought === sold ? "var(--green, #166534)" : "var(--amber, #a16207)" }}>
        Sellers: {sold.toLocaleString()} · Buyers: {bought.toLocaleString()} · Issued: {v.sharesIssued.toLocaleString()} {v.sharesIssued && sold === v.sharesIssued && bought === sold ? "— matches" : "— all three must match (100% sale)"}
      </p>

      {sellerNames.length === 1 && (
        <div className="form-grid-3">
          <div className="field"><label htmlFor={`sp-oh-${transfer.transfer_id}`}>Original holder <span className="muted">(only if the seller isn't who the stock was first issued to)</span></label><input id={`sp-oh-${transfer.transfer_id}`} value={v.originalHolder} onChange={(e) => set({ originalHolder: e.target.value })} placeholder="e.g. the first stockholder in the Articles of Incorporation" /></div>
          <div className="field"><label htmlFor={`sp-ohd-${transfer.transfer_id}`}>When they transferred to the seller</label><input id={`sp-ohd-${transfer.transfer_id}`} value={v.originalHolderTransferDate} onChange={(e) => set({ originalHolderTransferDate: e.target.value })} placeholder="e.g. January 2025" /></div>
        </div>
      )}

      <div className="field"><label htmlFor={`sp-pay-${transfer.transfer_id}`}>Payment terms</label><textarea id={`sp-pay-${transfer.transfer_id}`} rows={2} value={v.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} placeholder="e.g. $10,000 at closing and $15,000 by December 31, 2026" /></div>

      <h4 style={{ fontSize: 12.5, margin: "10px 0 4px" }}>New officers <span className="muted" style={{ fontWeight: 400 }}>(blank = first buyer)</span></h4>
      <div className="form-grid-3">
        {(["president", "vicePresident", "secretary", "treasurer"] as const).map((k) => (
          <div className="field" key={k}><label htmlFor={`sp-off-${k}-${transfer.transfer_id}`}>{k === "vicePresident" ? "Vice President (optional)" : k[0].toUpperCase() + k.slice(1)}</label>
            <input id={`sp-off-${k}-${transfer.transfer_id}`} value={v.officers[k]} onChange={(e) => set({ officers: { ...v.officers, [k]: e.target.value } })} placeholder={k === "vicePresident" ? "" : buyerNames[0]} />
          </div>
        ))}
      </div>
      {v.corpKind === "Stock" && (
        <div className="field"><label htmlFor={`sp-dir-${transfer.transfer_id}`}>Directors <span className="muted">(one per line; blank = the buyers)</span></label>
          <textarea id={`sp-dir-${transfer.transfer_id}`} rows={2} value={v.directors.join("\n")} onChange={(e) => set({ directors: e.target.value.split("\n") })} />
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, margin: "8px 0" }}>
        <input type="checkbox" checked={v.residentAgent.change} onChange={(e) => set({ residentAgent: { ...v.residentAgent, change: e.target.checked } })} />
        The resident agent is changing (adds the SDAT Resolution to Change Resident Agent)
      </label>
      {v.residentAgent.change && (
        <div className="form-grid-3">
          <div className="field"><label htmlFor={`sp-ra-n-${transfer.transfer_id}`}>New resident agent</label><input id={`sp-ra-n-${transfer.transfer_id}`} value={v.residentAgent.name} onChange={(e) => set({ residentAgent: { ...v.residentAgent, name: e.target.value } })} placeholder={buyerNames[0]} /></div>
          <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor={`sp-ra-a-${transfer.transfer_id}`}>Address in Maryland</label><input id={`sp-ra-a-${transfer.transfer_id}`} value={v.residentAgent.address} onChange={(e) => set({ residentAgent: { ...v.residentAgent, address: e.target.value } })} placeholder="Street, city, MD ZIP" /></div>
        </div>
      )}
      <div className="field" style={{ maxWidth: 260 }}><label htmlFor={`sp-ll-${transfer.transfer_id}`}>Landlord consent required?</label>
        <select id={`sp-ll-${transfer.transfer_id}`} value={v.landlordConsentRequired} onChange={(e) => set({ landlordConsentRequired: e.target.value as StockDetailsValue["landlordConsentRequired"] })}>
          <option value="">Not sure</option><option value="Yes">Yes</option><option value="No">No</option>
        </select>
      </div>

      {problem && <p style={{ color: "var(--red, #b42318)", fontSize: 12.5 }}>{problem}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn-secondary" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</button>
        <button className="btn-primary" disabled={saving} onClick={() => void saveAndDownload()}>Save &amp; Download Word package</button>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
        The signed pages carry no firm branding. The cover says the package was prepared from information the parties supplied and is not legal advice. Have an attorney review before signing.
      </p>
    </div>
  );
}
