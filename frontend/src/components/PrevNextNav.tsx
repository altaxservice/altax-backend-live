import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

/**
 * Previous/Next paging for a detail page, sitting next to BackLink — lets
 * staff step through the list they came from (Clients, Tasks) without going
 * back and re-clicking the next row. Renders nothing if the current record
 * isn't part of a saved list order (see utils/listNav.ts), e.g. the page was
 * opened via a direct link rather than from the list.
 */
export function PrevNextNav({ basePath, prevId, nextId }: { basePath: string; prevId: string | null; nextId: string | null }) {
  const navigate = useNavigate();
  const { dir } = useLanguage();
  if (!prevId && !nextId) return null;
  const prevArrow = dir === "rtl" ? "›" : "‹";
  const nextArrow = dir === "rtl" ? "‹" : "›";
  const btnStyle = (enabled: boolean): CSSProperties => ({
    color: "var(--muted)", fontSize: "inherit", opacity: enabled ? 1 : 0.35, cursor: enabled ? "pointer" : "default",
  });
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, marginInlineStart: 14 }}>
      <button type="button" className="link-button" disabled={!prevId} title="Previous" style={btnStyle(!!prevId)} onClick={() => prevId && navigate(`${basePath}/${prevId}`)}>
        {prevArrow} Previous
      </button>
      <button type="button" className="link-button" disabled={!nextId} title="Next" style={btnStyle(!!nextId)} onClick={() => nextId && navigate(`${basePath}/${nextId}`)}>
        Next {nextArrow}
      </button>
    </span>
  );
}
