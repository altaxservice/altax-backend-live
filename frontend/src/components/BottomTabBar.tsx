import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../context/LanguageContext";

/** Simple stroke icons, currentColor so the active teal tint applies for free. */
const ICONS: Record<string, React.ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" />
    </svg>
  ),
  billing: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" />
    </svg>
  ),
  documents: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V9.5z" /><path d="M13 3v6.5h6.5" />
    </svg>
  ),
  messages: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H4l1.6-3.2A8 8 0 1 1 21 12z" />
    </svg>
  ),
  guide: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" /><path d="M20 17v4H6.5a2.5 2.5 0 0 1 0-5" />
    </svg>
  ),
};

const CLIENT_TABS = [
  { to: "/", key: "tab.home", icon: "home" },
  { to: "/billing", key: "tab.billing", icon: "billing" },
  { to: "/documents", key: "tab.documents", icon: "documents" },
  { to: "/communications", key: "tab.messages", icon: "messages" },
  { to: "/guide", key: "tab.guide", icon: "guide" },
];

const EMPLOYEE_TABS = [
  { to: "/", key: "tab.home", icon: "home" },
  { to: "/documents", key: "tab.documents", icon: "documents" },
  { to: "/communications", key: "tab.messages", icon: "messages" },
  { to: "/guide", key: "tab.guide", icon: "guide" },
];

/**
 * Mobile-only persistent nav for client/employee (CSS-hidden above 860px), replacing
 * the sidebar drawer for these two roles — their full destination set fits in one bar,
 * so a hamburger+drawer would just be a redundant second way to reach the same 4-5
 * places. Admin/staff keep the Phase 1 hamburger drawer; this component renders
 * nothing for them. Icon + short label per tab ("Home", not "Command Center") — the
 * old text-only bar read as a cramped row of links, not app navigation, on phones.
 */
export function BottomTabBar() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== "client" && user?.role !== "employee") return null;
  const tabs = user.role === "client" ? CLIENT_TABS : EMPLOYEE_TABS;

  return (
    <nav className="bottom-tab-bar" aria-label="Bottom navigation">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === "/"}
          className={({ isActive }) => `bottom-tab-item ${isActive ? "active" : ""}`}
        >
          {ICONS[tab.icon]}
          {t(tab.key)}
        </NavLink>
      ))}
    </nav>
  );
}
