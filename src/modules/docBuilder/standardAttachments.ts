import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { query, queryOne } from "../../config/db";

/**
 * Official PDFs the firm keeps once and the app appends to the PDF of certain documents. Today: the Maryland Tenants' Bill of Rights,
 * which Maryland requires to be attached to every residential lease and which the state reissues each October 1.
 */
export interface AttachmentSpec {
  key: string;
  title: string;
  /** Document Builder template keys whose PDF gets this attachment. */
  templates: string[];
  /** The edition expires this many months after its "valid from" date (the state reissues it yearly). */
  renewMonths: number;
  /** Where to download the current edition. */
  sourceUrl: string;
  /** Plain-words reason shown next to the setting. */
  why: string;
}

export const ATTACHMENT_SPECS: AttachmentSpec[] = [
  {
    key: "md_tenants_bill_of_rights",
    title: "Maryland Tenants' Bill of Rights",
    templates: ["lease_residential"],
    renewMonths: 12,
    sourceUrl: "https://dhcd.maryland.gov/Tenant-Landlord-Affairs/Pages/Tenants-Bill-of-Rights.aspx",
    why: "Maryland landlords must attach the latest edition to every residential lease. The state publishes a new edition each October 1.",
  },
];

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

export function specFor(key: string): AttachmentSpec | undefined {
  return ATTACHMENT_SPECS.find((s) => s.key === key);
}

export interface AttachmentStatus {
  key: string; title: string; why: string; sourceUrl: string; templates: string[];
  uploaded: boolean; fileName: string | null; editionLabel: string | null; validFrom: string | null; expiresOn: string | null;
  pages: number | null; uploadedBy: string | null; uploadedAt: string | null;
  /** The uploaded edition is past its renewal date — a newer one has been published. */
  expired: boolean;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function expiryOf(validFrom: string | null, months: number): string | null {
  if (!validFrom) return null;
  const d = new Date(`${validFrom}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + months);
  return isoDay(d);
}

export async function attachmentStatuses(now = new Date()): Promise<AttachmentStatus[]> {
  const rows = await query<any>(`SELECT attach_key, file_name, edition_label, valid_from::text AS valid_from, page_count, uploaded_by, uploaded_at FROM altax.v3_standard_attachments`);
  const byKey = new Map(rows.map((r: any) => [r.attach_key, r]));
  return ATTACHMENT_SPECS.map((s) => {
    const r: any = byKey.get(s.key);
    const expiresOn = r ? expiryOf(r.valid_from, s.renewMonths) : null;
    return {
      key: s.key, title: s.title, why: s.why, sourceUrl: s.sourceUrl, templates: s.templates,
      uploaded: Boolean(r), fileName: r?.file_name ?? null, editionLabel: r?.edition_label || null, validFrom: r?.valid_from ?? null, expiresOn,
      pages: r?.page_count ?? null, uploadedBy: r?.uploaded_by ?? null, uploadedAt: r?.uploaded_at ? new Date(r.uploaded_at).toISOString() : null,
      expired: Boolean(expiresOn && isoDay(now) >= expiresOn),
    };
  });
}

/** Checks the bytes are a real, readable PDF and returns what is needed to store it. */
export async function inspectPdf(bytes: Buffer): Promise<{ pages: number; sha256: string }> {
  if (bytes.length < 100 || bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("That file is not a PDF.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error("That PDF is larger than 8 MB.");
  let doc: PDFDocument;
  try { doc = await PDFDocument.load(bytes); } catch { throw new Error("That PDF could not be read. It may be password-protected or damaged."); }
  const pages = doc.getPageCount();
  if (pages < 1) throw new Error("That PDF has no pages.");
  return { pages, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}

/** Appends every standard attachment that belongs to this document type after its last page. A missing or unreadable attachment never breaks the document itself. */
export async function appendStandardAttachments(pdf: Uint8Array, templateKey: string | null | undefined): Promise<Uint8Array> {
  const keys = ATTACHMENT_SPECS.filter((s) => templateKey && s.templates.includes(templateKey)).map((s) => s.key);
  if (!keys.length) return pdf;
  const rows = await query<{ attach_key: string; content: Buffer }>(`SELECT attach_key, content FROM altax.v3_standard_attachments WHERE attach_key = ANY($1)`, [keys]).catch(() => []);
  if (!rows.length) return pdf;
  const out = await PDFDocument.load(pdf);
  let added = 0;
  for (const k of keys) {
    const r = rows.find((x) => x.attach_key === k);
    if (!r) continue;
    try {
      const src = await PDFDocument.load(r.content);
      (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p));
      added += 1;
    } catch { /* skip an unreadable attachment */ }
  }
  return added ? out.save() : pdf;
}

/** The template key behind a saved Document Builder document (its contract's service key is "doc_<template>"). */
export function templateKeyOfService(serviceKey: string | null | undefined): string | null {
  const s = String(serviceKey || "");
  return s.startsWith("doc_") ? s.slice(4) : null;
}

export async function templateKeyOfContract(contractId: string): Promise<string | null> {
  const r = await queryOne<any>(`SELECT service_key FROM altax.v3_client_contracts WHERE contract_id = $1`, [contractId]);
  return templateKeyOfService(r?.service_key);
}
