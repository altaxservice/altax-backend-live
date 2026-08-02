/** Escapes text being interpolated into an HTML string (emails, PDFs) — &, <, > only, matching what every call site here actually needs (attribute values are never built this way). */
export function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));
}
