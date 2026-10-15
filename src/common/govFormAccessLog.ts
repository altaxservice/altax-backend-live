import { queryOne } from "../config/db";
import { logAudit } from "./audit";

/**
 * Access log for electronic Form W-4 / W-9 data.
 *
 * Treas. Reg. 31.3402(f)(5)-1(c)(2)(i): an electronic W-4 system "must document all occasions of
 * employee access that result in the furnishing of a Form W-4" and must make it reasonably certain
 * who is accessing it; the Instructions for the Requester of Form W-9 (electronic submission) ask for
 * the same kind of record. The firm keeps one audit row (v3_audit_log) for EVERY time a W-4 or W-9
 * filing's content is returned by the API - JSON view or PDF bytes, staff or employee/client, including
 * a signed copy fetched through the Documents download route:
 *
 *   module "Tools", action "VIEW" (the filing's data was returned) or "DOWNLOAD" (the PDF/file bytes
 *   were returned), record_id = filing id, new_value = form type (W4 / W9), user_email = who, and the
 *   note carries role + which route. SSNs, form_data and file contents are NEVER written to the log.
 *
 * Logging is awaited but swallows every error: an audit-log failure must never break the response
 * the person asked for (the same best-effort rule logClientActivity uses).
 */

export type GovFormActor = { email?: string | null; role?: string | null } | null | undefined;

const LOGGED_FORM_TYPES = new Set(["W4", "W9"]);

export function isLoggedGovFormType(formType: unknown): boolean {
  return LOGGED_FORM_TYPES.has(String(formType || ""));
}

export async function logGovFormAccess(
  filing: { filing_id?: string | null; form_type?: string | null } | null | undefined,
  action: "VIEW" | "DOWNLOAD",
  actor: GovFormActor,
  via: string
): Promise<void> {
  try {
    if (!filing?.filing_id || !isLoggedGovFormType(filing.form_type)) return;
    const email = actor?.email || "unknown";
    const role = actor?.role || "unknown";
    await logAudit(
      "Tools", action, String(filing.filing_id), "form_type", "", String(filing.form_type),
      `${filing.form_type} ${action === "VIEW" ? "viewed" : "downloaded"} by ${email} (role: ${role}) via ${via}.`,
      email
    );
  } catch {
    /* best-effort - never block or fail the response over an access-log row */
  }
}

/** Logs a VIEW for each W-4/W-9 row in a list response (one audit row per filing returned). */
export async function logGovFormListAccess(
  filings: Array<{ filing_id?: string | null; form_type?: string | null }>,
  actor: GovFormActor,
  via: string
): Promise<void> {
  for (const f of filings) await logGovFormAccess(f, "VIEW", actor, via);
}

/**
 * For routes that serve a stored file by upload id (Documents download): if that upload is the signed
 * copy of a W-4/W-9 filing, log a DOWNLOAD for that filing. One small lookup on a table of a few
 * hundred rows; any failure is swallowed.
 */
export async function logGovFormUploadAccess(uploadId: string, actor: GovFormActor, via: string): Promise<void> {
  try {
    const filing = await queryOne<any>(
      `SELECT filing_id, form_type FROM altax.v3_gov_form_filings WHERE attached_upload_id = $1 AND form_type IN ('W4','W9') LIMIT 1`,
      [uploadId]
    );
    if (filing) await logGovFormAccess(filing, "DOWNLOAD", actor, via);
  } catch {
    /* best-effort */
  }
}
