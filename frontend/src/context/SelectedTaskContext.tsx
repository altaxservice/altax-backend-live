import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "altax_selected_task";
const HIDDEN_KEY = "altax_task_panel_hidden";

interface SelectedTaskContextValue {
  taskId: string | null;
  taskName: string | null;
  setSelectedTask: (taskId: string | null, taskName?: string | null) => void;
  /** Same "hide, don't clear" behavior as SelectedClientContext — closing the panel shouldn't lose the selection. */
  panelHidden: boolean;
  setPanelHidden: (hidden: boolean) => void;
}

const SelectedTaskContext = createContext<SelectedTaskContextValue | undefined>(undefined);

export function SelectedTaskProvider({ children }: { children: ReactNode }) {
  const [taskId, setTaskId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));
  const [taskName, setTaskName] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY + "_name"));
  const [panelHidden, setPanelHiddenState] = useState<boolean>(() => localStorage.getItem(HIDDEN_KEY) === "1");

  useEffect(() => {
    if (panelHidden) localStorage.setItem(HIDDEN_KEY, "1");
    else localStorage.removeItem(HIDDEN_KEY);
  }, [panelHidden]);

  useEffect(() => {
    if (taskId) localStorage.setItem(STORAGE_KEY, taskId);
    else localStorage.removeItem(STORAGE_KEY);
    if (taskName) localStorage.setItem(STORAGE_KEY + "_name", taskName);
    else localStorage.removeItem(STORAGE_KEY + "_name");
  }, [taskId, taskName]);

  function setSelectedTask(id: string | null, name?: string | null) {
    setTaskId(id);
    setTaskName(name ?? null);
    if (id) setPanelHiddenState(false);
  }

  return (
    <SelectedTaskContext.Provider
      value={{ taskId, taskName, setSelectedTask, panelHidden, setPanelHidden: setPanelHiddenState }}
    >
      {children}
    </SelectedTaskContext.Provider>
  );
}

export function useSelectedTask(): SelectedTaskContextValue {
  const ctx = useContext(SelectedTaskContext);
  if (!ctx) throw new Error("useSelectedTask must be used within a SelectedTaskProvider");
  return ctx;
}
