/** Reads a browsed File into base64 (no data: prefix) for the upload endpoints that embed small files directly. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
