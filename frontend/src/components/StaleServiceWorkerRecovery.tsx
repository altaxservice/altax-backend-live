import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";

/**
 * Self-heals the exact bug reported live: a browser/device that had this PWA's
 * service worker registered BEFORE a given public marketing/booking path (e.g.
 * /book, /manage-appointment) was added to its navigateFallbackDenylist keeps
 * that OLD worker until it happens to get a normal update check — until then,
 * every navigation to that path is wrongly served this app's own shell instead
 * of the real marketing page, which (having no matching route) falls through
 * to this catch-all and would otherwise just bounce to /login. That's exactly
 * what a client tapping a booking-confirmation link from an in-app browser
 * (Messages/Mail's embedded Safari, which shares the system WebKit cache) hit —
 * confirmed live: the same link worked instantly in a fresh private tab.
 *
 * Rather than requiring every affected visitor to manually clear site data,
 * detect the mismatch here — a known marketing path with no SPA route — and
 * unregister the stale worker + force one real network reload of the exact
 * same URL. That reload can no longer be intercepted (no worker left to do
 * it), so it lands on the real page automatically, once, with no user action.
 * A sessionStorage guard prevents a retry loop if unregistering doesn't help
 * for some other reason — falls back to the normal dashboard redirect then.
 */
const MARKETING_PATHS = new Set([
  "/", "/about", "/services", "/resources", "/contact", "/book", "/manage-appointment",
  "/privacy", "/sms-terms", "/accessibility",
]);

function isKnownMarketingPath(pathname: string): boolean {
  if (MARKETING_PATHS.has(pathname)) return true;
  if (pathname === "/news" || pathname.startsWith("/news/")) return true;
  return false;
}

/**
 * Same failure mode as the marketing paths above, for a different reason: these
 * are real binary "Download PDF" links (vite.config.ts's navigateFallbackDenylist
 * has the matching entries) rather than missing marketing routes, but a worker
 * registered BEFORE a given entry was added still intercepts it until that worker
 * happens to update on its own — confirmed live for MD Sales Tax's public
 * acknowledge page (a client's already-stale worker served the login picker
 * instead of the PDF even though both the denylist and src/server.ts's catch-all
 * were otherwise correct). Recovering here self-heals on the very next click
 * instead of waiting on the worker's own update cycle.
 */
const KNOWN_PUBLIC_DOWNLOAD_PATTERNS = [
  /^\/public\/eftps-deposits\/[^/]+\/pdf$/,
  /^\/public\/md-filing\/[^/]+\/pdf$/,
  /^\/public\/form941\/[^/]+\/pdf$/,
  // Contracts/invoices use a different (plural) prefix than their own SPA
  // page routes (singular /public/contract, /public/invoice), so a broad
  // prefix match here can't shadow those — same reasoning as the equally
  // broad entries already in vite.config.ts's denylist for these two.
  /^\/public\/contracts\//,
  /^\/public\/invoices\//,
  /^\/documents\/uploads\/[^/]+\/download$/,
];

function isKnownRecoverablePath(pathname: string): boolean {
  return isKnownMarketingPath(pathname) || KNOWN_PUBLIC_DOWNLOAD_PATTERNS.some((re) => re.test(pathname));
}

const RECOVERY_FLAG = "altax_sw_recovery_attempted";

export function StaleServiceWorkerRecovery() {
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    const { pathname, search } = window.location;
    if (!isKnownRecoverablePath(pathname)) return;
    if (!("serviceWorker" in navigator)) return;
    if (sessionStorage.getItem(RECOVERY_FLAG)) return; // already tried once this session — don't loop

    setRecovering(true);
    sessionStorage.setItem(RECOVERY_FLAG, "1");

    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        // Best-effort — even a failed unregister still gets one real reload attempt below.
      } finally {
        window.location.replace(pathname + search);
      }
    })();
  }, []);

  if (recovering) return null; // reload is already in flight
  return <Navigate to="/dashboard" replace />;
}
