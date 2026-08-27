-- Tax return prep moves from a monthly subscription line to a one-time
-- engagement fee — direct owner decision, 2026-08-27: unlike Bookkeeping,
-- Payroll, and Sales Tax Filing, a tax return is genuinely an annual, not a
-- recurring monthly, deliverable. Billing it as a flat $/mo was just an
-- annual fee spread across 12 months; the owner wants it billed the way the
-- other one-time services already are.
--
-- Business Tax Return Preparation stays in CORE_PILLAR_KEYS
-- (subscriptionPricing.ts) on purpose — role only controls billing/whether
-- it's summed into the monthly subscription total, NOT tier eligibility,
-- which is a separate hardcoded service_key list by design (see that file's
-- own doc comment). So this client still counts toward Nexus tier even
-- though the fee itself no longer contributes to subscription_monthly_fee.
--
-- subscriber_discount (NEW column): a flat dollar amount knocked off a
-- one-time service's fee when the client already has at least one other
-- ACTIVE RECURRING service checked (i.e. they're already a subscriber, not
-- just buying tax prep standalone) — the owner's "$50 off if added [to] the
-- full subscription" ask. Generic on purpose (not hardcoded to this one
-- service) in case a similar bundling discount makes sense elsewhere later.
-- NULL/0 means no discount, which is every other service's default.
ALTER TABLE altax.v3_service_catalog
    ADD COLUMN IF NOT EXISTS subscriber_discount NUMERIC(10,2);

UPDATE altax.v3_service_catalog
   SET role = 'one_time', min_fee = 300.00, subscriber_discount = 50.00
 WHERE service_key = 'business_tax_prep';

UPDATE altax.v3_service_catalog
   SET role = 'one_time', min_fee = 200.00
 WHERE service_key = 'personal_tax_prep';
