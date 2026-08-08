-- Two additions to the Ownership Transfer package (see
-- src/modules/clients/ownershipTransfer.routes.ts):
--
-- include_bill_of_sale / include_8822b / include_cra / include_md_amendment_task:
-- staff choose at create time which of the four package outputs to actually
-- generate, instead of all four always being attempted. The Bill of Sale has
-- no separate stored artifact (it's rendered fresh from this row on every
-- download — see billOfSale.ts), so its own flag just controls whether the
-- download buttons show; the other three already record "was this created"
-- via their nullable gov_form_8822b_filing_id / gov_form_cra_filing_id /
-- md_amendment_task_id columns, so no extra flag is needed for those.
--
-- asset_allocations: a structured IRC Section 1060 / Form 8594-style asset
-- allocation schedule (category, description, allocated amount per line)
-- instead of one freeform "assets included" paragraph. When present, the
-- Bill of Sale renders it as a real itemized table and the sum of its lines
-- becomes the sale price (see computeAllocationTotal in
-- ownershipTransfer.routes.ts) — the allocations build the price, not the
-- other way around. NULL/empty for transfers created before this migration,
-- which keep using the legacy assets_included free-text paragraph.
ALTER TABLE altax.v3_ownership_transfers
    ADD COLUMN IF NOT EXISTS include_bill_of_sale BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS asset_allocations JSONB;
