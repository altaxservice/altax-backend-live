-- ---------------------------------------------------------------------------
-- Tools: IRS/MD Power of Attorney & Information Authorization filings
--
-- One row per generated Form 2848, Form 8821, or MD Form 548 — filled onto
-- the agency's own real fillable PDF (src/assets/tax-forms/{f2848,f8821,md548}.pdf),
-- never a firm-drawn substitute. Structured data is stored here (not a
-- rendered_body string like v3_client_contracts) because the "content" of
-- these documents IS a fixed set of government form fields, not free text —
-- the PDF is regenerated from this data every time it's viewed, so a later
-- correction to, say, a representative's PTIN doesn't require redoing the
-- whole filing.
--
-- Physical signature only, same as the general Authorization to Act/Release
-- of Information (v3_client_contracts, service_key='poa_release'): the IRS
-- only accepts an e-signature on 2848/8821 if submitted through its own
-- online portal, and Maryland has no e-file path for Form 548 at all. This
-- app cannot submit directly to either agency — see submitted_via/submitted_at
-- below, which is the firm's own record of how/when a staff member actually
-- sent the signed copy out, not a live integration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3_poa_filings (
    filing_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64) NOT NULL,
    -- '2848' (IRS POA + Declaration of Representative), '8821' (IRS Tax
    -- Information Authorization — info only, no representation), '548'
    -- (Maryland Comptroller POA).
    form_type VARCHAR(8) NOT NULL,

    -- { name, address, ssn, ein, itin, phone, spouseName, spouseSsn } — same
    -- snapshot reasoning as representatives/tax_matters below: a client's
    -- name/address changing later shouldn't silently rewrite a filing
    -- that may already be signed.
    taxpayer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- [{ name, firmName, address, ptin, cafNumber, phone, fax, email,
    --    sendCopies, designation, jurisdiction, licenseNumber }, ...]
    -- Snapshotted at generation time, same reasoning as contracts'
    -- rendered_body: a representative's PTIN changing later shouldn't alter
    -- a filing already generated (and possibly already signed) under the
    -- old one.
    representatives JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{ description, taxForm, years }, ...] — up to 3 rows, matching all
    -- three forms' own Tax Matters table.
    tax_matters JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- Line 6 (2848) / Line 5 (8821) / page 2 (548) — "check if you do NOT
    -- want to revoke a prior POA/authorization on file". Left unchecked
    -- (false) means what every agency's default is: this filing replaces
    -- any earlier one for the same matters.
    retain_prior BOOLEAN NOT NULL DEFAULT FALSE,
    -- Free-text "additional acts authorized" / "specific deletions" /
    -- notes — meaning varies slightly by form_type, interpreted by the
    -- generator for that type.
    notes TEXT,

    status VARCHAR(16) NOT NULL DEFAULT 'Draft', -- Draft | Signed | Submitted | Void
    signed_at TIMESTAMPTZ,
    signer_name VARCHAR(255),
    signer_title VARCHAR(255),
    recorded_by VARCHAR(255),

    -- The firm's own record of the manual step outside this app — mailing,
    -- faxing, hand-delivering, or (2848/8821 only) uploading through the
    -- IRS's own online portal.
    submitted_via VARCHAR(32),
    submitted_at TIMESTAMPTZ,
    submitted_note TEXT,

    voided_at TIMESTAMPTZ,
    voided_reason TEXT,

    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_poa_filings_client ON v3_poa_filings (client_id);
