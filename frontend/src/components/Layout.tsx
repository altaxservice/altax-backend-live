import { Fragment, useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, ListChecks, Calendar, Clock, Workflow, ClipboardCheck, FileText, Kanban,
  Receipt, Calculator, CreditCard, BookOpen, BarChart3, FolderOpen, FileSpreadsheet, MessageSquare,
  LayoutTemplate, UserCog, ShieldCheck, KeyRound, Wrench, Settings, ListTree, ClipboardList, LifeBuoy,
  type LucideProps,
} from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { CreateModal } from "./CreateModal";
import { Header } from "./Header";
import { ClientContextPanel } from "./ClientContextPanel";
import { IdleTimeout } from "./IdleTimeout";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useLanguage } from "../context/LanguageContext";
import { FirmLogo } from "./FirmLogo";
import { BottomTabBar } from "./BottomTabBar";
import { InstallPrompt } from "./InstallPrompt";
import { CommandPalette } from "./CommandPalette";
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
const NAV_ITEMS: { to: string; label: string; navKey?: string; roles?: string[]; group?: string; icon: ComponentType<LucideProps> }[] = [
  { to: "/", label: "Command Center", navKey: "nav.commandCenter", icon: LayoutDashboard },
  { to: "/clients", label: "Clients", roles: ["admin", "staff"], group: "Clients", icon: Users },
  { to: "/tasks", label: "Tasks", roles: ["admin", "staff"], group: "Work", icon: ListChecks },
  { to: "/calendar", label: "Calendar", roles: ["admin", "staff"], group: "Work", icon: Calendar },
  { to: "/time-tracking", label: "Time Tracking", roles: ["admin", "staff"], group: "Work", icon: Clock },
  { to: "/rules", label: "Rules", roles: ["admin", "staff"], group: "Work", icon: Workflow },
  { to: "/haccp", label: "Health Permits", roles: ["admin", "staff"], group: "Work", icon: ClipboardCheck },
  { to: "/estimates", label: "Estimates", roles: ["admin", "staff"], group: "Tools", icon: FileText },
  { to: "/pipeline", label: "Pipeline", roles: ["admin", "staff"], group: "Tools", icon: Kanban },
  { to: "/fee-schedule", label: "Fee Schedule", roles: ["admin", "staff"], group: "Tools", icon: Receipt },
  { to: "/calculators", label: "Calculators", roles: ["admin", "staff"], group: "Tools", icon: Calculator },
  { to: "/billing", label: "Billing", navKey: "nav.billing", roles: ["admin", "staff", "client"], group: "Money", icon: CreditCard },
  { to: "/accounting", label: "Accounting", roles: ["admin", "staff"], group: "Money", icon: BookOpen },
  { to: "/reports", label: "Reports", roles: ["admin", "staff"], group: "Money", icon: BarChart3 },
  { to: "/documents", label: "Documents", navKey: "nav.documents", group: "Client Communication", icon: FolderOpen },
  { to: "/my-tax-forms", label: "My Tax Forms", navKey: "nav.myTaxForms", roles: ["employee"], icon: FileSpreadsheet },
  { to: "/communications", label: "Communications", navKey: "nav.communications", group: "Client Communication", icon: MessageSquare },
  { to: "/templates", label: "Templates", roles: ["admin", "staff"], group: "Client Communication", icon: LayoutTemplate },
  // Moved out of the Clients group and renamed from "Portal Access" — this page manages
  // Firm/Staff/Admin accounts too, not just client portal logins, so filing it under
  // "Clients" (and calling it something that sounds client-only) undersold and
  // misfiled it. It belongs with the other firm-administration pages.
  { to: "/users", label: "Users & Access", roles: ["admin"], group: "Firm", icon: UserCog },
  { to: "/security", label: "Security", roles: ["admin"], group: "Firm", icon: ShieldCheck },
  { to: "/firm-portals", label: "Portal Credentials", roles: ["admin"], group: "Firm", icon: KeyRound },
  { to: "/fix-center", label: "Fix Center", roles: ["admin"], group: "Firm", icon: Wrench },
  { to: "/firm-settings", label: "Firm Settings", roles: ["admin"], group: "Firm", icon: Settings },
  { to: "/list-settings", label: "List Settings", roles: ["admin"], group: "Firm", icon: ListTree },
  { to: "/document-checklists", label: "Document Checklists", roles: ["admin"], group: "Firm", icon: ClipboardList },
  { to: "/guide", label: "Guide", navKey: "nav.guide", icon: LifeBuoy },
];

const TITLES: Record<string, string> = {
  "/": "Command Center",
  "/clients": "Clients",
  "/tasks": "Tasks",
  "/calendar": "Calendar",
  "/time-tracking": "Time Tracking",
  "/billing": "Billing",
  "/documents": "Documents",
  "/my-tax-forms": "My Tax Forms",
  "/users": "Users & Access",
  "/security": "Security",
  "/rules": "Rules",
  "/haccp": "Health Permits",
  "/accounting": "Accounting",
  "/reports": "Reports",
  "/communications": "Communications",
  "/templates": "Templates",
  "/estimates": "Estimates",
  "/pipeline": "Pipeline",
  "/fee-schedule": "Fee Schedule",
  "/calculators": "Calculators",
  "/fix-center": "Fix Center",
  "/firm-settings": "Firm Settings",
  "/list-settings": "List Settings",
  "/document-checklists": "Document Checklists",
  "/firm-portals": "Portal Credentials",
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
  "/my-tax-forms": "nav.myTaxForms",
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
                  <item.icon size={17} strokeWidth={2} aria-hidden="true" />
                  <span>{item.navKey ? t(item.navKey) : item.label}</span>
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
        <IdleTimeout />
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
      <CommandPalette />
      <BottomTabBar />
    </div>
  );
}
