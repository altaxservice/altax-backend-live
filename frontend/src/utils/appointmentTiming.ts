/**
 * Pure "where is this appointment relative to right now" math — shared by
 * the Calendar page's live clock widget and per-row timing badges, and the
 * Command Center's Today's Appointments panel, so all three ever agree on
 * what "starting soon" means. No side effects, no DOM — callers own their
 * own ticking (setInterval re-render), this just computes off whatever
 * `now` they pass in.
 */
export type AppointmentPhase = "before" | "during" | "after";

export interface AppointmentTiming {
  phase: AppointmentPhase;
  /** Human label — "Starts in 12m", "In progress — 8m left", "Ended 5m ago". */
  label: string;
  /** Just the duration text ("12m", "8m", "5m") — for a caller that wants to style the number apart from the surrounding words, rather than parsing it back out of `label`. */
  durationText: string;
  /** 0-100, only meaningful during the appointment (elapsed / total duration). */
  progressPct: number | null;
  /** True inside the "about to start" window — the moment a "before" phase should read as urgent, not just informational. */
  startingSoon: boolean;
}

/** mm:ss under a minute, otherwise "Xh Ym" / "Xm" — no seconds once past the first minute, so the display doesn't jitter distractingly on a slow glance. */
export function fmtDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

const STARTING_SOON_MS = 30 * 60 * 1000;

export function computeAppointmentTiming(startISO: string, endISO: string, now: number): AppointmentTiming {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();

  if (now < start) {
    const untilStart = start - now;
    const d = fmtDuration(untilStart);
    return { phase: "before", label: `Starts in ${d}`, durationText: d, progressPct: null, startingSoon: untilStart <= STARTING_SOON_MS };
  }
  if (now < end) {
    const total = Math.max(1, end - start);
    const elapsed = now - start;
    const d = fmtDuration(end - now);
    return {
      phase: "during", label: `In progress — ${d} left`, durationText: d,
      progressPct: Math.min(100, Math.max(0, (elapsed / total) * 100)), startingSoon: false,
    };
  }
  const d = fmtDuration(now - end);
  return { phase: "after", label: `Ended ${d} ago`, durationText: d, progressPct: null, startingSoon: false };
}

/**
 * Picks the single most relevant appointment out of a set for a "what's
 * happening right now" widget: an appointment actually in progress always
 * wins (most urgent to know about); otherwise the soonest upcoming one;
 * otherwise the most recently ended one, but only while it's still recent
 * enough to matter (30 minutes) rather than showing a stale "ended 6 hours
 * ago" all afternoon.
 */
export function pickMostRelevantAppointment<T extends { start_time: string; end_time: string }>(
  appointments: T[], now: number
): T | null {
  let inProgress: T | null = null;
  let soonestUpcoming: T | null = null;
  let mostRecentlyEnded: T | null = null;

  for (const a of appointments) {
    const start = new Date(a.start_time).getTime();
    const end = new Date(a.end_time).getTime();
    if (now >= start && now < end) {
      if (!inProgress || start < new Date(inProgress.start_time).getTime()) inProgress = a;
    } else if (now < start) {
      if (!soonestUpcoming || start < new Date(soonestUpcoming.start_time).getTime()) soonestUpcoming = a;
    } else if (now - end <= STARTING_SOON_MS) {
      if (!mostRecentlyEnded || end > new Date(mostRecentlyEnded.end_time).getTime()) mostRecentlyEnded = a;
    }
  }
  return inProgress || soonestUpcoming || mostRecentlyEnded;
}
