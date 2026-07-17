/**
 * Composes the legacy single-line `address` TEXT column from structured
 * street/city/state/zip parts, so every existing reader (W-2/1099 PDFs, invoice
 * ship-to defaults, client mailings) keeps working unchanged when a record is
 * edited via the newer structured fields instead of the old free-text box.
 */
export function composeAddress(parts: {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
}): string | null {
  const street = String(parts.street || "").trim();
  const city = String(parts.city || "").trim();
  const state = String(parts.state || "").trim();
  const zip = String(parts.zip || "").trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const composed = [street, cityStateZip].filter(Boolean).join("\n");
  return composed || null;
}
