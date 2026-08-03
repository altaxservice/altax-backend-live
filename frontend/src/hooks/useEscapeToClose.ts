import { useEffect } from "react";

/**
 * Shared across every useEscapeToClose instance in the app. Without this, a
 * confirm()/notify() dialog opened on top of another modal (e.g. an error
 * notice inside InvoiceEditorModal) had its own independent Escape listener,
 * and so did the modal underneath it — one Escape press fired both, closing
 * the notice AND silently discarding whatever the user was editing in the
 * modal behind it. Only the most-recently-opened (topmost) entry responds.
 */
const activeStack: (() => void)[] = [];

/**
 * Closes a modal/panel on Escape. `active` lets a caller skip attaching the
 * listener while the modal isn't actually mounted/open, instead of every
 * call site re-deriving that same `if (!open) return` guard.
 */
export function useEscapeToClose(onClose: () => void, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    activeStack.push(onClose);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeStack[activeStack.length - 1] !== onClose) return;
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const idx = activeStack.lastIndexOf(onClose);
      if (idx !== -1) activeStack.splice(idx, 1);
    };
  }, [active, onClose]);
}
