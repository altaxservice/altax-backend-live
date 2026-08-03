import { createContext, useCallback, useContext, useState, type FormEvent, type ReactNode } from "react";
import { useEscapeToClose } from "../hooks/useEscapeToClose";

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) — for deletes, voids, and other irreversible actions. */
  danger?: boolean;
}

interface PromptOptions {
  title?: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  /** True by default — mirrors window.prompt()'s own callers, which all treated an empty answer as invalid. */
  required?: boolean;
  multiline?: boolean;
}

interface NotifyOptions {
  title?: string;
}

type PendingRequest =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void }
  | { kind: "notify"; message: string; options: NotifyOptions; resolve: () => void };

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  promptFor: (options: PromptOptions) => Promise<string | null>;
  notify: (message: string, options?: NotifyOptions) => Promise<void>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * In-app replacement for window.confirm()/window.prompt() — those are unstyled OS
 * dialogs sitting inside an otherwise fully custom UI (the design audit's single
 * most-cited "this looks unfinished" tell), and on top of that aren't keyboard/
 * screen-reader friendly in any way this app controls. Reuses the existing
 * .modal-overlay/.modal-panel look so a confirmation reads as part of the product,
 * not a browser interruption. Call sites keep the exact same async/await shape they
 * already had with window.confirm()/window.prompt() — only the import changes.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [value, setValue] = useState("");
  const [touched, setTouched] = useState(false);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", options, resolve });
    });
  }, []);

  const promptFor = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setValue(options.defaultValue || "");
      setTouched(false);
      setPending({ kind: "prompt", options, resolve });
    });
  }, []);

  const notify = useCallback((message: string, options: NotifyOptions = {}) => {
    return new Promise<void>((resolve) => {
      setPending({ kind: "notify", message, options, resolve });
    });
  }, []);

  function close() {
    setPending(null);
    setValue("");
    setTouched(false);
  }

  function handleCancel() {
    if (pending?.kind === "confirm") pending.resolve(false);
    if (pending?.kind === "prompt") pending.resolve(null);
    if (pending?.kind === "notify") pending.resolve();
    close();
  }

  function handleConfirmYes() {
    if (pending?.kind === "confirm") pending.resolve(true);
    close();
  }

  function handlePromptSubmit(e: FormEvent) {
    e.preventDefault();
    if (pending?.kind !== "prompt") return;
    const required = pending.options.required !== false;
    if (required && !value.trim()) {
      setTouched(true);
      return;
    }
    pending.resolve(value.trim());
    close();
  }

  const promptInvalid = pending?.kind === "prompt" && touched && pending.options.required !== false && !value.trim();

  useEscapeToClose(handleCancel, Boolean(pending));

  return (
    <ConfirmContext.Provider value={{ confirm, promptFor, notify }}>
      {children}
      {pending && (
        <div className="modal-overlay" onClick={handleCancel}>
          <div className="modal-panel" role="dialog" aria-modal="true" style={{ width: "min(440px, 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{pending.kind === "notify" ? (pending.options.title || "Notice") : (pending.options.title || (pending.kind === "confirm" ? "Please confirm" : "One more thing"))}</h2>
            </div>
            {pending.kind === "notify" ? (
              <>
                <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "10px 0 20px", whiteSpace: "pre-wrap" }}>{pending.message}</p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button type="button" className="btn btn-primary" onClick={handleCancel} autoFocus>OK</button>
                </div>
              </>
            ) : pending.kind === "confirm" ? (
              <>
                <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "10px 0 20px" }}>{pending.options.message}</p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn" onClick={handleCancel}>{pending.options.cancelLabel || "Cancel"}</button>
                  <button type="button" className={pending.options.danger ? "btn btn-danger" : "btn btn-primary"} onClick={handleConfirmYes} autoFocus>
                    {pending.options.confirmLabel || "Confirm"}
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handlePromptSubmit}>
                <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "10px 0 14px" }}>{pending.options.message}</p>
                <div className="field" style={{ marginBottom: promptInvalid ? 4 : 20 }}>
                  {pending.options.multiline ? (
                    <textarea
                      autoFocus
                      rows={3}
                      value={value}
                      placeholder={pending.options.placeholder}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  ) : (
                    <input
                      autoFocus
                      type="text"
                      value={value}
                      placeholder={pending.options.placeholder}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  )}
                </div>
                {promptInvalid && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 16px" }}>This is required.</p>}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn" onClick={handleCancel}>Cancel</button>
                  <button type="submit" className="btn btn-primary">{pending.options.confirmLabel || "Continue"}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Drop-in async replacement for window.confirm(message) — call as `await confirm({ message })`. */
export function useConfirm(): (options: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}

/** Drop-in async replacement for window.prompt(message) — call as `await promptFor({ message })`; returns null on cancel, matching window.prompt(). */
export function usePrompt(): (options: PromptOptions) => Promise<string | null> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("usePrompt must be used within ConfirmProvider");
  return ctx.promptFor;
}

/** Drop-in async replacement for window.alert(message) — call as `await notify(message)`. Same single-string call shape as window.alert, so every existing call site converts with a find-and-replace, not a rewrite. */
export function useNotify(): (message: string, options?: NotifyOptions) => Promise<void> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useNotify must be used within ConfirmProvider");
  return ctx.notify;
}
