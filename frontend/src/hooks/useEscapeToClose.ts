import { useEffect, useRef } from "react";

/**
 * Shared across every useEscapeToClose instance in the app. Without this, a
 * confirm()/notify() dialog opened on top of another modal (e.g. an error
 * notice inside InvoiceEditorModal) had its own independent Escape listener,
 * and so did the modal underneath it — one Escape press fired both, closing
 * the notice AND silently discarding whatever the user was editing in the
 * modal behind it. Only the most-recently-opened (topmost) entry responds.
 *
 * Stack position is tracked by a stable per-instance `entry` object, not by
 * `onClose` identity — most call sites pass an inline arrow function as the
 * `onClose` prop, which is a new reference on every render. Re-running the
 * push/pop effect on every one of those renders (e.g. triggered by an
 * unrelated context value changing while a stacked dialog is open) would
 * pop this instance off the stack and re-push it at the top, silently
 * promoting it above a dialog that's genuinely on top of it — reintroducing
 * the exact bug this stack exists to prevent, just through re-renders
 * instead of independent listeners.
 */
let nextStackId = 0;
const activeStack: { id: number; onClose: () => void }[] = [];

/**
 * Closes a modal/panel on Escape. `active` lets a caller skip attaching the
 * listener while the modal isn't actually mounted/open, instead of every
 * call site re-deriving that same `if (!open) return` guard.
 */
export function useEscapeToClose(onClose: () => void, active: boolean = true) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const entry = { id: nextStackId++, onClose: () => onCloseRef.current() };
    activeStack.push(entry);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (activeStack[activeStack.length - 1] !== entry) return;
      entry.onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const idx = activeStack.indexOf(entry);
      if (idx !== -1) activeStack.splice(idx, 1);
    };
    // Deliberately NOT depending on `onClose` — see the module-level comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
