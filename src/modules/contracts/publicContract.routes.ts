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
import { rateLimit } from "../../common/rateLimit";
import { generateContractPdf } from "./contractPdf";

export const publicContractRouter = Router();

// Defense in depth alongside the token's own entropy (24 random bytes) — matches
// the dedicated limiters on the other public share-link routers.
const contractLimiter = rateLimit({ name: "public-contract", windowMs: 15 * 60 * 1000, max: 20 });

async function findByToken(token: string) {
  return queryOne<any>(`SELECT * FROM altax.v3_client_contracts WHERE share_token = $1`, [token]);
}

publicContractRouter.get("/:token", contractLimiter, asyncHandler(async (req: Request, res: Response) => {
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
publicContractRouter.post("/:token/sign", contractLimiter, asyncHandler(async (req: Request, res: Response) => {
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

  // Hard Audit finding, 2026-08-29: the status check above and this UPDATE
  // weren't atomic — two concurrent submissions on the same link (forwarded
  // and opened twice, or a slow request retried) could both read "not yet
  // signed" before either committed, both pass, and both write. The second
  // one silently overwrote the first signer's name/IP/timestamp, the entire
  // evidentiary point of an e-signature record. The WHERE clause here makes
  // the claim atomic: only the request that actually flips status away from
  // Sent can win, and RETURNING tells us whether this request was the one.
  const claimed = await query<{ contract_id: string }>(
    `UPDATE altax.v3_client_contracts
        SET status='Signed', signer_name=$2, signer_title=$3, agreed=true, signed_at=now(),
            signer_ip=$4, signer_user_agent=$5, updated_at=now()
      WHERE contract_id=$1 AND status NOT IN ('Signed', 'Void')
      RETURNING contract_id`,
    [contract.contract_id, signerName, signerTitle, signerIp, signerUserAgent]
  );
  if (claimed.length === 0) {
    // Someone else's request won the race (or the status changed between our
    // read above and this write) — report the real current state rather than
    // a stale one.
    const current = await findByToken(req.params.token);
    if (current?.status === "Void") return res.status(410).json({ error: "This contract has been voided and can no longer be signed." });
    return res.status(400).json({ error: "This contract has already been signed." });
  }

  await logAudit("Contracts", "SIGN", contract.contract_id, "status", contract.status, "Signed",
    `Signed electronically by "${signerName}" from IP ${signerIp || "unknown"}.`, signerName);

  res.json({ ok: true });
}));

publicContractRouter.get("/:token/pdf", contractLimiter, asyncHandler(async (req: Request, res: Response) => {
  const contract = await findByToken(req.params.token);
  if (!contract) return res.status(404).json({ error: "This link is invalid or has expired." });

  const client = await queryOne<any>(`SELECT client_name FROM altax.v3_clients WHERE client_id = $1`, [contract.client_id]);
  const bytes = await generateContractPdf({
    contractId: contract.contract_id, title: contract.title, clientName: client?.client_name || "", clientId: contract.client_id,
    renderedBody: contract.rendered_body, effectiveDate: contract.effective_date, status: contract.status,
    signerName: contract.signer_name, signerTitle: contract.signer_title, signedAt: contract.signed_at, signerIp: contract.signer_ip,
    signatureMethod: contract.signature_method, recordedBy: contract.recorded_by,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${contract.contract_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));
