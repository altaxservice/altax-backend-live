-- Manual bank reconciliation — a client uploads their bank's CSV statement export,
-- staff match each line to an existing GL entry (or create the missing GL entry
-- directly from the bank line, e.g. a bank fee no one recorded yet). account_name
-- matches v3_gl_entries.account / v3_coa.account_name (the free-text convention
-- every other accounting feature in this app already uses), identifying which GL
-- cash/bank asset account a given statement belongs to.
CREATE TABLE IF NOT EXISTS altax.v3_bank_statement_lines (
    line_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    account_name VARCHAR(255) NOT NULL,
    statement_date DATE NOT NULL,
    description TEXT,
    -- Positive = money in (deposit), negative = money out (withdrawal) — the bank's
    -- own sign convention, not the GL's debit/credit convention.
    amount NUMERIC(14,2) NOT NULL,
    matched_gl_entry_id VARCHAR(64),
    uploaded_by VARCHAR(255),
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_v3_bank_statement_lines_client_account ON altax.v3_bank_statement_lines(client_id, account_name);
CREATE INDEX IF NOT EXISTS idx_v3_bank_statement_lines_matched ON altax.v3_bank_statement_lines(matched_gl_entry_id);
