import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../context/LanguageContext";

const CLIENT_TABS = [
  { to: "/", key: "nav.commandCenter" },
  { to: "/billing", key: "nav.billing" },
  { to: "/documents", key: "nav.documents" },
  { to: "/communications", key: "nav.communications" },
  { to: "/guide", key: "nav.guide" },
];

const EMPLOYEE_TABS = [
  { to: "/", key: "nav.commandCenter" },
  { to: "/documents", key: "nav.documents" },
  { to: "/communications", key: "nav.communications" },
  { to: "/guide", key: "nav.guide" },
];

/**
 * Mobile-only persistent nav for client/employee (CSS-hidden above 860px), replacing
 * the sidebar drawer for these two roles — their full destination set fits in one bar,
 * so a hamburger+drawer would just be a redundant second way to reach the same 4-5
 * places. Admin/staff keep the Phase 1 hamburger drawer; this component renders
 * nothing for them.
 */
export function BottomTabBar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== "client" && user?.role !== "employee") return null;
  const tabs = user.role === "client" ? CLIENT_TABS : EMPLOYEE_TABS;

  return (
    <nav className="bottom-tab-bar" aria-label="Primary">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) => `bottom-tab-item ${isActive ? "active" : ""}`}
        >
          {t(tab.key)}
        </NavLink>
      ))}
    </nav>
  );
}
