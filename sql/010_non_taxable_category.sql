-- ---------------------------------------------------------------------------
-- A universal (state = NULL) "Non-Taxable Sales" category at 0%, so a
-- SNAP/EBT sale or other exempt item can be entered as its own line item —
-- its amount still flows into the gross sales total (the sum of every
-- line's taxable_amount) without being taxed, matching Form 202 Line 3's
-- definition ("taxable and non-taxable direct sales"). Appears automatically
-- in both Accounting -> Sales Input and the Calculators sales tax tool for
-- every state, since both already query
-- "WHERE state = $1 OR state IS NULL" for their category lists.
-- ---------------------------------------------------------------------------
INSERT INTO v3_tax_rates (rate_id, scope, client_id, client_name, rate_type, rate, wage_cap, state, active, notes)
VALUES ('CAT-NON-TAXABLE', 'Global', NULL, NULL, 'Non-Taxable Sales (SNAP/EBT, exempt items)', 0, NULL, NULL, true,
        'Universal 0% category so non-taxable sales still count toward gross sales totals.')
ON CONFLICT DO NOTHING;

INSERT INTO v3_sales_tax_categories (category_id, category_name, state, default_rate_id, filing_box_label, display_order, active, notes)
VALUES ('CAT-NON-TAXABLE', 'Non-Taxable Sales (SNAP/EBT, exempt items)', NULL, 'CAT-NON-TAXABLE', NULL, 999, true,
        'state = NULL (universal) so it appears for every state automatically.')
ON CONFLICT (category_id) DO NOTHING;
