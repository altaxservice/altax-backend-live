import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installSpellcheckEnforcement } from './utils/enforceSpellcheck'
import { installFieldSuggestions } from './utils/fieldSuggestions'

installSpellcheckEnforcement()
installFieldSuggestions()

/**
 * Real incident, 2026-09-17: a new deploy's service worker installs and
 * takes control (skipWaiting + clientsClaim are both already set in
 * vite.config.ts) fine in the background, but nothing ever told an
 * ALREADY-OPEN tab to actually reload and pick it up — so a tab kept
 * running the old cached JS bundle indefinitely. Confirmed live: opening
 * the new /kiosk link on a phone that had this app open from before landed
 * on the OLD bundle's routes (no /kiosk route existed yet), which fell
 * through to the login screen — and only fully quitting the browser (the
 * only way to force a truly fresh navigation) fixed it.
 *
 * Fix is deliberately scoped to /kiosk only, not every route: the kiosk
 * screen has no in-progress work to lose (just a roster + PIN pad), so an
 * immediate silent reload the instant a new service worker takes control is
 * strictly an improvement there. The main authenticated app is a different
 * risk — a staff member mid-typing a client note or a payroll form when a
 * routine deploy lands would lose that work to a forced reload. Left as
 * today's existing behavior (picks up the new version on next natural
 * navigation) everywhere outside /kiosk rather than trading one bug for a
 * worse one.
 */
if ("serviceWorker" in navigator && window.location.pathname.startsWith("/kiosk")) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
