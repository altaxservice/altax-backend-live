import { useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Remembers the window scroll position per history entry and restores it when the
 * user comes BACK to that entry (BackLink's navigate(-1) or the browser button).
 * Without this, returning to a long list technically landed on the right page but at
 * the very top — "it takes us back to the whole list" — losing the row the user had
 * drilled in from. Forward navigations still start at the top like normal pages.
 *
 * Two timing traps this is built around:
 * - Persisting happens in the layout-effect CLEANUP, reading a variable updated by
 *   scroll events — not window.scrollY at cleanup time. When the route swaps to a
 *   shorter page the browser clamps the scroll and fires a bogus scroll event, but
 *   that event dispatches in a later task; the cleanup runs synchronously first and
 *   captures the last position the user actually had.
 * - Restoring retries briefly because list pages render empty and then fill from the
 *   API — scrolling before the rows exist would clamp to a short page.
 */
export function ScrollMemory() {
  const location = useLocation();
  const navType = useNavigationType();

  useLayoutEffect(() => {
    // Take over from the browser's own (window-level, SPA-oblivious) restoration.
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

    const key = `altax_scroll:${location.key}`;
    let cancelled = false;

    if (navType === "POP") {
      const saved = Number(sessionStorage.getItem(key) || 0);
      if (saved > 0) {
        let attempts = 0;
        const tryRestore = () => {
          if (cancelled) return;
          window.scrollTo(0, saved);
          if (Math.abs(window.scrollY - saved) > 4 && attempts++ < 25) setTimeout(tryRestore, 80);
        };
        tryRestore();
      }
    } else {
      window.scrollTo(0, 0);
    }

    let lastY = window.scrollY;
    let moved = false;
    const onScroll = () => { lastY = window.scrollY; moved = true; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
      // Only overwrite when the user actually scrolled this entry. StrictMode's dev
      // double-invoke tears the effect down while the page is still at the top, and
      // saving that 0 would erase the position the very next mount is about to restore.
      if (moved) sessionStorage.setItem(key, String(lastY));
    };
  }, [location.key, navType]);

  return null;
}
