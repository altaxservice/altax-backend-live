-- One-click "Mark Done" for the EFTPS/MD Withholding/MD UI/Business Tax Return
-- obligations added in sql/056 — mirrors v3_md_filing_payments' role for MD
-- Sales Tax (052), but generic across source+due_date since these 4 obligation
-- types have no per-period tax-amount computation of their own to snapshot.
-- Once a (client, source, due_date) row exists here, computeUpcomingDeadlines
-- (complianceCalendar.ts) drops that specific deadline from the dashboard —
-- staff no longer have to go through Rules -> approve -> Tasks -> mark paid
-- just to silence a reminder for an obligation they already handled.
CREATE TABLE IF NOT EXISTS altax.v3_obligation_completions (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    source VARCHAR(64) NOT NULL,
    due_date DATE NOT NULL,
    label VARCHAR(255),
    completed_date DATE NOT NULL,
    completed_by VARCHAR(255) NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, source, due_date)
);
