// usage: npx ts-node --transpile-only scripts/docAudit/e2e.ts   (uses the dev database; removes everything it creates)
// For every document: start with a real client's prefill -> fill the required questions plausibly -> preview (nothing missing, no failed
// checks) -> create -> download the PDF, Word and printable page -> read the signer suggestion -> delete the rows it made.
import "dotenv/config";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { pool, query } from "../../src/config/db";
import { docBuilderRouter } from "../../src/modules/docBuilder/docBuilder.routes";
import { contractsRouter } from "../../src/modules/contracts/contracts.routes";
import { DOC_TEMPLATES } from "../../src/modules/docBuilder/templates";
import { allQuestions, condMet, type Question } from "../../src/modules/docBuilder/engine";

const only = new Set((process.env.ONLY || "").split(",").filter(Boolean));
(async () => {
  const u = (await query<any>(`SELECT user_id,email,token_version FROM altax.v3_users WHERE role ILIKE 'admin' LIMIT 1`))[0];
  const client = (await query<any>(`SELECT client_id FROM altax.v3_clients WHERE client_name IS NOT NULL AND address IS NOT NULL ORDER BY client_id LIMIT 1`))[0].client_id;
  const tok = jwt.sign({ sub: u.user_id, role: "admin", email: u.email, tv: u.token_version }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  const app = express(); app.use(express.json({ limit: "12mb" })); app.use("/doc-builder", docBuilderRouter); app.use("/contracts", contractsRouter);
  const srv = http.createServer(app).listen(0); const port = (srv.address() as any).port;
  const call = async (m: string, path: string, body?: any) => fetch(`http://127.0.0.1:${port}${path}`, { method: m, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const made: { contractId: string; docId: string }[] = [];
  let ok = 0; const bad: string[] = [];
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);
  for (const t of DOC_TEMPLATES as any[]) {
    if (only.size && !only.has(t.key)) continue;
    try {
      const start: any = await (await call("GET", `/doc-builder/templates/${t.key}/start?clientId=${client}`)).json();
      const a: Record<string, any> = { ...start.answers };
      let d = 0;
      const fill = (q: Question, tg: Record<string, any>) => {
        if (!condMet(q.showIf, tg) && !(q.showIf && tg === a)) { /* filled below once visible */ }
        const has = tg[q.id] !== undefined && tg[q.id] !== "" && !(Array.isArray(tg[q.id]) && !tg[q.id].length);
        if (has && q.type !== "list") return;
        if (q.type === "list") { tg[q.id] = [1, 2].map(() => { const r: Record<string, any> = {}; for (const f of q.fields || []) fill(f, r); return r; }); return; }
        if (q.type === "yesno") tg[q.id] = Boolean(q.default);
        else if (q.type === "select") tg[q.id] = q.default !== undefined ? String(q.default) : q.options![0].value;
        else if (q.type === "date") { if (q.id === "masterLeaseEnd") tg[q.id] = day(3000); else if (/^(contractDate|agreementDate|leaseDate|masterLeaseDate|formationDate)$/.test(q.id)) tg[q.id] = day(-400); else { d += 30; tg[q.id] = day(d); } }
        else if (q.type === "money") tg[q.id] = /nsf|returnFee|late/i.test(q.id) ? "25" : "1000";
        else if (q.type === "number") tg[q.id] = q.id === "before" ? "100" : /percent|share/i.test(q.id) ? "50" : /rate|interest/i.test(q.id) ? "0.5" : "5";
        else tg[q.id] = q.type === "textarea" ? "Sample details for this document." : "Sample text";
      };
      for (const q of allQuestions(t)) fill(q, a);
      const pv: any = await (await call("POST", "/doc-builder/preview", { templateKey: t.key, answers: a, lang: "en" })).json();
      if ((pv.missing || []).length) { bad.push(`${t.key}: still missing after filling — ${pv.missing.slice(0, 3).join("; ")}`); continue; }
      if ((pv.problems || []).length) { bad.push(`${t.key}: checks fail with plausible values — ${pv.problems.slice(0, 2).join("; ")}`); continue; }
      const cr = await call("POST", "/doc-builder/create", { templateKey: t.key, answers: a, lang: "en", clientId: client });
      const cj: any = await cr.json(); if (!cr.ok) { bad.push(`${t.key}: create failed — ${cj.error}`); continue; }
      made.push({ contractId: cj.contractId, docId: cj.docId });
      const pdf = await call("GET", `/contracts/${cj.contractId}/pdf`); const pb = Buffer.from(await pdf.arrayBuffer());
      const dx = await call("GET", `/contracts/${cj.contractId}/docx`); const db = Buffer.from(await dx.arrayBuffer());
      const ht = await call("GET", `/contracts/${cj.contractId}/html`); const hb = await ht.text();
      const sg: any = await (await call("GET", `/doc-builder/docs/${cj.docId}/signing`)).json();
      if (!pdf.ok || pb.subarray(0, 5).toString() !== "%PDF-") { bad.push(`${t.key}: PDF failed`); continue; }
      if (!dx.ok || db.subarray(0, 2).toString() !== "PK") { bad.push(`${t.key}: Word failed`); continue; }
      if (!ht.ok || !hb.includes("<html")) { bad.push(`${t.key}: print page failed`); continue; }
      if (!sg || !Array.isArray(sg.signers ?? sg.suggested ?? [])) { bad.push(`${t.key}: signing info failed`); continue; }
      ok++;
    } catch (e: any) { bad.push(`${t.key}: ${e.message}`); }
  }
  for (const m of made) { await query(`DELETE FROM altax.v3_doc_signers WHERE contract_id = $1`, [m.contractId]).catch(() => {}); await query(`DELETE FROM altax.v3_doc_builder_docs WHERE doc_id = $1`, [m.docId]).catch(() => {}); await query(`DELETE FROM altax.v3_client_contracts WHERE contract_id = $1`, [m.contractId]).catch(() => {}); }
  console.log(`documents completed end to end: ${ok} of ${only.size || DOC_TEMPLATES.length}`); for (const b of bad) console.log("PROBLEM", b);
  srv.close(); await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
