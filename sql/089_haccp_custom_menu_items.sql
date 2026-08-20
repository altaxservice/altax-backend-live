-- A reusable library of custom (non-master-list) HACCP menu items, separate
-- from the shared HACCP_MENU_CATEGORIES checklist in haccpContent.ts on
-- purpose: that checklist is the same ~35 generic categories shown on every
-- plan for every client (convenience stores, delis, restaurants alike), so
-- growing it with one client's specific dish names (e.g. "Chicken Shawarma")
-- would clutter every other client's plan. This table instead backs an
-- opt-in "choose from previously used items" picker — selecting from it only
-- ever adds the item to the ONE plan being built, exactly like typing it by
-- hand would, it just saves staff from retyping something already entered
-- once. Auto-populated whenever a plan is saved with a custom item that
-- isn't already in the master list — see POST/PATCH /haccp/plans.
CREATE TABLE IF NOT EXISTS altax.v3_haccp_custom_menu_items (
    label VARCHAR(255) PRIMARY KEY,
    created_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
