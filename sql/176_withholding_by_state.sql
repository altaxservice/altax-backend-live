-- A client can owe withholding to more than one state: a DC employer's employee
-- who lives in Maryland has MARYLAND tax withheld and needs Maryland filings, a
-- DC resident needs DC filings. Until now the withholding tracker only knew the
-- client's own state. This makes the state part of every withholding filing and
-- exclusion, and gives each additional state its own filing frequency (the
-- client's home state keeps using the Withholding Frequency on their profile).
CREATE TABLE IF NOT EXISTS altax.v3_client_withholding_states (
    client_id VARCHAR(64) NOT NULL REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE,
    state VARCHAR(2) NOT NULL,
    frequency VARCHAR(20) NOT NULL,
    updated_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, state)
);

-- Existing filings were all recorded for the client's own state.
UPDATE altax.v3_withholding_filings f
   SET state = COALESCE(NULLIF(upper(btrim(c.state)), ''), 'MD')
  FROM altax.v3_clients c
 WHERE c.client_id = f.client_id AND COALESCE(btrim(f.state), '') = '';
ALTER TABLE altax.v3_withholding_filings ALTER COLUMN state SET NOT NULL;

ALTER TABLE altax.v3_withholding_period_exclusions ADD COLUMN IF NOT EXISTS state VARCHAR(2);
UPDATE altax.v3_withholding_period_exclusions x
   SET state = COALESCE(NULLIF(upper(btrim(c.state)), ''), 'MD')
  FROM altax.v3_clients c
 WHERE c.client_id = x.client_id AND COALESCE(btrim(x.state), '') = '';
ALTER TABLE altax.v3_withholding_period_exclusions ALTER COLUMN state SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_schema = 'altax' AND constraint_name = 'v3_withholding_filings_pkey' AND column_name = 'state') THEN
    ALTER TABLE altax.v3_withholding_filings DROP CONSTRAINT v3_withholding_filings_pkey;
    ALTER TABLE altax.v3_withholding_filings ADD PRIMARY KEY (client_id, state, period_end);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage WHERE table_schema = 'altax' AND constraint_name = 'v3_withholding_period_exclusions_pkey' AND column_name = 'state') THEN
    ALTER TABLE altax.v3_withholding_period_exclusions DROP CONSTRAINT v3_withholding_period_exclusions_pkey;
    ALTER TABLE altax.v3_withholding_period_exclusions ADD PRIMARY KEY (client_id, state, period_end);
  END IF;
END $$;
