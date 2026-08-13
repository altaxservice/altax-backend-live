import { query } from "../config/db";

export type JobRunStatus = "success" | "failure" | "skipped";

/**
 * Durable "did this cron job actually run last night" record — before this,
 * only 3 of 11 cron jobs wrote anything queryable; the rest lived only in
 * console output and a best-effort admin email. One row per job, always
 * upserted to its latest run (a last-run record, not a history log) — see
 * GET /system/job-runs and the Fix Center check that reads it.
 */
export async function recordJobRun(jobName: string, status: JobRunStatus, detail?: string): Promise<void> {
  try {
    await query(
      `INSERT INTO altax.v3_job_runs (job_name, last_run_at, last_status, last_detail, updated_at)
       VALUES ($1, now(), $2, $3, now())
       ON CONFLICT (job_name) DO UPDATE SET last_run_at = now(), last_status = $2, last_detail = $3, updated_at = now()`,
      [jobName, status, detail || null]
    );
  } catch (err) {
    // Never let recording the run become the reason the run itself fails to
    // report — same "must not compound the original problem" rule adminAlerts's
    // alertAdmins already follows.
    // eslint-disable-next-line no-console
    console.error(`[jobRuns] failed to record run for ${jobName}:`, err);
  }
}
