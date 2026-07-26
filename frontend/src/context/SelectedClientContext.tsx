import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "altax_selected_client";
const HIDDEN_KEY = "altax_client_panel_hidden";

interface SelectedClientContextValue {
  clientId: string | null;
  clientName: string | null;
  setSelectedClient: (clientId: string | null, clientName?: string | null) => void;
  /**
   * Panel visibility is tracked separately from the selected client. Closing
   * the panel used to clear the client outright, which left no way back to it —
   * now ✕ only hides the panel and the selection survives.
   */
  panelHidden: boolean;
  setPanelHidden: (hidden: boolean) => void;
}

const SelectedClientContext = createContext<SelectedClientContextValue | undefined>(undefined);

export function SelectedClientProvider({ children }: { children: ReactNode }) {
  const [clientId, setClientId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [clientName, setClientName] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY + "_name"));
  const [panelHidden, setPanelHiddenState] = useState<boolean>(() => localStorage.getItem(HIDDEN_KEY) === "1");

  useEffect(() => {
    if (panelHidden) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  }, [panelHidden]);

  useEffect(() => {
    if (clientId) localStorage.setItem(STORAGE_KEY, clientId);
    else localStorage.removeItem(STORAGE_KEY);
    if (clientName) localStorage.setItem(STORAGE_KEY + "_name", clientName);
    else localStorage.removeItem(STORAGE_KEY + "_name");
  }, [clientId, clientName]);

  function setSelectedClient(id: string | null, name?: string | null) {
    setClientId(id);
    setClientName(name ?? null);
    // Picking a client is an explicit request to see it — always un-hide.
    if (id) setPanelHiddenState(false);
  }

  return (
    <SelectedClientContext.Provider
      value={{ clientId, clientName, setSelectedClient, panelHidden, setPanelHidden: setPanelHiddenState }}
    >
      {children}
    </SelectedClientContext.Provider>
  );
}

export function useSelectedClient(): SelectedClientContextValue {
  const ctx = useContext(SelectedClientContext);
  if (!ctx) throw new Error("useSelectedClient must be used within a SelectedClientProvider");
  return ctx;
}
