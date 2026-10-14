import path from "path";
import os from "os";

/**
 * Reads text out of a picture (a screenshot or phone photo of a POS report). Runs on the server with tesseract.js and the English
 * language data bundled in node_modules, so nothing is sent to any outside service. The picture is cleaned up first (rotated upright,
 * greyscale, contrast stretched, enlarged) because small screenshot text reads far more reliably that way.
 */
let workerPromise: Promise<any> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const langDir = path.join(path.dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
      const worker = await createWorker("eng", 1, { langPath: langDir, gzip: true, cachePath: path.join(os.tmpdir(), "altax-tesseract"), logger: () => {} });
      await worker.setParameters({ preserve_interword_spaces: "1" });
      return worker;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export const isImage = (b: Buffer) => (b[0] === 0x89 && b[1] === 0x50) /* png */ || (b[0] === 0xff && b[1] === 0xd8) /* jpg */ || (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") || b.subarray(0, 3).toString("latin1") === "GIF" || (b[0] === 0x42 && b[1] === 0x4d);

/** Several readings of the same picture at different tilts and layouts; a curved or tilted receipt reads best at a different angle in each part. */
export async function ocrImageVariants(buffer: Buffer): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  const longSide = Math.max(meta.width || 0, meta.height || 0) || 1000;
  const prep = async (target: number, angle: number) => {
    let img = sharp(buffer).rotate();
    if (angle) img = img.rotate(angle, { background: "#ffffff" });
    const scale = Math.min(Math.max(target / longSide, 0.5), 4);
    return img.grayscale().normalize().resize({ width: Math.round((meta.width || 1000) * scale), kernel: "lanczos3" }).sharpen().png().toBuffer();
  };
  const worker = await getWorker();
  const runs: [number, string, number][] = [[2400, "3", 0], [2400, "6", 0], [3200, "4", 0], [2000, "4", -6], [2000, "4", 6], [2000, "4", -3], [2000, "4", 3]];
  const out: string[] = [];
  for (const [target, psm, angle] of runs) {
    await worker.setParameters({ tessedit_pageseg_mode: psm as any });
    const { data } = await worker.recognize(await prep(target, angle));
    out.push(String(data?.text || ""));
  }
  return out;
}

export async function ocrImage(buffer: Buffer): Promise<string> { return (await ocrImageVariants(buffer))[0]; }

/** Cleans common recognition slips in report text before it is parsed (a "$" read as "S", spaces inside amounts). */
export function normalizeOcrText(text: string): string {
  return text
    .replace(/[|¦]/g, " ")
    .replace(/(^|\s)S(?=\d{1,3}(?:,\d{3})*\.\d{2}\b)/g, "$1$")
    .replace(/\$\s+(?=\d)/g, "$")
    .replace(/(\d)\s*,\s*(\d{3})/g, "$1,$2")
    .replace(/(\$?\(?-?\d{1,3}) (\d{3}\.\d{2})\b/g, "$1,$2")
    .replace(/(\d)\s+\.\s*(\d{2})\b/g, "$1.$2")
    .replace(/[ \t]+/g, " ");
}

/**
 * A PDF that is really a picture (a phone screenshot or scan saved as PDF) has no text to read, but it carries the picture inside it.
 * This pulls those pictures out (JPEG streams, and plain 8-bit grey / RGB ones) so they can be read like any other photo.
 */
export async function extractPdfImages(pdf: Buffer): Promise<Buffer[]> {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await import("pdf-lib");
  const zlib = await import("zlib");
  const sharp = (await import("sharp")).default;
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const out: Buffer[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (String(d.get(PDFName.of("Subtype"))) !== "/Image") continue;
    const filter = String(d.get(PDFName.of("Filter")));
    const w = (d.get(PDFName.of("Width")) as any)?.asNumber?.() as number, h = (d.get(PDFName.of("Height")) as any)?.asNumber?.() as number;
    if (!w || !h || w * h < 40_000) continue; // skip icons and decorations
    try {
      if (filter === "/DCTDecode") out.push(Buffer.from(obj.contents));
      else if (filter === "/FlateDecode") {
        const raw = zlib.inflateSync(Buffer.from(obj.contents));
        const bpc = (d.get(PDFName.of("BitsPerComponent")) as any)?.asNumber?.();
        const channels = Math.round(raw.length / (w * h));
        if (bpc === 8 && (channels === 1 || channels === 3)) out.push(await sharp(raw, { raw: { width: w, height: h, channels: channels as 1 | 3 } }).png().toBuffer());
      }
    } catch { /* an image we can't decode is skipped */ }
  }
  void PDFNumber;
  return out.slice(0, 6);
}
