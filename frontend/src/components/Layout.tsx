import { Fragment, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CreateModal } from "./CreateModal";
import { Header } from "./Header";
import { ClientContextPanel } from "./ClientContextPanel";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useLanguage } from "../context/LanguageContext";
import { FirmLogo } from "./FirmLogo";
import { BottomTabBar } from "./BottomTabBar";
import { InstallPrompt } from "./InstallPrompt";
import { APP_NAME, COPYRIGHT, FIRM_LEGAL_NAME } from "../utils/branding";

const CLIENT_PANEL_ROUTES = ["/tasks", "/documents", "/billing", "/accounting", "/reports", "/communications", "/clients"];

function showsClientPanel(pathname: string): boolean {
  if (/^\/clients\/[^/]+$/.test(pathname)) return false; // full client profile page already shows this
  return CLIENT_PANEL_ROUTES.some((base) => pathname === base || pathname.startsWith(base + "/"));
}

// navKey is only translated for the items client/employee can actually reach
// (Command Center, Billing, Documents, Communications, Guide) — admin/staff-only
// items keep their plain English label since those roles never see the toggle.
// group: rendered as a section label above the first item in each group — see
// showGroupLabels below for why it only kicks in once the list is long enough
// to actually need it (admin/staff), not for client/employee's short list.
const NAV_ITEMS: { to: string; label: string; navKey?: string; roles?: string[]; group?: string }[] = [
  { to: "/", label: "Command Center", navKey: "nav.commandCenter" },
  { to: "/clients", label: "Clients", roles: ["admin", "staff"], group: "Clients" },
  { to: "/tasks", label: "Tasks", roles: ["admin", "staff"], group: "Work" },
  { to: "/rules", label: "Rules", roles: ["admin", "staff"], group: "Work" },
  { to: "/haccp", label: "HACCP Plans", roles: ["admin", "staff"], group: "Work" },
  { to: "/billing", label: "Billing", navKey: "nav.billing", roles: ["admin", "staff", "client"], group: "Money" },
  { to: "/accounting", label: "Accounting", roles: ["admin", "staff"], group: "Money" },
  { to: "/reports", label: "Reports", roles: ["admin", "staff"], group: "Money" },
  { to: "/documents", label: "Documents", navKey: "nav.documents", group: "Client Communication" },
  { to: "/communications", label: "Communications", navKey: "nav.communications", group: "Client Communication" },
  { to: "/templates", label: "Templates", roles: ["admin", "staff"], group: "Client Communication" },
  // Moved out of the Clients group and renamed from "Portal Access" — this page manages
  // Firm/Staff/Admin accounts too, not just client portal logins, so filing it under
  // "Clients" (and calling it something that sounds client-only) undersold and
  // misfiled it. It belongs with the other firm-administration pages.
  { to: "/users", label: "Users & Access", roles: ["admin"], group: "Firm" },
  { to: "/security", label: "Security", roles: ["admin"], group: "Firm" },
  { to: "/fix-center", label: "Fix Center", roles: ["admin"], group: "Firm" },
  { to: "/firm-settings", label: "Firm Settings", roles: ["admin"], group: "Firm" },
  { to: "/guide", label: "Guide", navKey: "nav.guide" },
];

const TITLES: Record<string, string> = {
  "/": "Command Center",
  "/clients": "Clients",
  "/tasks": "Tasks",
  "/billing": "Billing",
  "/documents": "Documents",
  "/users": "Users & Access",
  "/security": "Security",
  "/rules": "Rules",
  "/haccp": "HACCP Plans",
  "/accounting": "Accounting",
  "/reports": "Reports",
  "/communications": "Communications",
  "/templates": "Templates",
  "/fix-center": "Fix Center",
  "/firm-settings": "Firm Settings",
  "/guide": "Guide",
};

// Mirrors NAV_ITEMS' navKey — only the pages client/employee can actually reach
// have a translation; everything else keeps its plain English title.
const TITLE_KEYS: Record<string, string> = {
  "/": "nav.commandCenter",
  "/billing": "nav.billing",
  "/documents": "nav.documents",
  "/communications": "nav.communications",
  "/guide": "nav.guide",
};

function titleForPath(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const base = "/" + (pathname.split("/")[1] || "");
  return TITLES[base] || APP_NAME;
}

function titleKeyForPath(pathname: string): string | undefined {
  if (TITLE_KEYS[pathname]) return TITLE_KEYS[pathname];
  const base = "/" + (pathname.split("/")[1] || "");
  return TITLE_KEYS[base];
}

const PORTAL_LABELS: Record<string, string> = {
  admin: "Admin Portal",
  staff: "Staff Portal",
  client: "Client Portal",
  employee: "Employee Portal",
  general: "Portal",
};

export function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const { clientId } = useSelectedClient();
  const { t, dir } = useLanguage();
  const [showCreate, setShowCreate] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  // Client/employee only ever see ~4-5 items — group headers would add more
  // clutter than they remove there. Admin (15) and staff (11) are exactly the
  // case grouping helps, so the threshold gates on role instead of a magic count.
  const showGroupLabels = user?.role === "admin" || user?.role === "staff";
  let lastGroup: string | undefined;
  const canCreate = user?.role === "admin" || user?.role === "staff";
  const showLanguageToggle = user?.role === "client" || user?.role === "employee";
  const sidebarDir = showLanguageToggle ? dir : "ltr";
  // Internal staff tool (full account/compliance summary + Open Client Profile/View
  // Billing shortcuts) for whoever staff is currently working on while navigating —
  // meaningless, and previously a real data-exposure bug, for a client or employee
  // viewing what is always just their own single account.
  const showPanel = (user?.role === "admin" || user?.role === "staff") && !!clientId && showsClientPanel(location.pathname);
  const pageTitle = titleForPath(location.pathname);
  const titleKey = titleKeyForPath(location.pathname);
  const displayTitle = showLanguageToggle && titleKey ? t(titleKey) : pageTitle;

  useEffect(() => {
    const portalLabel = user ? PORTAL_LABELS[user.role] || "Portal" : "Sign In";
    document.title = `${pageTitle} · ${portalLabel} – ${APP_NAME}`;
  }, [pageTitle, user]);

  // Auto-close the mobile drawer on navigation — otherwise a route change happening
  // "behind" the open drawer leaves it stuck open over the new page.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <div className={`sidebar-backdrop ${mobileNavOpen ? "open" : ""}`} onClick={() => setMobileNavOpen(false)} />
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`} dir={sidebarDir}>
        <div className="brand-lockup">
          <FirmLogo size={40} />
          <div>
            <div className="brand-name">{APP_NAME}</div>
            <div className="brand-subtitle">{t("brand.by")} {FIRM_LEGAL_NAME}</div>
          </div>
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary create-launch" onClick={() => setShowCreate(true)}>
            + Create
          </button>
        )}
        <nav className="nav-list" aria-label="Primary">
          {visibleNav.map((item) => {
            const showLabel = showGroupLabels && item.group && item.group !== lastGroup;
            lastGroup = item.group;
            return (
              <Fragment key={item.to}>
                {showLabel && <div className="nav-group-label">{item.group}</div>}
                <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                  {item.navKey ? t(item.navKey) : item.label}
                </NavLink>
              </Fragment>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="small-label">Data Layer</div>
          <div className="data-layer-badge">v5 professional tables</div>
          <div className="muted" dir="ltr" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.4, textAlign: sidebarDir === "rtl" ? "right" : "left" }}>{COPYRIGHT}</div>
        </div>
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Header title={displayTitle} onMenuClick={() => setMobileNavOpen((v) => !v)} />
        <InstallPrompt />
        <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
          <main className={showLanguageToggle ? "has-bottom-tabs" : ""} style={{ flex: 1, padding: "24px 32px", overflowX: "auto", minWidth: 0 }}>
            <Outlet />
          </main>
          {showPanel && <ClientContextPanel />}
        </div>
      </div>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      <BottomTabBar />
    </div>
  );
}
