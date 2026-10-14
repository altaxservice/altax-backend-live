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

/** Several readings of the same picture (different layouts / enlargement); the caller keeps the one whose numbers add up. */
export async function ocrImageVariants(buffer: Buffer): Promise<string[]> {
  const sharp = (await import("sharp")).default;
  const meta = await sharp(buffer).metadata();
  const longSide = Math.max(meta.width || 0, meta.height || 0) || 1000;
  const prep = async (target: number) => {
    let img = sharp(buffer).rotate().grayscale().normalize();
    const scale = Math.min(Math.max(target / longSide, 0.5), 4);
    img = img.resize({ width: Math.round((meta.width || 1000) * scale), kernel: "lanczos3" });
    return img.sharpen().png().toBuffer();
  };
  const worker = await getWorker();
  const runs: [number, string][] = [[2400, "3"], [2400, "6"], [3200, "4"]];
  const out: string[] = [];
  for (const [target, psm] of runs) {
    await worker.setParameters({ tessedit_pageseg_mode: psm as any });
    const { data } = await worker.recognize(await prep(target));
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
