import { useEffect } from "react";

/**
 * Closes a modal/panel on Escape. `active` lets a caller skip attaching the
 * listener while the modal isn't actually mounted/open, instead of every
 * call site re-deriving that same `if (!open) return` guard.
 */
export function useEscapeToClose(onClose: () => void, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}
