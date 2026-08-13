-- Hard audit (2026-08-13), Phase 1: AUTO-009. Only 3 of 11 cron jobs wrote any
-- durable record of whether they actually ran — everything else lived only in
-- console output and a best-effort admin email, neither of which is queryable
-- after the fact. One row per job, always upserted to its latest run (this is
-- a "last run" record, not a history log).
CREATE TABLE IF NOT EXISTS altax.v3_job_runs (
    job_name VARCHAR(64) PRIMARY KEY,
    last_run_at TIMESTAMPTZ,
    last_status VARCHAR(16) NOT NULL DEFAULT 'unknown',
    last_detail TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
