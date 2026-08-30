import { useState, type MouseEvent as ReactMouseEvent } from "react";

interface UseResizableWidthOptions {
  storageKey: string;
  defaultWidth: number;
  min: number;
  max: number;
  /** Which edge the drag handle sits on. "right" (default): handle on the card's right edge, dragging right widens it. "left": handle on the left edge — e.g. a panel flush against the right side of the screen — dragging left widens it. */
  edge?: "left" | "right";
}

/**
 * Drag-to-resize width, persisted per-browser via localStorage — the pattern
 * behind every `.resizable-card`/`.resizable-card-handle` in the app
 * (index.css:919-960). Extracted from three near-identical copies
 * (ClientContextPanel's sidebar, ClientDetailPage's edit form and Profile
 * card) so a 4th usage doesn't become a 4th copy-paste.
 */
export function useResizableWidth({ storageKey, defaultWidth, min, max, edge = "right" }: UseResizableWidthOptions) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return Number.isFinite(saved) && saved > 0 ? clamp(saved) : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);

  function startResize(e: ReactMouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    setResizing(true);
    function onMove(ev: MouseEvent) {
      const delta = edge === "left" ? startX - ev.clientX : ev.clientX - startX;
      setWidth(clamp(startWidth + delta));
    }
    function onUp() {
      setResizing(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidth((w) => { localStorage.setItem(storageKey, String(w)); return w; });
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return { width, resizing, startResize };
}
