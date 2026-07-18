import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** With no `roles`, only checks the user is logged in. With `roles`, also blocks any role not in the list — used to nest admin/staff-only route groups under the outer auth check so a client/employee account can't reach an internal-only page by typing its URL directly (previously the page rendered its full shell and just failed its API calls silently). */
export function ProtectedRoute({ roles }: { roles?: string[] }) {
  const { user, loading } = useAuth();

  if (loading) return <div className="spinner-wrap">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  return <Outlet />;
}
