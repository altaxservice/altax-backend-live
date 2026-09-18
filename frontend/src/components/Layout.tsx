import { Fragment, useEffect, useState, type ComponentType } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Users, ListChecks, Calendar, Clock, Workflow, ClipboardCheck, FileText, Kanban,
  Receipt, Calculator, CreditCard, BookOpen, BarChart3, FolderOpen, FileSpreadsheet, MessageSquare,
  LayoutTemplate, UserCog, ShieldCheck, ShieldAlert, KeyRound, Wrench, Settings, ListTree, ClipboardList, LifeBuoy, Zap, Tag, Building2, TabletSmartphone,
  PanelLeftClose, PanelLeft, FileSignature, Landmark, Lightbulb, TrendingUp, Layers, Mail, Globe, StickyNote, NotebookPen, HandCoins,
  ChevronDown, ChevronRight,
  type LucideProps,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CreateModal } from "./CreateModal";
import { Header } from "./Header";
import { ClientContextPanel } from "./ClientContextPanel";
import { TaskContextPanel } from "./TaskContextPanel";
import { IdleTimeout } from "./IdleTimeout";
import { useSelectedClient } from "../context/SelectedClientContext";
import { useSelectedTask } from "../context/SelectedTaskContext";
import { useLanguage } from "../context/LanguageContext";
import { FirmLogo } from "./FirmLogo";
import { BottomTabBar } from "./BottomTabBar";
import { InstallPrompt } from "./InstallPrompt";
import { CommandPalette } from "./CommandPalette";
import { APP_NAME, COPYRIGHT, FIRM_LEGAL_NAME } from "../utils/branding";

// The client's own detail page (/clients/:id and every tab within it) shows
// the panel via the plain "/clients" prefix match below — removed the old
// early-return that skipped it there (stale: it claimed the profile page
// "already shows this," which it didn't, leaving every tab without it).
// "/tasks" removed 2026-08-23 per direct owner request — the panel added
// clutter to task detail pages without enough payoff there; the task's
// linked client is already one click away. All of "/tasks" (the list AND
// every task's own detail page) gets TaskContextPanel instead — see
// showsTaskPanel below. Clicking a task row now selects it (no
// navigation) so the panel appears right there on the list; the task's
// own name is still a real link to its detail page.
const CLIENT_PANEL_ROUTES = ["/documents", "/accounting", "/reports", "/communications", "/clients"];

function showsTaskPanel(pathname: string): boolean {
  return pathname === "/tasks" || pathname.startsWith("/tasks/");
}

// AR Aging and MD Annual Report used to live as tabs on ReportsPage.tsx and
// needed a special case here to hide this panel for them (they're firm-wide,
// not scoped to whichever client is pinned) — both moved out to the Firm
// Report page entirely on 2026-08-26 (a page that's exclusively firm-wide
// sections already), so that special case is gone; no tab on /reports is
// firm-wide anymore.
function showsClientPanel(pathname: string): boolean {
  return CLIENT_PANEL_ROUTES.some((base) => pathname === base || pathname.startsWith(base + "/"));
}

// navKey is only translated for the items client/employee can actually reach
// (Command Center, Billing, Documents, Communications, Guide) — admin/staff-only
// items keep their plain English label since those roles never see the toggle.
// group: rendered as a section label above the first item in each group — see
// showGroupLabels below for why it only kicks in once the list is long enough
// to actually need it (admin/staff), not for client/employee's short list.
// `keywords` back plain-language ways someone might describe a page without
// remembering its exact sidebar label — matched by the command palette
// (CommandPalette.tsx) alongside the label itself, so "clock in" finds "Time
// Clock Kiosk" and "wages" finds "Payroll Agent" even though neither word
// appears in the label. Not exhaustive; add to a page's list as a real search
// miss turns up, same as the sidebar itself grows.
export const NAV_ITEMS: { to: string; label: string; navKey?: string; roles?: string[]; group?: string; icon: ComponentType<LucideProps>; keywords?: string[] }[] = [
  { to: "/dashboard", label: "Command Center", navKey: "nav.commandCenter", icon: LayoutDashboard, keywords: ["home", "dashboard", "overview"] },
  { to: "/clients", label: "Clients", roles: ["admin", "staff"], group: "Clients", icon: Users, keywords: ["customers", "accounts", "businesses"] },
  { to: "/tasks", label: "Tasks", roles: ["admin", "staff"], group: "Work", icon: ListChecks, keywords: ["to-do", "todo", "deadlines", "work items"] },
  { to: "/notes", label: "Notes", roles: ["admin", "staff"], group: "Work", icon: StickyNote, keywords: ["memo", "sticky note"] },
  { to: "/daily-log", label: "Daily Log", roles: ["admin", "staff"], group: "Work", icon: NotebookPen, keywords: ["journal", "activity log"] },
  { to: "/labels", label: "Labels", roles: ["admin", "staff"], group: "Work", icon: Tag, keywords: ["tags", "categories"] },
  { to: "/calendar", label: "Calendar", roles: ["admin", "staff"], group: "Work", icon: Calendar, keywords: ["appointments", "schedule", "booking"] },
  { to: "/time-tracking", label: "Time Tracking", roles: ["admin", "staff"], group: "Work", icon: Clock, keywords: ["hours", "clock in", "clock out", "timesheet", "kiosk", "punch", "wages", "pay rate"] },
  { to: "/rules", label: "Task Rules", roles: ["admin", "staff"], group: "Work", icon: Workflow, keywords: ["automation", "recurring tasks", "workflow"] },
  { to: "/haccp", label: "Health Permits", roles: ["admin", "staff"], group: "Work", icon: ClipboardCheck, keywords: ["haccp", "food safety", "inspections", "permits"] },
  { to: "/estimates", label: "Estimates", roles: ["admin", "staff"], group: "Tools", icon: FileText, keywords: ["quotes", "proposals"] },
  { to: "/pipeline", label: "Pipeline", roles: ["admin", "staff"], group: "Tools", icon: Kanban, keywords: ["deals", "leads", "crm", "sales"] },
  { to: "/fee-schedule", label: "Fee Schedule", roles: ["admin", "staff"], group: "Tools", icon: Receipt, keywords: ["pricing", "rates", "price list", "how much we charge"] },
  { to: "/subscription-plans", label: "Subscription Plans", roles: ["admin", "staff"], group: "Tools", icon: Layers, keywords: ["tiers", "packages", "membership"] },
  { to: "/calculators", label: "Calculators", roles: ["admin", "staff"], group: "Tools", icon: Calculator, keywords: ["math", "tools"] },
  { to: "/billing", label: "Billing", navKey: "nav.billing", roles: ["admin", "staff", "client"], group: "Money", icon: CreditCard, keywords: ["invoices", "payments", "ar", "money owed", "who owes"] },
  { to: "/tax-payments", label: "Client Tax Payments", roles: ["admin", "staff"], group: "Money", icon: HandCoins, keywords: ["sales tax", "filings", "tax due"] },
  { to: "/my-business", label: "My Business", navKey: "nav.myBusiness", roles: ["client"], icon: Building2 },
  { to: "/agreements", label: "Agreements", navKey: "nav.agreements", roles: ["client"], icon: FileSignature, keywords: ["contracts"] },
  { to: "/gov-filings", label: "Government Filings", navKey: "nav.govFilings", roles: ["client"], icon: Landmark, keywords: ["gov forms"] },
  { to: "/accounting", label: "Accounting", roles: ["admin", "staff"], group: "Money", icon: BookOpen, keywords: ["books", "bookkeeping", "gl", "journal entries", "sales input"] },
  { to: "/payroll-agent", label: "Payroll Agent", roles: ["admin", "staff"], group: "Money", icon: Zap, keywords: ["paychecks", "wages", "salary", "pay run", "employees"] },
  { to: "/reports", label: "Reports", roles: ["admin", "staff"], group: "Money", icon: BarChart3, keywords: ["analytics", "kpis"] },
  { to: "/documents", label: "Documents", navKey: "nav.documents", group: "Client Communication", icon: FolderOpen, keywords: ["files", "uploads"] },
  { to: "/my-tax-forms", label: "My Tax Forms", navKey: "nav.myTaxForms", roles: ["employee"], icon: FileSpreadsheet, keywords: ["w4", "w9"] },
  { to: "/communications", label: "Communications", navKey: "nav.communications", group: "Client Communication", icon: MessageSquare, keywords: ["messages", "emails", "texts", "sms"] },
  { to: "/templates", label: "Templates", roles: ["admin", "staff"], group: "Client Communication", icon: LayoutTemplate, keywords: ["email templates", "canned responses"] },
  { to: "/newsletter", label: "Newsletter", roles: ["admin", "staff"], group: "Client Communication", icon: Mail, keywords: ["email blast", "marketing email"] },
  // Moved out of the Clients group and renamed from "Portal Access" — this page manages
  // Firm/Staff/Admin accounts too, not just client portal logins, so filing it under
  // "Clients" (and calling it something that sounds client-only) undersold and
  // misfiled it. It belongs with the other firm-administration pages.
  { to: "/users", label: "Users & Access", roles: ["admin"], group: "Firm", icon: UserCog, keywords: ["staff accounts", "logins", "permissions", "team", "hourly rate", "new user"] },
  { to: "/security", label: "Security", roles: ["admin"], group: "Firm", icon: ShieldCheck, keywords: ["2fa", "passwords", "audit log"] },
  { to: "/firm-portals", label: "Portal Credentials", roles: ["admin"], group: "Firm", icon: KeyRound, keywords: ["eftps", "md tax connect", "agency logins"] },
  { to: "/kiosk-settings", label: "Time Clock Kiosk", roles: ["admin"], group: "Firm", icon: TabletSmartphone, keywords: ["clock in", "clock out", "punch clock", "attendance", "pin"] },
  { to: "/fix-center", label: "Fix Center", roles: ["admin", "staff"], group: "Firm", icon: Wrench, keywords: ["diagnostics", "errors", "health check", "troubleshoot"] },
  { to: "/compliance", label: "Compliance", roles: ["admin", "staff"], group: "Firm", icon: ShieldAlert, keywords: ["wisp", "security plan", "pub 4557"] },
  { to: "/firm-report", label: "Firm Report", roles: ["admin"], group: "Firm", icon: TrendingUp, keywords: ["business health", "compliance score", "p&l", "staff capacity"] },
  { to: "/website-analytics", label: "Website Analytics", roles: ["admin", "staff"], group: "Firm", icon: Globe, keywords: ["traffic", "visitors", "web stats"] },
  { to: "/firm-settings", label: "Firm Settings", roles: ["admin"], group: "Firm", icon: Settings, keywords: ["logo", "firm name", "address", "branding"] },
  { to: "/list-settings", label: "List Settings", roles: ["admin"], group: "Firm", icon: ListTree, keywords: ["dropdown options", "custom fields"] },
  { to: "/suggestions", label: "Suggestions", roles: ["admin", "staff"], group: "Firm", icon: Lightbulb, keywords: ["feedback", "ideas"] },
  { to: "/document-checklists", label: "Document Checklists", roles: ["admin"], group: "Firm", icon: ClipboardList, keywords: ["required docs"] },
  { to: "/guide", label: "Guide", navKey: "nav.guide", icon: LifeBuoy, keywords: ["help", "how to", "tutorial"] },
];

const TITLES: Record<string, string> = {
  "/dashboard": "Command Center",
  "/clients": "Clients",
  "/tasks": "Tasks",
  "/notes": "Notes",
  "/daily-log": "Daily Log",
  "/calendar": "Calendar",
  "/time-tracking": "Time Tracking",
  "/billing": "Billing",
  "/tax-payments": "Client Tax Payments",
  "/documents": "Documents",
  "/my-tax-forms": "My Tax Forms",
  "/users": "Users & Access",
  "/security": "Security",
  "/rules": "Task Rules",
  "/haccp": "Health Permits",
  "/accounting": "Accounting",
  "/payroll-agent": "Payroll Agent",
  "/reports": "Reports",
  "/communications": "Communications",
  "/templates": "Templates",
  "/newsletter": "Newsletter",
  "/website-analytics": "Website Analytics",
  "/estimates": "Estimates",
  "/pipeline": "Pipeline",
  "/fee-schedule": "Fee Schedule",
  "/subscription-plans": "Subscription Plans",
  "/calculators": "Calculators",
  "/fix-center": "Fix Center",
  "/compliance": "Compliance",
  "/firm-settings": "Firm Settings",
  "/list-settings": "List Settings",
  "/labels": "Labels",
  "/suggestions": "Suggestions",
  "/document-checklists": "Document Checklists",
  "/firm-portals": "Portal Credentials",
  "/kiosk-settings": "Time Clock Kiosk",
  "/guide": "Guide",
  "/my-business": "My Business",
  "/agreements": "Agreements",
  "/gov-filings": "Government Filings",
};

// Mirrors NAV_ITEMS' navKey — only the pages client/employee can actually reach
// have a translation; everything else keeps its plain English title.
const TITLE_KEYS: Record<string, string> = {
  "/dashboard": "nav.commandCenter",
  "/billing": "nav.billing",
  "/documents": "nav.documents",
  "/communications": "nav.communications",
  "/guide": "nav.guide",
  "/my-tax-forms": "nav.myTaxForms",
  "/my-business": "nav.myBusiness",
  "/agreements": "nav.agreements",
  "/gov-filings": "nav.govFilings",
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
  const { taskId } = useSelectedTask();
  const { t, dir } = useLanguage();
  const [showCreate, setShowCreate] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop-only icon-rail collapse — the mobile hamburger drawer above always
  // shows the full sidebar regardless of this (see the max-width:860px CSS
  // override), since a momentary overlay drawer has no use for staying narrow.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("altax_sidebar_collapsed") === "1");
  function toggleSidebarCollapsed() {
    setSidebarCollapsed((v) => {
      const next = !v;
      localStorage.setItem("altax_sidebar_collapsed", next ? "1" : "0");
      return next;
    });
  }
  // Mirrors the 860px breakpoint the mobile drawer CSS switches on — the collapse
  // preference only ever hides nav labels above it. Below it the drawer's CSS
  // override restores full width, but that alone can't bring back label <span>s
  // this component never rendered in the first place, so the JS has to know too.
  const [isDesktopWidth, setIsDesktopWidth] = useState(() => window.matchMedia("(min-width: 861px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 861px)");
    const onChange = () => setIsDesktopWidth(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const sidebarRailActive = sidebarCollapsed && isDesktopWidth;
  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  // Per-group collapse — Firm alone runs 11 items, so letting an admin fold
  // away groups they don't touch daily shortens the list without removing
  // anything. A group the current page belongs to is force-expanded below
  // (collapsedGroups.has(...) check gets && item.group !== activeGroup), so
  // collapsing a group can never hide the page you're actually standing on.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("altax_sidebar_collapsed_groups") || "[]")); } catch { return new Set(); }
  });
  function toggleGroup(group: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      localStorage.setItem("altax_sidebar_collapsed_groups", JSON.stringify(Array.from(next)));
      return next;
    });
  }
  const activeGroup = visibleNav.find((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))?.group;
  // Notes sidebar badge — refetched whenever the route changes so leaving the
  // Notes page after reading/resolving things (or another tab's action)
  // updates the count without a manual refresh or a dedicated poll.
  const [openNotesCount, setOpenNotesCount] = useState(0);
  useEffect(() => {
    if (!user || !["admin", "staff"].includes(user.role)) return;
    api.get<{ count: number }>("/staff-notes/open-count").then((r) => setOpenNotesCount(r.count)).catch(() => {});
  }, [user, location.pathname]);
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
  const isStaffOrAdmin = user?.role === "admin" || user?.role === "staff";
  const onTasksSection = showsTaskPanel(location.pathname);
  const showTaskPanel = isStaffOrAdmin && !!taskId && onTasksSection;
  // "/tasks" was already dropped from CLIENT_PANEL_ROUTES, so this is belt-
  // and-suspenders — the two panels are never both eligible on the same route.
  const showPanel = isStaffOrAdmin && !!clientId && !onTasksSection && showsClientPanel(location.pathname);
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
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <div className={`sidebar-backdrop ${mobileNavOpen ? "open" : ""}`} onClick={() => setMobileNavOpen(false)} />
      <aside id="primary-sidebar" className={`sidebar ${mobileNavOpen ? "open" : ""} ${sidebarRailActive ? "collapsed" : ""}`} dir={sidebarDir}>
        <div className="brand-lockup">
          <FirmLogo size={40} />
          {!sidebarRailActive && (
            <div>
              <div className="brand-name">{APP_NAME}</div>
              <div className="brand-subtitle">{t("brand.by")} {FIRM_LEGAL_NAME}</div>
            </div>
          )}
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={toggleSidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Hide sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Hide sidebar"}
          >
            {sidebarCollapsed ? <PanelLeft size={15} /> : <PanelLeftClose size={15} />}
          </button>
        </div>
        {canCreate && (
          <button type="button" className="btn btn-primary create-launch" onClick={() => setShowCreate(true)} title="Create">
            {sidebarRailActive ? "+" : "+ Create"}
          </button>
        )}
        <nav className="nav-list" aria-label="Primary">
          {visibleNav.map((item) => {
            const label = item.navKey ? t(item.navKey) : item.label;
            const showLabel = showGroupLabels && item.group && item.group !== lastGroup && !sidebarRailActive;
            lastGroup = item.group;
            // Gated on showGroupLabels too — client/employee never see group
            // headers (or a way to toggle them), so a stale collapsed-group
            // flag left in this browser's localStorage from an earlier admin
            // session must never silently hide a page from them.
            const groupCollapsed = Boolean(showGroupLabels && !sidebarRailActive && item.group && collapsedGroups.has(item.group) && item.group !== activeGroup);
            return (
              <Fragment key={item.to}>
                {showLabel && (
                  <button
                    type="button"
                    className="nav-group-label"
                    onClick={() => toggleGroup(item.group!)}
                    style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                    aria-expanded={!groupCollapsed}
                  >
                    {groupCollapsed ? <ChevronRight size={11} strokeWidth={2.5} aria-hidden="true" /> : <ChevronDown size={11} strokeWidth={2.5} aria-hidden="true" />}
                    {item.group}
                  </button>
                )}
                {groupCollapsed ? null : <NavLink
                  to={item.to} end={item.to === "/dashboard"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  title={sidebarRailActive ? label : undefined}
                >
                  <item.icon size={17} strokeWidth={2} aria-hidden="true" />
                  {!sidebarRailActive && <span>{label}</span>}
                  {item.to === "/notes" && openNotesCount > 0 && (
                    <span
                      style={{
                        marginLeft: sidebarRailActive ? 0 : "auto", fontSize: 11, fontWeight: 700,
                        background: "var(--red)", color: "#fff", borderRadius: 999, padding: "1px 6px", lineHeight: 1.5,
                      }}
                    >
                      {openNotesCount}
                    </span>
                  )}
                </NavLink>}
              </Fragment>
            );
          })}
        </nav>
        {!sidebarRailActive && (
          <div className="sidebar-footer">
            <div className="small-label">Data Layer</div>
            <div className="data-layer-badge">v5 professional tables</div>
            <div className="muted" dir="ltr" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.4, textAlign: sidebarDir === "rtl" ? "right" : "left" }}>{COPYRIGHT}</div>
          </div>
        )}
      </aside>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <IdleTimeout />
        <Header title={displayTitle} onMenuClick={() => setMobileNavOpen((v) => !v)} menuOpen={mobileNavOpen} />
        <InstallPrompt />
        <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
          {/* No overflow-x:auto here — every page with a genuinely wide table already
              wraps it in its own .table-scroll (which handles horizontal overflow
              locally), so this was a redundant second safety net. It was also a
              silent, app-wide killer of position:sticky: pairing a non-visible
              overflow-x with the default-visible overflow-y forces the latter to
              compute to "auto" too per spec (no override, inline or otherwise, can
              undo this), which turns <main> into ITS OWN scroll container even
              though it never actually scrolls (the real page scroll is on <html>)
              — so every sticky element anywhere in the app, not just table headers,
              was silently broken by this one inline style. */}
          <main id="main-content" tabIndex={-1} className={showLanguageToggle ? "has-bottom-tabs" : ""} style={{ flex: 1, padding: "24px 32px", minWidth: 0 }}>
            <Outlet />
          </main>
          {showPanel && <ClientContextPanel />}
          {showTaskPanel && <TaskContextPanel />}
        </div>
      </div>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} />}
      <CommandPalette />
      <BottomTabBar />
    </div>
  );
}
