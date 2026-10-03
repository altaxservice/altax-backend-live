-- Soft-hide a period that carried no real obligation (restorable), for the UI,
-- annual report, and Form 941 period tables -- same design as the sales tax and
-- withholding exclusions, one table keyed by which filing it is.
CREATE TABLE IF NOT EXISTS altax.v3_obligation_period_exclusions (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    reason TEXT,
    excluded_by VARCHAR(255),
    excluded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, kind, period_end)
);
