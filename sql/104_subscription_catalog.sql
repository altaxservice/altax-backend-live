-- Subscription service catalog ("Minimum Fee Schedule") — direct owner
-- request, 2026-08-26: every service becomes its own checkbox with its own
-- editable minimum fee, and a client's monthly subscription price/tier are
-- both derived automatically from whichever boxes are checked, instead of
-- 3 fixed price points staff have to pick manually.
--
-- role: 'core_pillar' | 'addon' | 'one_time'. Core pillars (bookkeeping,
-- payroll, sales_tax, business_tax_prep) decide the subscription TIER — that
-- decision table lives in code (src/common/subscriptionPricing.ts,
-- frontend/src/utils/subscriptionPricing.ts), not here, since it encodes a
-- deliberate business rule (e.g. "Bookkeeping alone still counts as Growth")
-- that shouldn't silently change if someone edits this table's `role`
-- column. Addons and core pillars both add to the subscription PRICE (sum of
-- min_fee for every checked service); one_time services are fully excluded
-- from the subscription — no price contribution, no tier effect — and stay
-- in their own section on the client profile, billed per engagement.
CREATE TABLE IF NOT EXISTS altax.v3_service_catalog (
    service_key   VARCHAR(64) PRIMARY KEY,
    label         VARCHAR(160) NOT NULL,
    group_name    VARCHAR(80) NOT NULL,
    role          VARCHAR(20) NOT NULL CHECK (role IN ('core_pillar', 'addon', 'one_time')),
    min_fee       NUMERIC(10,2),
    sort_order    INT NOT NULL DEFAULT 0,
    active        BOOLEAN NOT NULL DEFAULT true,
    legacy        BOOLEAN NOT NULL DEFAULT false,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    VARCHAR(255)
);

-- Tier names/descriptions are editable (no code deploy needed to rename or
-- re-describe them); the weight/pillar RULE that assigns a client to one of
-- these tier_keys is still the hardcoded decision table in
-- subscriptionPricing.ts — this table only supplies the display text.
CREATE TABLE IF NOT EXISTS altax.v3_subscription_tiers (
    tier_key      VARCHAR(32) PRIMARY KEY,
    tier_name     VARCHAR(120) NOT NULL,
    description   TEXT,
    sort_order    INT NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by    VARCHAR(255)
);

ALTER TABLE altax.v3_clients
    ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(32),
    ADD COLUMN IF NOT EXISTS subscription_monthly_fee NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS subscription_fee_is_custom BOOLEAN NOT NULL DEFAULT false;

INSERT INTO altax.v3_subscription_tiers (tier_key, tier_name, description, sort_order) VALUES
    ('essentials', 'Nexus Essentials', 'A single compliance filing relationship — no ongoing bookkeeping.', 1),
    ('growth', 'Nexus Growth', 'Bookkeeping, or two or more compliance services together.', 2),
    ('complete', 'Nexus Complete', 'Full back-office: bookkeeping and payroll together with tax compliance.', 3)
ON CONFLICT (tier_key) DO NOTHING;

INSERT INTO altax.v3_service_catalog (service_key, label, group_name, role, min_fee, sort_order, active, legacy) VALUES
    ('business_tax_prep', 'Business Tax Return Preparation', 'Tax Preparation', 'core_pillar', 150.00, 10, true, false),
    ('personal_tax_prep', 'Personal Tax Return Preparation', 'Tax Preparation', 'addon', 75.00, 20, true, false),
    ('bookkeeping', 'Bookkeeping & Financial Reporting', 'Bookkeeping & Accounting', 'core_pillar', 250.00, 30, true, false),
    ('payroll', 'Payroll Processing', 'Payroll & Employment', 'core_pillar', 175.00, 40, true, false),
    ('w2_1099', 'W-2 / 1099 Preparation', 'Payroll & Employment', 'addon', 60.00, 50, true, false),
    ('mdui', 'Maryland Unemployment Insurance Filing', 'Payroll & Employment', 'addon', 40.00, 60, true, false),
    ('eftps', 'Federal Tax Deposit Setup (EFTPS)', 'Payroll & Employment', 'addon', 25.00, 70, true, false),
    ('sales_tax', 'Sales & Use Tax Filing', 'Sales Tax & Ongoing Compliance', 'core_pillar', 75.00, 80, true, false),
    ('annual_report', 'Annual Report Filing', 'Sales Tax & Ongoing Compliance', 'addon', 75.00, 90, true, false),
    ('notice_resolution', 'IRS/State Notice Resolution', 'Sales Tax & Ongoing Compliance', 'addon', 100.00, 100, true, false),
    ('formation', 'Business Formation', 'Business Formation & Corporate Maintenance', 'one_time', NULL, 110, true, false),
    ('registered_agent', 'Registered Agent Service', 'Business Formation & Corporate Maintenance', 'addon', 50.00, 120, true, false),
    ('business_transfer', 'Business Transfer Documents', 'Business Formation & Corporate Maintenance', 'one_time', NULL, 130, true, false),
    ('permits_licenses', 'Business Licenses & Permits', 'Licensing & Permits', 'one_time', NULL, 140, true, false),
    ('snap_retailer_application', 'SNAP Retailer Application', 'Licensing & Permits', 'one_time', NULL, 150, true, false),
    ('immigration', 'Immigration Document Preparation', 'Specialty & Advisory', 'one_time', NULL, 160, true, false),
    ('irs_audit_representation', 'IRS/State Audit Representation', 'Specialty & Advisory', 'one_time', NULL, 170, true, false),
    ('consulting', 'Consulting & Administrative Services', 'Specialty & Advisory', 'one_time', NULL, 180, true, false),
    ('client_portal', 'Client Portal Access', 'Client Experience', 'addon', 20.00, 190, true, false),
    -- Legacy key from the old single blanket "Tax Preparation" checkbox — kept
    -- resolvable for clients who already have it checked (same convention as
    -- FIRM_SERVICES' own `legacy: true`), inactive so it no longer appears as
    -- a choice for new selections now that personal/business are split out.
    ('tax_prep', 'Tax Preparation (Legacy)', 'Tax Preparation', 'addon', NULL, 5, false, true)
ON CONFLICT (service_key) DO NOTHING;
