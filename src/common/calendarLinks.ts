/**
 * "Add to Calendar" support for appointment emails — a Google Calendar link
 * (works everywhere with zero setup on the recipient's end) plus a `.ics`
 * file attachment (what actually makes Apple Mail/Calendar and Outlook
 * offer an inline "Add to Calendar" action; Google Calendar itself doesn't
 * need the attachment since the link covers it).
 *
 * `appt.start_time`/`end_time` are real TIMESTAMPTZ values throughout this
 * app (see sql/022_appointments.sql) — every caller can pass them straight
 * through as ISO strings with no timezone conversion.
 */

export interface CalendarEventInput {
  /** Stable across reschedules — appointment_id, so re-adding after a time
   *  change updates the existing calendar entry by UID match in Google/Apple
   *  Calendar instead of creating a duplicate. SEQUENCE isn't incremented on
   *  reschedule (accepted v1 limitation — some clients may not visually flag
   *  the change as prominently as a bumped SEQUENCE would). */
  uid: string;
  title: string;
  startISO: string;
  endISO: string;
  location?: string | null;
  description?: string | null;
}

function toUtcCompact(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function buildGoogleCalendarUrl(input: CalendarEventInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${toUtcCompact(input.startISO)}/${toUtcCompact(input.endISO)}`,
  });
  if (input.description) params.set("details", input.description);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 TEXT escaping — backslash, comma, semicolon, and newline all need escaping inside a value. */
function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}

export function buildIcsFile(input: CalendarEventInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AL TAX SERVICE//Appointments//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}@altaxservice.app`,
    `DTSTAMP:${toUtcCompact(new Date().toISOString())}`,
    `DTSTART:${toUtcCompact(input.startISO)}`,
    `DTEND:${toUtcCompact(input.endISO)}`,
    `SUMMARY:${icsEscape(input.title)}`,
  ];
  if (input.location) lines.push(`LOCATION:${icsEscape(input.location)}`);
  if (input.description) lines.push(`DESCRIPTION:${icsEscape(input.description)}`);
  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

const THEME_COLORS: Record<"gold" | "green", { bg: string; fg: string }> = {
  gold: { bg: "#c9a86a", fg: "#0f2d3e" },
  green: { bg: "#0f5132", fg: "#ffffff" },
};

export function buildAddToCalendarButtonHtml(googleUrl: string, opts?: { theme?: "gold" | "green" }): string {
  const { bg, fg } = THEME_COLORS[opts?.theme || "green"];
  return `
    <div style="text-align:center; margin-top:10px;">
      <a href="${googleUrl}" style="display:inline-block; background:${bg}; color:${fg}; padding:10px 20px; border-radius:8px; text-decoration:none; font-size:13px; font-weight:700;">
        📅 Add to Calendar
      </a>
    </div>`;
}

/** Ready-to-attach .ics for sendEmail's `attachments` option. */
export function buildIcsAttachment(input: CalendarEventInput): { filename: string; content: Buffer; contentType: string } {
  return { filename: "appointment.ics", content: Buffer.from(buildIcsFile(input), "utf-8"), contentType: "text/calendar" };
}
