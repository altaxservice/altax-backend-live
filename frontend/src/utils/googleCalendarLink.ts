/**
 * "Add to Google Calendar" for each appointment (direct owner request,
 * 2026-08-25) — a plain link to Google's own event-creation page, prefilled
 * from data already on screen. No backend involved: Google reads everything
 * from the URL, so this is just string-building.
 */
interface CalendarLinkAppointment {
  title: string;
  start_time: string;
  end_time: string;
  location?: string | null;
  notes?: string | null;
  client_name?: string | null;
  contact_name?: string | null;
}

/** UTC, no dashes/colons, trailing Z — the exact form Google's `dates` param expects. */
function toGoogleUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function buildGoogleCalendarUrl(appt: CalendarLinkAppointment): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: appt.title || "Appointment",
    dates: `${toGoogleUtc(appt.start_time)}/${toGoogleUtc(appt.end_time)}`,
  });
  const who = appt.client_name || appt.contact_name;
  const details = [who ? `With: ${who}` : null, appt.notes || null].filter(Boolean).join("\n\n");
  if (details) params.set("details", details);
  if (appt.location) params.set("location", appt.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
