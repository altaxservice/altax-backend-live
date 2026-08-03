import { useEffect, type RefObject } from "react";

/**
 * Focusable-element query used both to find an initial focus target and to
 * compute the first/last elements Tab should cycle between. Deliberately
 * excludes disabled controls and anything pulled out of tab order with a
 * negative tabindex, and includes any element that's been opted back in with
 * a non-negative tabindex (e.g. a div acting as a button).
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return candidates.filter((el) => {
    if (el.hasAttribute("disabled")) return false;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) < 0) return false;
    return true;
  });
}

/**
 * Traps keyboard focus inside a modal/dialog container while `active`.
 *
 * Without this, Tab walks straight out of an open modal into the page behind
 * it — the overlay blocks clicks but not keyboard navigation, so a keyboard
 * or screen-reader user can end up interacting with controls they can't see.
 * On activation this focuses the first focusable element inside the
 * container (or the container itself if nothing inside is focusable), then
 * cycles Tab/Shift+Tab between the first and last focusable elements for as
 * long as it stays active.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const focusable = getFocusableElements(container);
    const initial = focusable[0] ?? container;
    if (!container.hasAttribute("tabindex") && initial === container) {
      container.setAttribute("tabindex", "-1");
    }
    initial.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !container) return;
      const elements = getFocusableElements(container);
      if (elements.length === 0) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const activeElement = document.activeElement;

      if (e.shiftKey) {
        if (activeElement === first || !container.contains(activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (activeElement === last || !container.contains(activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerRef]);
}
