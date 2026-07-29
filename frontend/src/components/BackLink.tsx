import { Link, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";

/**
 * Context-aware back link for detail pages. The old hardcoded "← All clients"-style
 * links threw away where the user actually came from — drill into a task from a
 * client's Tasks tab, hit back, and you'd land at the top of the full task list
 * instead of the client you were working in. React Router tracks its position in
 * the session history (history.state.idx), so when there IS an in-app previous
 * page this walks back to that exact view (same client, same tab, same filters);
 * the hardcoded list target only remains as the fallback for cold opens (deep
 * link, new tab, refresh), where "back" would otherwise leave the app.
 */
export function BackLink({ fallback, fallbackLabel }: { fallback: string; fallbackLabel: string }) {
  const navigate = useNavigate();
  const { t, dir } = useLanguage();
  const arrow = dir === "rtl" ? "→" : "←";
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  if (!canGoBack) {
    return <Link to={fallback} className="muted">{arrow} {fallbackLabel}</Link>;
  }
  return (
    <button
      type="button"
      className="link-button"
      style={{ color: "var(--muted)", fontSize: "inherit" }}
      onClick={() => navigate(-1)}
    >
      {arrow} {t("common.back")}
    </button>
  );
}
