import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Puts you back on the CLIENT OR TASK YOU WERE WORKING ON when you go back — not
 * merely on the right page, and not at "roughly the same height."
 *
 * The first attempt at this restored a saved pixel offset, which broke in practice:
 * a list is re-fetched on return, rows differ in height, and any filter or sort you
 * had applied resets, so the same y-coordinate lands on some unrelated row. The fix
 * is to anchor to the RECORD instead. Any row carrying data-row-id is remembered
 * when you click it, and on the way back that exact row is centered and flashed so
 * your eye lands on it immediately — correct no matter how the list reflowed.
 *
 * A saved scroll offset is still kept as the fallback for pages with no rows to
 * anchor to (a long detail page, a report), and for the case where the remembered
 * record is genuinely gone from the list.
 */

const rowKey = (path: string) => `altax_row:${path}`;
const scrollKey = (navKey: string) => `altax_scroll:${navKey}`;

/** ~4s of retries: lists paint empty first, then fill from the API. */
const RETRY_MS = 100;
const MAX_RETRIES = 40;

/** How long the returned-to row stays marked. Keep in sync with the
 *  .row-returned animation in index.css. */
const HIGHLIGHT_MS = 8000;

export function NavigationMemory() {
  const location = useLocation();
  const navType = useNavigationType();

  // Remember which row was clicked, for whichever list it happened on. A single
  // capture-phase listener means list pages need no wiring beyond data-row-id —
  // their existing onClick handlers stay untouched.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-row-id]") : null;
      const id = el?.getAttribute("data-row-id");
      if (id) sessionStorage.setItem(rowKey(window.location.pathname), id);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useLayoutEffect(() => {
    // Take over from the browser's own (window-level, SPA-oblivious) restoration.
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";

    const sKey = scrollKey(location.key);
    let cancelled = false;
    let timer = 0;

    if (navType === "POP") {
      const savedId = sessionStorage.getItem(rowKey(location.pathname));
      const savedY = Number(sessionStorage.getItem(sKey) || 0);
      let tries = 0;

      const settle = () => {
        if (cancelled) return;

        const row = savedId
          ? document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(savedId)}"]`)
          : null;
        if (row) {
          row.scrollIntoView({ block: "center" });
          row.classList.add("row-returned");
          window.setTimeout(() => row.classList.remove("row-returned"), HIGHLIGHT_MS + 100);
          return;
        }

        // No row yet. Hold the old scroll position meanwhile so the page doesn't
        // sit at the top and then jump once the rows arrive.
        if (savedY > 0) window.scrollTo(0, savedY);
        if (tries++ < MAX_RETRIES) timer = window.setTimeout(settle, RETRY_MS);
      };
      settle();
    } else {
      window.scrollTo(0, 0);
    }

    let lastY = window.scrollY;
    let moved = false;
    const onScroll = () => { lastY = window.scrollY; moved = true; };
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      // Only overwrite when the user actually scrolled this entry. StrictMode's dev
      // double-invoke tears the effect down while the page is still at the top, and
      // saving that 0 would erase the position the very next mount is about to use.
      if (moved) sessionStorage.setItem(sKey, String(lastY));
    };
  }, [location.key, location.pathname, navType]);

  return null;
}
