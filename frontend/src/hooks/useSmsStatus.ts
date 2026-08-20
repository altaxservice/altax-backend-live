import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { WebOptions } from "../api/types2";

/**
 * Whether Twilio is actually connected server-side — SMS/WhatsApp reminder
 * settings, channel pickers, and consent toggles used to offer these options
 * with no way to tell they were silently failing every send (TWILIO_* env
 * vars unset, caught by a "best-effort" try/catch with nothing surfaced).
 * Module-level cache: this almost never changes mid-session, and several
 * pages/components need it, so one fetch is shared rather than one per mount.
 */
let cached: { smsConfigured: boolean; whatsappConfigured: boolean } | null = null;
let inFlight: Promise<{ smsConfigured: boolean; whatsappConfigured: boolean }> | null = null;

function load(): Promise<{ smsConfigured: boolean; whatsappConfigured: boolean }> {
  if (cached) return Promise.resolve(cached);
  if (!inFlight) {
    inFlight = api.get<WebOptions>("/system/options")
      .then((r) => { cached = { smsConfigured: r.smsConfigured, whatsappConfigured: r.whatsappConfigured }; return cached; })
      .catch(() => ({ smsConfigured: true, whatsappConfigured: true })); // fail open — don't block a real send attempt on a status-check error
  }
  return inFlight;
}

export function useSmsStatus(): { smsConfigured: boolean; whatsappConfigured: boolean; loaded: boolean } {
  const [state, setState] = useState(() => cached);
  useEffect(() => {
    if (cached) return;
    let live = true;
    load().then((r) => { if (live) setState(r); });
    return () => { live = false; };
  }, []);
  return { smsConfigured: state?.smsConfigured ?? true, whatsappConfigured: state?.whatsappConfigured ?? true, loaded: state !== null };
}
