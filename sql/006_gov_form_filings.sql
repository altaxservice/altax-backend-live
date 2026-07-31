-- ---------------------------------------------------------------------------
-- Tools: general-purpose IRS/other government form filings — Form SS-4
-- (EIN application), Form 2553 (S-Corp election), Form W-9 (TIN request),
-- Form 8332 (release of dependency exemption), Form W-4 (employee
-- withholding certificate).
--
-- One row per generated form, filled onto the agency's own real fillable PDF
-- (src/assets/tax-forms/{ss4,f2553,fw9,f8332,fw4}.pdf), same pattern as
-- v3_poa_filings and the W-2/1099/940/941/1096 generators — never a
-- firm-drawn substitute.
--
-- Unlike v3_poa_filings (which has a handful of shared fields — taxpayer,
-- representatives, tax matters — reused across all three POA forms), these
-- five forms have almost nothing in common with each other (SS-4 asks about
-- entity structure, 8332 asks about a child and two parents, W-4 asks about
-- withholding elections). Rather than five near-empty tables each mostly
-- NULL columns, form_data is one JSONB blob whose shape is defined per
-- form_type in src/modules/govForms/*.ts — the generator for that type is
-- the only code that needs to agree with it.
--
-- client_id is used for SS-4/2553/W9/8332 (client-level); employee_id is
-- used for W-4 (an employee's own withholding election, filed with their
-- employer — not something the IRS ever sees). Exactly one of the two is
-- set, enforced in the route layer rather than a CHECK constraint since
-- "which one" depends on form_type, not a fixed rule the DB can express
-- cleanly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS v3_gov_form_filings (
    filing_id VARCHAR(64) PRIMARY KEY,
    client_id VARCHAR(64),
    employee_id VARCHAR(64),
    -- 'SS4' | '2553' | 'W9' | '8332' | 'W4' | 'CRA'
    form_type VARCHAR(8) NOT NULL,
    -- Form-specific payload — see the generator for form_type for its shape.
    form_data JSONB NOT NULL DEFAULT '{}'::jsonb,

    status VARCHAR(16) NOT NULL DEFAULT 'Draft', -- Draft | Signed | Submitted | Void
    signed_at TIMESTAMPTZ,
    signer_name VARCHAR(255),
    signer_title VARCHAR(255),
    recorded_by VARCHAR(255),

    -- The firm's own record of the manual step outside this app — mailing,
    -- faxing, hand-delivering, or (SS-4 only) applying online/by phone. Most
    -- of these forms (W-9, 8332, W-4) never go to a government agency at
    -- all — they're kept on file or handed to whoever asked for them — so
    -- this stays optional rather than a required step for every form_type.
    submitted_via VARCHAR(32),
    submitted_at TIMESTAMPTZ,
    submitted_note TEXT,

    voided_at TIMESTAMPTZ,
    voided_reason TEXT,

    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT fk_v3_gov_form_filings_client_id FOREIGN KEY (client_id) REFERENCES v3_clients(client_id) ON DELETE SET NULL,
    CONSTRAINT fk_v3_gov_form_filings_employee_id FOREIGN KEY (employee_id) REFERENCES v3_employees(employee_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_gov_form_filings_client ON v3_gov_form_filings (client_id);
CREATE INDEX IF NOT EXISTS idx_gov_form_filings_employee ON v3_gov_form_filings (employee_id);
