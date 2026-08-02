import type { ReactNode } from "react";
import { FirmLogo } from "./FirmLogo";
import { FIRM_LEGAL_NAME, COPYRIGHT } from "../utils/branding";

/**
 * Shared header/footer for every no-login public page (invoice, contract,
 * message, and their loading/error states) — these routes sit outside
 * <ProtectedRoute>/<Layout> in App.tsx, so without this they render as a bare
 * card floating on a blank background with no way to tell which firm sent the
 * link. Every state (loading, error, real content) goes through here so a
 * client never lands on something that looks broken.
 */
export function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--surface)" }}>
      <header style={{ borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <FirmLogo size={32} />
          <span style={{ fontWeight: 800, fontSize: 15 }}>{FIRM_LEGAL_NAME}</span>
        </div>
      </header>
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={{ borderTop: "1px solid var(--line)", padding: "16px 20px", textAlign: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>{COPYRIGHT}</span>
      </footer>
    </div>
  );
}
