import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";

const IOS_DISMISSED_KEY = "altax_ios_install_dismissed";

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
 * never fires that event, so it gets a one-time dismissible instructional banner
 * instead (there's no programmatic install API there — the user has to use the
 * Share sheet themselves).
 */
export function InstallPrompt() {
  const { t } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosBanner, setShowIosBanner] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    if (isIos() && localStorage.getItem(IOS_DISMISSED_KEY) !== "1") {
      setShowIosBanner(true);
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
    localStorage.setItem(IOS_DISMISSED_KEY, "1");
    setShowIosBanner(false);
  }

  if (deferredPrompt) {
    return (
      <div className="install-banner">
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
      <div className="install-banner">
        <span>{t("install.iosPrompt")}</span>
        <button type="button" className="btn btn-sm" onClick={dismissIosBanner}>{t("install.dismiss")}</button>
      </div>
    );
  }

  return null;
}
