import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useEscapeToClose } from "../hooks/useEscapeToClose";
import { useFocusTrap } from "../hooks/useFocusTrap";

const IOS_DISMISSED_AT_KEY = "altax_ios_install_dismissed_at";
/** Dismissal used to be forever — nobody re-discovers a banner they closed once
    months ago, so the install feature effectively vanished. Re-offer after two weeks. */
const REDISMISS_AFTER_MS = 14 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Global, role-agnostic install affordance. Chrome/Edge (desktop and Android) fire
 * beforeinstallprompt, which we capture and trigger from a small banner. iOS Safari
 * never fires that event, so it gets a dismissible instructional banner instead
 * (there's no programmatic install API there — the user has to use the Share sheet
 * themselves); its "Show me how" button opens a numbered step-by-step walkthrough,
 * since the one-line hint alone wasn't enough for non-technical clients. The same
 * steps live permanently in the Guide's "Install the App" section for anyone who
 * dismissed the banner.
 */
export function InstallPrompt() {
  const { t, dir } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosBanner, setShowIosBanner] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEscapeToClose(() => setShowIosSteps(false), showIosSteps);
  const stepsPanelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(stepsPanelRef, showIosSteps);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    if (isIos()) {
      const dismissedAt = Number(localStorage.getItem(IOS_DISMISSED_AT_KEY) || 0);
      if (!dismissedAt || Date.now() - dismissedAt > REDISMISS_AFTER_MS) {
        setShowIosBanner(true);
      }
    }

    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  function dismissIosBanner() {
    localStorage.setItem(IOS_DISMISSED_AT_KEY, String(Date.now()));
    setShowIosBanner(false);
    setShowIosSteps(false);
  }

  if (deferredPrompt) {
    return (
      <div className="install-banner" dir={dir}>
        <span>{t("install.androidPrompt")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={handleInstall}>{t("install.installButton")}</button>
          <button type="button" className="btn btn-sm" onClick={() => setDeferredPrompt(null)}>{t("install.dismiss")}</button>
        </div>
      </div>
    );
  }

  if (showIosBanner) {
    return (
      <>
        <div className="install-banner" dir={dir}>
          <span>{t("install.iosBanner")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowIosSteps(true)}>{t("install.showHow")}</button>
            <button type="button" className="btn btn-sm" onClick={dismissIosBanner}>{t("install.dismiss")}</button>
          </div>
        </div>
        {showIosSteps && (
          <div className="modal-overlay" onClick={() => setShowIosSteps(false)}>
            <div ref={stepsPanelRef} className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="install-steps-title" style={{ maxWidth: 400 }} dir={dir} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2 id="install-steps-title" style={{ fontSize: 16 }}>{t("install.stepsTitle")}</h2>
                <button className="btn btn-sm" onClick={() => setShowIosSteps(false)}>{t("install.close")}</button>
              </div>
              <ol style={{ margin: "8px 0 0", paddingInlineStart: 20, display: "grid", gap: 10, fontSize: 14, lineHeight: 1.55 }}>
                <li>{t("install.step1")}</li>
                <li>{t("install.step2")}</li>
                <li>{t("install.step3")}</li>
              </ol>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>{t("install.stepsNote")}</p>
              <button type="button" className="btn btn-primary" style={{ marginTop: 12, width: "100%" }} onClick={dismissIosBanner}>{t("install.done")}</button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
