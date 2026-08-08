-- Business Ownership Transfer package: one intake (old owner -> new owner,
-- effective date, sale terms) that fans out to the documents a transfer
-- actually needs, instead of five disconnected manual steps. See
-- src/modules/clients/ownershipTransfer.routes.ts.
--
-- The Bill of Sale itself isn't a government form, so it doesn't belong in
-- v3_gov_form_filings — its terms are stored here and the PDF is generated
-- on demand (same "regenerate from stored data" pattern as every other PDF
-- in this app, never a stored blob). The 8822-B and CRA filings this same
-- route creates DO go into v3_gov_form_filings (gov_form_8822b_filing_id /
-- gov_form_cra_filing_id below are just pointers back to them), so they show
-- up in the client's existing Government Forms section with zero new UI.
CREATE TABLE IF NOT EXISTS altax.v3_ownership_transfers (
    transfer_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    seller_name VARCHAR(255) NOT NULL,
    seller_title VARCHAR(255),
    buyer_name VARCHAR(255) NOT NULL,
    buyer_title VARCHAR(255),
    -- Same category of PII as v3_clients.company_contact_ssn — encrypted at
    -- rest from the start (see encryptValue/decryptTolerant usage in
    -- ownershipTransfer.routes.ts), never stored plaintext even briefly.
    buyer_ssn TEXT,
    buyer_email VARCHAR(255),
    buyer_phone VARCHAR(255),
    buyer_street_address VARCHAR(255),
    buyer_city VARCHAR(255),
    buyer_state VARCHAR(255),
    buyer_zip_code VARCHAR(255),
    effective_date DATE,
    sale_price NUMERIC(14,2),
    assets_included TEXT,
    liabilities_included TEXT,
    additional_terms TEXT,
    gov_form_8822b_filing_id VARCHAR(64),
    gov_form_cra_filing_id VARCHAR(64),
    md_amendment_task_id VARCHAR(64),
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_v3_ownership_transfers_client_id FOREIGN KEY (client_id) REFERENCES altax.v3_clients(client_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_v3_ownership_transfers_client ON altax.v3_ownership_transfers(client_id);
