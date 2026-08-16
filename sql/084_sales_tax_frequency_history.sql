-- Tracks a client's Maryland sales-tax filing frequency over time, since the
-- Comptroller can reassign it (e.g. Quarterly -> Monthly) effective a given
-- date. v3_clients.sales_tax_frequency stays the fast "current value"
-- lookup; this table lets period-splitting logic (mdFiling.ts) use the
-- frequency that was ACTUALLY in effect for a given historical period
-- instead of silently re-deriving every past period under whatever
-- frequency happens to be set today (see splitIntoMdFilingPeriodsForClient).
CREATE TABLE IF NOT EXISTS altax.v3_client_sales_tax_frequency_history (
    id SERIAL PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    frequency VARCHAR(32) NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_sales_tax_freq_history_client
    ON altax.v3_client_sales_tax_frequency_history (client_id, effective_from);

-- One open-ended backfill row per client with a frequency already on file,
-- anchored far enough in the past to cover all real filing history — so
-- existing clients' period math stays exactly as it is today until the day
-- someone actually records a frequency change for them.
INSERT INTO altax.v3_client_sales_tax_frequency_history (client_id, frequency, effective_from, effective_to, created_by)
SELECT c.client_id, c.sales_tax_frequency, DATE '2000-01-01', NULL, 'system:backfill'
FROM altax.v3_clients c
WHERE c.sales_tax_frequency IS NOT NULL AND c.sales_tax_frequency <> ''
  AND NOT EXISTS (
    SELECT 1 FROM altax.v3_client_sales_tax_frequency_history h WHERE h.client_id = c.client_id
  );
