import { useState } from "react";
import { resolveFileUrl } from "../api/client";

const LOGO_URL = resolveFileUrl("/firm-settings/logo");

/**
 * The firm's uploaded logo (Firm Settings, admin-only) if one is set, falling
 * back to the plain "AL" text badge otherwise. Hits the public, unauthenticated
 * GET /firm-settings/logo endpoint directly — this needs to render on the
 * pre-login screen, so it can't go through the authed api client.
 */
export function FirmLogo({ size = 40 }: { size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <div className="brand-mark">AL</div>;

  return (
    <img
      src={LOGO_URL}
      alt="Firm logo"
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: "contain", borderRadius: 8 }}
    />
  );
}
