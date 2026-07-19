/**
 * Public, no-login contract view + e-sign page — the "share link" destination,
 * same pattern as publicInvoice.routes.ts: access gated entirely by knowing the
 * opaque share_token (24 random bytes), not by a portal account, so a brand-new
 * client can review and sign an engagement letter before a portal account even
 * exists for them (matches the real intake workflow — the contract is usually
 * signed before the portal invite goes out).
 */
import { Router, Request, Response } from "express";
import { query, queryOne } from "../../config/db";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { generateContractPdf } from "./contractPdf";

export const publicContractRouter = Router();

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE share_token = $1`, [token]);
}

publicContractRouter.get("/:token", asyncHandler(async (req: Request, res: Response) => {
  const contract = await findByToken(req.params.token);
  if (!contract) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (contract.status === "Void") return res.status(410).json({ error: "This contract has been voided and is no longer available for signature." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  res.json({
    contract: {
      contract_id: contract.contract_id, title: contract.title, rendered_body: contract.rendered_body,
      effective_date: contract.effective_date, status: contract.status, client_name: client?.client_name || "",
      signer_name: contract.signer_name, signed_at: contract.signed_at,
    },
  });
}));

/** Click-to-sign: typed name + explicit agreement, with timestamp + IP captured as the audit trail — the standard basic e-signature pattern (ESIGN Act does not require a hand-drawn signature). */
publicContractRouter.post("/:token/sign", asyncHandler(async (req: Request, res: Response) => {
  const contract = await findByToken(req.params.token);
  if (!contract) return res.status(404).json({ error: "This link is invalid or has expired." });
  if (contract.status === "Void") return res.status(410).json({ error: "This contract has been voided and can no longer be signed." });
  if (contract.status === "Signed") return res.status(400).json({ error: "This contract has already been signed." });

  const body = req.body || {};
  const signerName = String(body.signerName || "").trim();
  const signerTitle = String(body.signerTitle || "").trim() || null;
  if (!signerName) return res.status(400).json({ error: "Please type your full legal name to sign." });
  if (!body.agreed) return res.status(400).json({ error: "Please confirm you have read and agree to the terms." });

  const signerIp = String(req.ip || req.socket.remoteAddress || "").slice(0, 64) || null;
  const signerUserAgent = String(req.headers["user-agent"] || "").slice(0, 500) || null;

  await query(
    `UPDATE altax.v3_client_contracts
        SET status='Signed', signer_name=$2, signer_title=$3, agreed=true, signed_at=now(),
            signer_ip=$4, signer_user_agent=$5, updated_at=now()
      WHERE contract_id=$1`,
    [contract.contract_id, signerName, signerTitle, signerIp, signerUserAgent]
  );
  await logAudit("Contracts", "SIGN", contract.contract_id, "status", contract.status, "Signed",
    `Signed electronically by "${signerName}" from IP ${signerIp || "unknown"}.`, signerName);

  res.json({ ok: true });
}));

publicContractRouter.get("/:token/pdf", asyncHandler(async (req: Request, res: Response) => {
  const contract = await findByToken(req.params.token);
  if (!contract) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  const bytes = await generateContractPdf({
    contractId: contract.contract_id, title: contract.title, clientName: client?.client_name || "", clientId: contract.client_id,
    renderedBody: contract.rendered_body, effectiveDate: contract.effective_date, status: contract.status,
    signerName: contract.signer_name, signerTitle: contract.signer_title, signedAt: contract.signed_at, signerIp: contract.signer_ip,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${contract.contract_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));
