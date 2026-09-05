import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * With no `roles`, only checks the user is logged in. With `roles`, also blocks
 * any role not in the list — used to nest admin/staff-only route groups under
 * the outer auth check so a client/employee account can't reach an
 * internal-only page by typing its URL directly (previously the page rendered
 * its full shell and just failed its API calls silently).
 *
 * App.tsx nests every role-scoped <ProtectedRoute roles={...}> INSIDE one
 * outer, roles-less <ProtectedRoute /> (the shared "just needs to be logged
 * in" wrapper around <Layout/>). React Router never renders a nested route's
 * element once an ancestor route's element has already returned a redirect —
 * so for a signed-out visitor, the OUTER instance is always the one whose
 * `!user` branch actually fires; a role-scoped inner instance never even
 * mounts to redirect anywhere client/employee-specific. Confirmed live: a
 * `roles={["client"]}`-only fix on this component had zero effect for a
 * signed-out visit, because the outer no-roles instance caught it first and
 * always used the generic path.
 *
 * The fix has to live at the point that actually fires: a small,
 * hand-maintained lookup of client-only / employee-only path prefixes
 * (mirrored from App.tsx's own `roles={["client"]}` / `roles={["employee"]}`
 * groups — update both places together) lets even the outer, roles-less
 * instance redirect a signed-out visitor straight to that role's own locked
 * sign-in form (/login/client, /login/employee) instead of the bare 4-portal
 * picker — the same "which of these am I?" dead end already fixed for
 * stale-service-worker downloads (StaleServiceWorkerRecovery.tsx), reached
 * here a different way (an expired session, or a bookmarked/emailed deep
 * link opened in a fresh browser). Any other path (admin/staff/mixed, or one
 * not listed here) keeps the existing bare /login fallback.
 */
const CLIENT_ONLY_PATHS = ["/my-business", "/agreements", "/gov-filings"];
const EMPLOYEE_ONLY_PATHS = ["/my-tax-forms"];

function loginPathFor(pathname: string, roles?: string[]): string {
  if (roles?.length === 1 && (roles[0] === "client" || roles[0] === "employee")) return `/login/${roles[0]}`;
  if (CLIENT_ONLY_PATHS.includes(pathname)) return "/login/client";
  if (EMPLOYEE_ONLY_PATHS.includes(pathname)) return "/login/employee";
  return "/login";
}

export function ProtectedRoute({ roles }: { roles?: string[] }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) return <div className="spinner-wrap">Loading…</div>;
  if (!user) return <Navigate to={loginPathFor(pathname, roles)} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
