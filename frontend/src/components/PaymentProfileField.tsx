import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { PaymentMethod } from "../api/types2";

export const MANUAL_PROFILE = "__manual__";

/** Shared "Payment Profile" select: fetches a client's saved payment methods and offers manual bank-field entry as a fallback, matching legacy's "Use entered bank info" option. */
function usePaymentMethods(clientId: string) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  useEffect(() => {
    if (!clientId) { setMethods([]); return; }
    api.get<{ paymentMethods: PaymentMethod[] }>(`/payment-methods/${clientId}`).then((r) => setMethods(r.paymentMethods)).catch(() => setMethods([]));
  }, [clientId]);
  return methods;
}

export function PaymentProfileField({ clientId, value, onChange }: { clientId: string; value: string; onChange: (v: string) => void }) {
  const methods = usePaymentMethods(clientId);
  return (
    <div className="field">
      <label>Payment Profile</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={MANUAL_PROFILE}>Use entered bank info</option>
        {methods.map((m) => <option key={m.payment_method_id} value={m.payment_method_id}>{m.method_name} ({m.method_type})</option>)}
      </select>
    </div>
  );
}
