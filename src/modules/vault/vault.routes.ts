import { Router, Response, NextFunction } from "express";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth } from "../../common/requireAuth";
import { logAudit } from "../../common/audit";
import { asyncHandler } from "../../common/asyncHandler";
import { encryptValue, decryptValue } from "../../common/encryption";

/**
 * Secure Vault module — Phase 8. Implements Option B from
 * AL_TAX_VAULT_ENCRYPTION_PROPOSAL_20260709.md: real server-side encryption (see
 * src/common/encryption.ts), chosen because v3_Client_Secrets had zero rows in
 * production (confirmed 2026-07-08) — no migration problem, so there was no reason to
 * keep the legacy model, where the server stored whatever "ciphertext" the browser
 * sent with no server-side encryption or validation at all.
 *
 * Ported from alTaxV5VaultUser_ (admin-only, stricter than the general adminOnly
 * flag), alTaxPortalListClientSecrets, alTaxPortalSaveClientSecret,
 * alTaxPortalDeleteClientSecret, alTaxPortalResetClientVault, and the audit helpers
 * alTaxV5VaultAudit_ / alTaxV5VaultDenied_ — every access, success or denial, is
 * logged to v3_secret_access_log, matching legacy's defense-in-depth approach.
 *
 * API contract change from legacy (necessary for Option B): callers now send
 * PLAINTEXT (`secret`), not pre-encrypted payload/salt/iv — the server encrypts.
 * Reading a secret is a separate, individually-audited action (GET .../reveal), not
 * bundled into the list call, so viewing 50 secrets doesn't silently decrypt all 50.
 */
export const vaultRouter = Router();

function idSuffix(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const rand = Math.floor(100 + Math.random() * 900);
  return `${ts}-${rand}`;
}

async function vaultAudit(
  userEmail: string, clientId: string, clientName: string, secretId: string, category: string,
  action: string, field: string, result: "Success" | "Denied", note: string
): Promise<void> {
  await query(
    `INSERT INTO altax.v3_secret_access_log
       (logged_at, user_email, client_id, client_name, secret_id, category, action, field, result, note)
     VALUES (now(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [userEmail, clientId || null, clientName || null, secretId || null, category || null, action, field || null, result, note]
  );
}

/**
 * Every route in this module is admin-only, matching alTaxV5VaultUser_ exactly.
 * Unlike the generic requireRole() middleware, this also logs the denial to
 * v3_secret_access_log (and the general audit log) — mirroring how legacy wraps
 * every vault function in try/catch and calls alTaxV5VaultDenied_ on any
 * rejection, so a non-admin's access attempt is itself part of the vault's
 * audit trail, not just a silent 403. A logging failure never blocks the
 * response, matching alTaxV5VaultDenied_'s own swallowed try/catch.
 */
async function requireVaultAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.user && req.user.role === "admin") return next();

  // req.params isn't populated yet at router.use()-level middleware — every
  // route in this router is /:clientId[/...], so the first path segment is
  // always the clientId (verified against every route defined below).
  const clientId = String(req.path.split("/").filter(Boolean)[0] || "").trim();
  const note = "Only Admin can open the Secure Vault.";
  try {
    await vaultAudit(req.user?.email || "unknown", clientId, "", "", "Secure Vault", "ACCESS_DENIED", "", "Denied", note);
    await logAudit("Secure Vault", "ACCESS_DENIED", clientId, "", "", "", note, req.user?.email || "unknown");
  } catch {
    // Denial logging is best-effort; never block the 403 response on it.
  }
  res.status(403).json({ error: note });
}

vaultRouter.use(requireAuth, requireVaultAdmin);

/**
 * List a client's vault items — metadata only (label, category, jurisdiction, agency,
 * portal URL, last-4 hint, status). Never returns encrypted payloads in bulk.
 */
vaultRouter.get("/:clientId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) {
    await vaultAudit(req.user!.email, clientId, "", "", "", "OPEN_DENIED", "", "Denied", "Client not found.");
    return res.status(404).json({ error: "Client not found." });
  }

  const rows = await query(
    `SELECT secret_id, category, jurisdiction, agency_name, label, portal_url, last4_hint, status,
            created_at, created_by, updated_at, updated_by
       FROM altax.v3_client_secrets
      WHERE client_id = $1 AND lower(status) <> 'deleted'
      ORDER BY category, label`,
    [clientId]
  );

  await vaultAudit(req.user!.email, client.client_id, client.client_name, "", "", "OPEN", "", "Success", "Secure vault opened/listed.");
  res.json({ clientId: client.client_id, clientName: client.client_name, secrets: rows });
}));

/**
 * Create or update a vault item — ported from alTaxPortalSaveClientSecret. Accepts
 * plaintext `secret`; encrypts server-side (encryptValue). Category and label are
 * required, matching legacy's own validation.
 */
vaultRouter.post("/:clientId", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) {
    await vaultAudit(req.user!.email, clientId, "", "", "", "SAVE_DENIED", "", "Denied", "Client not found.");
    return res.status(404).json({ error: "Client not found." });
  }

  const body = req.body || {};
  const category = String(body.category || "").trim();
  const label = String(body.label || "").trim();
  const secret = String(body.secret ?? "");
  if (!category) return res.status(400).json({ error: "Category is required." });
  if (!label) return res.status(400).json({ error: "Label is required." });
  if (!secret) return res.status(400).json({ error: "A secret value is required." });

  const secretId = String(body.secretId || "").trim() || `SEC-${idSuffix()}`;
  const existing = await queryOne<any>(
    `SELECT secret_id FROM altax.v3_client_secrets WHERE secret_id = $1 AND client_id = $2`,
    [secretId, clientId]
  );

  const encryptedPayload = encryptValue(secret);
  const last4 = secret.replace(/\D/g, "").slice(-4) || null;
  const fields = [
    category, String(body.jurisdiction || "").trim() || null, String(body.agencyName || "").trim() || null,
    label, String(body.portalUrl || "").trim() || null, encryptedPayload, last4,
    String(body.status || "Active").trim(), req.user!.email,
  ];

  if (existing) {
    await query(
      `UPDATE altax.v3_client_secrets SET
         category=$3, jurisdiction=$4, agency_name=$5, label=$6, portal_url=$7, encrypted_payload=$8,
         last4_hint=$9, status=$10, updated_at=now(), updated_by=$11
       WHERE secret_id=$1 AND client_id=$2`,
      [secretId, clientId, ...fields]
    );
  } else {
    await query(
      `INSERT INTO altax.v3_client_secrets
         (secret_id, client_id, client_name, category, jurisdiction, agency_name, label, portal_url,
          encrypted_payload, last4_hint, status, created_by, updated_by, source_system, source_record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12,'Node Web App',$1)`,
      [secretId, clientId, client.client_name, ...fields]
    );
  }

  await vaultAudit(req.user!.email, client.client_id, client.client_name, secretId, category,
    existing ? "UPDATE" : "CREATE", "EncryptedPayload", "Success", "Secure vault item saved.");
  await logAudit("Secure Vault", existing ? "UPDATE" : "CREATE", secretId, "ClientID", "", clientId,
    `Encrypted secure vault item saved for ${client.client_name}.`, req.user!.email);

  res.json({ ok: true, secretId });
}));

/**
 * Reveal one secret's plaintext — decrypts server-side, individually audited. This
 * is the ONLY route in this backend that returns decrypted vault content.
 */
vaultRouter.get("/:clientId/:secretId/reveal", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, secretId } = req.params;
  const row = await queryOne<any>(
    `SELECT * FROM altax.v3_client_secrets WHERE secret_id = $1 AND client_id = $2 AND lower(status) <> 'deleted'`,
    [secretId, clientId]
  );
  if (!row) {
    await vaultAudit(req.user!.email, clientId, "", secretId, "", "REVEAL_DENIED", "", "Denied", "Secret not found.");
    return res.status(404).json({ error: "Secure vault item not found." });
  }

  let plaintext: string;
  try {
    plaintext = decryptValue(row.encrypted_payload);
  } catch (err: any) {
    await vaultAudit(req.user!.email, clientId, row.client_name, secretId, row.category, "REVEAL_DENIED", "", "Denied", `Decryption failed: ${err.message}`);
    return res.status(500).json({ error: "Could not decrypt this value." });
  }

  await vaultAudit(req.user!.email, clientId, row.client_name, secretId, row.category, "REVEAL", "EncryptedPayload", "Success", "Secret revealed to admin.");
  await logAudit("Secure Vault", "REVEAL", secretId, "", "", "", `Secret revealed by ${req.user!.email}.`, req.user!.email);

  res.json({ secretId, label: row.label, secret: plaintext });
}));

/**
 * Soft-delete one vault item — ported from alTaxPortalDeleteClientSecret: clears the
 * encrypted payload and hint, sets Status=Deleted with deleted_at/deleted_by. Not a
 * row delete — the audit trail (who created/deleted what, when) stays intact.
 */
vaultRouter.post("/:clientId/:secretId/delete", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId, secretId } = req.params;
  const row = await queryOne<any>(`SELECT * FROM altax.v3_client_secrets WHERE secret_id = $1 AND client_id = $2`, [secretId, clientId]);
  if (!row) return res.status(404).json({ error: "Secure vault item not found." });

  await query(
    `UPDATE altax.v3_client_secrets SET
       encrypted_payload = '', last4_hint = '', status = 'Deleted',
       deleted_at = now(), deleted_by = $3, updated_at = now(), updated_by = $3
     WHERE secret_id = $1 AND client_id = $2`,
    [secretId, clientId, req.user!.email]
  );

  await vaultAudit(req.user!.email, clientId, row.client_name, secretId, row.category, "DELETE", "EncryptedPayload", "Success", "Encrypted payload removed and vault row marked deleted.");
  await logAudit("Secure Vault", "DELETE", secretId, "Status", row.status || "Active", "Deleted",
    `Encrypted vault item deleted for ${row.client_name}.`, req.user!.email);

  res.json({ ok: true, secretId });
}));

/**
 * Reset a client's entire vault — ported from alTaxPortalResetClientVault. Requires
 * typed confirmation ("RESET"), same gate legacy uses. Irreversibly clears every
 * active secret for the client (soft-deletes each, same as the single-item delete).
 */
vaultRouter.post("/:clientId/reset", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const { clientId } = req.params;
  const confirmation = String((req.body || {}).confirmation || "").trim();
  if (confirmation !== "RESET") return res.status(400).json({ error: "Type RESET to confirm vault reset." });

  const client = await queryOne<any>(`SELECT client_id, client_name FROM altax.v3_clients WHERE client_id = $1`, [clientId]);
  if (!client) return res.status(404).json({ error: "Client not found." });

  const result = await query(
    `UPDATE altax.v3_client_secrets SET
       encrypted_payload = '', last4_hint = '', status = 'Deleted',
       deleted_at = now(), deleted_by = $2, updated_at = now(), updated_by = $2
     WHERE client_id = $1 AND lower(status) <> 'deleted'
     RETURNING secret_id`,
    [clientId, req.user!.email]
  );
  const resetCount = result.length;

  await vaultAudit(req.user!.email, client.client_id, client.client_name, "", "Secure Vault", "RESET_VAULT",
    "EncryptedPayload", "Success", `${resetCount} encrypted vault row(s) deleted. Old secrets were not recovered.`);
  await logAudit("Secure Vault", "RESET_VAULT", client.client_id, "EncryptedPayload", "Active", "Deleted",
    `Secure vault reset for ${client.client_name}; ${resetCount} encrypted row(s) deleted.`, req.user!.email);

  res.json({ ok: true, clientId: client.client_id, resetCount });
}));
