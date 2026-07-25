import { Router, Response, NextFunction } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { encryptValue, decryptValue } from "../../common/encryption";

/**
 * Firm Portal Credentials — the firm's OWN agency logins (EFTPS, MD Tax Connect,
 * SSA BSO, state unemployment portals, ...), as opposed to the client-scoped
 * Secure Vault in vault.routes.ts.
 *
 * Deliberately a separate table (v3_firm_portals) rather than v3_client_secrets
 * rows with a NULL client_id: a portal login is a *pair* (user ID + password)
 * plus a URL, while a vault secret is a single opaque value. Encoding two fields
 * into one encrypted blob would break the existing single-value reveal contract.
 *
 * Everything else is shared with the client vault on purpose: the same AES key
 * (encryptValue/decryptValue), the same admin-only gate, and the same
 * v3_secret_access_log audit trail — so "who looked at the EFTPS password, when"
 * lands in the exact same report the client vault already feeds.
 */
export const firmPortalsRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${ts}-${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Same audit trail as vault.routes.ts's vaultAudit, with client_id left NULL
 * (firm-level). secret_id also stays NULL: it carries a real FK to
 * v3_client_secrets, so a portal_id there would be rejected — the portal id
 * rides in the note text instead.
 */
async function portalAudit(
  userEmail: string, portalId: string, portalName: string,
  action: string, field: string, result: "Success" | "Denied", note: string
): Promise<void> {
  const withId = portalId ? `[${portalId}] ${note}` : note;
  await query(
    `INSERT INTO altax.v3_secret_access_log
       (logged_at, user_email, client_id, client_name, secret_id, category, action, field, result, note)
     VALUES (now(),$1,NULL,$2,NULL,'Firm Portal',$3,$4,$5,$6)`,
    [userEmail, portalName || null, action, field || null, result, withId.slice(0, 255)]
  );
}

async function requireFirmVaultAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user && req.user.role === "admin") return next();
  const note = "Only Admin can open Firm Portal Credentials.";
  try {
    await portalAudit(req.user?.email || "unknown", "", "", "ACCESS_DENIED", "", "Denied", note);
    await logAudit("Firm Portals", "ACCESS_DENIED", "", "", "", "", note, req.user?.email || "unknown");
  } catch {
    // Denial logging is best-effort; never block the 403 response on it.
  }
  res.status(403).json({ error: note });
}

firmPortalsRouter.use(requireAuth, requireFirmVaultAdmin);

/** List portals — metadata + username, never the password. */
firmPortalsRouter.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const rows = await query(
    `SELECT portal_id, portal_name, category, jurisdiction, agency_name, portal_url, username,
            (encrypted_notes IS NOT NULL AND encrypted_notes <> '') AS has_notes,
            status, created_at, created_by, updated_at, updated_by
       FROM altax.v3_firm_portals
      WHERE lower(status) <> 'deleted'
      ORDER BY COALESCE(category,'~'), portal_name`
  );
  await portalAudit(req.user!.email, "", "", "OPEN", "", "Success", "Firm portal list opened.");
  res.json({ portals: rows });
}));

/** Create or update one portal. Password/notes arrive as plaintext and are encrypted here. */
firmPortalsRouter.post("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = req.body || {};
  const portalName = String(body.portalName || "").trim();
  if (!portalName) return res.status(400).json({ error: "Portal name is required." });

  const portalId = String(body.portalId || "").trim() || `FPT-${idSuffix()}`;
  const existing = await queryOne<any>(
    `SELECT portal_id, encrypted_password, encrypted_notes FROM altax.v3_firm_portals WHERE portal_id = $1`,
    [portalId]
  );

  // On edit, an empty password field means "leave it alone" — otherwise every
  // metadata tweak would silently wipe the credential the admin came here for.
  const rawPassword = String(body.password ?? "");
  const encryptedPassword = rawPassword
    ? encryptValue(rawPassword)
    : (existing ? existing.encrypted_password : null);
  // Notes aren't a credential, so an explicitly-sent empty string does mean
  // "clear it"; only an omitted field leaves the stored value untouched.
  const encryptedNotes = body.notes === undefined
    ? (existing ? existing.encrypted_notes : null)
    : (String(body.notes) ? encryptValue(String(body.notes)) : "");

  const fields = [
    portalName,
    String(body.category || "").trim() || null,
    String(body.jurisdiction || "").trim() || null,
    String(body.agencyName || "").trim() || null,
    String(body.portalUrl || "").trim() || null,
    String(body.username || "").trim() || null,
    encryptedPassword,
    encryptedNotes,
    String(body.status || "Active").trim(),
    req.user!.email,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_firm_portals SET
         portal_name=$2, category=$3, jurisdiction=$4, agency_name=$5, portal_url=$6,
         username=$7, encrypted_password=$8, encrypted_notes=$9, status=$10,
         updated_at=now(), updated_by=$11
       WHERE portal_id=$1`,
      [portalId, ...fields]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_firm_portals
         (portal_id, portal_name, category, jurisdiction, agency_name, portal_url,
          username, encrypted_password, encrypted_notes, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
      [portalId, ...fields]
    );
  }

  await portalAudit(req.user!.email, portalId, portalName, existing ? "UPDATE" : "CREATE",
    "EncryptedPassword", "Success", "Firm portal credential saved.");
  await logAudit("Firm Portals", existing ? "UPDATE" : "CREATE", portalId, "", "", "",
    `Firm portal credential saved: ${portalName}.`, req.user!.email);

  res.json({ ok: true, portalId });
}));

/** Reveal one portal's password (and notes) — the only route that decrypts. Individually audited. */
firmPortalsRouter.get("/:portalId/reveal", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { portalId } = req.params;
  const row = await queryOne<any>(
    `SELECT * FROM altax.v3_firm_portals WHERE portal_id = $1 AND lower(status) <> 'deleted'`,
    [portalId]
  );
  if (!row) {
    await portalAudit(req.user!.email, portalId, "", "REVEAL_DENIED", "", "Denied", "Portal not found.");
    return res.status(404).json({ error: "Portal credential not found." });
  }

  let password = "";
  let notes = "";
  try {
    if (row.encrypted_password) password = decryptValue(row.encrypted_password);
    if (row.encrypted_notes) notes = decryptValue(row.encrypted_notes);
  } catch (err: any) {
    await portalAudit(req.user!.email, portalId, row.portal_name, "REVEAL_DENIED", "", "Denied", `Decryption failed: ${err.message}`);
    return res.status(500).json({ error: "Could not decrypt this credential." });
  }

  await portalAudit(req.user!.email, portalId, row.portal_name, "REVEAL", "EncryptedPassword", "Success", "Firm portal credential revealed to admin.");
  await logAudit("Firm Portals", "REVEAL", portalId, "", "", "", `Firm portal credential revealed by ${req.user!.email}.`, req.user!.email);

  res.json({ portalId, portalName: row.portal_name, username: row.username || "", password, notes });
}));

/** Soft-delete — clears the credential, keeps the row so the audit trail stays whole. */
firmPortalsRouter.post("/:portalId/delete", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { portalId } = req.params;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_firm_portals WHERE portal_id = $1`, [portalId]);
  if (!row) return res.status(404).json({ error: "Portal credential not found." });

  await query(
    `UPDATE altax.v3_firm_portals SET
       encrypted_password = '', encrypted_notes = '', status = 'Deleted',
       deleted_at = now(), deleted_by = $2, updated_at = now(), updated_by = $2
     WHERE portal_id = $1`,
    [portalId, req.user!.email]
  );

  await portalAudit(req.user!.email, portalId, row.portal_name, "DELETE", "EncryptedPassword", "Success", "Firm portal credential deleted.");
  await logAudit("Firm Portals", "DELETE", portalId, "Status", row.status || "Active", "Deleted",
    `Firm portal credential deleted: ${row.portal_name}.`, req.user!.email);

  res.json({ ok: true, portalId });
}));
