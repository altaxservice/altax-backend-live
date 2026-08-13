-- UX-005 (Hard Audit, 2026-08-13): computeClientFlags()'s BalancePastDue/
-- AgencyPastDue flags are computed fresh on every read, never stored, so a
-- client crossing into past-due never generated an audit_log row — meaning
-- it never reached the since-login digest either (that digest is just a
-- filtered read of v3_audit_log). UX-001 already fixed the "pull" side (the
-- At-Risk Clients dashboard panel); this closes the "push" side. One row per
-- client+flag-type currently active — presence means "already alerted since
-- it started," absence (after a delete on self-clear) means the next
-- occurrence alerts again, same self-healing shape as the flags themselves.
CREATE TABLE IF NOT EXISTS altax.v3_flag_alerts_sent (
    client_id VARCHAR(64) NOT NULL,
    flag_type VARCHAR(32) NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, flag_type)
);
