import type { CSSProperties } from "react";
import { suggestFix } from "../utils/errorHelp";

/**
 * An error message plus what to do about it.
 *
 * Replaces the bare error-banner divs this app used everywhere. Those said what
 * failed and stopped there, which leaves non-technical staff and clients with
 * nothing to act on — "You do not have access to this client" reads as "the app
 * is broken" unless it also says who can grant that access.
 *
 * The suggestion is rendered inline rather than in a hover tooltip on purpose:
 * a tooltip is invisible on touch devices, invisible to screen readers, and
 * undiscoverable to anyone who does not think to hover — which is exactly the
 * person who is already stuck.
 *
 * When no rule matches, this renders exactly what the plain banner did, so a
 * missing suggestion is never worse than before.
 */
export function ErrorBanner({ error, className, style }: {
  error: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  if (!error) return null;
  const fix = suggestFix(error);

  return (
    <div className={`error-banner ${className || ""}`.trim()} style={style} role="alert">
      <div>{error}</div>
      {fix && (
        <div className="error-banner-fix">
          <strong>How to fix:</strong> {fix}
        </div>
      )}
    </div>
  );
}
