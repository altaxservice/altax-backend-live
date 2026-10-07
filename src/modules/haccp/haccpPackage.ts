/**
 * The health permit "submission package": attachments (cut sheets, certificate of occupancy, zoning use permit),
 * an Equipment Schedule page, and ONE print-ready PDF that puts everything in the order a reviewer expects —
 * cover sheet, application, HACCP plan / menu and equipment, equipment schedule, cut sheets, then the approvals.
 */
import { Router, Response } from "express";
import crypto from "crypto";
import { PDFDocument, StandardFonts, rgb, PDFFont } from "pdf-lib";
import { query, queryOne } from "../../config/db";
import { AuthedRequest, requireAuth, requireRole } from "../../common/requireAuth";
import { asyncHandler } from "../../common/asyncHandler";
import { logAudit } from "../../common/audit";
import { pdfSafeText } from "../../common/pdfText";
import { writeUploadBlob, readUploadBlob } from "../../common/uploadBlobStorage";
import { scanFileForMalware } from "../../common/malwareScan";
import { generateHaccpPdf } from "./haccpPdf";
import {
  generateFoodLicenseApplicationPdf, generatePlanReviewApplicationPdf, generateCountyFoodServicePermitApplicationPdf,
} from "./licenseApplicationsPdf";
import { loadPlanForUser, toHaccpPdfInput, toLicensePdfInput, type EquipmentSelection } from "./haccp.routes";
import { HACCP_NO_CUT_SHEET_KEYS } from "./haccpContent";

export const haccpPackageRouter = Router();

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_PLAN = 40;
const KINDS = ["cut_sheet", "occupancy", "zoning", "other"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = { cut_sheet: "Equipment cut sheet", occupancy: "Certificate of Occupancy", zoning: "Zoning Use Permit", other: "Additional attachment" };

const TEAL = rgb(0.043, 0.42, 0.42);
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.42, 0.42, 0.42);
const LINE = rgb(0.82, 0.82, 0.82);
const PAGE_W = 612, PAGE_H = 792;

function idSuffix(): string {
  const n = new Date();
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${n.getFullYear()}${pad(n.getMonth() + 1)}${pad(n.getDate())}${pad(n.getHours())}${pad(n.getMinutes())}${pad(n.getSeconds())}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Which file type these bytes really are — by their first bytes, never by the name the browser reported. */
function detectType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 4 && buf.slice(0, 4).toString("latin1") === "%PDF") return { mime: "application/pdf", ext: "pdf" };
  if (buf.length > 8 && buf[0] === 0x89 && buf.slice(1, 4).toString("latin1") === "PNG") return { mime: "image/png", ext: "png" };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}

function etDate(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = pdfSafeText(text).split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(cand, size) > maxWidth && cur) { lines.push(cur); cur = w; } else cur = cand;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

interface AttachmentMeta { attachment_id: string; kind: Kind; equipment_key: string | null; label: string | null; file_name: string; mime_type: string; file_size: number; uploaded_at: string }

async function listAttachments(planId: string): Promise<AttachmentMeta[]> {
  return query<AttachmentMeta>(
    `SELECT attachment_id, kind, equipment_key, label, file_name, mime_type, file_size, uploaded_at
       FROM altax.v3_haccp_plan_attachments WHERE plan_id = $1 ORDER BY uploaded_at ASC`, [planId]
  );
}

async function loadAttachmentBytes(planId: string, attachmentId: string): Promise<{ bytes: Buffer; meta: AttachmentMeta } | null> {
  const row = await queryOne<any>(`SELECT * FROM altax.v3_haccp_plan_attachments WHERE attachment_id = $1 AND plan_id = $2`, [attachmentId, planId]);
  if (!row) return null;
  const base64 = await readUploadBlob(row.attachment_id, row.file_data, row.blob_backend);
  return { bytes: Buffer.from(base64, "base64"), meta: row };
}

function equipmentNeedingCutSheets(equipment: EquipmentSelection[]): EquipmentSelection[] {
  return equipment.filter((e) => !HACCP_NO_CUT_SHEET_KEYS.includes(e.key));
}

// ---------------------------------------------------------------------------
// Equipment Schedule
// ---------------------------------------------------------------------------
export async function generateEquipmentSchedulePdf(plan: any, attachments: AttachmentMeta[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const equipment: EquipmentSelection[] = plan.selected_equipment || [];
  const L = 48, R = PAGE_W - 48;
  const cols = { no: L, name: L + 26, qty: L + 214, model: L + 250, sheet: L + 420 };
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = 56;
  const text = (x: number, yy: number, str: string, size = 9.5, f: PDFFont = font, color = INK) =>
    page.drawText(pdfSafeText(str), { x, y: PAGE_H - yy, size, font: f, color });
  const footer = () => {
    text(L, PAGE_H - 36, `${plan.business_name} - Equipment Schedule`, 8, bold);
    text(L, PAGE_H - 26, `Prepared ${etDate()} for the ${plan.jurisdiction} Health Department.`, 7, font, MUTED);
  };
  const header = () => {
    page.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: TEAL });
    text(L, y, plan.business_name, 14, bold);
    y += 16;
    text(L, y, [plan.street_address, [plan.city, [plan.state, plan.zip_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" - "), 9.5, font, MUTED);
    y += 22;
    text(L, y, "EQUIPMENT SCHEDULE", 12.5, bold, TEAL);
    y += 6;
    page.drawLine({ start: { x: L, y: PAGE_H - y }, end: { x: R, y: PAGE_H - y }, thickness: 0.75, color: LINE });
    y += 14;
    text(L, y, "Every piece of equipment, with the make and model the manufacturer's cut sheet is attached for.", 8.5, font, MUTED);
    y += 18;
  };
  const tableHead = () => {
    page.drawRectangle({ x: L, y: PAGE_H - y - 4, width: R - L, height: 16, color: rgb(0.93, 0.97, 0.97) });
    text(cols.no + 2, y + 8, "#", 8.5, bold, TEAL);
    text(cols.name, y + 8, "Equipment", 8.5, bold, TEAL);
    text(cols.qty, y + 8, "Qty", 8.5, bold, TEAL);
    text(cols.model, y + 8, "Make / model", 8.5, bold, TEAL);
    text(cols.sheet, y + 8, "NSF cut sheet", 8.5, bold, TEAL);
    y += 20;
  };
  header();
  tableHead();
  if (equipment.length === 0) text(L, y + 8, "(no equipment selected)", 9.5, font, MUTED);
  equipment.forEach((e, i) => {
    const needs = !HACCP_NO_CUT_SHEET_KEYS.includes(e.key);
    const attached = attachments.some((a) => a.kind === "cut_sheet" && a.equipment_key === e.key);
    const nameLines = wrap(font, e.label, 9.5, cols.qty - cols.name - 8);
    const modelLines = wrap(font, e.model || "", 9.5, cols.sheet - cols.model - 8);
    const rows = Math.max(nameLines.length, modelLines.length, 1);
    const rowH = rows * 12 + 8;
    if (y + rowH > PAGE_H - 60) { footer(); page = doc.addPage([PAGE_W, PAGE_H]); y = 56; header(); tableHead(); }
    text(cols.no + 2, y + 10, String(i + 1), 9.5);
    nameLines.forEach((l, li) => text(cols.name, y + 10 + li * 12, l, 9.5));
    text(cols.qty, y + 10, String(e.quantity || 1), 9.5);
    modelLines.forEach((l, li) => text(cols.model, y + 10 + li * 12, l, 9.5));
    if (!e.model && needs) text(cols.model, y + 10, "(model needed)", 9, font, rgb(0.7, 0.35, 0.05));
    text(cols.sheet, y + 10, !needs ? "Not required" : attached ? "Attached" : "Needed", 9.5, attached ? bold : font, !needs ? MUTED : attached ? TEAL : rgb(0.7, 0.35, 0.05));
    y += rowH;
    page.drawLine({ start: { x: L, y: PAGE_H - y + 2 }, end: { x: R, y: PAGE_H - y + 2 }, thickness: 0.5, color: LINE });
  });
  y += 14;
  const missing = equipmentNeedingCutSheets(equipment).filter((e) => !attachments.some((a) => a.kind === "cut_sheet" && a.equipment_key === e.key)).length;
  if (y + 30 < PAGE_H - 60) text(L, y, missing ? `${missing} cut sheet${missing === 1 ? "" : "s"} still to attach.` : "All required cut sheets are attached behind this page.", 9, font, MUTED);
  footer();
  return doc.save();
}

// ---------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------
interface Section { title: string; doc: PDFDocument; note?: string }

async function pdfFromBytes(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/** An uploaded image becomes a letter-size page with the picture scaled to fit. */
async function pdfFromImage(bytes: Buffer, mime: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const img = mime === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const maxW = PAGE_W - 72, maxH = PAGE_H - 96;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2, width: w, height: h });
  return doc;
}

async function buildPacket(plan: any, attachments: AttachmentMeta[]): Promise<{ bytes: Uint8Array; pending: string[] }> {
  const components: string[] = plan.components || [];
  const isCounty = plan.jurisdiction === "Baltimore County";
  const equipment: EquipmentSelection[] = plan.selected_equipment || [];
  const sections: Section[] = [];
  const pending: string[] = [];

  if (components.includes("license_application")) {
    const bytes = isCounty ? await generateCountyFoodServicePermitApplicationPdf(toLicensePdfInput(plan)) : await generateFoodLicenseApplicationPdf(toLicensePdfInput(plan));
    sections.push({ title: isCounty ? "Food Service Facility Permit Application and Fee Statement" : "Food Facility License Application", doc: await pdfFromBytes(bytes), note: "Owner signs and dates" });
    pending.push("Owner's signature and date on the application");
    pending.push(isCounty ? "Check payable to “Baltimore County, Maryland” for the amount on the Fee Statement" : "Check or money order payable to “Director of Finance”");
  }
  if (components.includes("haccp_plan") || components.includes("menu_equipment")) {
    const only = components.includes("haccp_plan") ? undefined : "menu_equipment";
    const bytes = await generateHaccpPdf(toHaccpPdfInput(plan, only));
    sections.push({ title: components.includes("haccp_plan") ? "HACCP Plan, Menu and Equipment List" : "Menu and Equipment List (with priority assessment)", doc: await pdfFromBytes(bytes) });
  }
  if (equipment.length > 0 && (components.includes("menu_equipment") || components.includes("plan_review"))) {
    sections.push({ title: "Equipment Schedule", doc: await pdfFromBytes(await generateEquipmentSchedulePdf(plan, attachments)) });
  }
  // Cut sheets in the order the equipment is listed, then any extra attachments of that kind.
  const needed = equipmentNeedingCutSheets(equipment);
  for (const e of needed) {
    const a = attachments.find((x) => x.kind === "cut_sheet" && x.equipment_key === e.key);
    if (!a) { pending.push(`Cut sheet for ${e.label}${e.model ? ` (${e.model})` : ""}`); continue; }
    const loaded = await loadAttachmentBytes(plan.plan_id, a.attachment_id);
    if (loaded) sections.push({ title: `Cut sheet — ${e.label}${e.model ? ` (${e.model})` : ""}`, doc: loaded.meta.mime_type === "application/pdf" ? await pdfFromBytes(loaded.bytes) : await pdfFromImage(loaded.bytes, loaded.meta.mime_type) });
  }
  for (const kind of ["occupancy", "zoning", "other"] as Kind[]) {
    const list = attachments.filter((a) => a.kind === kind || (kind === "other" && a.kind === "cut_sheet" && !equipment.some((e) => e.key === a.equipment_key)));
    if (list.length === 0 && kind !== "other") { pending.push(`Copy of the ${KIND_LABEL[kind]}`); continue; }
    for (const a of list) {
      const loaded = await loadAttachmentBytes(plan.plan_id, a.attachment_id);
      if (loaded) sections.push({ title: `${a.label || KIND_LABEL[kind]}`, doc: loaded.meta.mime_type === "application/pdf" ? await pdfFromBytes(loaded.bytes) : await pdfFromImage(loaded.bytes, loaded.meta.mime_type) });
    }
  }
  if (components.includes("plan_review") && !isCounty) {
    sections.push({ title: "Plan Review Application", doc: await pdfFromBytes(await generatePlanReviewApplicationPdf(toLicensePdfInput(plan))), note: "Owner signs and dates" });
  }

  // ---- cover sheet (page numbers are known now that every section's length is) ----
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const cover = out.addPage([PAGE_W, PAGE_H]);
  const L = 56, R = PAGE_W - 56;
  const draw = (x: number, yy: number, str: string, size = 10, f: PDFFont = font, color = INK) => cover.drawText(pdfSafeText(str), { x, y: PAGE_H - yy, size, font: f, color });
  cover.drawRectangle({ x: 0, y: PAGE_H - 6, width: PAGE_W, height: 6, color: TEAL });
  let y = 70;
  draw(L, y, "HEALTH PERMIT SUBMISSION PACKET", 17, bold, TEAL); y += 26;
  draw(L, y, plan.business_name, 14, bold); y += 17;
  draw(L, y, [plan.street_address, [plan.city, [plan.state, plan.zip_code].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(" - "), 10, font, MUTED); y += 15;
  draw(L, y, `${plan.jurisdiction} Health Department  -  Prepared ${etDate()}`, 10, font, MUTED); y += 15;
  const submitTo: string[] = [isCounty
    ? "Submit to: Baltimore County Department of Health, Division of Environmental Health Services, 6401 York Road, Third Floor, Baltimore, MD 21212"
    : "Submit to: Baltimore City Health Department, Environmental Inspection Services, 1001 E. Fayette Street, Baltimore, MD 21202"];
  if (isCounty && plan.license_application_data?.county?.buildingPermit === "yes") {
    submitTo.push("Building work: Baltimore County Department of Permits, Approvals and Inspections, Building Inspections, 111 W. Chesapeake Avenue, Room 100, Towson, MD 21204");
  }
  if (isCounty) submitTo.push("The County's Plans Review Guide is an information sheet and is not filed.");
  for (const line of submitTo) for (const w of wrap(font, line, 8.5, R - L)) { draw(L, y, w, 8.5, font, MUTED); y += 12; }
  y += 14;
  cover.drawLine({ start: { x: L, y: PAGE_H - y }, end: { x: R, y: PAGE_H - y }, thickness: 0.75, color: LINE }); y += 22;
  draw(L, y, "CONTENTS", 11, bold, TEAL); y += 18;
  let pageNo = 2;
  sections.forEach((sec, i) => {
    const count = sec.doc.getPageCount();
    const range = count > 1 ? `${pageNo}-${pageNo + count - 1}` : String(pageNo);
    draw(L, y, `${i + 1}.`, 10, bold);
    draw(L + 22, y, sec.title + (sec.note ? `  (${sec.note})` : ""), 10);
    draw(R - font.widthOfTextAtSize(`p. ${range}`, 10), y, `p. ${range}`, 10, font, MUTED);
    y += 16;
    pageNo += count;
  });
  y += 14;
  if (pending.length) {
    draw(L, y, "STILL NEEDED BEFORE YOU FILE", 11, bold, rgb(0.7, 0.35, 0.05)); y += 18;
    for (const item of pending) {
      for (const [i, line] of wrap(font, item, 10, R - L - 24).entries()) { draw(i === 0 ? L : L + 14, y, i === 0 ? `[  ]  ${line}` : line, 10); y += 14; }
    }
  } else {
    draw(L, y, "Everything on the checklist is attached.", 10, font, TEAL);
  }
  draw(L, PAGE_H - 40, "Prepared by AL Tax Service. The health department assigns the final priority and decides what it needs.", 7.5, font, MUTED);

  for (const sec of sections) {
    const copied = await out.copyPages(sec.doc, sec.doc.getPageIndices());
    copied.forEach((p) => out.addPage(p));
  }
  return { bytes: await out.save(), pending };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function planOr404(req: AuthedRequest, res: Response): Promise<any | null> {
  const plan = await loadPlanForUser(req, req.params.planId);
  if (plan === null) { res.status(404).json({ error: "Plan not found." }); return null; }
  if (plan === "forbidden") { res.status(403).json({ error: "You do not have access to this plan." }); return null; }
  return plan;
}

haccpPackageRouter.get("/plans/:planId/attachments", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  res.json({ attachments: await listAttachments(plan.plan_id) });
}));

haccpPackageRouter.post("/plans/:planId/attachments", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  const body = req.body || {};
  const kind = String(body.kind || "") as Kind;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: "Unknown attachment type." });
  const equipmentKey = kind === "cut_sheet" ? String(body.equipmentKey || "").trim() || null : null;
  if (kind === "cut_sheet" && (!equipmentKey || !(plan.selected_equipment || []).some((e: EquipmentSelection) => e.key === equipmentKey))) {
    return res.status(400).json({ error: "Pick the equipment this cut sheet belongs to (save the plan first if you just added it)." });
  }
  const cleaned = String(body.fileBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
  if (!cleaned) return res.status(400).json({ error: "A file is required." });
  if (Math.ceil((cleaned.length * 3) / 4) > MAX_ATTACHMENT_BYTES) return res.status(400).json({ error: "That file is larger than 8MB. Save it as a smaller PDF or photo and try again." });
  const buf = Buffer.from(cleaned, "base64");
  const type = detectType(buf);
  if (!type) return res.status(400).json({ error: "Only PDF, PNG or JPG files can be attached." });
  const fileName = String(body.fileName || `${KIND_LABEL[kind]}.${type.ext}`).replace(/[\\/:*?"<>|\r\n]/g, "-").slice(0, 200);
  const scan = await scanFileForMalware(buf, fileName);
  if (scan.scanned && !scan.clean) return res.status(400).json({ error: "That file did not pass the virus scan." });

  const existing = await listAttachments(plan.plan_id);
  if (kind !== "other" && existing.some((a) => a.kind === kind && (kind !== "cut_sheet" || a.equipment_key === equipmentKey))) {
    // One cut sheet per piece of equipment, one certificate, one zoning permit: a new upload replaces the old one.
    await query(`DELETE FROM altax.v3_haccp_plan_attachments WHERE plan_id = $1 AND kind = $2 AND COALESCE(equipment_key,'') = COALESCE($3,'')`, [plan.plan_id, kind, equipmentKey]);
  } else if (existing.length >= MAX_ATTACHMENTS_PER_PLAN) {
    return res.status(400).json({ error: `A plan can hold up to ${MAX_ATTACHMENTS_PER_PLAN} attachments.` });
  }
  const attachmentId = `HPA-${idSuffix()}`;
  const { fileData, blobBackend } = await writeUploadBlob(attachmentId, buf.toString("base64"));
  await query(
    `INSERT INTO altax.v3_haccp_plan_attachments (attachment_id, plan_id, kind, equipment_key, label, file_name, mime_type, file_size, file_data, blob_backend, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [attachmentId, plan.plan_id, kind, equipmentKey, String(body.label || "").trim().slice(0, 255) || null, fileName, type.mime, buf.length, fileData, blobBackend, req.user!.email]
  );
  await logAudit("Haccp", "PLAN_ATTACHMENT_ADDED", plan.plan_id, kind, "", fileName, `${KIND_LABEL[kind]} attached to ${plan.business_name} by ${req.user!.email}.`, req.user!.email);
  res.status(201).json({ ok: true, attachmentId });
}));

haccpPackageRouter.post("/plans/:planId/attachments/:attachmentId/delete", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  const r = await query<any>(`DELETE FROM altax.v3_haccp_plan_attachments WHERE attachment_id = $1 AND plan_id = $2 RETURNING file_name, kind`, [req.params.attachmentId, plan.plan_id]);
  if (!r.length) return res.status(404).json({ error: "Attachment not found." });
  await logAudit("Haccp", "PLAN_ATTACHMENT_REMOVED", plan.plan_id, r[0].kind, r[0].file_name, "", `Attachment removed from ${plan.business_name} by ${req.user!.email}.`, req.user!.email);
  res.json({ ok: true });
}));

haccpPackageRouter.get("/plans/:planId/attachments/:attachmentId/file", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  const loaded = await loadAttachmentBytes(plan.plan_id, req.params.attachmentId);
  if (!loaded) return res.status(404).json({ error: "Attachment not found." });
  res.setHeader("Content-Type", loaded.meta.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${loaded.meta.file_name.replace(/"/g, "")}"`);
  res.send(loaded.bytes);
}));

haccpPackageRouter.get("/plans/:planId/equipment-schedule.pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  const bytes = await generateEquipmentSchedulePdf(plan, await listAttachments(plan.plan_id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="EquipmentSchedule_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

haccpPackageRouter.get("/plans/:planId/package.pdf", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req: AuthedRequest, res: Response) => {
  const plan = await planOr404(req, res); if (!plan) return;
  const { bytes } = await buildPacket(plan, await listAttachments(plan.plan_id));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="SubmissionPacket_${plan.plan_id}.pdf"`);
  res.send(Buffer.from(bytes));
}));

export { buildPacket, listAttachments };
