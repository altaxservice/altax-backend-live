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
 * Traps keyboard focus inside a modal/dialog container while `active`, and
 * restores it to whatever triggered the modal once it closes.
 *
 * Without the trap, Tab walks straight out of an open modal into the page
 * behind it — the overlay blocks clicks but not keyboard navigation, so a
 * keyboard or screen-reader user can end up interacting with controls they
 * can't see. On activation this focuses the first focusable element inside
 * the container (or the container itself if nothing inside is focusable),
 * then cycles Tab/Shift+Tab between the first and last focusable elements
 * for as long as it stays active.
 *
 * Without the restoration, closing a modal drops keyboard focus back to
 * <body> — the user's place in the page is lost and they have to re-find it
 * by tabbing from the very top. This captures document.activeElement right
 * before moving focus into the modal, and refocuses it on deactivate/unmount
 * — but only if that element is still attached to the DOM (`.isConnected`):
 * the row/button that opened the modal can easily have been removed by a
 * list re-render while the modal was open, and focusing a detached element
 * is a silent no-op at best, so this just leaves focus wherever it lands
 * (usually <body>) in that case rather than throwing.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, active: boolean = true) {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const triggerElement = document.activeElement as HTMLElement | null;

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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      try {
        if (triggerElement && triggerElement.isConnected) {
          triggerElement.focus();
        }
      } catch {
        // Trigger element gone or unfocusable (e.g. removed from the DOM by a
        // re-render while the modal was open) — leave focus where it is
        // rather than let a restoration failure break the modal's close path.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, containerRef]);
}
