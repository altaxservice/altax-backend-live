import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";

const STORAGE_KEY = "altax_selected_business";

interface SelectedBusinessContextValue {
  /** The client-portal business currently in view. Defaults to the login's
   *  default business (user.clientId) and never baked into the JWT — every
   *  API call sends it explicitly, re-validated server-side per request
   *  (mirrors staff's SelectedClientContext). */
  clientId: string | null;
  clientName: string | null;
  /** Every business this login can access; length <= 1 for a single-business login. */
  linkedClients: { clientId: string; clientName: string }[];
  setSelectedBusiness: (clientId: string, clientName?: string | null) => void;
}

const SelectedBusinessContext = createContext<SelectedBusinessContextValue | undefined>(undefined);

export function SelectedBusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const linkedClients = user?.linkedClients || [];
  const [clientId, setClientId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [clientName, setClientName] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY + "_name"));

  // Re-anchor whenever the logged-in user changes (login, logout, switching
  // portals in another tab) — a stored selection from a previous login must
  // never leak into a new one, and a login with no saved selection yet (or
  // one whose saved business is no longer linked) falls back to the login's
  // default business.
  useEffect(() => {
    if (!user || user.role !== "client") {
      setClientId(null);
      setClientName(null);
      return;
    }
    const stillLinked = clientId && linkedClients.some((l) => l.clientId === clientId);
    if (!stillLinked) {
      setClientId(user.clientId || null);
      setClientName(user.clientName || null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.userId]);

  useEffect(() => {
    if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
    else localStorage.removeItem(STORAGE_KEY);
    if (clientName) localStorage.setItem(STORAGE_KEY + "_name", clientName);
    else localStorage.removeItem(STORAGE_KEY + "_name");
  }, [clientId, clientName]);

  function setSelectedBusiness(id: string, name?: string | null) {
    setClientId(id);
    setClientName(name ?? null);
  }

  return (
    <SelectedBusinessContext.Provider value={{ clientId, clientName, linkedClients, setSelectedBusiness }}>
      {children}
    </SelectedBusinessContext.Provider>
  );
}

export function useSelectedBusiness(): SelectedBusinessContextValue {
  const ctx = useContext(SelectedBusinessContext);
  if (!ctx) throw new Error("useSelectedBusiness must be used within a SelectedBusinessProvider");
  return ctx;
}
