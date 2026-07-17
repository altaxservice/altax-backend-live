import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "altax_selected_client";

interface SelectedClientContextValue {
  clientId: string | null;
  clientName: string | null;
  setSelectedClient: (clientId: string | null, clientName?: string | null) => void;
}

const SelectedClientContext = createContext<SelectedClientContextValue | undefined>(undefined);

export function SelectedClientProvider({ children }: { children: ReactNode }) {
  const [clientId, setClientId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [clientName, setClientName] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY + "_name"));

  useEffect(() => {
    if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
    else localStorage.removeItem(STORAGE_KEY);
    if (clientName) localStorage.setItem(STORAGE_KEY + "_name", clientName);
    else localStorage.removeItem(STORAGE_KEY + "_name");
  }, [clientId, clientName]);

  function setSelectedClient(id: string | null, name?: string | null) {
    setClientId(id);
    setClientName(name ?? null);
  }

  return (
    <SelectedClientContext.Provider value={{ clientId, clientName, setSelectedClient }}>
      {children}
    </SelectedClientContext.Provider>
  );
}

export function useSelectedClient(): SelectedClientContextValue {
  const ctx = useContext(SelectedClientContext);
  if (!ctx) throw new Error("useSelectedClient must be used within a SelectedClientProvider");
  return ctx;
}
