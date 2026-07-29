-- ---------------------------------------------------------------------------
-- Tools: Fee Schedule + Estimates
--
-- Design rule, stated by the firm and enforced here: NO FEE AMOUNT IS EVER
-- HARDCODED. Agencies change their prices, and the firm's own pricing changes
-- with them. Everything below is data the firm edits in the app; the code only
-- knows how fees COMBINE (base + speed + copies + a percentage fee), never what
-- any of them cost.
-- ---------------------------------------------------------------------------

-- ---- Fee catalog -----------------------------------------------------------
-- One row per chargeable item. Rows are filtered into an estimate by entity
-- type, business type, jurisdiction and processing speed, so picking
-- "Carryout / Baltimore City / Expedited" assembles the right priced checklist.
CREATE TABLE IF NOT EXISTS v3_fee_items (
    fee_item_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    -- 'Government' = collected for an agency (SDAT, health dept, fire, clerk).
    -- 'Service'    = AL TAX's own work. Drives the split totals on the estimate
    --               and keeps agency money out of reported revenue.
    category VARCHAR(32) NOT NULL DEFAULT 'Government',
    agency VARCHAR(255),
    -- "Maryland" for state filings, else the county/city whose fee this is.
    jurisdiction VARCHAR(255) NOT NULL DEFAULT 'Maryland',

    -- Empty array = applies to every entity/business type. Otherwise the line
    -- only appears for the listed ones (health permits for food service, etc).
    entity_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    business_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- NULL = any speed. 'Expedited'/'Rush' rows are added only at that speed,
    -- which is how SDAT actually prices: a base filing plus a speed surcharge.
    speed VARCHAR(32),

    -- 'fixed'   = unit_cost/unit_price as entered.
    -- 'percent' = computed from the government subtotal (the state's 3%
    --             technology fee), so it stays correct when fees change.
    amount_kind VARCHAR(16) NOT NULL DEFAULT 'fixed',
    percent_rate NUMERIC(7,4) NOT NULL DEFAULT 0,

    -- What the agency charges US.
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- What the CLIENT is charged. Usually equal to unit_cost for a pass-through
    -- fee, but kept separate because the firm rounds up (a $216.30 filing billed
    -- at $225). That difference is real margin and has to be attributable.
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    default_qty NUMERIC(10,2) NOT NULL DEFAULT 1,

    -- Shown on the estimate at 0.00 as "Included" (EIN, sales & use tax number).
    included BOOLEAN NOT NULL DEFAULT FALSE,
    -- Never auto-added; staff opt in per estimate (extra certified copies).
    optional BOOLEAN NOT NULL DEFAULT FALSE,
    -- Jurisdictions are hierarchical: a state filing is owed on a county job too.
    statewide BOOLEAN NOT NULL DEFAULT FALSE,
    -- Real work (file the articles, get the permit) rather than a surcharge on
    -- someone else's filing, so converting the estimate opens a task for it.
    creates_task BOOLEAN NOT NULL DEFAULT FALSE,
    turnaround_days VARCHAR(64),
    notes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fee_items_jurisdiction ON v3_fee_items (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_fee_items_active ON v3_fee_items (active);

-- ---- Estimates -------------------------------------------------------------
-- Deliberately holds the prospect's own details rather than pointing at a
-- client record: a business being quoted is not a client yet, and the Clients
-- list should not fill up with people who never signed. client_id is set only
-- when the estimate is approved and converted.
CREATE TABLE IF NOT EXISTS v3_estimates (
    estimate_id VARCHAR(64) PRIMARY KEY,
    estimate_number VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'Draft',

    business_name VARCHAR(255) NOT NULL,
    contact_name VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(64),
    street VARCHAR(255),
    city VARCHAR(128),
    state VARCHAR(32),
    zip VARCHAR(16),

    entity_type VARCHAR(64),
    business_type VARCHAR(128),
    jurisdiction VARCHAR(255),
    speed VARCHAR(32) NOT NULL DEFAULT 'Standard',

    estimate_date DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE,
    prepared_by VARCHAR(255),

    discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    tax_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    deposit_date DATE,
    terms TEXT,
    internal_note TEXT,

    -- Approval is recorded by staff (the firm approves after speaking to the
    -- client), so HOW it was approved is captured for the record the same way
    -- the contracts module records an in-person signature.
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(255),
    approval_method VARCHAR(64),
    declined_reason TEXT,

    client_id VARCHAR(64),
    converted_at TIMESTAMPTZ,
    contract_id VARCHAR(64),
    invoice_id VARCHAR(64),

    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estimates_status ON v3_estimates (status);
CREATE INDEX IF NOT EXISTS idx_estimates_client ON v3_estimates (client_id);

-- ---- Estimate lines --------------------------------------------------------
-- Amounts are COPIED from the catalog, never referenced live: a fee rise next
-- year must not silently rewrite an estimate already sent to a client.
CREATE TABLE IF NOT EXISTS v3_estimate_lines (
    line_id VARCHAR(64) PRIMARY KEY,
    estimate_id VARCHAR(64) NOT NULL,
    fee_item_id VARCHAR(64),
    sort_order INTEGER NOT NULL DEFAULT 0,

    description VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL DEFAULT 'Government',
    agency VARCHAR(255),
    qty NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount_kind VARCHAR(16) NOT NULL DEFAULT 'fixed',
    percent_rate NUMERIC(7,4) NOT NULL DEFAULT 0,
    included BOOLEAN NOT NULL DEFAULT FALSE,
    creates_task BOOLEAN NOT NULL DEFAULT FALSE,

    -- 'Firm' = we collect it and remit it. 'Client' = they pay the agency
    -- directly, so it is shown for planning but excluded from what they owe us.
    payer VARCHAR(16) NOT NULL DEFAULT 'Firm',

    -- Agency ledger: proof this money actually reached the agency. Without it,
    -- money collected for a permit can sit in the account while the filing is
    -- quietly never made.
    remitted_at TIMESTAMPTZ,
    remitted_amount NUMERIC(12,2),
    remittance_ref VARCHAR(128),
    remittance_note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_estimate_lines_estimate FOREIGN KEY (estimate_id)
        REFERENCES v3_estimates(estimate_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_estimate ON v3_estimate_lines (estimate_id);
